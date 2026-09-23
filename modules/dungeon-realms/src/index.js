// dungeon-realms — the module entry. Bundled to a single self-contained
// module.js by esbuild (npm run build:dungeon-realms); everything outside
// comes through `api`.
//
// The game in one breath (21-C C6): the DUNGEON KIT module (id 'dungeon') generates
// and renders a multi-floor campaign from one seed and publishes userData.play on
// its scene-root group, so the app's own play mode provides WASD walking, wall
// collision, spawns and the minimap; THIS module reads that contract through
// api.scene() and adds the game on top — gems, gem-gated portals, P1/P2 slots,
// travel-together co-op, the start/victory menu — and exposes every rule and every
// readout as flow nodes so a template's core HUD shows the game. Replication is
// deterministic: the Kit replicates {seed, params, floorIndex}; this module
// replicates only tiny discrete rule events.

import { createGame, GROUP_NAME } from './game.js';
import { registerNodes } from './nodes.js';
import { hash32 } from './hash.js';

export default {
	id: 'dungeon-realms',
	name: 'Dungeon Realms',
	version: '2.1.0',
	description:
		'Co-op dungeon crawl on the Dungeon Kit: gem-gated portals, P1/P2 play, travel-together floors — every rule and readout a flow node. Requires the "dungeon" (Dungeon Kit) module.',

	/** @param {any} api the module SDK surface */
	register(api) {
		const game = createGame(api);
		const nodes = registerNodes(api, game);

		api.registerSystemGroup(GROUP_NAME);
		api.registerInteractiveGroup(GROUP_NAME);
		api.registerListedGroup?.(GROUP_NAME, { label: 'Dungeon Realms' }); // 30: its object-list row

		// ---- module card buttons -------------------------------------------------
		api.registerMenu('Generate dungeon', () => {
			const seed = hash32((api.now() * 1000) | 0, 'menu') % 100000;
			if (game.newDungeon(seed)) api.toast('Dungeon Realms seed ' + seed + ' — press the red Play button to start');
		});
		api.registerMenu('Clear dungeon', () => {
			game.kit()?.clear();
			game.clear();
		});

		// ---- clicks: portals travel, gems collect (desktop editor + VR trigger) ---
		// 30: portals and gems are PLAY pieces — Interact and Play; an Edit click selects
		api.registerClickHandler((mesh) => {
			let cursor = mesh;
			while (cursor && !cursor.userData?.portal && cursor.name !== 'dr-gems') cursor = cursor.parent;
			if (!cursor) return false;
			if (cursor.name === 'dr-gems') {
				if (!game.state.started || game.state.wonAt) return true;
				const ray = api.pointerRay();
				const gems = game.group()?.userData._dr?.gemWorld ?? [];
				const set = game.state.collected[game.state.floorIndex] ?? new Set();
				const point = new (api.THREE.Vector3)();
				for (const gem of gems) {
					if (set.has(gem.index)) continue;
					point.set(gem.x, gem.y, gem.z);
					if (ray && ray.ray.distanceToPoint(point) < 0.55) {
						game.collectGem(game.state.floorIndex, gem.index);
						return true;
					}
				}
				return true;
			}
			const portal = cursor.userData.portal;
			if (portal.kind === 'down') game.travel(game.state.floorIndex - 1);
			else if (portal.sealed) {
				const { need, have } = game.gemTotals();
				api.toast('Sealed — collect ' + (need - have) + ' more gem' + (need - have === 1 ? '' : 's'));
			} else game.travel(game.state.floorIndex + 1);
			return true;
		}, { modes: ['interact', 'play'] });

		// ---- netcode ---------------------------------------------------------------
		api.onMessage((data) => game.handleMessage(data));
		api.registerStateSync({
			getState: () => game.getState(),
			applyState: (remote) => game.applyState(remote)
		});
		api.onSceneClear(() => game.clear());

		// ---- per-frame tick ----------------------------------------------------------
		api.registerFrameTask((time) => {
			nodes.tick();
			game.tick(time);
		});

		if (api.hud?.registerDebugLine)
			api.hud.registerDebugLine(() => {
				const s = game.state;
				if (s.seed == null) return null;
				const { have, need } = game.gemTotals();
				return 'realms seed ' + s.seed + ' floor ' + s.floorIndex + '/' + s.levelCount + ' gems ' + have + '/' + need + (s.started ? ' playing' : '');
			});

		api.registerBindings([
			{ label: 'Menu — select option', keys: 'ArrowUp / ArrowDown' },
			{ label: 'Menu — confirm', keys: 'Enter' }
		]);

		// test/debug hook (never serialized): the flight reaches the game here too, so
		// it can assert before any dungeon exists
		if (typeof window !== 'undefined') {
			// 30b: + the module's own `api` object, so a flight can stand in for SDK calls an older
			// core lacks (setSpawn, playSound, music, effects, hapticPattern, announce) and prove
			// exactly what this module sends them
			/** @type {any} */ (window).__dungeonRealms = { game, nodes, api };
		}
	}
};
