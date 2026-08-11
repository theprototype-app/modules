// The node family — the ENTIRE game surface as flow nodes. Every node OWNS a
// rule group while it is alive in a running graph: its (replicated) node data
// overrides the module defaults on every peer identically, so no extra
// netcode is needed. Remove the node and the defaults return within a second.
//
// Runtime reality (SDK v1, see DEVX-REQUESTS.md): module nodes are EFFECT
// nodes — they run when wired to an Object Selector, or with no wiring at all
// inside any object's own graph (the implicit-owner rule). Range params get
// wireable input sockets for free; module nodes cannot yet OUTPUT values or
// fire triggers, and a module cannot pre-seed a wired example graph.

import { DEFAULT_RULES, DEFAULT_MENU, DEFAULT_HUD } from './game.js';

const EXPIRE_FRAMES = 40; // node gone from the graph -> defaults return

/** @param {any} api @param {ReturnType<import('./game.js').createGame>} game */
export function registerNodes(api, game) {
	let frame = 0;
	const seen = { rules: -1, menu: -1, hud: -1 };
	/** @type {Record<string, number>} prop name -> last seen frame */
	const propSeen = {};

	api.registerNodeGroup({
		group: 'Dungeon Realms',
		items: [
			{
				type: 'drdungeon',
				label: 'Dungeon',
				defaults: { seed: 7, roomCount: 0, levelCount: 5, gemDensity: 1, apply: false },
				params: [
					{ key: 'seed', kind: 'range', min: 1, max: 9999, step: 1 },
					{ key: 'roomCount', kind: 'range', min: 0, max: 60, step: 2 },
					{ key: 'levelCount', kind: 'range', min: 1, max: 9, step: 1 },
					{ key: 'gemDensity', kind: 'range', min: 0.25, max: 2, step: 0.05 },
					{ key: 'apply', kind: 'toggle' }
				]
			},
			{
				type: 'drrules',
				label: 'Game Rules',
				defaults: { ...DEFAULT_RULES },
				params: [
					{ key: 'gemShare', kind: 'range', min: 0.05, max: 1, step: 0.05 },
					{ key: 'pickupRadius', kind: 'range', min: 0.4, max: 3, step: 0.1 },
					{ key: 'allPlayersPortal', kind: 'toggle' },
					{ key: 'disableFlight', kind: 'toggle' }
				]
			},
			{
				type: 'drmenu',
				label: 'Start Menu',
				defaults: { ...DEFAULT_MENU },
				params: [
					{ key: 'show', kind: 'select', options: ['auto', 'always', 'never'] },
					{ key: 'button1', kind: 'select', options: ['none', 'join-p1', 'join-p2', 'start', 'resume', 'new-dungeon'] },
					{ key: 'button2', kind: 'select', options: ['none', 'join-p1', 'join-p2', 'start', 'resume', 'new-dungeon'] },
					{ key: 'button3', kind: 'select', options: ['none', 'join-p1', 'join-p2', 'start', 'resume', 'new-dungeon'] },
					{ key: 'button4', kind: 'select', options: ['none', 'join-p1', 'join-p2', 'start', 'resume', 'new-dungeon'] }
				]
			},
			{
				type: 'drhud',
				label: 'Game HUD',
				defaults: { ...DEFAULT_HUD },
				params: [
					{ key: 'showGems', kind: 'toggle' },
					{ key: 'showLevel', kind: 'toggle' },
					{ key: 'showPlayers', kind: 'toggle' },
					{ key: 'showObjective', kind: 'toggle' },
					{ key: 'corner', kind: 'select', options: ['top-left', 'top-right', 'bottom-left', 'bottom-right'] }
				]
			},
			{
				type: 'drprop',
				label: 'Prop Counter',
				defaults: { prop: 'score', initial: 0, showInHud: true },
				params: [
					{ key: 'prop', kind: 'select', options: ['score', 'keys', 'skulls', 'torches'] },
					{ key: 'initial', kind: 'range', min: 0, max: 100, step: 1 },
					{ key: 'showInHud', kind: 'toggle' }
				]
			}
		]
	});

	/** shallow-compare + assign; marks the GUI dirty only on real change */
	const assign = (target, next) => {
		let changed = false;
		for (const key of Object.keys(next)) {
			if (target[key] !== next[key]) {
				target[key] = next[key];
				changed = true;
			}
		}
		if (changed) game.markGuiDirty();
	};

	api.registerEffect('drdungeon', (object, base, data) => {
		if (!data.apply) return;
		const seed = Math.round(data.seed ?? 7);
		const params = {
			roomCount: Math.round(data.roomCount ?? 0) || 0,
			levelCount: Math.round(data.levelCount ?? 5),
			gemDensity: data.gemDensity ?? 1
		};
		// the node data replicates with the graph, so every peer regenerates the
		// SAME dungeon locally — deterministic model, no op needed
		if (game.state.seed !== seed || JSON.stringify(game.state.params) !== JSON.stringify(params))
			game.generate(seed, params, false);
	});

	api.registerEffect('drrules', (object, base, data) => {
		seen.rules = frame;
		assign(game.config.rules, {
			gemShare: Math.min(1, Math.max(0.05, data.gemShare ?? DEFAULT_RULES.gemShare)),
			pickupRadius: data.pickupRadius ?? DEFAULT_RULES.pickupRadius,
			allPlayersPortal: !!(data.allPlayersPortal ?? DEFAULT_RULES.allPlayersPortal),
			disableFlight: !!(data.disableFlight ?? DEFAULT_RULES.disableFlight)
		});
	});

	api.registerEffect('drmenu', (object, base, data) => {
		seen.menu = frame;
		assign(game.config.menu, {
			show: data.show ?? DEFAULT_MENU.show,
			button1: data.button1 ?? DEFAULT_MENU.button1,
			button2: data.button2 ?? DEFAULT_MENU.button2,
			button3: data.button3 ?? DEFAULT_MENU.button3,
			button4: data.button4 ?? DEFAULT_MENU.button4
		});
	});

	api.registerEffect('drhud', (object, base, data) => {
		seen.hud = frame;
		assign(game.config.hud, {
			showGems: !!(data.showGems ?? true),
			showLevel: !!(data.showLevel ?? true),
			showPlayers: !!(data.showPlayers ?? true),
			showObjective: !!(data.showObjective ?? true),
			corner: data.corner ?? 'top-left'
		});
	});

	api.registerEffect('drprop', (object, base, data) => {
		const name = data.prop ?? 'score';
		propSeen[name] = frame;
		const existing = game.config.props[name];
		const next = { initial: Math.round(data.initial ?? 0), showInHud: !!(data.showInHud ?? true) };
		if (!existing || existing.initial !== next.initial || existing.showInHud !== next.showInHud) {
			game.config.props[name] = next;
			game.markGuiDirty();
		}
	});

	/** called from the module frame task: expire configs whose node vanished */
	function tick() {
		frame++;
		if (seen.rules >= 0 && frame - seen.rules > EXPIRE_FRAMES) {
			seen.rules = -1;
			assign(game.config.rules, { ...DEFAULT_RULES });
		}
		if (seen.menu >= 0 && frame - seen.menu > EXPIRE_FRAMES) {
			seen.menu = -1;
			assign(game.config.menu, { ...DEFAULT_MENU });
		}
		if (seen.hud >= 0 && frame - seen.hud > EXPIRE_FRAMES) {
			seen.hud = -1;
			assign(game.config.hud, { ...DEFAULT_HUD });
		}
		for (const [name, at] of Object.entries(propSeen)) {
			if (frame - at > EXPIRE_FRAMES) {
				delete propSeen[name];
				delete game.config.props[name];
				game.markGuiDirty();
			}
		}
	}

	return { tick };
}
