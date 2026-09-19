// the engine against a FAKE api — the sweep's derivation, sources and edges without a
// browser. Everything the engine touches on `api` is a tiny stand-in here.
import { createEngine } from '../src/engine.js';
import { recipe } from '../src/graph.js';

class V3 {
	constructor(x = 0, y = 0, z = 0) {
		this.x = x;
		this.y = y;
		this.z = z;
	}
	distanceTo(o) {
		return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z);
	}
	toArray() {
		return [this.x, this.y, this.z];
	}
}

/** a scene + graph + trigger log the engine can drive */
function fakeApi() {
	const nodes = [];
	const edges = [];
	const triggers = new Map(); // node id -> {count, lastT}
	const rows = new Map();
	const objects = new Map(); // uuid -> {position}
	const fired = [];
	let clock = 100;
	let playing = true;
	let player = [0, 0, 0];
	let frame = null;
	let nextId = 1;
	const api = {
		now: () => clock,
		isPlaying: () => playing,
		playerPosition: () => player.slice(),
		objectsGroup: () => ({
			getObjectByProperty: (_k, uuid) => {
				const o = objects.get(uuid);
				return o ? o.handle : null;
			}
		}),
		THREE: { Vector3: V3 },
		flow: {
			nodes: () => nodes.map((n) => ({ ...n, data: { ...n.data } })),
			edges: () => edges.map((e) => ({ ...e })),
			nodeValue: (id) => (nodes.find((n) => n.id === id)?.type === 'counter' ? triggers.get(id)?.count ?? 0 : undefined),
			triggerStamp: (id) => (triggers.has(id) ? { stamp: triggers.get(id).lastT, age: clock - triggers.get(id).lastT } : null),
			addNodes: (spec) => {
				const ids = spec.nodes.map((n) => {
					const id = 'n' + nextId++;
					nodes.push({ id, type: n.type, graphId: 'scene', data: { ...(n.data ?? {}) } });
					return id;
				});
				for (const e of spec.edges ?? []) {
					const source = typeof e.from === 'number' ? ids[e.from] : e.from;
					const target = typeof e.to === 'number' ? ids[e.to] : e.to;
					edges.push({ id: 'e-' + source + '-' + target + (e.handle ? '.' + e.handle : ''), source, target, targetHandle: e.handle ?? null, sourceHandle: null, graphId: 'scene' });
				}
				return ids;
			},
			setNodeData: (id, patch) => {
				const n = nodes.find((x) => x.id === id);
				if (n) Object.assign(n.data, patch);
				return !!n;
			}
		},
		// core's applyNodeTrigger in miniature: stamp the node, bump downstream counters
		fireNodeTrigger: (type, match, opts) => {
			for (const n of nodes) {
				if (n.type !== type || (match && !match(n.data, n.id))) continue;
				fired.push({ id: n.id, type, replicate: opts?.replicate !== false });
				triggers.set(n.id, { count: triggers.get(n.id)?.count ?? 0, lastT: clock });
				for (const e of edges) {
					if (e.source !== n.id) continue;
					const t = nodes.find((x) => x.id === e.target);
					if (t?.type !== 'counter') continue;
					if (e.targetHandle === 'reset') triggers.set(t.id, { count: 0, lastT: clock });
					else triggers.set(t.id, { count: (triggers.get(t.id)?.count ?? 0) + 1, lastT: clock });
				}
			}
		},
		peerVars: {
			mine: (name, fallback) => (rows.has(name) ? rows.get(name) : fallback),
			setMine: (name, v) => rows.set(name, v),
			all: () => []
		},
		game: { roundCutoff: () => round },
		registerFrameTask: (fn) => (frame = fn),
		flyTo: (pos) => flights.push(pos),
		onHit: (fn) => (hitListener = fn)
	};
	let round = null;
	const flights = [];
	let hitListener = null;
	return {
		api,
		nodes,
		edges,
		triggers,
		rows,
		fired,
		flights,
		addObject: (uuid, position, name = uuid) => {
			const o = { position, name, handle: { name, visible: true, getWorldPosition: () => new V3(...o.position) } };
			objects.set(uuid, o);
		},
		moveObject: (uuid, position) => (objects.get(uuid).position = position),
		visible: (uuid) => objects.get(uuid)?.handle.visible,
		tick: (dt = 0.2) => {
			clock += dt;
			frame?.(clock);
		},
		setPlayer: (p) => (player = p),
		setPlaying: (v) => (playing = v),
		setRound: (v) => (round = v),
		stamp: (id) => triggers.set(id, { count: 0, lastT: clock }),
		knock: (hit) => hitListener?.(hit),
		clock: () => clock
	};
}

// the engine throttles on performance.now(); a fake clock that always advances
let perf = 0;
globalThis.performance = { now: () => (perf += 200) };

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	// ---- an object chain: click, wired, first sight --------------------------------------
	{
		const f = fakeApi();
		f.addObject('crate', [0, 0, 0], 'Crate');
		const engine = createEngine(f.api);
		const ids = f.api.flow.addNodes(recipe({ uuid: 'crate', row: 0, health: { name: 'hp', max: 3 }, damage: { amount: 1, source: 'click' } }));
		f.tick();
		const s0 = engine.stateOf(ids[2]);
		check(s0?.hp === 3 && !s0.dead && s0.uuid === 'crate' && s0.label === 'Crate', 'a fresh chain derives 3/3 on its object');
		engine.hitObjects(['crate'], 'click', { local: false });
		f.tick();
		check(f.fired.length === 1 && f.fired[0].replicate === true, 'a click fires ONE replicated pulse');
		check(engine.stateOf(ids[2])?.hp === 2, 'and the counter takes it to 2/3');
		engine.hitObjects(['crate'], 'click', { local: false });
		engine.hitObjects(['crate'], 'click', { local: false });
		f.tick();
		check(engine.stateOf(ids[2])?.dead === true && engine.stateOf(ids[2])?.hp === 0, 'three hits: dead');
		check(f.visible('crate') === false, 'and hidden (deathAction hide, in play)');
		f.setPlaying(false);
		f.tick();
		check(f.visible('crate') === true, 'out of play the object is given back (the module hid it, the module restores it)');
		f.setPlaying(true);
		f.tick();
		check(f.visible('crate') === false, 'back in play: hidden again');
		const before = f.fired.length;
		engine.hitObjects(['crate'], 'click', { local: false });
		check(f.fired.length === before, 'COUNTERFACTUAL guard: a hit on the dead fires nothing');
		// a wired source: a stamp already there at first sight is history
		const [key] = f.api.flow.addNodes({ nodes: [{ type: 'keypress', x: 0, y: 0, data: {} }], edges: [{ from: 0, to: ids[0], handle: 'trigger' }] });
		f.api.flow.setNodeData(ids[0], { source: 'wired' });
		f.stamp(key);
		f.fired.length = 0;
		f.tick();
		f.tick();
		check(f.fired.length === 0, 'FIRST SIGHT: a stamp present when the node was first seen fires nothing');
		f.api.fireNodeTrigger('healthreset', (d) => d.name === 'hp', { replicate: false });
		f.tick();
		check(engine.stateOf(ids[2])?.hp === 3, 'a reset pulse zeroes the counter: 3/3');
		check(f.visible('crate') === true, 'and the object is back');
		f.fired.length = 0;
		f.tick();
		f.stamp(key);
		f.tick();
		check(f.fired.length === 1 && f.fired[0].id === ids[0] && f.fired[0].replicate === false, 'a NEW stamp on the wired source fires one LOCAL pulse');
		f.tick();
		check(engine.stateOf(ids[2])?.hp === 2, 'which the counter counts (2/3)');
	}

	// ---- the round rule --------------------------------------------------------------------
	{
		const f = fakeApi();
		f.addObject('crate', [0, 0, 0]);
		const engine = createEngine(f.api);
		const ids = f.api.flow.addNodes(recipe({ uuid: 'crate', row: 0, health: { name: 'hp', max: 3 }, damage: { amount: 1, source: 'click' } }));
		f.tick();
		engine.hitObjects(['crate'], 'click', { local: false });
		f.tick();
		check(engine.stateOf(ids[2])?.hp === 2, 'premise: 2/3');
		f.setRound(500); // a joiner sees a round already under way
		f.tick();
		check(engine.stateOf(ids[2])?.hp === 2, 'THE JOINER RULE: the first sight of a round is a seed, nothing resets');
		f.setRound(Infinity); // back to the menu
		f.tick();
		f.setRound(600); // a NEW round
		f.tick();
		f.tick();
		check(engine.stateOf(ids[2])?.hp === 3, 'a witnessed new round resets to 3/3');
	}

	// ---- touch on an object, zone on the player, respawn -------------------------------------
	{
		const f = fakeApi();
		f.addObject('lava', [10, 0, 0], 'Lava');
		f.addObject('crate', [5, 0, 0], 'Crate');
		f.addObject('home', [40, 0, 40], 'Home');
		const engine = createEngine(f.api);
		const crate = f.api.flow.addNodes(recipe({ uuid: 'crate', row: 0, health: { name: 'hp', max: 3 }, damage: { amount: 1, source: 'touch', radius: 2 } }));
		const me = f.api.flow.addNodes(recipe({ uuid: null, row: 1, health: { name: 'me', max: 5, deathAction: 'respawn', respawnDelay: 2 }, damage: { amount: 1, source: 'wired' } }));
		const zone = f.api.flow.addNodes({
			nodes: [
				{ type: 'damage', x: 0, y: 0, data: { source: 'zone', amount: 1, perSecond: 2, radius: 2 } },
				{ type: 'objectselector', x: 0, y: 0, data: { selected: 'lava' } },
				{ type: 'counter', x: 0, y: 0, data: {} },
				{ type: 'objectselector', x: 0, y: 0, data: { selected: 'home' } }
			],
			edges: [{ from: 1, to: 0, handle: 'zone' }, { from: 0, to: 2, handle: 'pulse' }, { from: 2, to: me[2], handle: 'damage' }, { from: 3, to: me[2], handle: 'respawnAt' }]
		});
		f.tick();
		check(engine.stateOf(me[2])?.hp === 5 && engine.stateOf(crate[2])?.hp === 3, 'premise: player 5/5, crate 3/3');
		f.setPlayer([5, 0.5, 0]);
		f.tick();
		f.tick();
		check(engine.stateOf(crate[2])?.hp === 2 && f.fired.at(-1)?.replicate === true, 'walking into the crate: one REPLICATED touch pulse, 2/3');
		f.tick();
		f.tick();
		check(engine.stateOf(crate[2])?.hp === 2, 'standing there does not keep hurting it (an edge)');
		f.setPlayer([0, 0, 0]);
		f.tick();
		f.setPlayer([5, 0.5, 0]);
		f.tick();
		f.tick();
		check(engine.stateOf(crate[2])?.hp === 1, 'out and back in: a second touch, 1/3');
		f.setPlayer([10, 0.5, 0]); // into the lava
		f.fired.length = 0;
		f.tick(0.6);
		f.tick(0.1);
		check(engine.stateOf(me[2])?.hp === 4 && f.fired.length === 1 && f.fired[0].replicate === false, 'in the zone: one LOCAL pulse and the row drops to 4 (' + JSON.stringify(f.fired) + ' hp ' + engine.stateOf(me[2])?.hp + ')');
		check(f.rows.get('me') === 4 && typeof f.rows.get('me.at') === 'number', 'the row holds {base 4, at}');
		let died = false;
		for (let i = 0; i < 12 && !died; i++) {
			f.tick(0.3); // the fake's performance clock is coarse: ~every other sweep ticks the zone
			died = engine.stateOf(me[2])?.dead === true;
		}
		check(died, 'staying kills the player (hp ' + engine.stateOf(me[2])?.hp + ')');
		f.setPlaying(false); // out of play: the zone stops, and the respawn is on the clock
		f.tick(1);
		f.tick(1.5);
		f.tick(0.1);
		const s = engine.stateOf(me[2]);
		check(s && !s.dead && s.hp === 5, 'respawn after the delay: 5/5');
		check(f.flights.length === 1 && f.flights[0][0] === 40 && f.flights[0][2] === 40, 'and the camera flew to the respawnAt object');
		void zone;
	}

	// ---- the knock feed ---------------------------------------------------------------------
	{
		const f = fakeApi();
		f.addObject('crate', [0, 0, 0]);
		const engine = createEngine(f.api);
		const ids = f.api.flow.addNodes(recipe({ uuid: 'crate', row: 0, health: { name: 'hp', max: 5 }, damage: { amount: 1, source: 'hit', scale: 'speed', speedRef: 3 } }));
		f.tick();
		f.knock({ uuid: 'crate', speed: 6, at: 1, local: false });
		f.tick();
		check(engine.stateOf(ids[2])?.hp === 3 && f.fired.length === 2 && f.fired.every((x) => !x.replicate), 'a 6 m/s knock at ref 3 fires TWO local pulses: 3/5');
		f.knock({ uuid: 'crate', speed: 6, at: 1, local: false });
		f.tick();
		check(engine.stateOf(ids[2])?.hp === 3, 'the same knock stamp again is dropped');
		f.knock({ uuid: 'other', speed: 6, at: 2, local: false });
		f.tick();
		check(engine.stateOf(ids[2])?.hp === 3, 'a knock on another object is not ours');
	}
}
