// The game layer: replication (deterministic model — only {seed, params,
// floorIndex} + discrete events travel), the co-op rules (P1/P2 slots,
// gem-gated portals, travel-together), GUI state machine and the frame tick.
//
// Movement is the app's own play mode (red Play button): WASD walking, wall
// collision and per-peer spawn all come FREE from publishing userData.play in
// the exact dungeonPlay.js shape. The group name MUST be 'dungeon-module' —
// core resolves the play contract by that name (DEVX-REQUESTS #13).

import { generateCampaign } from './gen/campaign.js';
import { FLOOR } from './gen/dungeon.js';
import { hash32 } from './gen/rng.js';
import { buildFloorGroup, applyGems, setPortalSealed, animateFloor } from './render.js';
import * as gui from './gui.js';
import * as audio from './audio.js';

export const GROUP_NAME = 'dungeon-module';

export const DEFAULT_RULES = {
	gemShare: 0.7,
	pickupRadius: 0.9,
	allPlayersPortal: true,
	disableFlight: true
};
export const DEFAULT_MENU = {
	show: 'auto',
	button1: 'join-p1',
	button2: 'join-p2',
	button3: 'start',
	button4: 'new-dungeon'
};
export const DEFAULT_HUD = { showGems: true, showLevel: true, showPlayers: true, showObjective: true, corner: 'top-left' };

/** @param {any} api the module SDK surface */
export function createGame(api) {
	const THREE = api.THREE;

	const state = {
		seed: /** @type {number | null} */ (null),
		params: /** @type {any} */ ({}),
		campaign: /** @type {any} */ (null),
		floorIndex: 1,
		/** @type {Record<number, Set<number>>} floor -> collected gem indices */
		collected: {},
		/** @type {Record<string, {peerId: string, name: string} | null>} */
		slots: { p1: null, p2: null },
		started: false,
		startedAt: 0,
		wonAt: 0,
		/** @type {Record<string, boolean>} peerId -> standing on the UP portal */
		onPortal: {},
		myOnPortal: false,
		combo: 0,
		lastGemAt: 0,
		/** @type {Record<string, number>} custom prop counters (drprop nodes) */
		propValues: {}
	};

	// live node-config overrides (nodes.js writes these; absent nodes = defaults)
	const config = {
		rules: { ...DEFAULT_RULES },
		menu: { ...DEFAULT_MENU },
		hud: { ...DEFAULT_HUD },
		/** @type {Record<string, {initial: number, showInHud: boolean}>} */
		props: {}
	};

	let guiDirty = true;
	let playingNow = false;

	const me = () => api.peerId() ?? 'me';
	const shortName = (peerId) => (peerId === me() ? 'you' : String(peerId).slice(0, 6));
	const currentFloor = () => state.campaign?.floors[state.floorIndex - 1] ?? null;
	const collectedSet = (floor = state.floorIndex) => (state.collected[floor] ??= new Set());

	const group = () => api.scene()?.getObjectByName(GROUP_NAME) ?? null;

	function disposeGroup() {
		const existing = group();
		if (!existing) return;
		existing.traverse((child) => {
			child.geometry?.dispose?.();
			if (child.material && !Array.isArray(child.material)) child.material.dispose?.();
		});
		existing.parent?.remove(existing);
	}

	function gemTotals(floor = state.floorIndex) {
		const dungeon = state.campaign?.floors[floor - 1];
		if (!dungeon) return { total: 0, need: 0, have: 0 };
		const total = dungeon.props.filter((p) => p.kind === 'gem').length;
		const need = Math.max(1, Math.ceil(total * config.rules.gemShare));
		return { total, need, have: Math.min(collectedSet(floor).size, total) };
	}

	const sealed = () => {
		const { need, have } = gemTotals();
		return have < need;
	};
	const topFloor = () => state.floorIndex >= (state.campaign?.floors.length ?? 1);

	/** (Re)build the current floor's meshes + play contract. */
	function rebuild() {
		disposeGroup();
		const scene = api.scene();
		const dungeon = currentFloor();
		if (!scene || !dungeon) return;
		const built = buildFloorGroup(THREE, dungeon, collectedSet());
		built.name = GROUP_NAME;

		// play contract — EXACT dungeonPlay.js shape; rooms ordered entrance-first
		// then by depth so both players spawn at the dungeon start together
		const ordered = [...dungeon.rooms]
			.sort((a, b) => {
				const ka = a.type === 'entrance' ? -1 : a.depth;
				const kb = b.type === 'entrance' ? -1 : b.depth;
				return ka - kb || a.id - b.id;
			})
			.map((room) => ({ x: room.x + dungeon.ox, y: room.y + dungeon.oy, w: room.w, h: room.h }));
		built.userData = {
			seed: state.seed,
			params: state.params,
			floorIndex: state.floorIndex,
			levelCount: state.campaign.floors.length,
			checksum: dungeon.checksum,
			campaignChecksum: state.campaign.checksum,
			name: dungeon.name,
			stats: dungeon.stats,
			_dr: built.userData._dr,
			play: {
				grid: dungeon.grid,
				width: dungeon.W,
				height: dungeon.H,
				minX: dungeon.ox,
				minY: dungeon.oy,
				rooms: ordered,
				floorValue: FLOOR
			}
		};
		// debug/test hook (scene-root local, never serialized) — the flight drives
		// the game through this instead of reaching into module scope
		built.userData._dr.game = {
			state,
			config,
			collect: (index) => collectGem(state.floorIndex, index),
			travel: (target) => travel(target),
			start: () => start(),
			claimSlot: (slot) => claimSlot(slot),
			menuAction,
			gemTotals
		};
		scene.add(built);
		setPortalSealed(built, sealed(), dungeon.theme);
		guiDirty = true;
	}

	// ---- actions (each: apply locally, optionally broadcast; receivers never
	// re-send — the applier is shared by both paths) -----------------------------

	function generate(seed, params = {}, broadcast = true) {
		let campaign;
		try {
			campaign = generateCampaign(seed, params);
		} catch (error) {
			api.toast('Dungeon generation failed: ' + error.message);
			return false;
		}
		state.seed = seed >>> 0;
		state.params = params;
		state.campaign = campaign;
		state.floorIndex = 1;
		state.collected = {};
		state.started = false;
		state.wonAt = 0;
		state.onPortal = {};
		state.myOnPortal = false;
		state.combo = 0;
		state._wasSealed = undefined;
		state._menuSuppressed = false;
		rebuild();
		if (broadcast) api.send({ op: 'generate', seed: state.seed, params, checksum: campaign.checksum });
		return true;
	}

	function applyRemoteGenerate(data) {
		if (data.seed === state.seed && JSON.stringify(data.params ?? {}) === JSON.stringify(state.params) && state.campaign) return;
		if (!generate(data.seed, data.params ?? {}, false)) return;
		if (data.checksum && data.checksum !== state.campaign.checksum)
			api.toast('Dungeon checksum differs from the sender — versions may not match');
	}

	function collectGem(floor, index, broadcast = true) {
		const set = collectedSet(floor);
		if (set.has(index)) return;
		set.add(index);
		const g = group();
		if (floor === state.floorIndex && g) {
			applyGems(g, set);
			const wasSealed = state._wasSealed ?? true;
			const nowSealed = sealed();
			if (wasSealed && !nowSealed && !topFloor()) {
				audio.sealBreak();
				api.toast('The portal unseals!');
				setPortalSealed(g, false, currentFloor()?.theme);
			}
			state._wasSealed = nowSealed;
		}
		if (broadcast) {
			const now = api.now();
			state.combo = now - state.lastGemAt < 4 ? state.combo + 1 : 0;
			state.lastGemAt = now;
			audio.gemChime(state.combo);
			api.send({ op: 'gem', floor, index });
		}
		guiDirty = true;
		// victory: enough gems on the top floor
		if (floor === state.floorIndex && topFloor() && state.started && !state.wonAt && !sealed()) {
			state.wonAt = api.now();
			audio.winFanfare();
			guiDirty = true;
		}
	}

	function travel(target, broadcast = true) {
		const levels = state.campaign?.floors.length ?? 0;
		if (!levels || target < 1 || target > levels || target === state.floorIndex) return;
		state.floorIndex = target;
		state.onPortal = {};
		state.myOnPortal = false;
		state._wasSealed = undefined;
		rebuild();
		audio.portalWhoosh();
		const dungeon = currentFloor();
		api.toast('LEVEL ' + target + ' / ' + levels + ' — ' + dungeon.name);
		if (broadcast) api.send({ op: 'floor', floorIndex: target });
	}

	function claimSlot(slot, broadcast = true, peerId = me()) {
		const mineAlready = state.slots[slot]?.peerId === peerId;
		// toggle own slot off; claiming also frees your other slot
		Object.keys(state.slots).forEach((key) => {
			if (state.slots[key]?.peerId === peerId) state.slots[key] = null;
		});
		if (!mineAlready) state.slots[slot] = { peerId, name: shortName(peerId) };
		guiDirty = true;
		if (broadcast) api.send({ op: 'slot', slot, peerId: mineAlready ? null : peerId });
	}

	function applyRemoteSlot(data) {
		Object.keys(state.slots).forEach((key) => {
			if (data.peerId && state.slots[key]?.peerId === data.peerId) state.slots[key] = null;
		});
		state.slots[data.slot] = data.peerId ? { peerId: data.peerId, name: shortName(data.peerId) } : null;
		guiDirty = true;
	}

	function start(broadcast = true) {
		if (!state.campaign || state.started) return;
		state.started = true;
		state.startedAt = api.now();
		state.wonAt = 0;
		audio.startThump();
		guiDirty = true;
		if (broadcast) api.send({ op: 'start' });
	}

	function reset(broadcast = true) {
		state.started = false;
		state.wonAt = 0;
		guiDirty = true;
		if (broadcast) api.send({ op: 'reset' });
	}

	function bumpProp(name, delta, broadcast = true) {
		state.propValues[name] = (state.propValues[name] ?? 0) + delta;
		guiDirty = true;
		if (broadcast) api.send({ op: 'prop', name, value: state.propValues[name] });
	}

	function clear() {
		disposeGroup();
		state.campaign = null;
		state.seed = null;
		state.started = false;
		state.wonAt = 0;
		state.collected = {};
		state.onPortal = {};
		state.propValues = {};
		gui.hideMenu();
		gui.hideHud();
	}

	// ---- menu ------------------------------------------------------------------

	function menuAction(id) {
		if (id === 'join-p1') claimSlot('p1');
		else if (id === 'join-p2') claimSlot('p2');
		else if (id === 'start') start();
		else if (id === 'resume') {
			state._menuSuppressed = true;
			guiDirty = true;
		} else if (id === 'new-dungeon' || id === 'play-again') {
			const seed = hash32((api.now() * 1000) | 0, 'dice') % 100000;
			generate(seed, state.params ?? {});
			api.toast('New dungeon — seed ' + seed);
		} else if (id === 'generate') {
			const seed = hash32((api.now() * 1000) | 0, 'dice') % 100000;
			generate(seed, {});
		}
		guiDirty = true;
	}

	function slotLabel(slot, fallback) {
		const claim = state.slots[slot];
		if (!claim) return fallback;
		return fallback + ' — ' + (claim.peerId === me() ? 'you (click to leave)' : claim.name);
	}

	function buttonFor(action) {
		switch (action) {
			case 'join-p1': return { id: action, label: slotLabel('p1', 'Join as Player 1') };
			case 'join-p2': return { id: action, label: slotLabel('p2', 'Join as Player 2') };
			case 'start': return { id: action, label: 'Start adventure', disabled: !state.campaign };
			case 'resume': return { id: action, label: 'Resume' };
			case 'new-dungeon': return { id: action, label: 'New dungeon \u{1F3B2}' };
			case 'play-again': return { id: action, label: 'Play again \u{1F3B2}' };
			default: return null;
		}
	}

	function refreshGui() {
		guiDirty = false;
		const showMode = config.menu.show ?? 'auto';
		const menuWanted =
			playingNow &&
			showMode !== 'never' &&
			(showMode === 'always' || (!state.started && !state._menuSuppressed) || state.wonAt > 0);

		if (menuWanted && state.wonAt) {
			const seconds = Math.max(0, Math.round(state.wonAt - state.startedAt));
			const totalGems = Object.values(state.collected).reduce((sum, set) => sum + set.size, 0);
			gui.showMenu({
				title: 'Victory!',
				subtitle: 'The dragon’s hoard is yours',
				lines: [
					'Gems collected: ' + totalGems,
					'Time: ' + Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's',
					'Floors conquered: ' + state.campaign.floors.length
				],
				buttons: [buttonFor('play-again'), buttonFor('resume')].filter(Boolean),
				onAction: menuAction
			});
		} else if (menuWanted) {
			const dungeon = currentFloor();
			const { total } = gemTotals();
			const buttons = state.campaign
				? [config.menu.button1, config.menu.button2, config.menu.button3, config.menu.button4]
						.map(buttonFor)
						.filter(Boolean)
				: [{ id: 'generate', label: 'Generate a dungeon \u{1F3B2}' }];
			if (state.started && !buttons.some((b) => b.id === 'resume')) buttons.push(buttonFor('resume'));
			gui.showMenu({
				title: dungeon ? dungeon.name : 'Dungeon Realms',
				subtitle: dungeon
					? 'LEVEL ' + state.floorIndex + ' / ' + state.campaign.floors.length + ' · ' +
						dungeon.rooms.length + ' rooms · ' + total + ' gems hidden'
					: 'Co-op gem hunt · collect gems, unseal portals, reach the top',
				buttons,
				onAction: menuAction
			});
		} else gui.hideMenu();

		const hudWanted = playingNow && state.started && state.campaign;
		if (hudWanted) {
			const dungeon = currentFloor();
			const { total, need, have } = gemTotals();
			const players = ['p1', 'p2']
				.filter((slot) => state.slots[slot])
				.map((slot) => ({ slot, name: state.slots[slot].name, me: state.slots[slot].peerId === me() }));
			const extraProps = Object.entries(config.props)
				.filter(([, def]) => def.showInHud)
				.map(([name, def]) => ({ name, value: state.propValues[name] ?? def.initial ?? 0 }));
			const objective = state.wonAt
				? 'Victory! Press Esc to leave play mode.'
				: sealed()
					? 'Collect ' + (need - have) + ' more gem' + (need - have === 1 ? '' : 's') +
						(topFloor() ? ' to claim the dragon’s hoard' : ' to unseal the portal')
					: topFloor()
						? 'The hoard is yours!'
						: config.rules.allPlayersPortal && players.length > 1
							? 'Portal unsealed — stand on it together!'
							: 'Portal unsealed — step through!';
			gui.showHud({
				gems: { have, need, total },
				level: { k: state.floorIndex, n: state.campaign.floors.length, name: dungeon.name },
				players,
				objective,
				extraProps,
				corner: config.hud.corner,
				show: {
					gems: config.hud.showGems,
					level: config.hud.showLevel,
					players: config.hud.showPlayers,
					objective: config.hud.showObjective
				}
			});
		} else gui.hideHud();
	}

	// ---- frame tick --------------------------------------------------------------

	function tick(time) {
		// play-mode signal: the core minimap is visible exactly while play mode is
		// engaged AND our play contract exists (no api.isPlaying() yet — DEVX #11)
		const minimap = typeof document !== 'undefined' ? document.getElementById('dungeon-minimap') : null;
		const playing = !!minimap && !minimap.classList.contains('hidden');
		if (playing !== playingNow) {
			playingNow = playing;
			if (!playing) state._menuSuppressed = false;
			guiDirty = true;
		}

		const g = group();
		if (g) animateFloor(THREE, g, collectedSet(), time);

		if (playingNow && state.started && !state.wonAt && g) {
			const ray = api.pointerRay();
			const origin = ray?.ray?.origin;
			if (origin) {
				// gem pickup by proximity (walk over it)
				const gems = g.userData._dr?.gemWorld ?? [];
				const set = collectedSet();
				for (const gem of gems) {
					if (set.has(gem.index)) continue;
					const dx = origin.x - gem.x;
					const dz = origin.z - gem.z;
					if (dx * dx + dz * dz < config.rules.pickupRadius * config.rules.pickupRadius && Math.abs(origin.y - gem.y) < 2.6)
						collectGem(state.floorIndex, gem.index);
				}
				// portal travel: stand on the unsealed UP portal (together, by default)
				const portal = g.getObjectByName('dr-portal-up');
				if (portal && !sealed()) {
					const dx = origin.x - portal.position.x;
					const dz = origin.z - portal.position.z;
					const on = dx * dx + dz * dz < 1.4 * 1.4;
					if (on !== state.myOnPortal) {
						state.myOnPortal = on;
						state.onPortal[me()] = on;
						api.send({ op: 'onportal', peerId: me(), on });
					}
					if (on) {
						const others = ['p1', 'p2']
							.map((slot) => state.slots[slot]?.peerId)
							.filter((peerId) => peerId && peerId !== me());
						const together = !config.rules.allPlayersPortal || others.every((peerId) => state.onPortal[peerId]);
						if (together) travel(state.floorIndex + 1);
					}
				}
			}
		}

		if (guiDirty) refreshGui();
	}

	// ---- netcode -----------------------------------------------------------------

	function handleMessage(data) {
		if (data.op === 'generate') applyRemoteGenerate(data);
		else if (data.op === 'floor') travel(data.floorIndex, false);
		else if (data.op === 'gem') collectGem(data.floor, data.index, false);
		else if (data.op === 'slot') applyRemoteSlot(data);
		else if (data.op === 'start') {
			state.started = true;
			state.startedAt = api.now();
			guiDirty = true;
		} else if (data.op === 'reset') {
			state.started = false;
			state.wonAt = 0;
			guiDirty = true;
		} else if (data.op === 'onportal') {
			state.onPortal[data.peerId] = !!data.on;
		} else if (data.op === 'prop') {
			state.propValues[data.name] = data.value;
			guiDirty = true;
		} else if (data.op === 'clear') clear();
	}

	function getState() {
		if (state.seed == null) return null;
		return {
			seed: state.seed,
			params: state.params,
			floorIndex: state.floorIndex,
			collected: Object.fromEntries(Object.entries(state.collected).map(([floor, set]) => [floor, [...set]])),
			slots: state.slots,
			started: state.started,
			startedAt: state.startedAt,
			wonAt: state.wonAt,
			propValues: state.propValues
		};
	}

	function applyState(remote) {
		if (!remote || remote.seed == null) return;
		if (!generate(remote.seed, remote.params ?? {}, false)) return;
		Object.entries(remote.collected ?? {}).forEach(([floor, indices]) => {
			state.collected[floor] = new Set(indices);
		});
		state.slots = { p1: null, p2: null, ...(remote.slots ?? {}) };
		state.started = !!remote.started;
		state.startedAt = remote.startedAt ?? 0;
		state.wonAt = remote.wonAt ?? 0;
		state.propValues = remote.propValues ?? {};
		if (remote.floorIndex && remote.floorIndex !== state.floorIndex) travel(remote.floorIndex, false);
		else rebuild();
		guiDirty = true;
	}

	const suppressFlight = () =>
		playingNow && state.started && !state.wonAt && config.rules.disableFlight;

	return {
		state,
		config,
		generate,
		collectGem,
		travel,
		claimSlot,
		start,
		reset,
		bumpProp,
		clear,
		menuAction,
		tick,
		handleMessage,
		getState,
		applyState,
		gemTotals,
		suppressFlight,
		group,
		markGuiDirty: () => (guiDirty = true)
	};
}
