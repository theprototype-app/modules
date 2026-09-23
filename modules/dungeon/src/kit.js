// The Kit's core: world state {seed, params, floorIndex}, its replication, the ONE
// persistent scene-root group and the published contract.
//
// Replication is deterministic (golden rule 8): only {seed, params} and the floor
// index travel — every peer regenerates the identical campaign locally, and the
// checksum only DETECTS divergence (a toast, never a fight). Late joiners get
// {seed, params, floorIndex} through registerStateSync.
//
// THE GROUP IS PERSISTENT. 'dungeon-module' is created once and its floor child is
// swapped on regenerate / travel, so `userData.kit` (the function seam a rule module
// calls) never goes stale and there is no frame in which the group is missing.

import { generateCampaign } from './gen/campaign.js';
import { buildFloorGroup, animateFloor } from './render.js';
import { GROUP_NAME, playPayload, mergeMarkers, normalizeParams } from './contract.js';

/** @param {any} api the module SDK surface */
export function createKit(api) {
	const THREE = api.THREE;

	const state = {
		seed: /** @type {number | null} */ (null),
		params: /** @type {any} */ ({}),
		campaign: /** @type {any} */ (null),
		floorIndex: 1
	};
	/** @type {Record<string, {x: number, z: number, kind: string}[]>} rule modules' minimap markers */
	const markersByOwner = {};
	/** @type {boolean | null} null = the contract default (grounded) */
	let grounded = null;
	/** @type {any} the current floor's meshes (a child of the persistent group) */
	let floorGroup = null;
	/** @type {(() => void)[]} toolbox/UI refresh hooks */
	const listeners = [];

	const currentFloor = () => state.campaign?.floors[state.floorIndex - 1] ?? null;

	/** the persistent scene-root group, created on first use */
	function group() {
		const scene = api.scene();
		if (!scene) return null;
		let existing = scene.getObjectByName(GROUP_NAME);
		if (!existing) {
			existing = new THREE.Group();
			existing.name = GROUP_NAME;
			scene.add(existing);
		}
		if (existing.userData.kit !== kit) existing.userData.kit = kit;
		return existing;
	}

	function disposeFloor() {
		if (!floorGroup) return;
		floorGroup.traverse((child) => {
			child.geometry?.dispose?.();
			if (child.material && !Array.isArray(child.material)) child.material.dispose?.();
		});
		floorGroup.parent?.remove(floorGroup);
		floorGroup = null;
	}

	function notify() {
		listeners.forEach((fn) => {
			try {
				fn();
			} catch {
				/* a UI refresh must never break the world */
			}
		});
	}

	/** (re)stamp userData: the play contract when a dungeon exists, nothing otherwise */
	function publish() {
		const g = group();
		if (!g) return;
		const play = state.campaign
			? playPayload(state.campaign, state.floorIndex, { grounded, markers: mergeMarkers(markersByOwner) })
			: null;
		if (play) {
			const dungeon = currentFloor();
			g.userData.play = play;
			g.userData.seed = state.seed;
			g.userData.params = state.params;
			g.userData.floorIndex = state.floorIndex;
			g.userData.levelCount = state.campaign.floors.length;
			g.userData.checksum = dungeon.checksum;
			g.userData.campaignChecksum = state.campaign.checksum;
			g.userData.name = dungeon.name;
			g.userData.stats = dungeon.stats;
		} else {
			delete g.userData.play;
			delete g.userData.seed;
			delete g.userData.params;
			delete g.userData.floorIndex;
			delete g.userData.levelCount;
			delete g.userData.checksum;
			delete g.userData.campaignChecksum;
			delete g.userData.name;
			delete g.userData.stats;
		}
		notify();
	}

	function rebuild() {
		disposeFloor();
		const g = group();
		const dungeon = currentFloor();
		if (g && dungeon) {
			floorGroup = buildFloorGroup(THREE, dungeon);
			floorGroup.name = 'dk-floor';
			g.add(floorGroup);
		}
		publish();
	}

	// ---- actions (apply locally, optionally broadcast; receivers never re-send) ----

	/**
	 * Generate a campaign. @param {number} seed @param {any=} params
	 * @param {{broadcast?: boolean}=} opts
	 */
	function generate(seed, params = {}, opts = {}) {
		const clean = normalizeParams(params);
		let campaign;
		try {
			campaign = generateCampaign(seed >>> 0, clean);
		} catch (error) {
			api.toast('Dungeon generation failed: ' + error.message);
			return false;
		}
		state.seed = seed >>> 0;
		state.params = clean;
		state.campaign = campaign;
		state.floorIndex = 1;
		// a rule module's markers belong to the world that just went away
		for (const owner of Object.keys(markersByOwner)) delete markersByOwner[owner];
		rebuild();
		if (opts.broadcast !== false) api.send({ op: 'generate', seed: state.seed, params: clean, checksum: campaign.checksum });
		return true;
	}

	/** @param {any} data */
	function applyRemoteGenerate(data) {
		const same = data.seed === state.seed && JSON.stringify(normalizeParams(data.params ?? {})) === JSON.stringify(state.params);
		if (same && state.campaign) return;
		if (!generate(data.seed, data.params ?? {}, { broadcast: false })) return;
		if (data.checksum && data.checksum !== state.campaign.checksum)
			api.toast('Dungeon checksum differs from the sender — module versions may not match');
	}

	/** Show floor k (1-based). @param {number} target @param {{broadcast?: boolean}=} opts */
	function showFloor(target, opts = {}) {
		const levels = state.campaign?.floors.length ?? 0;
		target = Math.round(Number(target));
		if (!levels || !(target >= 1) || target > levels) return false;
		if (target === state.floorIndex) return true;
		state.floorIndex = target;
		for (const owner of Object.keys(markersByOwner)) delete markersByOwner[owner];
		rebuild();
		if (opts.broadcast !== false) api.send({ op: 'floor', floorIndex: target });
		return true;
	}

	/** @param {{broadcast?: boolean}=} opts */
	function clear(opts = {}) {
		disposeFloor();
		state.campaign = null;
		state.seed = null;
		state.params = {};
		state.floorIndex = 1;
		for (const owner of Object.keys(markersByOwner)) delete markersByOwner[owner];
		publish();
		if (opts.broadcast !== false) api.send({ op: 'clear' });
	}

	// ---- the seam a rule module drives (userData.kit) ---------------------------------

	/**
	 * Put markers on the play minimap under an owner key; replaces that owner's list.
	 * @param {string} owner @param {{x: number, z: number, kind: string}[] | null} list
	 */
	function setMarkers(owner, list) {
		if (!owner) return;
		if (list && list.length) markersByOwner[owner] = list;
		else delete markersByOwner[owner];
		const g = group();
		if (g?.userData.play) g.userData.play.markers = mergeMarkers(markersByOwner);
	}

	/** Override the contract's grounded flag (null = the Kit default, true). @param {boolean | null} value */
	function setGrounded(value) {
		grounded = value == null ? null : !!value;
		const g = group();
		if (g?.userData.play) g.userData.play.grounded = grounded == null ? true : grounded;
	}

	/** what the toolbox footer shows */
	function stats() {
		const dungeon = currentFloor();
		if (!dungeon || !state.campaign) return null;
		return {
			rooms: dungeon.rooms.length,
			gems: dungeon.props.filter((p) => p.kind === 'gem').length,
			loops: dungeon.stats.loops,
			ms: Math.round(dungeon.stats.genMs * 10) / 10,
			checksum: dungeon.checksum,
			campaignChecksum: state.campaign.checksum,
			name: dungeon.name,
			floorIndex: state.floorIndex,
			levelCount: state.campaign.floors.length
		};
	}

	const kit = {
		/** bump when a field below changes shape */
		version: 2,
		generate,
		showFloor,
		clear,
		setMarkers,
		setGrounded,
		/** the replicated world state, copied */
		state: () => ({ seed: state.seed, params: { ...state.params }, floorIndex: state.floorIndex, levelCount: state.campaign?.floors.length ?? 0 }),
		/** the whole campaign (pure data) — for a rule that needs another floor's props */
		campaign: () => state.campaign,
		stats,
		/** @param {() => void} fn refresh hook (toolbox) */
		onChange: (fn) => {
			listeners.push(fn);
			return () => {
				const at = listeners.indexOf(fn);
				if (at >= 0) listeners.splice(at, 1);
			};
		}
	};

	// ---- netcode -----------------------------------------------------------------

	/** @param {any} data */
	function handleMessage(data) {
		if (data.op === 'generate') applyRemoteGenerate(data);
		else if (data.op === 'floor') showFloor(data.floorIndex, { broadcast: false });
		else if (data.op === 'clear') clear({ broadcast: false });
	}

	function getState() {
		if (state.seed == null) return null;
		return { seed: state.seed, params: state.params, floorIndex: state.floorIndex };
	}

	/** @param {any} remote */
	function applyState(remote) {
		if (!remote || remote.seed == null) return;
		if (!generate(remote.seed, remote.params ?? {}, { broadcast: false })) return;
		if (remote.floorIndex && remote.floorIndex !== state.floorIndex) showFloor(remote.floorIndex, { broadcast: false });
	}

	/** @type {any} */ let _focus = null;
	/** @param {number} time */
	function tick(time) {
		if (!floorGroup) return;
		// P4: the vault shows only IN PLAY (the editor keeps its open view). 30b: the capped lights
		// follow the VIEWER everywhere — the player in Interact/Play, the camera in the editor (a VR
		// editor flying through the dungeon is lit wherever it looks)
		// 30b: Interact is a game view too (VR enters it from Play) — the vault closes there as well
		const playing = (typeof api.isPlaying === 'function' && !!api.isPlaying()) || api.editorMode?.() === 'interact';
		const p = typeof api.playerPosition === 'function' ? api.playerPosition() : null;
		// the contract's frame is the group's LOCAL one (core's world root may carry a VR Edit
		// transform above it — C1 P5); the viewer is world
		let focus = null;
		if (p && floorGroup.parent) {
			const v = (_focus ??= new THREE.Vector3()).set(p[0], p[1], p[2]);
			floorGroup.parent.updateWorldMatrix(true, false);
			floorGroup.parent.worldToLocal(v);
			focus = { x: v.x, z: v.z };
		}
		animateFloor(floorGroup, time, { playing, player: focus });
	}

	return { kit, state, group, handleMessage, getState, applyState, tick, ensureGroup: group };
}
