// waves — the module entry. Bundled to one self-contained module.js by esbuild
// (npm run build:waves); everything outside comes through `api`.
//
// The game in one breath: pre-placed enemies carry the health module's chains; a Waves
// node derives the wave from their hit counters (each wave heals them back with local
// pulses, so a counter reads hp × kills), walks the living ones from their spawn points
// to the goal on the synced clock, and when the last wave's last enemy falls every peer
// fires `over` and appends the same run to gameState.vars. Kills sit on the killer's
// own peerVars row (the health module credits them). Needs the health module.

import { createWavesEngine } from './engine.js';
import { registerNodes } from './nodes.js';
import { registerToolbox } from './toolbox.js';
import { arenaHud, hudGraph } from './hud.js';
import { DEFAULTS } from './curve.js';
import { registerFx } from './fx.js';
import { registerStart } from './start.js';
import { createJuice } from './juice.js';
import { createPrefs } from './prefs.js';
import { createFeel } from './feel.js';
import { registerWeapon } from './weapon.js';

/** 30b: the module's own scene-root group — the headset board, later the gun and the shots.
 * LOCAL content: never in objectsGroup, never saved, never sent. */
export const ROOT = 'waves-module';

export default {
	id: 'waves',
	name: 'Waves',
	version: '1.1.0',
	description:
		'Wave survival on the health module: enemies walk from spawn points to a goal, a wave ends when its last enemy dies, the run is over when the last wave does — derived on every peer, no authority.',

	/** @param {any} api the module SDK surface */
	register(api) {
		if (!api.flow?.addNodes || !api.game?.roundCutoff || !api.peerVars?.all || !api.registerValueNode) {
			api.toast('Waves needs a newer app build (the game SDK seams are missing)');
			return;
		}
		const engine = createWavesEngine(api);
		registerNodes(api, engine);
		const toolbox = registerToolbox(api, engine);

		const root = new api.THREE.Group();
		root.name = ROOT;
		const prefs = createPrefs(api);
		const feel = createFeel(api, prefs);
		const juice = createJuice(api, root);
		const fx = registerFx(api, engine, juice, feel);
		// attached on first sight of the scene (a module may register before it exists); if core
		// re-parents it (30b C1 hangs module content on the world rig) it is left where it is
		api.registerFrameTask(() => {
			if (!root.parent) api.scene()?.add(root);
		});
		api.registerSystemGroup?.(ROOT);
		const start = registerStart(api, root);
		const weapon = registerWeapon(api, engine, root, juice, prefs, feel);
		api.registerFrameTask(() => juice.frame());

		api.hud.registerDebugLine(() => {
			const runs = engine.all();
			if (!runs.length) return null;
			return runs
				.map((s) => 'waves (' + s.name + '): ' + (s.done ? 'cleared' : 'wave ' + s.wave + '/' + s.curve.waves + (s.running ? ', ' + s.alive + ' left' : ', idle')))
				.join(' · ');
		});
		api.hud.registerAction({
			key: 'showwave',
			label: 'Show the wave',
			group: 'Data',
			role: 'drives',
			node: '',
			via: { node: 'wavesvalue', data: { name: DEFAULTS.name, read: 'wave' }, handle: 'value' },
			hint: 'The current wave, derived from the enemies’ hit counters on every peer.'
		});
		api.hud.registerAction({
			key: 'showleft',
			label: 'Show enemies left',
			group: 'Data',
			role: 'drives',
			node: '',
			via: { node: 'wavesvalue', data: { name: DEFAULTS.name, read: 'left' }, handle: 'value' },
			hint: 'How many of this wave are still standing.'
		});

		api.onSceneClear(() => engine.clear());

		if (typeof window !== 'undefined')
			/** @type {any} */ (window).__waves = {
				api,
				engine,
				fx,
				toolbox,
				start,
				root,
				prefs,
				juice,
				weapon,
				hud: arenaHud,
				hudGraph,
				snapshot: () =>
					engine.all().map((s) => ({
						id: s.id,
						name: s.name,
						wave: s.wave,
						completed: s.completed,
						done: s.done,
						running: s.running,
						started: s.started,
						alive: s.alive,
						size: s.size,
						waves: s.curve.waves,
						waveStart: s.waveStart,
						goal: s.goal,
						spawns: s.spawns.length,
						enemies: s.enemies.map((e) => ({ uuid: e.uuid, label: e.label, hits: e.hits, heals: e.heals, kills: e.kills, hp: e.hp })),
						log: engine.runLog(s.name)
					}))
			};
	}
};
