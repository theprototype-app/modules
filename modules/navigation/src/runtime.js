// navigation — THE RUNTIME: who steps the NPCs, how their poses reach every peer, and the six
// behaviours (Enemy, Chase, Flee, Move To, Patrol, Wander).
//
// AUTHORITY. One peer steps the crowd: the lowest peer id among the peers that are in Play or
// Interact right now (each active peer says so with a 2 s heartbeat). Everyone computes the same
// answer from the same roster, so no message elects it. A peer in Edit never steps (its tab may
// be busy with an edit tool) — but an NPC still moves for a player while the authority edits,
// because the authority IS a player then. When nobody plays, the NPCs rest at their editor pose.
//
// THE WIRE. The authority broadcasts a snapshot ~10 times a second: per NPC its world origin,
// yaw, state, debug label and (every 5th snapshot) its path corners. Peers ease toward it with
// the measured velocity, so a 100 ms gap reads as motion, not steps. A late joiner gets the last
// snapshot through registerStateSync. Events ("attack", "unreachable" …) are fired by the
// authority alone through fireNodeTrigger, which replicates — a Counter counts each one once.
//
// THE OBJECT. An NPC is an object whose own graph holds a nav effect node: the effect writes its
// pose each frame while this peer is in Play or Interact, and writes nothing in Edit (core then
// rests it at its base pose — the editor pose IS its home). Moving it makes 57's motion-driven
// locomotion play its walk / run clips by itself.
//
// LAZY. Nothing about recast loads until a scene holds a navigation node AND someone needs the
// mesh (an NPC to step, or the overlay switched on): a scene without NPCs downloads no wasm.

import { normalizeNpc, newBrain, think, STATES, yawToward } from './brain.js';
import { makeWorkerClient } from './workerClient.js';
import { capsFor, npcCapMessage, bakeCapMessage } from './caps.js';

/** effect node types, by priority when one object carries several (lower wins) */
export const NAV_EFFECTS = Object.freeze({ navnpc: 0, navchase: 1, navflee: 2, navmoveto: 3, navpatrol: 4, navwander: 5 });
export const NAV_TYPES = [...Object.keys(NAV_EFFECTS), 'navnoise', 'navevent', 'navstate', 'navmesh'];
/** the events On NPC Event offers */
export const NPC_EVENTS = ['spotted', 'heard', 'attack', 'lost', 'gaveup', 'returned', 'unreachable', 'arrived'];
export const WHY = ['any', 'off mesh', 'blocked', 'too far'];

const SNAP_MS = 100;
const THINK_MS = 100;
const WATCH_MS = 1000;
const BEAT_MS = 2000;
const BEAT_TTL = 5500;
const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
const dist = (/** @type {number[]} */ a, /** @type {number[]} */ b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dxz = (/** @type {number[]} */ a, /** @type {number[]} */ b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const wrapAngle = (/** @type {number} */ a) => Math.atan2(Math.sin(a), Math.cos(a));

/** @param {any} api */
export function createRuntime(api) {
	const THREE = api.THREE;
	const client = makeWorkerClient(api);
	const caps = capsFor(api);
	const me = () => String(api.peerId?.() ?? '');

	/** uuid -> the nav effect driving that object this frame @type {Map<string, any>} */
	const seen = new Map();
	/** uuid -> what every peer draws: {target, vel, disp, yaw, yawTarget, state, label, why, corners, at} @type {Map<string, any>} */
	const shown = new Map();
	/** uuid -> the authority's bookkeeping @type {Map<string, any>} */
	const agents = new Map();
	/** peerId -> last heartbeat (ms) @type {Map<string, number>} */
	const activePeers = new Map();
	/** node id -> the npc uuid an On NPC Event / NPC State listens to (null = any) @type {Map<string, string | null>} */
	const eventTarget = new Map();
	/** Make Noise nodes: id -> {sources: string[], at: string|null, loudness} @type {Map<string, any>} */
	const noiseNodes = new Map();
	/** a source node's last stamp seen (Make Noise edge detection) @type {Map<string, number>} */
	const noiseStamps = new Map();
	/** @type {{pos: number[], loudness: number, until: number, heardBy?: boolean}[]} */
	let noises = [];
	/** players' feet, from the worker's probe @type {Map<string, number[]>} */
	const playerFeet = new Map();
	/** players' last positions, for speed (running = footsteps) @type {Map<string, {pos: number[], at: number}>} */
	const playerLast = new Map();

	const bake = {
		status: /** @type {'idle' | 'baking' | 'ready' | 'empty' | 'failed'} */ ('idle'),
		ms: 0,
		triangles: 0,
		area: 0,
		error: '',
		truncated: false,
		signature: '',
		at: 0,
		/** @type {{positions: Float32Array, indices: Uint32Array} | null} */
		debug: null,
		version: 0
	};
	/** @type {{key: string, min: number[], max: number[]}[]} */
	let obstacles = [];
	let obstaclesDirty = false;
	let baking = false;
	let bakeAgain = false;
	/** @type {any} */
	let rebakeTimer = null;
	let stepping = false;
	let lastStepAt = 0;
	let lastThink = 0;
	let lastSnap = 0;
	let snapCount = 0;
	let lastWatch = 0;
	let lastBeat = 0;
	let wasActive = false;
	let wasAuthority = false;
	let frame = 0;
	let lastFrameAt = 0;
	let navNodes = 0;
	/** @type {any} */
	let lastSnapshot = null;
	/** the overlay / debug wish (set by the view toggles) */
	const want = { overlay: false, debug: false };
	/** toasts already shown (once each) @type {Set<string>} */
	const toasted = new Set();
	const stats = { thinks: 0, steps: 0, snapsSent: 0, snapsGot: 0, reaches: 0, events: /** @type {Record<string, number>} */ ({}), lastEvent: '' };
	/** @type {Set<() => void>} */
	const listeners = new Set();
	const notify = () => listeners.forEach((fn) => {
		try {
			fn();
		} catch {
			/* a listener's own problem */
		}
	});

	const toastOnce = (/** @type {string} */ key, /** @type {string} */ text) => {
		if (toasted.has(key)) return;
		toasted.add(key);
		api.toast(text);
	};

	// ---- who is playing, who steps ------------------------------------------------------------

	/** this peer is in Play, Interact (game feel) or a VR session */
	function active() {
		try {
			// a headset is a player too: core has no Play state inside a VR session
			return !!api.isPlaying?.() || api.editorMode?.() === 'interact' || !!api.isVR?.();
		} catch {
			return false;
		}
	}
	/** the authority among the active peers (null = nobody plays) */
	function authorityId() {
		const roster = new Set((api.peerIds?.() ?? []).map(String));
		const now = Date.now();
		/** @type {string[]} */
		const ids = [];
		if (active()) ids.push(me());
		for (const [id, at] of activePeers) {
			if (now - at > BEAT_TTL || (roster.size && !roster.has(id))) {
				activePeers.delete(id);
				continue;
			}
			if (id !== me()) ids.push(id);
		}
		if (!ids.length) return null;
		ids.sort();
		return ids[0];
	}
	const isAuthority = () => authorityId() === me() && active();

	// ---- the graph: which nodes exist, what they listen to ------------------------------------

	/** resolve an object input: a wired Object Selector, else the node's own param, else its graph's owner */
	function objectInput(/** @type {any} */ node, /** @type {string} */ handle, /** @type {any[]} */ edges, /** @type {Map<string, any>} */ byId) {
		for (const e of edges) {
			if (e.target !== node.id || e.targetHandle !== handle) continue;
			const src = byId.get(e.source);
			const sel = src?.type === 'objectselector' ? src.data?.selected : null;
			if (sel && sel !== '-None-') return String(sel);
		}
		const own = node.data?.[handle];
		if (typeof own === 'string' && own && own !== '-None-') return own;
		return node.graphId && node.graphId !== 'scene' ? node.graphId : null;
	}

	function scanGraph() {
		const all = api.flow.nodes();
		const mine = all.filter((/** @type {any} */ n) => NAV_TYPES.includes(n.type));
		navNodes = mine.length;
		const edges = api.flow.edges();
		const byId = new Map(all.map((/** @type {any} */ n) => [n.id, n]));
		eventTarget.clear();
		noiseNodes.clear();
		for (const n of mine) {
			if (n.type === 'navevent' || n.type === 'navstate') eventTarget.set(n.id, objectInput(n, 'npc', edges, byId));
			if (n.type === 'navnoise') {
				const sources = edges.filter((/** @type {any} */ e) => e.target === n.id && e.targetHandle === 'trigger').map((/** @type {any} */ e) => e.source);
				noiseNodes.set(n.id, { sources: [...sources, n.id], at: objectInput(n, 'at', edges, byId), loudness: Number(n.data?.loudness ?? 1) || 1 });
			}
		}
		if (!navNodes) {
			agents.clear();
			shown.clear();
		}
		notify();
	}

	/** the scene's Navmesh node settings (the first one), or {} */
	function bakeSettings() {
		const node = api.flow.nodes('navmesh')[0];
		return node ? { ...node.data } : {};
	}

	// ---- the bake -----------------------------------------------------------------------------

	const needMesh = () => navNodes > 0 && (want.overlay || (isAuthority() && seen.size > 0));

	async function rebake() {
		if (baking) {
			bakeAgain = true;
			return;
		}
		baking = true;
		bake.status = 'baking';
		notify();
		try {
			await client.ensure();
			const geo = await api.colliderGeometry({ exclude: [...seen.keys()], maxTriangles: caps.bakeTriangles });
			if (geo.truncated) toastOnce('bake-cap', bakeCapMessage(caps, geo.triangles));
			bake.signature = geo.signature;
			bake.truncated = geo.truncated;
			obstacles = geo.moving.map((/** @type {any} */ m) => ({ key: m.uuid, min: m.min, max: m.max }));
			obstaclesDirty = true;
			if (!geo.triangles) {
				Object.assign(bake, { status: 'empty', triangles: 0, area: 0, debug: null, error: 'nothing to walk on' });
				bake.version++;
				return;
			}
			const r = await client.call('bake', { positions: geo.positions, indices: geo.indices, bake: bakeSettings(), maxAgents: caps.npcs }, [geo.positions.buffer, geo.indices.buffer]);
			Object.assign(bake, {
				status: r.baked ? 'ready' : 'failed',
				ms: Math.round(r.ms ?? 0),
				triangles: r.triangles ?? geo.triangles,
				area: r.area ?? 0,
				error: r.baked ? '' : String(r.error ?? 'bake failed'),
				debug: r.debug ?? null,
				at: Date.now()
			});
			bake.version++;
			// a fresh navmesh holds no agents: every NPC is re-added where it stands
			for (const a of agents.values()) a.reachAt = 0;
			if (!r.baked) toastOnce('bake-failed', 'Navigation: the navmesh bake failed (' + bake.error + ').');
		} catch (error) {
			Object.assign(bake, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
			toastOnce('bake-error', 'Navigation could not start: ' + bake.error);
		} finally {
			baking = false;
			notify();
			if (bakeAgain) {
				bakeAgain = false;
				scheduleRebake(200);
			}
		}
	}

	/** @param {number} ms */
	function scheduleRebake(ms) {
		if (rebakeTimer) api.timers.clearTimeout(rebakeTimer);
		rebakeTimer = api.timers.setTimeout(() => {
			rebakeTimer = null;
			if (needMesh()) rebake();
		}, ms);
	}

	/** the cheap once-a-second look: did the walls change (rebake), did a crate move (obstacles)? */
	async function watch() {
		if (baking || bake.status === 'idle') return;
		const geo = await api.colliderGeometry({ exclude: [...seen.keys()], signatureOnly: true });
		const moving = geo.moving.map((/** @type {any} */ m) => ({ key: m.uuid, min: m.min, max: m.max }));
		if (JSON.stringify(moving.map((m) => [m.key, m.min.map(r2), m.max.map(r2)])) !== JSON.stringify(obstacles.map((m) => [m.key, m.min.map(r2), m.max.map(r2)]))) {
			obstacles = moving;
			obstaclesDirty = true;
			notify();
		}
		if (geo.signature !== bake.signature) {
			bake.signature = geo.signature;
			// debounced: a drag fires this every second; a slow bake waits longer between rebakes
			scheduleRebake(Math.max(1200, Math.min(10000, bake.ms * 3, caps.rebakeMs * 2)));
		}
	}

	// ---- the effects (every peer) -------------------------------------------------------------

	const vW = new THREE.Vector3();
	const boxW = new THREE.Box3();

	/**
	 * Called by every nav effect node, every frame, on every peer.
	 * @param {string} type @param {any} object @param {any} base @param {any} data @param {any} ctx
	 */
	function drive(type, object, base, data, ctx) {
		if (!object?.uuid || data?.enabled === false || data?.enabled === 0) return;
		const uuid = object.uuid;
		const cur = seen.get(uuid);
		const rank = NAV_EFFECTS[/** @type {keyof typeof NAV_EFFECTS} */ (type)] ?? 9;
		if (!cur || cur.frame !== frame || rank < cur.rank || (rank === cur.rank && ctx.id < cur.nodeId)) {
			seen.set(uuid, { uuid, type, rank, nodeId: ctx?.id ?? '', graphId: ctx?.graphId ?? 'scene', object, data, base: { pos: [...(base?.pos ?? [0, 0, 0])], rot: [...(base?.rot ?? [0, 0, 0])] }, frame });
		}
		if (!active()) return;
		const s = shown.get(uuid);
		if (!s?.disp) return;
		vW.fromArray(s.disp);
		object.parent?.worldToLocal(vW);
		object.position.copy(vW);
		object.rotation.y = s.yaw + ((Number(data?.faceOffset) || 0) * Math.PI) / 180;
	}

	// ---- the authority: agents, thinking, stepping --------------------------------------------

	/** the world position of an object's origin at its BASE pose, and its feet offset */
	function homeOf(/** @type {any} */ entry) {
		const o = entry.object;
		vW.fromArray(entry.base.pos);
		if (o.parent) {
			o.parent.updateWorldMatrix(true, false);
			vW.applyMatrix4(o.parent.matrixWorld);
		}
		const origin = vW.toArray();
		o.updateWorldMatrix(true, true);
		boxW.setFromObject(o);
		const wp = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
		const foot = boxW.isEmpty() ? 0 : Math.max(0, wp.y - boxW.min.y);
		const size = boxW.isEmpty() ? new THREE.Vector3(0.6, 1.8, 0.6) : boxW.getSize(new THREE.Vector3());
		const radius = Math.min(1, Math.max(0.2, Math.max(size.x, size.z) / 2));
		return { origin, feet: [origin[0], origin[1] - foot, origin[2]], foot, radius, yaw: entry.base.rot[1] ?? 0 };
	}

	/** an object's world position (a chase / move-to target) @param {string} uuid */
	function objectPos(uuid) {
		const o = api.objectsGroup()?.getObjectByProperty('uuid', uuid);
		if (!o) return null;
		o.updateWorldMatrix(true, false);
		return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).toArray();
	}

	function playersNow() {
		/** @type {{id: string, pos: number[], head: number[]}[]} */
		const out = [];
		const now = Date.now();
		for (const p of api.players?.() ?? []) {
			// enemies hunt PLAYERS: this peer while it plays, a peer whose "I play" heartbeat is fresh —
			// never someone editing the scene (an editor's avatar flies about, or waits at the origin)
			if (p.me ? !active() : !(now - (activePeers.get(String(p.id)) ?? -Infinity) <= BEAT_TTL)) continue;
			// the probe snaps the feet to the navmesh; trust it only when the player really stands
			// there (a player on a pillar or a ledge keeps their own feet, so they read unreachable)
			const raw = [p.pos[0], p.pos[1] - 1.6, p.pos[2]];
			const snap = playerFeet.get(p.id);
			const feet = snap && dxz(snap, raw) < 0.6 && Math.abs(snap[1] - raw[1]) < 0.9 ? snap : raw;
			out.push({ id: p.id, pos: feet, head: p.pos });
		}
		return out;
	}

	/** the nearest player's feet to `from` */
	function nearestPlayer(/** @type {number[]} */ from, /** @type {any[]} */ players) {
		let best = null;
		let bestD = Infinity;
		for (const p of players) {
			const d = dist(from, p.pos);
			if (d < bestD) {
				bestD = d;
				best = p;
			}
		}
		return best;
	}

	const ray = new THREE.Raycaster();
	const vA = new THREE.Vector3();
	const vB = new THREE.Vector3();
	/** line of sight from `from` to `to` for agent `a` (the NPC's own body and the players never block) */
	function sees(/** @type {any} */ a, /** @type {number[]} */ from, /** @type {number[]} */ to) {
		const root = api.objectsGroup();
		if (!root) return true;
		vA.fromArray(from);
		vB.fromArray(to).sub(vA);
		const far = vB.length();
		if (far < 0.05) return true;
		ray.set(vA, vB.normalize());
		ray.far = far;
		const hits = ray.intersectObjects(root.children, true);
		for (const h of hits) {
			const o = h.object;
			if (!o.isMesh || h.distance > far - 0.3) continue;
			let skip = false;
			for (let n = o; n && n !== root; n = n.parent) {
				if (n.uuid === a.uuid || n.visible === false || n.userData?.navIgnore || n.userData?.physics?.sensor || n.userData?.water || n.userData?.spline) {
					skip = true;
					break;
				}
			}
			if (!skip) return false;
		}
		return true;
	}

	/** the event fire (authority only — it replicates) @param {string} uuid @param {string} name @param {any} [extra] */
	function fire(uuid, name, extra = {}) {
		stats.events[name] = (stats.events[name] ?? 0) + 1;
		stats.lastEvent = name + (extra.why ? ' (' + extra.why + ')' : '');
		api.fireNodeTrigger('navevent', (/** @type {any} */ data, /** @type {string} */ id) => {
			const want = eventTarget.has(id) ? eventTarget.get(id) : null;
			if (want && want !== uuid) return false;
			if ((data?.event ?? 'spotted') !== name) return false;
			if (name === 'unreachable' && data?.why && data.why !== 'any' && data.why !== extra.why) return false;
			return true;
		});
	}

	/** the agent bookkeeping for an NPC entry, made on first sight */
	function agentFor(/** @type {any} */ entry) {
		let a = agents.get(entry.uuid);
		if (a) return a;
		const h = homeOf(entry);
		const was = shown.get(entry.uuid);
		const feet = was?.disp ? [was.disp[0], was.disp[1] - h.foot, was.disp[2]] : h.feet;
		a = {
			uuid: entry.uuid,
			home: h.feet,
			foot: h.foot,
			radius: h.radius,
			feet,
			vel: [0, 0, 0],
			yaw: was?.yaw ?? h.yaw,
			face: /** @type {number[] | null} */ (null),
			speed: 1.6,
			brain: newBrain(h.feet, h.yaw),
			target: /** @type {number[] | null} */ (null),
			reachOpts: {},
			reach: /** @type {any} */ (null),
			reachAt: 0,
			crowdGoal: /** @type {number[] | null} */ (null),
			stopped: false,
			unreachWhy: '',
			arrived: false,
			wp: -1,
			wpDir: 1,
			wanderAt: 0,
			fleeAt: 0,
			pending: false,
			corners: /** @type {number[][]} */ ([]),
			state: 'idle',
			label: '',
			teleport: !!was?.disp
		};
		agents.set(entry.uuid, a);
		return a;
	}

	/** ask for a walk to `target` (null = stand) — re-asks the navmesh only when needed @param {any} a */
	function setTarget(a, /** @type {number[] | null} */ target, opts = {}, now = Date.now()) {
		if (!target) {
			a.target = null;
			a.crowdGoal = null;
			a.reach = null;
			a.unreachWhy = '';
			return;
		}
		const moved = !a.target || dist(target, a.target) > 0.5;
		a.target = target;
		a.reachOpts = opts;
		if (moved || now - a.reachAt > 1000) a.reachDue = true;
	}

	/** Patrol: the current waypoint of a Path (live — editing the path changes the patrol) */
	function waypoint(/** @type {any} */ a, /** @type {string} */ pathUuid, advance = true) {
		const info = pathUuid ? api.paths?.of(pathUuid) : null;
		// 78's points are {pos, ...extras} (WORLD); an array is accepted too
		const pts = info?.points?.map((/** @type {any} */ q) => (Array.isArray(q) ? q : q?.pos)).filter((/** @type {any} */ q) => Array.isArray(q));
		if (!pts?.length) return null;
		const n = pts.length;
		if (a.wp < 0 || a.wp >= n || a.wpPath !== pathUuid) {
			// start at the nearest point
			let best = 0;
			for (let i = 1; i < n; i++) if (dxz(a.feet, pts[i]) < dxz(a.feet, pts[best])) best = i;
			a.wp = best;
			a.wpPath = pathUuid;
		}
		if (advance && dxz(a.feet, pts[a.wp]) < Math.max(0.7, a.radius * 1.5)) {
			if (info.closed) a.wp = (a.wp + 1) % n;
			else {
				if (a.wp + a.wpDir >= n || a.wp + a.wpDir < 0) a.wpDir = -a.wpDir;
				a.wp = Math.max(0, Math.min(n - 1, a.wp + a.wpDir));
			}
		}
		return pts[a.wp];
	}

	/** gather the noises heard this think: Make Noise pulses, knocks, running players */
	function collectNoises(/** @type {number} */ now, /** @type {any[]} */ players) {
		// a noise lives its time AND at least one think (a slow frame must not swallow it)
		noises = noises.filter((n) => n.until > now || !n.heardBy);
		for (const [id, node] of noiseNodes) {
			for (const src of node.sources) {
				const t = api.flow.triggerStamp(src);
				const stamp = t?.stamp ?? 0;
				const before = noiseStamps.get(src);
				noiseStamps.set(src, stamp);
				if (before === undefined || !stamp || stamp === before) continue;
				let at = node.at ? objectPos(node.at) : null;
				if (!at) at = nearestPlayer([0, 0, 0], players)?.pos ?? null;
				if (at) noises.push({ pos: at, loudness: node.loudness, until: now + 600 });
				void id;
			}
		}
		for (const p of players) {
			const last = playerLast.get(p.id);
			playerLast.set(p.id, { pos: p.pos, at: now });
			if (!last || now - last.at > 1000) continue;
			const speed = dxz(p.pos, last.pos) / Math.max(0.016, (now - last.at) / 1000);
			// running players make footsteps (walking is quiet)
			if (speed > 4.2) noises.push({ pos: p.pos, loudness: 0.5, until: now + 300 });
		}
	}

	/** one think for every agent (10 Hz, authority) */
	function thinkAll(/** @type {number} */ now) {
		stats.thinks++;
		const players = playersNow();
		collectNoises(now, players);
		const clock = now / 1000;
		for (const entry of seen.values()) {
			const a = agentFor(entry);
			const d = entry.data ?? {};
			const type = entry.type;
			let label = '';
			if (type === 'navnpc') {
				const p = normalizeNpc(d);
				const pathUuid = typeof d.path === 'string' && d.path && d.path !== '-None-' ? d.path : '';
				const patrol = pathUuid ? waypoint(a, pathUuid, a.brain.state === 'patrol') : null;
				const out = think(a.brain, {
					now: clock,
					pos: a.feet,
					yaw: a.yaw,
					p,
					players,
					see: (from, to) => sees(a, from, to),
					noises,
					patrol,
					reach: a.reach
				});
				a.speed = out.speed;
				a.face = out.face;
				a.state = out.state;
				label = out.label;
				for (const ev of out.events) fire(a.uuid, ev.name, ev);
				setTarget(a, out.goal, { maxPath: out.state === 'chase' ? p.chaseRange * 2.5 : Infinity }, now);
			} else if (type === 'navchase') {
				const tgt = d.target && d.target !== '-None-' ? objectPos(d.target) : nearestPlayer(a.feet, players)?.pos ?? null;
				a.speed = Number(d.speed) || 3.5;
				a.state = 'chase';
				a.face = tgt;
				const stopAt = Math.max(0.3, Number(d.stopAt) || 1.2);
				if (tgt && dxz(a.feet, tgt) <= stopAt) {
					setTarget(a, null);
					label = 'chase: caught up';
				} else {
					setTarget(a, tgt, { maxPath: Number(d.maxPath) > 0 ? Number(d.maxPath) : Infinity }, now);
					label = tgt ? 'chase' : 'chase: no target';
				}
			} else if (type === 'navmoveto') {
				const tgt = d.target && d.target !== '-None-' ? objectPos(d.target) : Array.isArray(d.point) ? d.point : null;
				a.speed = Number(d.speed) || 2;
				a.state = 'patrol';
				a.face = null;
				if (tgt && dxz(a.feet, tgt) < 0.6) {
					if (!a.arrived) fire(a.uuid, 'arrived');
					a.arrived = true;
					setTarget(a, null);
					label = 'move to: arrived';
				} else {
					if (tgt && a.arrived && dxz(a.feet, tgt) > 1.2) a.arrived = false;
					setTarget(a, tgt, {}, now);
					label = tgt ? 'move to' : 'move to: no target';
				}
			} else if (type === 'navpatrol') {
				a.speed = Number(d.speed) || 1.6;
				a.state = 'patrol';
				a.face = null;
				const pt = waypoint(a, typeof d.path === 'string' ? d.path : '');
				setTarget(a, pt, {}, now);
				label = pt ? 'patrol ' + (a.wp + 1) : 'patrol: no Path';
			} else if (type === 'navflee') {
				const threat = d.from && d.from !== '-None-' ? objectPos(d.from) : nearestPlayer(a.feet, players)?.pos ?? null;
				const safe = Math.max(1, Number(d.distance) || 8);
				a.speed = Number(d.speed) || 3.5;
				a.face = null;
				if (!threat || dxz(a.feet, threat) > safe) {
					a.state = 'idle';
					setTarget(a, null);
					label = 'flee: safe';
				} else {
					a.state = 'alert';
					label = 'flee';
					if (!a.pending && (now - a.fleeAt > 1000 || !a.target)) {
						a.fleeAt = now;
						a.pending = true;
						const away = [a.feet[0] - threat[0], 0, a.feet[2] - threat[2]];
						const len = Math.hypot(away[0], away[2]) || 1;
						const around = [a.feet[0] + (away[0] / len) * safe * 0.6, a.feet[1], a.feet[2] + (away[2] / len) * safe * 0.6];
						client
							.call('random', { list: [0, 1, 2, 3, 4, 5].map((i) => ({ key: String(i), around, radius: safe * 0.6 })) })
							.then((r) => {
								let best = null;
								let bestD = -1;
								for (const q of r.points ?? []) if (q.point && dxz(q.point, threat) > bestD) {
									bestD = dxz(q.point, threat);
									best = q.point;
								}
								if (best) setTarget(a, best, {}, Date.now());
							})
							.catch(() => {})
							.finally(() => (a.pending = false));
					}
				}
			} else if (type === 'navwander') {
				const radius = Math.max(1, Number(d.radius) || 6);
				a.speed = Number(d.speed) || 1.2;
				a.state = 'patrol';
				a.face = null;
				const there = !a.target || dxz(a.feet, a.target) < 0.7 || (a.reach && !a.reach.ok);
				if (there && !a.wanderAt) a.wanderAt = now + Math.max(0, Number(d.pause ?? 2)) * 1000;
				if (a.wanderAt && now >= a.wanderAt && !a.pending) {
					a.wanderAt = 0;
					a.pending = true;
					client
						.call('random', { list: [{ key: a.uuid, around: a.home, radius }] })
						.then((r) => {
							const pt = r.points?.[0]?.point;
							if (pt) setTarget(a, pt, {}, Date.now());
						})
						.catch(() => {})
						.finally(() => (a.pending = false));
				}
				label = a.wanderAt ? 'wander: pause' : 'wander';
			}
			a.label = label;
		}
		for (const n of noises) n.heardBy = true;
		// drop agents whose node is gone (the effect stopped calling)
		for (const uuid of [...agents.keys()]) if (!seen.has(uuid)) agents.delete(uuid);
		// one batched reachability ask for every agent that needs it (G6)
		const due = [...agents.values()].filter((a) => a.reachDue && a.target);
		if (due.length && bake.status === 'ready') {
			for (const a of due) {
				a.reachDue = false;
				a.reachAt = now;
			}
			stats.reaches += due.length;
			client
				.call('reach', { list: due.map((a) => ({ key: a.uuid, from: a.feet, target: a.target, maxPath: Number.isFinite(a.reachOpts?.maxPath) ? a.reachOpts.maxPath : undefined })) })
				.then((r) => {
					for (const res of r.results ?? []) {
						const a = agents.get(res.key);
						if (!a || !a.target) continue;
						a.reach = { ok: res.ok, why: res.why, length: res.length };
						a.crowdGoal = res.goal ?? null;
						a.stopped = false;
						if (!res.ok) {
							if (a.unreachWhy !== res.why) {
								a.unreachWhy = res.why;
								fire(a.uuid, 'unreachable', { why: res.why });
							}
						} else a.unreachWhy = '';
					}
				})
				.catch(() => {});
		}
	}

	/** one crowd step (authority) */
	function step(/** @type {number} */ now) {
		if (stepping || bake.status !== 'ready') return;
		stepping = true;
		const dt = lastStepAt ? Math.min(0.5, (now - lastStepAt) / 1000) : 1 / 60;
		lastStepAt = now;
		const list = [];
		let n = 0;
		for (const a of agents.values()) {
			if (n++ >= caps.npcs) break;
			// stop AT the goal (no jitter): park inside one radius, walk again only 0.5 m further out
			let goal = a.crowdGoal;
			if (goal) {
				const d = dxz(a.feet, goal);
				// the crowd slows to a crawl inside ~2 radii of a goal: park within one radius
				const park = Math.max(0.3, a.radius);
				if (a.stopped ? d < park + 0.5 : d < park) {
					a.stopped = true;
					goal = null;
				} else a.stopped = false;
			}
			list.push({ key: a.uuid, pos: a.feet, speed: a.speed, radius: a.radius, goal, teleport: a.teleport });
			a.teleport = false;
		}
		const probe = (api.players?.() ?? []).map((/** @type {any} */ p) => ({ key: p.id, p: [p.pos[0], p.pos[1] - 1.0, p.pos[2]] }));
		/** @type {any} */
		const body = { agents: list, dt, probe, wantDebug: want.overlay };
		if (obstaclesDirty) {
			body.obstacles = obstacles;
			obstaclesDirty = false;
		}
		client
			.call('step', body)
			.then((r) => {
				stats.steps++;
				for (const q of r.probes ?? []) if (q.point) playerFeet.set(q.key, q.point);
				if (r.debug) {
					bake.debug = r.debug;
					bake.version++;
				}
				const sdt = Math.max(0.016, dt);
				for (const s of r.agents ?? []) {
					const a = agents.get(s.key);
					if (!a) continue;
					a.feet = s.pos;
					a.vel = s.vel;
					a.corners = s.corners ?? [];
					const sp = Math.hypot(s.vel[0], s.vel[2]);
					let want = a.yaw;
					if (sp > 0.15) want = Math.atan2(s.vel[0], s.vel[2]);
					else if (a.face) want = yawToward(a.feet, a.face);
					a.yaw = wrapAngle(a.yaw + wrapAngle(want - a.yaw) * Math.min(1, sdt * 8));
					const origin = [a.feet[0], a.feet[1] + a.foot, a.feet[2]];
					const row = shown.get(a.uuid) ?? {};
					shown.set(a.uuid, { ...row, target: origin, disp: origin, vel: [0, 0, 0], yaw: a.yaw, state: a.state, label: a.label, why: a.unreachWhy, corners: a.corners, at: performance.now() });
				}
				if (r.full) toastOnce('crowd-full', npcCapMessage(caps, agents.size));
			})
			.catch(() => {})
			.finally(() => (stepping = false));
	}

	/** the snapshot every peer draws from @returns {any} */
	function buildSnapshot(withCorners = false) {
		const a = [];
		for (const [uuid, s] of shown) {
			if (!agents.has(uuid)) continue;
			const row = [uuid, r2(s.disp[0]), r2(s.disp[1]), r2(s.disp[2]), r2(s.yaw), Math.max(0, STATES.indexOf(s.state)), String(s.label ?? '').slice(0, 60), s.why ?? ''];
			if (withCorners) row.push((s.corners ?? []).slice(0, 4).map((/** @type {number[]} */ c) => c.map(r2)));
			a.push(row);
		}
		return { op: 'snap', from: me(), t: Date.now(), a };
	}

	/** a snapshot arrives (or a late joiner's state) @param {any} snap */
	function applySnapshot(snap) {
		if (!snap || !Array.isArray(snap.a)) return;
		lastSnapshot = snap;
		if (isAuthority()) return;
		stats.snapsGot++;
		const now = performance.now();
		const live = new Set();
		for (const row of snap.a) {
			const [uuid, x, y, z, yaw, si, label, why, corners] = row;
			live.add(uuid);
			const s = shown.get(uuid) ?? {};
			const target = [x, y, z];
			const dtMsg = s.at ? Math.max(0.03, (now - s.at) / 1000) : 0;
			const vel = s.target && dtMsg ? [(x - s.target[0]) / dtMsg, (y - s.target[1]) / dtMsg, (z - s.target[2]) / dtMsg] : [0, 0, 0];
			// a teleport (respawn, a far correction) jumps; ordinary motion eases
			const jump = !s.disp || dist(s.disp, target) > 4;
			shown.set(uuid, {
				...s,
				target,
				vel: jump ? [0, 0, 0] : vel.map((v) => Math.max(-12, Math.min(12, v))),
				disp: jump ? target : s.disp,
				yaw: s.yaw ?? yaw,
				yawTarget: yaw,
				state: STATES[si] ?? 'idle',
				label,
				why: why ?? '',
				corners: corners ?? s.corners ?? [],
				at: now
			});
		}
		for (const uuid of [...shown.keys()]) if (!live.has(uuid)) shown.delete(uuid);
	}

	/** non-authority easing toward the last snapshot */
	function ease(/** @type {number} */ dt) {
		const now = performance.now();
		for (const s of shown.values()) {
			if (!s.target || !s.disp) continue;
			const age = Math.min(0.25, (now - (s.at ?? now)) / 1000);
			const aim = [s.target[0] + s.vel[0] * age, s.target[1] + s.vel[1] * age, s.target[2] + s.vel[2] * age];
			const k = Math.min(1, dt * 12);
			s.disp = [s.disp[0] + (aim[0] - s.disp[0]) * k, s.disp[1] + (aim[1] - s.disp[1]) * k, s.disp[2] + (aim[2] - s.disp[2]) * k];
			if (s.yawTarget !== undefined) s.yaw = wrapAngle(s.yaw + wrapAngle(s.yawTarget - s.yaw) * Math.min(1, dt * 10));
		}
	}

	// ---- the frame ----------------------------------------------------------------------------

	function tick() {
		frame++;
		const now = Date.now();
		const t = performance.now();
		const dt = lastFrameAt ? Math.min(0.1, (t - lastFrameAt) / 1000) : 1 / 60;
		lastFrameAt = t;
		if (!navNodes) return;
		// heartbeat: "I play"
		const on = active();
		if (on !== wasActive || (on && now - lastBeat > BEAT_MS)) {
			lastBeat = now;
			api.send({ op: on ? 'here' : 'gone', from: me() });
		}
		if (on !== wasActive && !on) {
			// back to Edit: the NPCs rest at their editor pose; the next Play starts from home
			agents.clear();
		}
		wasActive = on;
		// forget NPCs whose node stopped calling (deleted, disabled)
		for (const [uuid, e] of seen) if (frame - e.frame > 30) seen.delete(uuid);
		const auth = isAuthority();
		if (auth !== wasAuthority) {
			wasAuthority = auth;
			if (!auth) agents.clear();
			notify();
		}
		// the FIRST bake: armed once (re-arming every frame would clear the timer before it ever fired)
		if (needMesh() && bake.status === 'idle' && !baking && !rebakeTimer) scheduleRebake(300);
		if (needMesh() && now - lastWatch > WATCH_MS) {
			lastWatch = now;
			watch().catch(() => {});
		}
		if (auth) {
			if (seen.size > caps.npcs) toastOnce('npc-cap', npcCapMessage(caps, seen.size));
			if (now - lastThink >= THINK_MS && bake.status === 'ready') {
				lastThink = now;
				thinkAll(now);
			}
			step(now);
			if (now - lastSnap >= SNAP_MS) {
				lastSnap = now;
				snapCount++;
				const snap = buildSnapshot(snapCount % 5 === 0 || want.debug);
				lastSnapshot = snap;
				if (snap.a.length) {
					api.send(snap);
					stats.snapsSent++;
				}
			}
		} else {
			lastStepAt = 0; // the next stepper's first step must not count the time it was not stepping
			ease(dt);
		}
	}

	api.onMessage((/** @type {any} */ msg) => {
		if (msg?.op === 'here' && msg.from) activePeers.set(String(msg.from), Date.now());
		else if (msg?.op === 'gone' && msg.from) activePeers.delete(String(msg.from));
		else if (msg?.op === 'snap') {
			if (msg.from) activePeers.set(String(msg.from), Date.now());
			applySnapshot(msg);
		}
	});

	api.registerStateSync({
		getState: () => lastSnapshot ?? { op: 'snap', a: [] },
		applyState: (/** @type {any} */ st) => applySnapshot(st)
	});

	api.flow.onChange(scanGraph);
	api.onSceneClear?.(() => {
		agents.clear();
		shown.clear();
		seen.clear();
		bake.status = 'idle';
		bake.debug = null;
		bake.version++;
		notify();
	});

	return {
		drive,
		tick,
		scanGraph,
		want,
		bake,
		caps,
		stats,
		client,
		shown,
		agents,
		seen,
		get obstacles() {
			return obstacles;
		},
		active,
		isAuthority,
		authorityId,
		/** re-run the bake now (the toolbox button, a test) */
		rebake: () => rebake(),
		/** @param {() => void} fn */
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		/** an NPC State read: pure of the replicated snapshot @param {string | null} uuid */
		stateOf(uuid) {
			if (uuid) return shown.get(uuid) ?? null;
			const first = shown.values().next();
			return first.done ? null : first.value;
		},
		eventTarget,
		/** a test hook: make a noise right now (authority only) @param {number[]} pos @param {number} loudness */
		noise(pos, loudness = 1) {
			noises.push({ pos, loudness, until: Date.now() + 600 });
		},
		/** a module-level teardown helper for a test @returns {any} */
		debug() {
			return {
				navNodes,
				seen: [...seen.values()].map((e) => ({ uuid: e.uuid, type: e.type, frame: e.frame })),
				frame,
				authority: authorityId(),
				me: me(),
				active: active(),
				bake: { ...bake, debug: bake.debug ? { triangles: bake.debug.indices.length / 3 } : null },
				obstacles: obstacles.length,
				agents: [...agents.values()].map((a) => ({ uuid: a.uuid, feet: a.feet.map(r2), state: a.state, label: a.label, why: a.unreachWhy, target: a.target?.map(r2) ?? null, goal: a.crowdGoal?.map(r2) ?? null, reach: a.reach, wp: a.wp })),
				shown: [...shown.entries()].map(([uuid, s]) => ({ uuid, disp: s.disp?.map(r2), state: s.state, label: s.label, why: s.why })),
				stats: { ...stats, events: { ...stats.events } },
				worker: { ...client.stats, started: client.started },
				caps
			};
		}
	};
}
