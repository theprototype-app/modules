// football — the module entry. Bundled to one self-contained module.js by esbuild
// (npm run build:football); everything outside comes through `api`.
//
// The game in one breath: two gates float at chest height, one ball floats between them
// (the scene's zero-g physics block, fork 2), you hit it with your hands (core's knock,
// 24-A A1) and it flies at the speed you hit it. Every peer receives every hit, so every
// peer derives the same last touch; the physics initiator alone sees the ball enter a
// gate and broadcasts the goal, naming who touched it last; the ONE peer that goal names
// bumps its own sheet row (peerVars, one writer per row). Rules, gates, buttons, lamps and
// the sheet are flow nodes (rule ownership, the dungeon-realms pattern); a saved scene
// keeps the match log in gameState.vars (fork 3).

import { createGame } from './game.js';
import { registerNodes } from './nodes.js';
import { registerToolbox } from './toolbox.js';
import { pitchHud } from './hud.js';

export default {
	id: 'football',
	name: 'Football',
	version: '1.1.0',
	description:
		'VR football on the knock: floating ball, two team gates, last-touch attribution, modes, per-player records and a saved match log — every rule a flow node.',

	/** @param {any} api the module SDK surface */
	register(api) {
		const game = createGame(api);
		const nodes = registerNodes(api, game);
		const hitSource = game.wireHits();
		const toolbox = registerToolbox(api, game, { hitSource: () => hitSource });

		// clicks on button objects: desktop click, play-mode tap and the VR trigger all
		// dispatch through the same handler with the exact mesh that was hit
		api.registerClickHandler((mesh) => nodes.clickButton(mesh), { modes: ['interact', 'play'] }); // 30: a button presses in Interact/Play; Edit selects it

		api.onMessage((data) => game.handleMessage(data));
		api.registerStateSync({
			getState: () => game.getState(),
			applyState: (remote) => game.applyState(remote)
		});
		api.onSceneClear(() => game.clear());

		api.registerFrameTask((time) => {
			nodes.tick();
			game.tick(time);
		});

		if (api.hud?.registerDebugLine)
			api.hud.registerDebugLine(() => 'football ' + game.scoreLine() + (game.state.started ? ' playing' : '') + ' · hits via ' + hitSource);

		// the HUD editor's Actions picker: a HUD Button that presses a Match Button node
		if (api.hud?.registerAction)
			for (const action of ['join-red', 'join-blue', 'start', 'new-match', 'spectate', 'swap-sides'])
				api.hud.registerAction({ key: action, label: 'Football: ' + action, group: 'Football', role: 'press', node: 'fbbutton', data: { action }, handle: 'press' });

		// test/debug hook (never serialized): the flight drives the game through this
		// instead of reaching into module scope — the dungeon-realms `_dr.game` shape
		if (typeof window !== 'undefined') {
			/** @type {any} */ (window).__football = {
				game,
				nodes,
				toolbox,
				hud: pitchHud,
				hitSource: () => hitSource,
				snapshot: () => ({
					...game.getState(),
					rules: game.rules(),
					gates: { ...game.config.gates },
					ball: game.config.ballUuid,
					authority: game.isAuthority(),
					buttons: nodes.buttons(),
					sheet: game.sheetRows(),
					log: game.matchLog(),
					hitSource
				})
			};
		}
	}
};
