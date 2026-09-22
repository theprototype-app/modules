// untangle — THE DEF (21-C C7): the thin, honest template. A .tpscene can carry the
// board's POSE and the starting LEVEL (seed INPUTS), never the positions (derived state —
// a saved positions array loaded onto peers that regenerate from the seed is the
// "deterministic animation that also receives corrective positions" failure). So the
// template is: a room and a plinth so the board no longer hangs in the void, the
// environment, the HUD document, the post stack, `modules: [{id:'untangle'}]` and the
// control graph. Core reads `untangle.def.json` (emitted by `npm run build:untangle`).

export const BOARD = { level: 2, radius: 1.1, boardY: 1.6, x: 0, z: 0, yaw: 0, autoAdvance: true, apply: true };
export const NAMES = { floor: 'Floor', wall: 'Back wall', pedestal: 'Pedestal', frame: 'Board frame', lampL: 'Lamp left', lampR: 'Lamp right' };

const PANEL = { bg: 'rgba(15, 18, 28, 0.9)', radius: 14, border: '1px solid rgba(251, 191, 36, 0.3)' };
const BUTTON = (bg) => ({ size: 15, weight: '600', bg, color: '#ffffff', radius: 10 });

/** the room: a floor, a back wall, the pedestal the node targets, a ring frame, two lamps */
export function roomObjects() {
	const y = BOARD.boardY;
	return [
		{ type: 'box', name: NAMES.floor, color: 0x2b2f36, roughness: 0.95, size: [8, 0.2, 8], pos: [0, -0.1, 0] },
		{ type: 'box', name: NAMES.wall, color: 0x1f2430, roughness: 0.9, size: [8, 3.4, 0.2], pos: [0, 1.7, -1.6] },
		{ type: 'box', name: NAMES.pedestal, color: 0x3a4150, roughness: 0.8, size: [0.5, y - 0.3, 0.3], pos: [0, (y - 0.3) / 2, -0.12] },
		{ type: 'torus', name: NAMES.frame, color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.6, r: BOARD.radius + 0.18, tube: 0.04, pos: [0, y, -0.06] },
		{ type: 'light', name: NAMES.lampL, color: 0xffd9a8, intensity: 8, distance: 10, pos: [-2.2, 2.6, 1.4] },
		{ type: 'light', name: NAMES.lampR, color: 0xa8d0ff, intensity: 6, distance: 10, pos: [2.2, 2.6, 1.4] }
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
	readout('cross', 'crossings', 'ut-crossings', '{v} crossings');
	readout('count', 'count', 'ut-solved', '{v} solved this session');
	// the solved EVENT into a Counter (replicated once per solve) into a HUD Text
	N('evsolved', 'utevent', 'On solved', 40, y, { event: 'solved' });
	N('csolved', 'counter', 'Boards solved', 280, y, { op: 'up', step: 1 });
	N('tcount', 'hudtext', 'HUD ut-counter', 520, y, { element: 'ut-counter', format: '{v} untangled', decimals: 0 });
	E('evsolved', 'csolved', 'trigger');
	E('csolved', 'tcount', 'value');
	y += 150;
	// the game shell: Start from the menu screen, P pauses, Quit resets
	N('bstart', 'hudbutton', 'Start button', 40, y, { element: 'start-btn' });
	N('gostart', 'setgamestate', 'Start', 280, y, { state: 'playing', outcome: '', reset: false });
	E('bstart', 'gostart', 'trigger');
	// roadmap 30 P2: the level grid's Continue picks the next level and pulses `start` (the
	// module cannot move the game shell itself — DEVX #19)
	N('evstart', 'utevent', 'On Continue', 40, y + 60, { event: 'start' });
	E('evstart', 'gostart', 'trigger');
	y += 170;
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
						{ id: 'subtitle', kind: 'text', anchor: 'center', x: 0, y: -185, w: 480, h: 44, z: 1, label: 'Drag the dots until no edges cross. Every peer sees the same board; your unlocked levels are yours.', style: { size: 13, color: '#d8dee9', align: 'center' }, wrap: true },
						// the module's own HUD kind: mode, the 30-level grid with locks, Continue, Reset
						{ id: 'levels', kind: 'mod-untangle-levels', anchor: 'center', x: 0, y: 10, w: 480, h: 330, z: 1, label: '' },
						{ id: 'start-btn', kind: 'button', anchor: 'center', x: 0, y: 212, w: 220, h: 46, z: 1, label: 'Start', enabled: true, style: BUTTON('#d97706') },
						{ id: 'menu-hint', kind: 'text', anchor: 'center', x: 0, y: 252, w: 480, h: 20, z: 1, label: 'Pick a level (or Continue) · green edges are clear · P pauses', style: { size: 12, color: '#8b97a8', align: 'center' } }
					]
				},
				{
					id: 'hud',
					name: 'HUD',
					showWhile: 'playing',
					input: 'game',
					elements: [
						{ id: 'hud-panel', kind: 'panel', anchor: 'top-left', x: 16, y: 64, w: 240, h: 92, z: 0, label: '', style: PANEL },
						{ id: 'ut-level', kind: 'text', anchor: 'top-left', x: 28, y: 72, w: 220, h: 30, z: 1, label: 'LEVEL 1', style: { size: 22, weight: '700', color: '#fbbf24', align: 'left' } },
						{ id: 'ut-crossings', kind: 'text', anchor: 'top-left', x: 28, y: 104, w: 220, h: 22, z: 1, label: '0 crossings', style: { size: 14, color: '#e2e8f0', align: 'left' } },
						{ id: 'ut-counter', kind: 'text', anchor: 'top-left', x: 28, y: 128, w: 220, h: 20, z: 1, label: '0 untangled', style: { size: 12, color: '#94a3b8', align: 'left' } },
						{ id: 'ut-solved', kind: 'text', anchor: 'top-right', x: 16, y: 64, w: 220, h: 22, z: 1, label: '0 solved this session', style: { size: 12, color: '#94a3b8', align: 'right' } },
						{ id: 'play-hint', kind: 'text', anchor: 'bottom-center', x: 0, y: 12, w: 520, h: 20, z: 1, label: 'Click a dot, move, click to drop · P pauses', style: { size: 11, color: '#8b97a8', align: 'center' } }
					]
				},
				{
					id: 'pause',
					name: 'Pause',
					input: 'menu',
					elements: [
						{ id: 'pause-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 380, h: 250, z: 0, label: '', style: PANEL },
						{ id: 'pause-title', kind: 'text', anchor: 'center', x: 0, y: -75, w: 340, h: 36, z: 1, label: 'PAUSED', style: { size: 26, weight: '700', color: '#e5e9f0', align: 'center' } },
						{ id: 'resume-btn', kind: 'button', anchor: 'center', x: 0, y: -10, w: 240, h: 42, z: 1, label: 'Resume', enabled: true, style: BUTTON('#d97706') },
						{ id: 'quit-btn', kind: 'button', anchor: 'center', x: 0, y: 42, w: 240, h: 42, z: 1, label: 'Quit to menu', enabled: true, style: { size: 15, weight: '500', bg: '#3a4150', color: '#e5e9f0', radius: 10 } }
					]
				}
			]
		}
	};
}

export function untangleDef() {
	return {
		kind: 'game',
		slug: 'untangle',
		title: 'Untangle',
		description: 'A planar-graph puzzle on a lit board: drag the dots until no edges cross, then the next level appears. Every peer sees and solves the same board.',
		license: 'CC0-1.0',
		author: 'theprototype',
		tags: ['puzzle', 'co-op', 'procedural'],
		modules: [{ id: 'untangle', version: '2.0.0' }],
		installModules: ['untangle'],
		env: { preset: 'sunset', exposure: 1 },
		physics: { play: { interaction: 'click', grounded: true, simOnPlay: false } },
		post: {
			enabled: true,
			effects: [
				{ id: 'tone', kind: 'tonemapping', enabled: true, params: { mode: 'AGX' } },
				{ id: 'bloom', kind: 'bloom', enabled: true, params: { intensity: 0.45, luminanceThreshold: 0.8 } },
				{ id: 'aa', kind: 'smaa', enabled: true, params: {} }
			],
			changedAt: 0
		},
		graphs: { scene: untangleGraph() },
		hud: untangleHud(),
		objects: roomObjects(),
		view: { pos: [2.6, 2.4, 4.2], target: [0, BOARD.boardY, 0] },
		thumb: { sceneGroups: ['untangle-module'] }
	};
}
