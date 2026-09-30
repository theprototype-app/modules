// untangle — THE DEF (21-C C7, finished in roadmap 30 P4). A .tpscene carries the board's
// POSE and the starting LEVEL (seed INPUTS), never the positions (derived state — a saved
// positions array loaded onto peers that regenerate from the seed is the "deterministic
// animation that also receives corrective positions" failure). So the template is: a lit
// room around the board, the environment, the HUD document (the Games-tab standard shell:
// menu with mode + the level grid + Start, the in-game HUD, pause, a solved screen with
// Next / Menu), the post stack, `modules: [{id:'untangle'}]` and the control graph. Core
// reads `untangle.def.json` (emitted by `npm run build:untangle`).
//
// P4 look (roadmap 30): the old room was #1f2430 walls lit by two coloured POINT lights —
// dark, with "rainbow blotches": 8-bit banding rings of the lights' falloff across big dark
// surfaces (MEASURED: they stay with AO off, so no AO setting removes them), plus a floor
// flush with y = 0. Now: a custom dusk sky (30-author-kit: a gradient, fog, a ground disc,
// sun + hemi), a raised stage slab, a lighter slate wall, a low plinth, a glowing stage ring
// and two DIRECTIONAL lamps (even light, no falloff to band) under the same names — the
// scene's object list is unchanged, 6 rows. On a 1.16 core the custom sky degrades to its
// flat bottom colour. The room is a round stage (dais, plinth, ring) in front of a clear-coated
// display wall — designed, not a grey blockout slab.

export const BOARD = { level: 1, radius: 1.1, boardY: 1.6, x: 0, z: 0, yaw: 0, autoAdvance: false, apply: true };
export const NAMES = { floor: 'Floor', wall: 'Back wall', pedestal: 'Pedestal', frame: 'Board frame', lampL: 'Lamp left', lampR: 'Lamp right' };

const PANEL = { bg: 'rgba(13, 17, 28, 0.92)', radius: 16, border: '1px solid rgba(251, 191, 36, 0.35)' };
const BUTTON = (bg) => ({ size: 15, weight: '600', bg, color: '#ffffff', radius: 10 });
const QUIET = { size: 15, weight: '500', bg: '#334155', color: '#e5e9f0', radius: 10 };

/** the room: a round stage, a display wall, the plinth the node targets, a stage ring, two lamps */
export function roomObjects() {
	const y = BOARD.boardY;
	return [
		// a round, clear-coated STAGE the ring sits on — raised off y = 0, where the custom
		// sky's ground disc lives (a coplanar floor z-fights it into blotches)
		{ type: 'cylinder', name: NAMES.floor, color: 0x283152, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.35, r: 2.3, h: 0.1, pos: [0, 0.05, 0] },
		// the backdrop: a deep-blue display wall with a faint self-glow and a clear coat, so the
		// dark board and the globe read against it instead of against a grey slab
		{ type: 'box', name: NAMES.wall, color: 0x1d2a4f, emissive: 0x1b2d63, emissiveIntensity: 0.35, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.3, size: [8, 4.2, 0.2], pos: [0, 2.1, -2.1], bevel: 0.18 },
		// a round plinth under the board (the board / globe floats above it)
		{ type: 'cylinder', name: NAMES.pedestal, color: 0x3a4568, roughness: 0.35, metalness: 0.3, r: 0.55, r2: 0.62, h: 0.26, pos: [0, 0.23, 0] },
		// the stage ring (reads in 2D and 3D)
		{ type: 'ring', name: NAMES.frame, color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.9, r: 1.55, inner: 1.47, pos: [0, 0.105, 0], rot: [-Math.PI / 2, 0, 0], shadow: false },
		// two DIRECTIONAL key/fill lamps: even light, no falloff. The old coloured point lights
		// (and a spot pass tried here) painted 8-bit banding rings across the big dark surfaces
		// - the "rainbow blotches" - which no AO setting removes.
		{ type: 'light', kind: 'directional', name: NAMES.lampL, color: 0xffe6c8, intensity: 1.6, pos: [-3, 5, 4], target: [0, y, 0], castShadow: false },
		{ type: 'light', kind: 'directional', name: NAMES.lampR, color: 0xd2e2ff, intensity: 0.9, pos: [3.5, 4, 3], target: [0, y, 0], castShadow: false }
	];
}

/** the control graph: the board node + HUD readouts + the game shell */
export function untangleGraph() {
	/** @type {any[]} */ const nodes = [];
	/** @type {any[]} */ const edges = [];
	const N = (id, type, label, x, y, data = {}) => nodes.push({ id, type, position: { x, y }, data: { label, ...data }, class: 'w-[150px]' });
	const E = (source, target, handle) =>
		edges.push({ id: 'e-' + source + '-' + target + (handle ? '.' + handle : ''), source, target, ...(handle ? { targetHandle: handle } : {}) });
	let y = 40;
	N('board', 'utboard', 'Untangle Board', 280, y, { ...BOARD });
	N('selped', 'objectselector', 'Pedestal', 520, y, { selected: NAMES.pedestal });
	E('board', 'selped');
	y += 150;
	const readout = (key, read, element, format) => {
		N('v' + key, 'utvalue', 'Untangle: ' + read, 40, y, { read });
		N('t' + key, 'hudtext', 'HUD ' + element, 280, y, { element, format, decimals: 0 });
		E('v' + key, 't' + key, 'value');
		y += 110;
	};
	readout('level', 'level', 'ut-level', 'LEVEL {v}');
	readout('cross', 'crossings', 'ut-crossings', 'Crossings: {v}');
	readout('clear', 'level', 'ut-clear', 'LEVEL {v} UNTANGLED');
	// the solved EVENT into a Counter (replicated once per solve) into a HUD Text
	N('evsolved', 'utevent', 'On solved', 40, y, { event: 'solved' });
	N('csolved', 'counter', 'Boards solved', 280, y, { op: 'up', step: 1 });
	N('tcount', 'hudtext', 'HUD ut-counter', 520, y, { element: 'ut-counter', format: '{v} untangled', decimals: 0 });
	E('evsolved', 'csolved', 'trigger');
	E('csolved', 'tcount', 'value');
	// ...and into the SOLVED screen: the shell goes to `over` (outcome solved) on every peer
	N('gosolved', 'setgamestate', 'Show solved', 520, y + 70, { state: 'over', outcome: 'solved', reset: false });
	E('evsolved', 'gosolved', 'trigger');
	y += 170;
	// the game shell: Start from the menu screen, P pauses, Quit resets
	N('bstart', 'hudbutton', 'Start button', 40, y, { element: 'start-btn' });
	N('gostart', 'setgamestate', 'Start', 280, y, { state: 'playing', outcome: '', reset: false });
	E('bstart', 'gostart', 'trigger');
	// roadmap 30 P2: the level grid's Continue picks the next level and pulses `start` (the
	// module cannot move the game shell itself — DEVX #19)
	N('evstart', 'utevent', 'On Continue', 40, y + 60, { event: 'start' });
	E('evstart', 'gostart', 'trigger');
	// P4: Next on the solved screen = back to playing; the module sees a round START on a
	// SOLVED board and every peer advances to the next level in lockstep (no message)
	N('bnext', 'hudbutton', 'Next button', 40, y + 120, { element: 'next-btn' });
	E('bnext', 'gostart', 'trigger');
	y += 190;
	N('bmenu', 'hudbutton', 'Menu button', 40, y, { element: 'menu-btn' });
	N('gomenu', 'setgamestate', 'Back to menu', 280, y, { state: 'menu', outcome: '', reset: true });
	E('bmenu', 'gomenu', 'trigger');
	y += 110;
	N('pkey', 'keypress', 'Press P', 40, y, { code: 'KeyP', edge: 'down', pulse: 0.3 });
	N('pausetoggle', 'hudscreen', 'Toggle pause menu', 280, y, { screen: 'pause', action: 'toggle' });
	E('pkey', 'pausetoggle', 'trigger');
	y += 110;
	N('bresume', 'hudbutton', 'Resume button', 40, y, { element: 'resume-btn' });
	N('resumehide', 'hudscreen', 'Close pause menu', 280, y, { screen: 'pause', action: 'hide' });
	E('bresume', 'resumehide', 'trigger');
	y += 110;
	N('bquit', 'hudbutton', 'Quit button', 40, y, { element: 'quit-btn' });
	N('doquit', 'setgamestate', 'Quit to menu', 280, y, { state: 'menu', outcome: '', reset: true });
	N('quithide', 'hudscreen', 'Close pause on quit', 520, y, { screen: 'pause', action: 'hide' });
	E('bquit', 'doquit', 'trigger');
	E('bquit', 'quithide', 'trigger');
	return { nodes, edges };
}

// Titles are wide centred boxes: core 1.17 centres a single-line HUD text on its box (DEVX
// #28). On 1.16 they sit flush left inside the box, readable, just not centred.
export function untangleHud() {
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
						{ id: 'menu-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 540, h: 560, z: 0, label: '', style: PANEL },
						{ id: 'title', kind: 'text', anchor: 'center', x: 0, y: -235, w: 480, h: 48, z: 1, label: 'UNTANGLE', style: { size: 36, weight: '700', color: '#fbbf24', align: 'center' } },
						{ id: 'subtitle', kind: 'text', anchor: 'center', x: 0, y: -185, w: 480, h: 44, z: 1, label: 'Drag the dots until no edges cross — on a flat board or around a globe. Every peer sees the same board; your unlocked levels are yours.', style: { size: 13, color: '#d8dee9', align: 'center' }, wrap: true },
						// the module's own HUD kind: mode, the 30-level grid with locks, Continue, Reset
						{ id: 'levels', kind: 'mod-untangle-levels', anchor: 'center', x: 0, y: 10, w: 480, h: 330, z: 1, label: '' },
						{ id: 'start-btn', kind: 'button', anchor: 'center', x: 0, y: 212, w: 220, h: 46, z: 1, label: 'Start', enabled: true, style: BUTTON('#d97706') },
						{ id: 'menu-hint', kind: 'text', anchor: 'center', x: 0, y: 252, w: 480, h: 20, z: 1, label: 'Pick a level (or Continue) · drag, or click a dot then click where it goes · P pauses', style: { size: 12, color: '#8b97a8', align: 'center' } }
					]
				},
				{
					id: 'hud',
					name: 'HUD',
					showWhile: 'playing',
					input: 'game',
					elements: [
						{ id: 'hud-panel', kind: 'panel', anchor: 'top-left', x: 16, y: 64, w: 260, h: 118, z: 0, label: '', style: PANEL },
						{ id: 'ut-level', kind: 'text', anchor: 'top-left', x: 30, y: 72, w: 230, h: 30, z: 1, label: 'LEVEL 1', style: { size: 22, weight: '700', color: '#fbbf24', align: 'left' } },
						{ id: 'ut-crossings', kind: 'text', anchor: 'top-left', x: 30, y: 104, w: 230, h: 22, z: 1, label: 'Crossings: 0', style: { size: 15, color: '#e2e8f0', align: 'left' } },
						// the module's clock + your best for this level (m:ss, an em dash for none)
						{ id: 'ut-time', kind: 'mod-untangle-stats', anchor: 'top-left', x: 30, y: 128, w: 230, h: 22, z: 1, label: '', show: 'play' },
						{ id: 'ut-counter', kind: 'text', anchor: 'top-left', x: 30, y: 154, w: 230, h: 20, z: 1, label: '0 untangled', style: { size: 12, color: '#94a3b8', align: 'left' } }, // boards solved by the room this session
						{ id: 'play-hint', kind: 'text', anchor: 'bottom-center', x: 0, y: 12, w: 620, h: 20, z: 1, label: 'Drag a dot, or click it then click where it goes · on the globe right-drag turns it · P pauses', style: { size: 11, color: '#8b97a8', align: 'center' } }
					]
				},
				{
					id: 'solved',
					name: 'Solved',
					showWhile: 'over',
					input: 'menu',
					elements: [
						{ id: 'solved-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 420, h: 250, z: 0, label: '', style: { ...PANEL, border: '1px solid rgba(62, 224, 143, 0.5)' } },
						{ id: 'solved-title', kind: 'text', anchor: 'center', x: 0, y: -82, w: 420, h: 40, z: 1, label: 'UNTANGLED!', style: { size: 30, weight: '700', color: '#3ee08f', align: 'center' } },
						{ id: 'ut-clear', kind: 'text', anchor: 'center', x: 0, y: -44, w: 360, h: 24, z: 1, label: 'LEVEL 1 UNTANGLED', style: { size: 14, weight: '600', color: '#e2e8f0', align: 'center' } },
						{ id: 'ut-result', kind: 'mod-untangle-stats', anchor: 'center', x: 0, y: -8, w: 380, h: 28, z: 1, label: '', show: 'result' },
						{ id: 'next-btn', kind: 'button', anchor: 'center', x: -60, y: 60, w: 160, h: 44, z: 1, label: 'Next level', enabled: true, style: BUTTON('#059669') },
						{ id: 'menu-btn', kind: 'button', anchor: 'center', x: 115, y: 60, w: 130, h: 44, z: 1, label: 'Menu', enabled: true, style: QUIET }
					]
				},
				{
					id: 'pause',
					name: 'Pause',
					input: 'menu',
					elements: [
						{ id: 'pause-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 380, h: 250, z: 0, label: '', style: PANEL },
						{ id: 'pause-title', kind: 'text', anchor: 'center', x: 0, y: -75, w: 300, h: 36, z: 1, label: 'PAUSED', style: { size: 26, weight: '700', color: '#e5e9f0', align: 'center' } },
						{ id: 'resume-btn', kind: 'button', anchor: 'center', x: 0, y: -10, w: 240, h: 42, z: 1, label: 'Resume', enabled: true, style: BUTTON('#d97706') },
						{ id: 'quit-btn', kind: 'button', anchor: 'center', x: 0, y: 42, w: 240, h: 42, z: 1, label: 'Quit to menu', enabled: true, style: QUIET }
					]
				}
			]
		}
	};
}

/** the dusk sky (30-author-kit custom env): readable, and the glowing board carries the scene */
export const ENV = {
	preset: 'custom',
	base: 'sunset',
	exposure: 1.05,
	background: { top: '#1c2748', bottom: '#4a3350' },
	fog: { color: '#3a2d48', near: 16, far: 60 },
	ground: { color: '#262c3b', roughness: 0.95 },
	sun: { color: '#ffd9b0', intensity: 1.5, dir: [0.4, 0.85, 0.55] },
	hemi: { sky: '#d6e2ff', ground: '#3a3246', intensity: 1.25 }
};

export function untangleDef() {
	return {
		kind: 'game',
		slug: 'untangle',
		title: 'Untangle',
		description: 'A planar-graph puzzle on a flat board or around a globe: drag the dots until no edges cross. 30 levels per mode that unlock as you solve them; every peer sees and solves the same board.',
		license: 'CC0-1.0',
		author: 'theprototype',
		tags: ['puzzle', 'co-op', 'procedural', '3d'],
		modules: [{ id: 'untangle', version: '2.2.0' }],
		installModules: ['untangle'],
		env: ENV,
		// play.cursor 'free' (30-core-flow): no pointer lock — the real cursor drags; a core
		// without the field keeps the lock and the module aims with the crosshair instead
		physics: { play: { interaction: 'click', grounded: true, simOnPlay: false, cursor: 'free' } },
		post: {
			enabled: true,
			effects: [
				// gentle AO: the default radius/intensity (1.5 / 2.5) blotched the dark room
				{ id: 'ao', kind: 'ao', enabled: true, params: { aoRadius: 0.6, intensity: 1.2, distanceFalloff: 1 } },
				{ id: 'tone', kind: 'tonemapping', enabled: true, params: { mode: 'AGX' } },
				{ id: 'bloom', kind: 'bloom', enabled: true, params: { intensity: 0.7, luminanceThreshold: 0.72 } },
				{ id: 'aa', kind: 'smaa', enabled: true, params: {} }
			],
			changedAt: 0
		},
		graphs: { scene: untangleGraph() },
		hud: untangleHud(),
		objects: roomObjects(),
		view: { pos: [0, 1.75, 4.6], target: [0, BOARD.boardY, 0] },
		thumb: { sceneGroups: ['untangle-module'] }
	};
}
