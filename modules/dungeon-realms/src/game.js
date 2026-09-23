// The game layer: the co-op rules (P1/P2 slots, gem-gated portals, travel-together),
// the menu state machine and the frame tick — as an OVERLAY on the Dungeon Kit.
//
// 21-C C6: the world is the Kit's. This module never generates or renders a level;
// it reads the Kit's scene-root group ('dungeon-module') through api.scene() —
// `userData.play` is the published contract (raster, rooms, props, portals, world
// offsets), `userData.kit` the function seam (generate / showFloor / setMarkers /
// setGrounded). Realms OBSERVES {seed, floorIndex} every frame and rebuilds its
// overlay when the Kit's world changes, whoever changed it (this module's portal,
// the Kit's toolbox, a Dungeon node, a late-join sync); it DRIVES travel by calling
// kit.showFloor, which the Kit replicates itself. So what replicates here is only
// the rule state: gem pickups, slots, start/reset, portal presence, prop counters.

import { DEFAULT_RULES, DEFAULT_MENU, gemTotals as totals, objectiveText, minimapMarkers, canTravelTogether } from './rules.js';
import { hash32 } from './hash.js';
import { buildOverlay, applyGems, setPortalSealed, animateOverlay } from './overlay.js';
import * as gui from './gui.js';
import * as audio from './audio.js';
import { spawnFor, footstep, feel } from './juice.js';

export const GROUP_NAME = 'dungeon-realms';
export const KIT_GROUP = 'dungeon-module';
export { DEFAULT_RULES, DEFAULT_MENU };

/** @param {any} api the module SDK surface */
export function createGame(api) {
	const THREE = api.THREE;

	const state = {
		/** the Kit world this rule state belongs to (observed) */
		seed: /** @type {number | null} */ (null),
		campaignChecksum: 0,
		checksum: 0,
		floorIndex: 1,
		levelCount: 0,
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
		propValues: {},
		/** a late-join state waiting for the Kit to show its seed */
		wanted: /** @type {any} */ (null),
		_wasSealed: /** @type {boolean | undefined} */ (undefined),
		_menuSuppressed: false,
		/** 30b: the last spawn handed to core (the flight reads it) @type {any} */
		spawn: null
	};

	// live node-config overrides (nodes.js writes these; absent nodes = defaults)
	const config = {
		rules: { ...DEFAULT_RULES },
		menu: { ...DEFAULT_MENU },
		/** @type {Record<string, {initial: number, showInHud: boolean}>} */
		props: {}
	};

	let guiDirty = true;
	/** 30b: in a GAME view — Play, or Interact (VR enters Interact from Play): gems, portals,
	 * footsteps and music run here, never in the Edit view */
	let playingNow = false;
	/** 30b: the footstep clock, the music we asked for, the last feel calls (the flight reads it) */
	const stepClock = {};
	let musicOn = false;
	/** @type {{event: string, sound?: string, burst?: string, haptic?: string | null, announce?: string, at: number}[]} */
	const fxLog = [];
	let groundedSent = /** @type {boolean | null} */ (null);
	/** @type {((event: string) => void) | null} nodes.js hooks the event node here */
	let eventSink = null;

	const me = () => api.peerId() ?? 'me';
	const shortName = (peerId) => (peerId === me() ? 'you' : String(peerId).slice(0, 6));
	const collectedSet = (floor = state.floorIndex) => (state.collected[floor] ??= new Set());

	// ---- the Kit, through the scene -------------------------------------------------
	const kitGroup = () => api.scene()?.getObjectByName(KIT_GROUP) ?? null;
	/** the Kit's function seam, or null when the Kit is not installed */
	const kit = () => kitGroup()?.userData?.kit ?? null;
	/** the Kit's published contract, or null when no dungeon exists */
	const play = () => kitGroup()?.userData?.play ?? null;
	const group = () => api.scene()?.getObjectByName(GROUP_NAME) ?? null;

	// ---- 30b: the frame the game's coordinates live in ------------------------------------------
	// Module groups sit under core's world root (C1 P5), which a VR Edit grab can move/scale; the
	// contract's coordinates are the Kit group's LOCAL frame, the viewer and the SDK are world.
	const _v = new THREE.Vector3();
	/** world -> the Kit's frame @param {number[]} p */
	function toLocal(p) {
		const k = kitGroup();
		_v.set(p[0], p[1], p[2]);
		if (k) { k.updateWorldMatrix(true, false); k.worldToLocal(_v); }
		return { x: _v.x, y: _v.y, z: _v.z };
	}
	/** the Kit's frame -> world @param {number} x @param {number} y @param {number} z @returns {[number, number, number]} */
	function toWorld(x, y, z) {
		const k = kitGroup();
		_v.set(x, y, z);
		if (k) { k.updateWorldMatrix(true, false); k.localToWorld(_v); }
		return [_v.x, _v.y, _v.z];
	}

	/**
	 * Play a game event's FEEL (juice.js feel table) through the SDK: a built-in sound (C5) — or
	 * this module's own WebAudio voices on an app without them —, a particle burst (C6), a haptic
	 * (C4: core mutes it in Edit), a big banner (C2) — or a toast without it. All LOCAL.
	 * @param {string} event @param {any} ctx @param {[number, number, number] | null} [at] world position
	 */
	function play_(event, ctx = {}, at = null) {
		const f = /** @type {any} */ (feel(/** @type {any} */ (event), ctx));
		if (f.sound) {
			if (api.music) api.playSound?.(f.sound, at ?? undefined);
			else if (f.sound === 'coin') audio.gemChime(state.combo);
			else if (f.sound === 'portal') audio.sealBreak();
			else if (f.sound === 'levelup') audio.portalWhoosh();
			else if (f.sound === 'success') audio.startThump();
			else if (f.sound === 'cheer') audio.winFanfare();
		}
		if (f.burst && at) api.effects?.burst?.(at, { kind: f.burst.kind, count: f.burst.count, ...(f.burst.color != null ? { color: f.burst.color } : {}) });
		if (f.haptic) {
			if (typeof api.hapticPattern === 'function') api.hapticPattern(f.haptic);
			else api.haptic?.(0.6, 60);
		}
		if (f.announce) {
			if (typeof api.announce === 'function') api.announce(f.announce.text, f.announce.sub ? { sub: f.announce.sub } : {});
			else if (event !== 'start') api.toast(f.announce.text + (f.announce.sub ? ' — ' + f.announce.sub : ''));
		}
		if (f.music) setMusic(true);
		fxLog.push({ event, sound: f.sound, burst: f.burst?.kind, haptic: f.haptic ?? null, announce: f.announce?.text, at: api.now() });
		if (fxLog.length > 40) fxLog.shift();
	}

	/** the dungeon's music on/off (C5). Core refuses it in Edit (play() returns false) and stops
	 * it by itself on leaving the game, so "on" is re-asserted until it is really playing
	 * (api.music.current()) @param {boolean} on */
	function setMusic(on) {
		if (!api.music) return;
		if (on) {
			if (musicOn && (typeof api.music.current === 'function' ? api.music.current() : 'dungeon') === 'dungeon') return;
			musicOn = api.music.play?.('dungeon', { volume: 0.5 }) !== false;
		} else if (musicOn) {
			musicOn = false;
			api.music.stop?.();
		}
	}

	/** my party slot index (P1 = 0, P2 = 1; unslotted players stand with P1) */
	function mySlot() {
		if (state.slots.p2?.peerId === me()) return 1;
		return 0;
	}

	/**
	 * Tell core where this floor starts for ME (C1 api.setSpawn, feet + yaw). `teleport` also moves
	 * me there now (only while Interact/Play is on — core's rule): a new floor, a started game.
	 * @param {boolean} teleport
	 */
	function placeSpawn(teleport) {
		if (typeof api.setSpawn !== 'function') return false;
		const p = play();
		const spawn = spawnFor(p, mySlot());
		if (!spawn) return false;
		const [x, y, z] = toWorld(spawn.position[0], spawn.position[1], spawn.position[2]);
		state.spawn = { position: [x, y, z], yaw: spawn.yaw, floor: p.floorIndex, teleport };
		return api.setSpawn([x, y, z], spawn.yaw, { teleport });
	}

	const gemCount = (floor = state.floorIndex) => {
		if (floor === state.floorIndex) return (play()?.props ?? []).filter((p) => p.kind === 'gem').length;
		const dungeon = kit()?.campaign?.()?.floors[floor - 1];
		return dungeon ? dungeon.props.filter((p) => p.kind === 'gem').length : 0;
	};
	function gemTotals(floor = state.floorIndex) {
		return totals(gemCount(floor), collectedSet(floor).size, config.rules.gemShare);
	}
	const sealed = () => {
		const { need, have } = gemTotals();
		return have < need;
	};
	const topFloor = () => state.floorIndex >= (state.levelCount || 1);
	const players = () => ['p1', 'p2'].filter((slot) => state.slots[slot]).length;

	function disposeOverlay() {
		const existing = group();
		if (!existing) return;
		existing.traverse((child) => {
			child.geometry?.dispose?.();
			if (child.material && !Array.isArray(child.material)) child.material.dispose?.();
		});
		existing.parent?.remove(existing);
	}

	/** the minimap half of the seam: uncollected gems + portals as markers */
	function publishMarkers() {
		kit()?.setMarkers?.(GROUP_NAME, minimapMarkers(play(), collectedSet()));
	}

	/** (Re)build the overlay for the Kit's CURRENT floor. */
	function rebuild() {
		disposeOverlay();
		const scene = api.scene();
		const p = play();
		if (!scene || !p) return;
		const built = buildOverlay(THREE, p, collectedSet());
		built.name = GROUP_NAME;
		// debug/test hook (scene-root local, never serialized) — the flight drives the
		// game through this instead of reaching into module scope
		built.userData._dr.game = {
			state,
			config,
			collect: (index) => collectGem(state.floorIndex, index),
			travel: (target) => travel(target),
			start: () => start(),
			claimSlot: (slot) => claimSlot(slot),
			menuAction,
			gemTotals,
			sealed,
			objective
		};
		scene.add(built);
		setPortalSealed(built, sealed(), p.theme);
		publishMarkers();
		guiDirty = true;
	}

	/** reset the rule state for a NEW world (keeps the slots — the players are still here) */
	function resetForWorld() {
		state.collected = {};
		state.started = false;
		state.wonAt = 0;
		state.onPortal = {};
		state.myOnPortal = false;
		state.combo = 0;
		state._wasSealed = undefined;
		state._menuSuppressed = false;
	}

	/** apply a late-join state now that the Kit shows its seed @param {any} remote */
	function applyWanted(remote) {
		state.collected = {};
		Object.entries(remote.collected ?? {}).forEach(([floor, indices]) => {
			state.collected[floor] = new Set(indices);
		});
		state.slots = { p1: null, p2: null, ...(remote.slots ?? {}) };
		state.started = !!remote.started;
		state.startedAt = remote.startedAt ?? 0;
		state.wonAt = remote.wonAt ?? 0;
		state.propValues = remote.propValues ?? {};
		state._wasSealed = undefined;
	}

	/**
	 * Every frame: follow the Kit. A new seed = a new game (unless a late-join state
	 * for exactly that seed is waiting); a new floor = rebuild the overlay there.
	 */
	function observe() {
		const p = play();
		if (!p) {
			if (state.seed != null || group()) {
				disposeOverlay();
				state.seed = null;
				state.levelCount = 0;
				resetForWorld();
				gui.hideMenu();
				guiDirty = true;
			}
			return;
		}
		const newWorld = p.seed !== state.seed || p.campaignChecksum !== state.campaignChecksum;
		const newFloor = p.floorIndex !== state.floorIndex || p.checksum !== state.checksum;
		if (!newWorld && !newFloor) {
			if (!group()) rebuild(); // the overlay was cleared under us (scene clear ordering)
			return;
		}
		if (newWorld) {
			state.seed = p.seed;
			state.campaignChecksum = p.campaignChecksum;
			state.levelCount = p.levelCount;
			if (state.wanted && state.wanted.seed === p.seed) {
				applyWanted(state.wanted);
				if (state.wanted.floorIndex && state.wanted.floorIndex !== p.floorIndex) kit()?.showFloor(state.wanted.floorIndex, { broadcast: false });
				state.wanted = null;
			} else resetForWorld();
		} else {
			state.onPortal = {};
			state.myOnPortal = false;
			state._wasSealed = undefined;
			// 30b: a new floor — the fanfare and a big "Floor N" banner (C2)
			play_('floor', { floor: p.floorIndex, name: p.name });
		}
		state.floorIndex = p.floorIndex;
		state.checksum = p.checksum;
		rebuild();
		// 30b: the floor's start for core's spawn (C1): a checkpoint for a new world; for a new floor
		// while the game view is on, everyone MOVES there (a player who did not step on the portal
		// must not arrive inside a wall of the next floor)
		placeSpawn(!newWorld && playingNow);
		guiDirty = true;
	}

	// ---- actions (each: apply locally, optionally broadcast; receivers never
	// re-send — the applier is shared by both paths) -----------------------------

	/** ask the Kit for a new world (the Kit replicates it) @param {number} seed */
	function newDungeon(seed) {
		const k = kit();
		if (!k) {
			api.toast('Dungeon Realms needs the Dungeon Kit module — install "dungeon" first');
			return false;
		}
		const ok = k.generate(seed, k.state().params);
		if (ok) eventSink?.('reset');
		return ok;
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
				const portal = g.getObjectByName('dr-portal-up');
				const pp = portal ? toWorld(portal.position.x, 0.6, portal.position.z) : null;
				play_('unseal', { local: broadcast, color: play()?.theme?.gemColor }, pp);
				setPortalSealed(g, false, play()?.theme);
				if (broadcast) eventSink?.('unseal');
			}
			state._wasSealed = nowSealed;
			publishMarkers();
		}
		if (broadcast) {
			const now = api.now();
			state.combo = now - state.lastGemAt < 4 ? state.combo + 1 : 0;
			state.lastGemAt = now;
			api.send({ op: 'gem', floor, index });
			eventSink?.('gem');
		}
		// 30b: the pickup's feel on EVERY peer (a coin + sparkles where the gem was); the haptic
		// only on the picker's own hands
		if (floor === state.floorIndex) {
			const gem = g?.userData._dr?.gemWorld?.find((/** @type {any} */ e) => e.index === index);
			play_('gem', { local: broadcast, color: play()?.theme?.gemColor }, gem ? toWorld(gem.x, gem.y, gem.z) : null);
		}
		guiDirty = true;
		// victory: enough gems on the top floor
		if (floor === state.floorIndex && topFloor() && state.started && !state.wonAt && !sealed()) {
			state.wonAt = api.now();
			play_('victory', { local: broadcast }, playerAt());
			if (broadcast) eventSink?.('victory');
			guiDirty = true;
		}
	}

	/** travel to floor `target` — the Kit shows it and replicates; observe() follows */
	function travel(target) {
		const k = kit();
		if (!k || target === state.floorIndex) return false;
		const ok = k.showFloor(target);
		if (ok) eventSink?.('travel');
		return ok;
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
		if (state.seed == null || state.started) return;
		// P4: whoever starts the adventure is IN it — a free slot is claimed for the starter
		// ("0 in the party" while you walk the dungeon read as a bug)
		if (broadcast && !Object.values(state.slots).some((s) => s?.peerId === me())) {
			const free = ['p1', 'p2'].find((slot) => !state.slots[slot]);
			if (free) claimSlot(free);
		}
		state.started = true;
		state.startedAt = api.now();
		state.wonAt = 0;
		onStarted();
		guiDirty = true;
		if (broadcast) {
			api.send({ op: 'start' });
			eventSink?.('start');
		}
	}

	/** 30b: the adventure begins (here or on a peer) — every player to the floor's start, the
	 * banner, the music */
	function onStarted() {
		const p = play();
		placeSpawn(playingNow);
		play_('start', { floor: p?.floorIndex ?? 1, name: p?.name });
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

	/** drop the overlay and the rule state (the Kit clears its own world) */
	function clear() {
		disposeOverlay();
		state.seed = null;
		state.levelCount = 0;
		resetForWorld();
		state.propValues = {};
		state.wanted = null;
		gui.hideMenu();
		guiDirty = true;
	}

	// ---- menu ------------------------------------------------------------------

	function menuAction(id) {
		if (id === 'join-p1') claimSlot('p1');
		else if (id === 'join-p2') claimSlot('p2');
		else if (id === 'start') start();
		else if (id === 'quit') {
			// 30: back to the Start screen — the round resets on every peer (the rule state;
			// the world and the collected gems stay, a new dungeon is the dice button)
			if (state.started || state.wonAt) {
				reset();
				eventSink?.('reset');
			}
		} else if (id === 'resume') {
			state._menuSuppressed = true;
			guiDirty = true;
		} else if (id === 'new-dungeon' || id === 'play-again' || id === 'generate') {
			const seed = hash32((api.now() * 1000) | 0, 'dice') % 100000;
			if (newDungeon(seed)) api.toast('New dungeon — seed ' + seed);
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
			case 'start': return { id: action, label: 'Start adventure', disabled: state.seed == null };
			case 'resume': return { id: action, label: 'Resume' };
			case 'new-dungeon': return { id: action, label: 'New dungeon \u{1F3B2}' };
			case 'play-again': return { id: action, label: 'Play again \u{1F3B2}' };
			default: return null;
		}
	}

	/** the objective line (also what the HUD rows node publishes) */
	function objective() {
		const { need, have } = gemTotals();
		return objectiveText({
			won: !!state.wonAt,
			sealed: sealed(),
			need,
			have,
			topFloor: topFloor(),
			allPlayersPortal: config.rules.allPlayersPortal,
			players: players()
		});
	}

	function refreshGui() {
		guiDirty = false;
		const showMode = config.menu.show ?? 'auto';
		const menuWanted =
			playingNow &&
			showMode !== 'never' &&
			(showMode === 'always' || (!state.started && !state._menuSuppressed) || state.wonAt > 0);
		const p = play();

		if (menuWanted && state.wonAt) {
			const seconds = Math.max(0, Math.round(state.wonAt - state.startedAt));
			const totalGems = Object.values(state.collected).reduce((sum, set) => sum + set.size, 0);
			gui.showMenu({
				title: 'Victory!',
				subtitle: 'The dragon’s hoard is yours',
				lines: [
					'Gems collected: ' + totalGems,
					'Time: ' + Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's',
					'Floors conquered: ' + state.levelCount
				],
				buttons: [buttonFor('play-again'), buttonFor('resume')].filter(Boolean),
				onAction: menuAction
			});
		} else if (menuWanted) {
			const { total } = gemTotals();
			const buttons = p
				? [config.menu.button1, config.menu.button2, config.menu.button3, config.menu.button4].map(buttonFor).filter(Boolean)
				: [{ id: 'generate', label: 'Generate a dungeon \u{1F3B2}' }];
			if (state.started && !buttons.some((b) => b.id === 'resume')) buttons.push(buttonFor('resume'));
			gui.showMenu({
				title: p ? p.name : 'Dungeon Realms',
				subtitle: p
					? 'LEVEL ' + state.floorIndex + ' / ' + state.levelCount + ' · ' + p.rooms.length + ' rooms · ' + total + ' gems hidden'
					: kit()
						? 'Co-op gem hunt · collect gems, unseal portals, reach the top'
						: 'Install the Dungeon Kit module (id "dungeon") to generate a world',
				buttons,
				onAction: menuAction
			});
		} else gui.hideMenu();
	}

	// ---- frame tick --------------------------------------------------------------

	/** play-mode signal: api.isPlaying() (DEVX #11), the minimap DOM on an older app */
	function isPlaying() {
		// 30b: Interact is a game view too (C1: VR's Play enters Interact)
		if (api.editorMode?.() === 'interact') return true;
		if (typeof api.isPlaying === 'function') return !!api.isPlaying();
		const minimap = typeof document !== 'undefined' ? document.getElementById('dungeon-minimap') : null;
		return !!minimap && !minimap.classList.contains('hidden');
	}

	/** where the player stands: api.playerPosition() (R3a), the pointer ray origin before it */
	function playerXZ() {
		// 30b: in the Kit's frame (the world root may carry a VR Edit transform)
		if (typeof api.playerPosition === 'function') {
			const p = api.playerPosition();
			if (p) return toLocal(p);
		}
		const origin = api.pointerRay()?.ray?.origin;
		return origin ? toLocal([origin.x, origin.y, origin.z]) : null;
	}
	/** the viewer's WORLD position, or null @returns {[number, number, number] | null} */
	function playerAt() {
		const p = typeof api.playerPosition === 'function' ? api.playerPosition() : null;
		return p ? [p[0], p[1], p[2]] : null;
	}

	function tick(time) {
		observe();

		const playing = isPlaying();
		if (playing !== playingNow) {
			playingNow = playing;
			if (!playing) state._menuSuppressed = false;
			stepClock.x = stepClock.z = undefined;
			// 30b: entering the game view mid-round: the floor's start is the checkpoint (core moves
			// you there on entry — C1)
			if (playing && state.started && !state.wonAt) placeSpawn(false);
			guiDirty = true;
		}
		// 30b: the dungeon's music plays while the game view is on and a dungeon stands
		setMusic(playing && state.seed != null);

		// Game Rules ▸ disableFlight rides the CONTRACT (userData.play.grounded, DEVX
		// #14) instead of swallowing Q/E at window capture; sent on change only
		const grounded = !!config.rules.disableFlight;
		if (grounded !== groundedSent && kit()) {
			kit().setGrounded?.(grounded);
			groundedSent = grounded;
		}

		const g = group();
		if (g) animateOverlay(THREE, g, collectedSet(), time);

		if (playingNow && state.started && !state.wonAt && g) {
			const pos = playerXZ();
			if (pos) {
				// 30b: footsteps as you walk (LOCAL, at your feet)
				if (footstep(stepClock, pos)) play_('step', {}, toWorld(pos.x, 0, pos.z));
				// gem pickup by proximity (walk over it)
				const gems = g.userData._dr?.gemWorld ?? [];
				const set = collectedSet();
				const r2 = config.rules.pickupRadius * config.rules.pickupRadius;
				for (const gem of gems) {
					if (set.has(gem.index)) continue;
					const dx = pos.x - gem.x;
					const dz = pos.z - gem.z;
					if (dx * dx + dz * dz < r2 && Math.abs(pos.y - gem.y) < 2.6) collectGem(state.floorIndex, gem.index);
				}
				// portal travel: stand on the unsealed UP portal (together, by default)
				const portal = g.getObjectByName('dr-portal-up');
				if (portal && !sealed()) {
					const dx = pos.x - portal.position.x;
					const dz = pos.z - portal.position.z;
					const on = dx * dx + dz * dz < 1.4 * 1.4;
					if (on !== state.myOnPortal) {
						state.myOnPortal = on;
						state.onPortal[me()] = on;
						api.send({ op: 'onportal', peerId: me(), on });
					}
					if (on && canTravelTogether(state.slots, state.onPortal, me(), config.rules.allPlayersPortal)) travel(state.floorIndex + 1);
				}
			}
		}

		if (guiDirty) refreshGui();
	}

	// ---- netcode -----------------------------------------------------------------

	function handleMessage(data) {
		if (data.op === 'gem') collectGem(data.floor, data.index, false);
		else if (data.op === 'slot') applyRemoteSlot(data);
		else if (data.op === 'start') {
			state.started = true;
			state.startedAt = api.now();
			onStarted();
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
		}
	}

	function getState() {
		if (state.seed == null) return null;
		return {
			seed: state.seed,
			floorIndex: state.floorIndex,
			collected: Object.fromEntries(Object.entries(state.collected).map(([floor, set]) => [floor, [...set]])),
			slots: state.slots,
			started: state.started,
			startedAt: state.startedAt,
			wonAt: state.wonAt,
			propValues: state.propValues
		};
	}

	/** the Kit syncs its own world; this waits for it when it has not arrived yet */
	function applyState(remote) {
		if (!remote || remote.seed == null) return;
		const p = play();
		if (p && p.seed === remote.seed) {
			state.seed = p.seed;
			state.campaignChecksum = p.campaignChecksum;
			state.levelCount = p.levelCount;
			applyWanted(remote);
			if (remote.floorIndex && remote.floorIndex !== p.floorIndex) kit()?.showFloor(remote.floorIndex, { broadcast: false });
			else {
				state.floorIndex = p.floorIndex;
				state.checksum = p.checksum;
				rebuild();
			}
			state.wanted = null;
		} else state.wanted = remote; // observe() applies it when the Kit shows this seed
		guiDirty = true;
	}

	return {
		state,
		config,
		kit,
		play,
		group,
		newDungeon,
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
		sealed,
		topFloor,
		players,
		objective,
		isPlaying,
		placeSpawn,
		fxLog,
		markGuiDirty: () => (guiDirty = true),
		/** @param {(event: string) => void} fn */
		onEvent: (fn) => (eventSink = fn)
	};
}
