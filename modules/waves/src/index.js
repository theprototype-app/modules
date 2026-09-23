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
import { registerPowers } from './powers.js';
import { registerSession, resultLines } from './session.js';
import { registerMenu } from './menu.js';
import { createAssets } from './assets.js';
import { registerAvatars } from './avatars.js';

/** 30b: the module's own scene-root group — the headset board, later the gun and the shots.
 * LOCAL content: never in objectsGroup, never saved, never sent. */
export const ROOT = 'waves-module';

export default {
	id: 'waves',
	name: 'Waves',
	version: '2.1.0',
	description:
		'A VR wave shooter on the health module: a gun in your hand, five levels of grunts, runners and tanks walking from the portals to your crystal, a loadout of guns and abilities — every wave derived on every peer, no authority.',

	/** @param {any} api the module SDK surface */
	register(api) {
		if (!api.flow?.addNodes || !api.game?.roundCutoff || !api.peerVars?.all || !api.registerValueNode) {
			api.toast('Waves needs a newer app build (the game SDK seams are missing)');
			return;
		}
		const engine = createWavesEngine(api);
		/** @type {Record<string, () => number>} the local reads of the Waves Player node */
		const player = {};
		registerNodes(api, engine, player);
		const toolbox = registerToolbox(api, engine);

		const root = new api.THREE.Group();
		root.name = ROOT;
		const prefs = createPrefs(api);
		const feel = createFeel(api, prefs);
		const juice = createJuice(api, root);
		// 30c: the Meshy guns, enemies and crystal (lazy: the primitive look until each is in)
		const assets = createAssets(api);
		/** @type {ReturnType<typeof registerAvatars> | null} */
		let avatars = null;
		const fx = registerFx(api, engine, juice, feel, (uuid) => avatars?.of(uuid) ?? null);
		// attached on first sight of the scene (a module may register before it exists); if core
		// re-parents it (30b C1 hangs module content on the world rig) it is left where it is
		api.registerFrameTask(() => {
			if (!root.parent) api.scene()?.add(root);
		});
		api.registerSystemGroup?.(ROOT);
		const start = registerStart(api, root);
		const weapon = registerWeapon(api, engine, root, juice, prefs, feel, assets);
		avatars = registerAvatars(api, engine, root, assets);
		// the models load once a Waves arena is in the scene (not for a module merely installed)
		let preloaded = false;
		api.registerFrameTask(() => {
			if (preloaded || !engine.all().length) return;
			preloaded = true;
			assets.preload();
		});
		const powers = registerPowers(api, engine, root, prefs, feel);
		let spawnSet = false;
		const session = registerSession(api, engine, juice, feel, prefs, start);
		start.setResult(() => {
			const r = session.result();
			if (!r) return null;
			const l = resultLines(r);
			return { title: l.title, lines: l.lines, color: r.won ? '#6fcf7a' : '#ff5a4a' };
		});
		const menu = registerMenu(api, engine, prefs, feel);
		// 30b C1: the game's spawn is the Home pad, facing the arena (a module's spawn wins over
		// the scene's; feature-detected — a core without it keeps its own)
		api.registerFrameTask(() => {
			if (spawnSet || typeof api.setSpawn !== 'function') return;
			const home = api.objectsGroup()?.children.find((/** @type {any} */ c) => c.name === 'Home');
			if (!home || !engine.all().length) return;
			const p = home.getWorldPosition(new api.THREE.Vector3());
			api.setSpawn([p.x, 0, p.z], 0);
			spawnSet = true;
		});
		api.onSceneClear(() => {
			spawnSet = false;
		});
		// a breach asks this player's Shield before it hurts them
		engine.setGuard(() => powers.shielded());
		player.score = () => Number(api.peerVars.mine('score', 0)) || 0;
		player.best = () => session.best()?.score ?? 0;
		player.ability = () => powers.readiness();
		player.heat = () => Math.max(...['right', 'left', 'desk'].map((h) => weapon.heatOf(h).heat));
		// a new round starts every player's ability charged
		let roundAt = api.game.roundCutoff();
		api.registerFrameTask(() => {
			juice.frame();
			const r = api.game.roundCutoff();
			if (r !== roundAt) {
				roundAt = r;
				powers.reset();
			}
		});

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
				powers,
				session,
				menu,
				assets,
				avatars,
				hud: arenaHud,
				hudGraph,
				snapshot: () =>
					engine.all().map((s) => ({
						id: s.id,
						name: s.name,
						wave: s.wave,
						level: s.level,
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
