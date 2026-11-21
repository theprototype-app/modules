// navigation — the module entry. Bundled to one self-contained module.js by esbuild
// (npm run build:navigation); the recast half is a separate worker asset + the wasm, loaded only
// when a scene holds navigation nodes. Everything outside comes through `api`.
//
// Roadmap 61: a navmesh baked from the scene (G1), enemies that see, hear, chase, attack and give
// up (G5), an honest "unreachable" (G6), a debug view (G7), device caps (G8) and one
// "Make this an enemy" sheet shared with the agent tools (G10).

import { createRuntime } from './runtime.js';
import { registerNodes } from './nodes.js';
import { createOverlay } from './overlay.js';
import { registerSheet } from './sheet.js';

export default {
	id: 'navigation',
	name: 'Navigation',
	version: '1.0.0',
	description:
		'Enemies that walk: a navmesh baked from your scene, Move To / Chase / Patrol / Flee / Wander nodes, and guards that see, hear, chase, attack and give up. Right-click an object ▸ Make this an enemy.',

	/** @param {any} api the module SDK surface */
	register(api) {
		if (!api.colliderGeometry || !api.paths?.of || !api.registerObjectAction || !api.flow?.addNodes || !api.registerValueNode) {
			api.toast('Navigation needs a newer app build (the game-world SDK seams are missing).');
			return;
		}
		const rt = createRuntime(api);
		registerNodes(api, rt);
		const overlay = createOverlay(api, rt);
		const sheet = registerSheet(api, rt);
		api.registerFrameTask(() => {
			rt.tick();
			overlay.update();
		});
		rt.scanGraph();

		api.hud?.registerDebugLine?.(() => {
			if (!rt.shown.size && rt.bake.status === 'idle') return null;
			const by = rt.authorityId();
			return 'navigation: ' + rt.bake.status + (rt.bake.status === 'ready' ? ' ' + rt.bake.ms + ' ms' : '') + ' · ' + rt.shown.size + ' enemies · steps on ' + (by === null ? 'nobody' : by === String(api.peerId?.() ?? '') ? 'this peer' : by);
		});

		// test/debug hook (never serialized)
		if (typeof window !== 'undefined') /** @type {any} */ (window).__navigation = { api, rt, overlay, sheet, debug: () => ({ ...rt.debug(), overlay: overlay.info() }) };
	}
};
