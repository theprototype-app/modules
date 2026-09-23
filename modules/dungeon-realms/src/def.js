// dungeon-realms — THE DEF (21-C C6-b), the shape core's scripts/author-templates.cjs
// builds a game template from (kind, slug, modules, installModules, env, physics, post,
// graphs, hud, objects, view, thumb). ONE source: the graph is the README's reference
// graph made REAL, the HUD is the core HUD document the module publishes into, the
// objects are the entrance arch — placed at the entrance room the SEED produces, which
// the emitter (emit-def.mjs) computes with the Kit's own generator so the arch stands
// where players spawn. Core reads `dungeon-realms.def.json` (emitted by
// `npm run build:dungeon-realms`) the way it reads football's, and runs
// `--only dungeon-realms` into a scratch folder the lane stages.
//
// TWO MODULES: `modules: [{id:'dungeon'}, {id:'dungeon-realms'}]` — the two-module case
// the requirement list exists for. The Kit's Dungeon node IS the recipe: its replicated
// data regenerates the identical campaign on every peer that loads the scene, and the
// template broadcasts nothing (the derived requirement list picks both modules up from
// the node types in the graph, so the authored and the derived lists agree).

export const SEED = 1337;
export const RECIPE = { seed: SEED, roomCount: 0, levelCount: 5, loopChance: 0.15, gemDensity: 1, apply: true };
export const NAMES = { plinth: 'Entrance plinth', left: 'Arch left', right: 'Arch right', lintel: 'Arch lintel', lantern: 'Arch lantern', light: 'Arch light', card: 'Card camera', ground: 'Ground' };

/** 30: the menu on CORE HUD screens — each HUD button (perPlayer: the press is the presser's)
 * reaches a Realms Button through a Delay (DEVX #22); element id -> action */
export const MENU_BUTTONS = [
	['dr-join-p1', 'join-p1'],
	['dr-join-p2', 'join-p2'],
	['dr-start', 'start'],
	['dr-new-dungeon', 'new-dungeon'],
	['dr-restart', 'new-dungeon'],
	['dr-play-again', 'new-dungeon'],
	['quit-btn', 'quit'],
	['dr-over-menu', 'quit']
];

const PANEL = { bg: 'rgba(12, 16, 24, 0.9)', radius: 14, border: '1px solid rgba(103, 232, 249, 0.25)' };
const BUTTON = (bg) => ({ size: 15, weight: '600', bg, color: '#ffffff', radius: 10 });

/**
 * The entrance arch + plinth in the replicated objectsGroup, centred on the entrance
 * room the seed produces (players spawn there). @param {{x: number, z: number}} entrance
 */
export function archObjects(entrance) {
	const { x, z } = entrance;
	const stone = 0x6a6660;
	const glow = 0x67e8f9;
	return [
		// the plinth: a flat slab the Object Selector targets (module effect nodes run wired)
		{ type: 'box', name: NAMES.plinth, color: 0x4a4f5c, roughness: 0.9, size: [2.8, 0.12, 2.8], pos: [x, 0.06, z] },
		{ type: 'box', name: NAMES.left, color: stone, roughness: 0.85, size: [0.36, 3, 0.36], pos: [x - 1.1, 1.5, z] },
		{ type: 'box', name: NAMES.right, color: stone, roughness: 0.85, size: [0.36, 3, 0.36], pos: [x + 1.1, 1.5, z] },
		{ type: 'box', name: NAMES.lintel, color: stone, roughness: 0.85, size: [2.6, 0.36, 0.5], pos: [x, 3.18, z] },
		// 30: the lantern throws the kit's `sparkles` particles (one emitter) — the entrance reads
		// as the way in from across the hall
		{ type: 'sphere', name: NAMES.lantern, color: glow, emissive: glow, emissiveIntensity: 2.4, r: 0.16, pos: [x, 2.75, z], shadow: false, particles: 'sparkles' },
		{ type: 'light', name: NAMES.light, color: glow, intensity: 9, distance: 10, pos: [x, 2.6, z] },
		// 30: the ground the dungeon stands on — the TEMPLATE's (the Kit's tiles top at +0.015, this
		// sits between them and the editor grid at 0; a ground inside the Kit's own group stalled
		// a third peer's page in the Kit's flight). Select-through: a click lands on the level
		{ type: 'plane', name: NAMES.ground, size: [400, 400], pos: [x, 0.006, z], rot: [-Math.PI / 2, 0, 0], color: 0x3a3440, roughness: 1, pick: 'through' },
		// the Games-tab card's camera: over the entrance hall's wall, down onto the arch
		{ type: 'camera', name: NAMES.card, pos: [x + 5, 4.6, z + 6], lookAt: [x, 0.9, z - 0.5], fov: 55 }
	];
}

/** the scene graph: recipe + rules + HUD readouts + game-shell events */
export function realmsGraph() {
	/** @type {any[]} */ const nodes = [];
	/** @type {any[]} */ const edges = [];
	const N = (id, type, label, x, y, data = {}) => nodes.push({ id, type, position: { x, y }, data: { label, ...data }, class: 'w-[150px]' });
	const E = (source, target, handle) =>
		edges.push({ id: 'e-' + source + '-' + target + (handle ? '.' + handle : ''), source, target, ...(handle ? { targetHandle: handle } : {}) });

	let y = 40;
	// ---- the recipe: a Number feeds the Dungeon node's seed; the node targets the plinth ----
	N('seed', 'number', 'Seed', 40, y, { value: SEED, step: 1 });
	N('dungeon', 'dkdungeon', 'Dungeon Kit', 280, y, { ...RECIPE });
	N('selplinth', 'objectselector', 'Entrance plinth', 520, y, { selected: NAMES.plinth });
	E('seed', 'dungeon', 'seed');
	E('dungeon', 'selplinth');
	y += 150;
	// ---- the rules (rule ownership: the node data replicates, defaults return when removed) ----
	N('rules', 'drrules', 'Game Rules', 280, y, { gemShare: 0.7, pickupRadius: 0.9, allPlayersPortal: true, disableFlight: true });
	E('rules', 'selplinth');
	y += 150;
	// 30: the module's own DOM menu card stands down (show: never) — the menu, the pause and the
	// victory screen are core HUD screens below, so exactly ONE menu is ever on screen
	N('menu', 'drmenu', 'Start Menu', 280, y, { show: 'never', button1: 'join-p1', button2: 'join-p2', button3: 'start', button4: 'new-dungeon' });
	E('menu', 'selplinth');
	y += 150;
	// ---- the HUD menu's buttons: HUD Button (perPlayer) -> Delay -> Realms Button -------------
	for (const [element, action] of MENU_BUTTONS) {
		const id = element.replace(/[^a-z0-9]/g, '');
		N('h' + id, 'hudbutton', 'HUD ' + element, 40, y, { element, perPlayer: true });
		N('d' + id, 'delay', 'HUD ' + element + ' press', 160, y, { seconds: 0.05, pulse: 0.3 });
		N('b' + id, 'drbutton', 'Realms: ' + action, 280, y, { action });
		E('h' + id, 'd' + id, 'trigger');
		E('d' + id, 'b' + id, 'press');
		E('b' + id, 'selplinth');
		y += 110;
	}
	// a restart from the pause menu also closes it (the shell goes to menu on the reset event)
	N('restarthide', 'hudscreen', 'Close pause on restart', 520, y - 110 * (MENU_BUTTONS.length - 4), { screen: 'pause', action: 'hide' });
	E('hdrrestart', 'restarthide', 'trigger');
	// the menu's dungeon line and the party, as rows
	N('rmenulevel', 'drrows', 'Menu: the dungeon', 280, y, { element: 'dr-menu-level', show: 'level' });
	E('rmenulevel', 'selplinth');
	N('rmenuplayers', 'drrows', 'Menu: the party', 520, y, { element: 'dr-menu-players', show: 'players' });
	E('rmenuplayers', 'selplinth');
	y += 150;
	N('score', 'drprop', 'Prop Counter', 280, y, { prop: 'score', initial: 0, showInHud: true });
	E('score', 'selplinth');
	y += 150;
	// ---- the HUD readouts: values into HUD Text, rows into HUD lists (bound by element id) ----
	const readout = (key, read, element, format) => {
		N('v' + key, 'drvalue', 'Realms: ' + read, 40, y, { read });
		N('t' + key, 'hudtext', 'HUD ' + element, 280, y, { element, format, decimals: 0 });
		E('v' + key, 't' + key, 'value');
		y += 110;
	};
	readout('gems', 'gems', 'dr-gems', '{v}');
	readout('need', 'need', 'dr-need', '/ {v} needed');
	readout('level', 'level', 'dr-level', 'LEVEL {v}');
	readout('levels', 'levels', 'dr-levels', '/ {v}');
	readout('players', 'players', 'dr-player-count', '{v} in the party');
	N('robjective', 'drrows', 'Objective line', 280, y, { element: 'dr-objective', show: 'objective' });
	E('robjective', 'selplinth');
	N('rplayers', 'drrows', 'Player pills', 520, y, { element: 'dr-players', show: 'players' });
	E('rplayers', 'selplinth');
	y += 150;
	// ---- gems taken across the run: the gem EVENT into a Counter into a HUD Text ------------
	N('evgem', 'drevent', 'On gem', 40, y, { event: 'gem' });
	N('cgems', 'counter', 'Gems taken', 280, y, { op: 'up', step: 1 });
	N('ttaken', 'hudtext', 'HUD dr-taken', 520, y, { element: 'dr-taken', format: '{v} gems taken', decimals: 0 });
	E('evgem', 'cgems', 'trigger');
	E('cgems', 'ttaken', 'value');
	y += 150;
	// ---- the game shell follows the module's events (Set Game State drives the screens) -------
	N('evstart', 'drevent', 'On start', 40, y, { event: 'start' });
	N('gostart', 'setgamestate', 'Realms: playing', 280, y, { state: 'playing', outcome: '', reset: false });
	E('evstart', 'gostart', 'trigger');
	y += 110;
	N('evwin', 'drevent', 'On victory', 40, y, { event: 'victory' });
	N('goover', 'setgamestate', 'Realms: over', 280, y, { state: 'over', outcome: 'The hoard is yours', reset: false });
	E('evwin', 'goover', 'trigger');
	y += 110;
	N('evreset', 'drevent', 'On new dungeon', 40, y, { event: 'reset' });
	N('gomenu', 'setgamestate', 'Realms: menu', 280, y, { state: 'menu', outcome: '', reset: true });
	E('evreset', 'gomenu', 'trigger');
	y += 150;
	// ---- pause (P) — the Towers / Football shape ---------------------------------------------
	N('pkey', 'keypress', 'Press P', 40, y, { code: 'KeyP', edge: 'down', pulse: 0.3 });
	N('pausetoggle', 'hudscreen', 'Toggle pause menu', 280, y, { screen: 'pause', action: 'toggle' });
	E('pkey', 'pausetoggle', 'trigger');
	y += 110;
	N('bresume', 'hudbutton', 'Resume button', 40, y, { element: 'resume-btn' });
	N('resumehide', 'hudscreen', 'Close pause menu', 280, y, { screen: 'pause', action: 'hide' });
	E('bresume', 'resumehide', 'trigger');
	y += 110;
	N('bquit', 'hudbutton', 'Quit to menu button', 40, y, { element: 'quit-btn' });
	N('doquit', 'setgamestate', 'Quit to menu', 280, y, { state: 'menu', outcome: '', reset: true });
	N('quithide', 'hudscreen', 'Close pause on quit', 520, y, { screen: 'pause', action: 'hide' });
	E('bquit', 'doquit', 'trigger');
	E('bquit', 'quithide', 'trigger');
	return { nodes, edges };
}

/** the def's `hud` field — the DOM HUD the desktop peer and the editor see. 30: the Start menu,
 * the pause menu and the victory screen are real core screens with `input: 'menu'` (the
 * pointer is FREE while they show: mouse, arrows + Enter and a gamepad's A all work) */
export function realmsHud() {
	const text = (id, x, y, w, h, label, style, extra = {}) => ({ id, kind: 'text', anchor: 'center', x, y, w, h, z: 1, label, style, ...extra });
	const button = (id, x, y, w, h, label, style) => ({ id, kind: 'button', anchor: 'center', x, y, w, h, z: 1, label, enabled: true, style });
	return {
		scene: {
			active: '',
			changedAt: 0,
			screens: [
				{
					id: 'menu',
					name: 'Menu',
					showWhile: 'menu',
					input: 'menu',
					elements: [
						{ id: 'menu-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 480, h: 440, z: 0, label: '', style: PANEL },
						text('title', 0, -170, 412, 44, 'DUNGEON REALMS', { size: 34, weight: '800', color: '#67e8f9', align: 'left' }),
						{ id: 'dr-menu-level', kind: 'list', anchor: 'center', x: 0, y: -128, w: 412, h: 26, z: 1, label: '', rows: [], rowHeight: 20, style: { size: 14, weight: '600', color: '#e5e9f0', align: 'left', bg: 'transparent', pad: 0 } },
						text('subtitle', 0, -92, 412, 40, 'Collect gems to unseal the portal, stand on it together, and climb to the dragon’s hoard.', { size: 13, color: '#aab4c3', align: 'left' }, { wrap: true }),
						button('dr-join-p1', -106, -30, 200, 44, 'Join as Player 1', BUTTON('#334155')),
						button('dr-join-p2', 106, -30, 200, 44, 'Join as Player 2', BUTTON('#334155')),
						button('dr-start', 0, 32, 412, 52, 'Start adventure', { ...BUTTON('#0ea5e9'), size: 18, weight: '700' }),
						button('dr-new-dungeon', 0, 94, 412, 40, 'New dungeon 🎲', { size: 14, weight: '500', bg: '#2a3242', color: '#e5e9f0', radius: 10 }),
						{ id: 'dr-menu-players', kind: 'list', anchor: 'center', x: 0, y: 146, w: 412, h: 44, z: 1, label: '', rows: [], rowHeight: 18, style: { size: 12, color: '#86efac', align: 'left', bg: 'transparent', pad: 0 } },
						text('menu-hint', 0, 192, 412, 20, 'WASD walk  ·  walk over gems  ·  P pauses  ·  ↑↓ + Enter work too', { size: 11, color: '#64748b', align: 'left' })
					]
				},
				{
					id: 'hud',
					name: 'HUD',
					showWhile: 'playing',
					input: 'game',
					elements: [
						{ id: 'hud-panel', kind: 'panel', anchor: 'top-left', x: 16, y: 64, w: 300, h: 150, z: 0, label: '', style: PANEL },
						{ id: 'dr-gems', kind: 'text', anchor: 'top-left', x: 28, y: 72, w: 60, h: 34, z: 1, label: '0', style: { size: 26, weight: '700', color: '#39e0c0', align: 'left' } },
						{ id: 'dr-need', kind: 'text', anchor: 'top-left', x: 88, y: 82, w: 220, h: 22, z: 1, label: '/ 0 needed', style: { size: 13, color: '#94a3b8', align: 'left' } },
						{ id: 'dr-level', kind: 'text', anchor: 'top-left', x: 28, y: 110, w: 110, h: 20, z: 1, label: 'LEVEL 1', style: { size: 12, weight: '600', color: '#a5b4fc', align: 'left' } },
						{ id: 'dr-levels', kind: 'text', anchor: 'top-left', x: 118, y: 110, w: 60, h: 20, z: 1, label: '/ 5', style: { size: 12, color: '#a5b4fc', align: 'left' } },
						{ id: 'dr-player-count', kind: 'text', anchor: 'top-left', x: 180, y: 110, w: 130, h: 20, z: 1, label: '0 in the party', style: { size: 12, color: '#94a3b8', align: 'left' } },
						{ id: 'dr-players', kind: 'list', anchor: 'top-left', x: 28, y: 134, w: 280, h: 34, z: 1, label: '', rows: [], style: { size: 11, color: '#c8d0dc', align: 'left', bg: 'transparent' } },
						{ id: 'dr-objective', kind: 'list', anchor: 'top-left', x: 28, y: 170, w: 280, h: 36, z: 1, label: '', rows: [], style: { size: 12, color: '#86efac', align: 'left', bg: 'transparent' } },
						{ id: 'dr-taken', kind: 'text', anchor: 'top-right', x: 16, y: 64, w: 200, h: 24, z: 1, label: '0 gems taken', style: { size: 12, color: '#c8d0dc', align: 'right' } },
						{ id: 'play-hint', kind: 'text', anchor: 'bottom-center', x: 0, y: 12, w: 560, h: 20, z: 1, label: 'WASD walk · walk over gems · stand on the unsealed portal together · P pauses', style: { size: 11, color: '#c8d0dc', align: 'center' } }
					]
				},
				{
					id: 'pause',
					name: 'Pause',
					input: 'menu',
					elements: [
						{ id: 'pause-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 380, h: 300, z: 0, label: '', style: PANEL },
						{ id: 'pause-title', kind: 'text', anchor: 'center', x: 0, y: -95, w: 260, h: 36, z: 1, label: 'PAUSED', style: { size: 26, weight: '700', color: '#e5e9f0', align: 'left' } },
						{ id: 'resume-btn', kind: 'button', anchor: 'center', x: 0, y: -30, w: 260, h: 44, z: 1, label: 'Resume', enabled: true, style: BUTTON('#0ea5e9') },
						{ id: 'dr-restart', kind: 'button', anchor: 'center', x: 0, y: 24, w: 260, h: 44, z: 1, label: 'Restart — new dungeon', enabled: true, style: BUTTON('#3f7f5f') },
						{ id: 'quit-btn', kind: 'button', anchor: 'center', x: 0, y: 78, w: 260, h: 44, z: 1, label: 'Quit to menu', enabled: true, style: { size: 15, weight: '500', bg: '#3a4150', color: '#e5e9f0', radius: 10 } }
					]
				},
				{
					id: 'over',
					name: 'Victory',
					showWhile: 'over',
					input: 'menu',
					elements: [
						{ id: 'over-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 460, h: 300, z: 0, label: '', style: { ...PANEL, border: '1px solid rgba(255, 212, 94, 0.4)' } },
						{ id: 'over-title', kind: 'text', anchor: 'center', x: 0, y: -100, w: 400, h: 40, z: 1, label: 'THE HOARD IS YOURS', style: { size: 28, weight: '800', color: '#ffd45e', align: 'left' } },
						{ id: 'dr-taken-over', kind: 'text', anchor: 'center', x: 0, y: -56, w: 400, h: 24, z: 1, label: 'Every floor cleared — a new dungeon waits', style: { size: 13, color: '#c8d0dc', align: 'left' } },
						{ id: 'dr-play-again', kind: 'button', anchor: 'center', x: 0, y: 10, w: 280, h: 50, z: 1, label: 'Play again 🎲', enabled: true, style: { ...BUTTON('#0ea5e9'), size: 17 } },
						{ id: 'dr-over-menu', kind: 'button', anchor: 'center', x: 0, y: 72, w: 280, h: 42, z: 1, label: 'Back to menu', enabled: true, style: { size: 15, weight: '500', bg: '#3a4150', color: '#e5e9f0', radius: 10 } }
					]
				}
			]
		}
	};
}

/** @param {{x: number, z: number}} entrance the entrance room centre (world) for SEED */
export function realmsDef(entrance) {
	return {
		kind: 'game',
		slug: 'dungeon-realms',
		title: 'Dungeon Realms',
		description:
			'Co-op dungeon crawl: a seeded five-floor dungeon, gems to collect, portals that unseal when enough are found, and a dragon’s hoard at the top. Join as Player 1 / 2, walk it together.',
		license: 'CC0-1.0',
		author: 'theprototype',
		tags: ['co-op', 'procedural', 'vr', 'dungeon'],
		modules: [{ id: 'dungeon', version: '2.1.0' }, { id: 'dungeon-realms', version: '2.1.0' }],
		installModules: ['dungeon', 'dungeon-realms'],
		// 30: a custom dusk — a violet gradient sky, fog that turns far corridors to depth, a cool
		// moon and a warm-floored sky fill so the stone reads; torches, gems and portals glow
		env: {
			preset: 'custom',
			base: 'night',
			exposure: 1.3,
			background: { top: '#0d1430', bottom: '#4a3350' },
			fog: { color: '#2e2438', near: 18, far: 64 },
			ground: { color: '#2a2530', roughness: 1 },
			sun: { color: '#b8c6ff', intensity: 1, dir: [0.35, 0.8, 0.25] },
			hemi: { sky: '#a4acd8', ground: '#7a5c40', intensity: 2.4 }
		},
		// the dungeon is WALKED on its own raster: click interaction, grounded, no sim
		physics: { play: { interaction: 'click', grounded: true, simOnPlay: false } },
		post: {
			enabled: true,
			effects: [
				// the standard shell's floor; a tighter AO than the default (it blotched the floors)
				{ id: 'ao', kind: 'ao', enabled: true, params: { aoRadius: 0.5, intensity: 1 } },
				{ id: 'tone', kind: 'tonemapping', enabled: true, params: { mode: 'AGX' } },
				{ id: 'bloom', kind: 'bloom', enabled: true, params: { intensity: 0.9, luminanceThreshold: 0.75 } },
				{ id: 'aa', kind: 'smaa', enabled: true, params: {} }
			],
			changedAt: 0
		},
		graphs: { scene: realmsGraph() },
		hud: realmsHud(),
		objects: archObjects(entrance),
		// the editor camera opens on the arch; the card renders the module's world too
		view: { pos: [entrance.x + 9, 7, entrance.z + 11], target: [entrance.x, 1, entrance.z] },
		thumb: { camera: NAMES.card, sceneGroups: ['dungeon-module'] }
	};
}
