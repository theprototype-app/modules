// dungeon-realms — the module entry. Bundled to a single self-contained
// module.js by esbuild (npm run build:dungeon-realms); everything outside
// comes through `api`.
//
// The game in one breath: a 9-stage pure-data generator (src/gen, node-tested
// without the app) builds a multi-floor campaign from ONE seed; the renderer
// instances it into the scene-root 'dungeon-module' group and publishes
// userData.play, so the app's own play mode (red Play button) provides WASD
// walking, wall collision, spawns and the minimap; the game layer adds gems,
// gem-gated portals, P1/P2 slots, travel-together co-op and the GUI; the node
// family exposes every rule in the flow editor. Replication is deterministic:
// {seed, params, floorIndex} + tiny discrete events.

import { createGame, GROUP_NAME } from './game.js';
import { registerNodes } from './nodes.js';
import { hash32 } from './gen/rng.js';

export default {
	id: 'dungeon-realms',
	name: 'Dungeon Realms',
	version: '1.0.0',
	description:
		'Co-op dungeon crawl: seeded multi-floor generator, gem-gated portals, P1/P2 play — every rule editable as flow nodes.',

	/** @param {any} api the module SDK surface */
	register(api) {
		const game = createGame(api);
		const nodes = registerNodes(api, game);

		api.registerSystemGroup(GROUP_NAME);
		api.registerInteractiveGroup(GROUP_NAME);

		// ---- module card buttons -------------------------------------------------
		api.registerMenu('Generate dungeon', () => {
			const seed = hash32((api.now() * 1000) | 0, 'menu') % 100000;
			if (game.generate(seed, game.state.params ?? {}))
				api.toast('Dungeon Realms seed ' + seed + ' — press the red Play button to start');
		});
		api.registerMenu('Clear dungeon', () => {
			game.clear();
			api.send({ op: 'clear' });
		});

		// ---- clicks: portals travel, gems collect (desktop editor + VR trigger) ---
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
		});

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

		// ---- flight suppression (Game Rules ▸ disableFlight) ---------------------------
		// Play mode's Q/E fly keys are swallowed at window CAPTURE while the game
		// runs, so players walk the dungeon instead of flying out of it. keyup
		// passes through so a held key can never wedge the move state. A proper
		// "grounded" play-mode option is filed in DEVX-REQUESTS.md.
		if (typeof window !== 'undefined') {
			window.addEventListener(
				'keydown',
				(event) => {
					if ((event.code === 'KeyQ' || event.code === 'KeyE') && game.suppressFlight()) {
						event.preventDefault();
						event.stopImmediatePropagation();
					}
				},
				true
			);
		}

		api.registerBindings([
			{ label: 'Menu — select option', keys: 'ArrowUp / ArrowDown' },
			{ label: 'Menu — confirm', keys: 'Enter' }
		]);
	}
};
