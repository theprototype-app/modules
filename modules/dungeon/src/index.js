// Dungeon Kit — the module entry. Bundled to one self-contained module.js by esbuild
// (npm run build:dungeon); everything outside comes through `api`.
//
// 21-C C6: `dungeon` is the KIT — the 9-stage pure-data generator (src/gen, node-
// tested), the instanced renderer, the toolbox and the published play contract. The
// playable game is DUNGEON REALMS (modules/dungeon-realms), which reads this module's
// scene-root group through api.scene() and adds gems, portals, rules and a menu on
// top. Two modules cannot share code (an entry file has no imports), so they share
// the SCENE: userData.play is the public contract, userData.kit the function seam.
//
// Only {seed, params, floorIndex} replicates — every peer regenerates the identical
// dungeon locally (determinism IS the netcode). The meshes live in a module-owned
// group at the SCENE root, never in objectsGroup.

import { createKit } from './kit.js';
import { registerNodes } from './nodes.js';
import { registerToolbox } from './toolbox.js';
import { GROUP_NAME } from './contract.js';

export default {
	id: 'dungeon',
	name: 'Dungeon Kit',
	version: '2.1.0',
	description:
		'Level generation toolbox: a seeded multi-floor dungeon generator (rooms, corridors, decor, torches) with a toolbox, a Dungeon node and the userData.play contract the app walks in play mode. The playable game is Dungeon Realms.',

	/** @param {any} api the module SDK surface */
	register(api) {
		const core = createKit(api);
		registerNodes(api, core);
		const toolbox = registerToolbox(api, core);

		api.registerSystemGroup(GROUP_NAME); // visible under the System filter
		core.ensureGroup(); // the persistent group exists from the first frame

		api.onMessage((data) => core.handleMessage(data));
		api.onSceneClear(() => core.kit.clear({ broadcast: false }));

		// late joiners rebuild from {seed, params, floorIndex}
		api.registerStateSync({
			getState: () => core.getState(),
			applyState: (remote) => core.applyState(remote)
		});

		api.registerFrameTask((time) => core.tick(time));

		// test/debug hook (never serialized): the flights read the toolbox host
		if (typeof window !== 'undefined') {
			/** @type {any} */ (window).__dungeonKit = { kit: core.kit, toolbox, groupName: GROUP_NAME };
		}
	}
};
