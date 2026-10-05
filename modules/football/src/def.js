// football — THE DEF (B4), the shape core's scripts/author-templates.cjs builds a game
// template from (kind, slug, modules, installModules, env, physics, post, graphs, hud,
// objects). One source: the objects and graph are pitch.js, the HUD is hud.js. The
// orchestrator pastes/imports `football.def.json` (emitted by `npm run build:football`)
// into the author script and runs `--only football` against the scenes checkout.

import { pitchObjects, pitchGraph, PITCH_PHYSICS, DEFAULT_DIMS } from './pitch.js';
import { pitchHud } from './hud.js';
import { arenaObjects, arenaGraph } from './arena.js';

/** 30: the scoreboard HUD's big numbers and the clock (see hud.js) — Football Value nodes into
 * HUD Text, appended to the pitch graph @param {number} y0 */
function scoreboardGraph(y0) {
	/** @type {any[]} */ const nodes = [];
	/** @type {any[]} */ const edges = [];
	let y = y0;
	for (const team of ['red', 'blue']) {
		const k = team[0];
		nodes.push({ id: 'sbv' + k, type: 'fbvalue', position: { x: 40, y }, data: { label: 'Score: ' + team, read: team }, class: 'w-[150px]' });
		nodes.push({ id: 'sbt' + k, type: 'hudtext', position: { x: 280, y }, data: { label: 'HUD fb-' + team + '-score', element: 'fb-' + team + '-score', format: '{v}', decimals: 0 }, class: 'w-[150px]' });
		edges.push({ id: 'e-sbv' + k + '-sbt' + k + '.value', source: 'sbv' + k, target: 'sbt' + k, targetHandle: 'value' });
		y += 110;
	}
	return { nodes, edges, rows: y };
}

/** @param {{rulesCode?: string}} [opts] `rulesCode` = src/football.rules.js (emit-def.mjs reads it) */
export function footballDef(opts = {}) {
	return {
		kind: 'game',
		slug: 'football',
		title: 'Football',
		description:
			'VR football: swing a controller through the floating ball and put it through the other gate. Hit the ball to kick off; first to 5 or 3:00, golden goal on a tie. Colocation-ready.',
		license: 'CC0-1.0',
		author: 'theprototype',
		tags: ['vr', 'competitive', 'colocation', 'physics'],
		modules: [{ id: 'football', version: '1.4.0' }],
		installModules: ['football'],
		// 30: a floodlit stadium at dusk — a gradient sky, fog on the horizon, a cool sky fill,
		// exposure over the 0.9 floor. 31: NO sun — core's env sun is a shadow-casting directional
		// light (a shadow pass every frame + a third real-time light); the two floodlights light
		// the pitch, a brighter sky fill the rest
		env: {
			preset: 'custom',
			base: 'sunset',
			exposure: 1.1,
			background: { top: '#1f3a66', bottom: '#e6a57a' },
			fog: { color: '#b9a3a0', near: 28, far: 90 },
			ground: { color: '#4a5462', roughness: 0.95 },
			sun: null,
			hemi: { sky: '#b4c8ea', ground: '#5a4a3a', intensity: 1.45 }
		},
		physics: PITCH_PHYSICS,
		// the standard shell's post floor: AO -> AgX -> bloom -> SMAA
		post: {
			enabled: true,
			effects: [
				// a gentle AO: the default radius smeared colour over the big floor plane
				{ id: 'ao', kind: 'ao', enabled: true, params: { aoRadius: 0.6, intensity: 1.5 } },
				{ id: 'tone', kind: 'tonemapping', enabled: true, params: { mode: 'AGX' } },
				{ id: 'bloom', kind: 'bloom', enabled: true, params: { intensity: 0.7, luminanceThreshold: 0.8 } },
				{ id: 'aa', kind: 'smaa', enabled: true, params: {} }
			],
			changedAt: 0
		},
		graphs: { scene: opts.rulesCode ? mainGraph(fullGraph(), opts.rulesCode) : fullGraph() },
		// 36 F11: the layout reads well — the author script only moves what overlaps or sits on a wire
		graphTidy: 'repair',
		hud: pitchHud(),
		// the editor opens on the pitch from the blue end, above the glass; the card is the
		// broadcast camera high in a corner
		view: { pos: [2.6, 2.9, 5.6], target: [0, 1, -0.6] },
		thumb: { camera: 'Broadcast camera' },
		objects: [
			...pitchObjects(DEFAULT_DIMS),
			...arenaObjects(DEFAULT_DIMS)
		]
	};
}

/** the pitch graph + the scoreboard readouts + the nets' Pulse, one scene graph */
function fullGraph() {
	const g = pitchGraph(undefined, { hudButtons: true });
	const y0 = Math.max(...g.nodes.map((n) => n.position.y)) + 150;
	const sb = scoreboardGraph(y0);
	const arena = arenaGraph(sb.rows + 40);
	return { nodes: [...g.nodes, ...sb.nodes, ...arena.nodes], edges: [...g.edges, ...sb.edges, ...arena.edges] };
}

/**
 * 36 (U10, 36-games-graphs): the MAIN graph — the match flow readable at a glance. The ball and
 * the pitch feed the Match Rules node (the settings); the "Football rules" behaviour holds the
 * DECISIONS (src/football.rules.js) and its moments flash the nets and drive the game shell;
 * everything else sits in named groups (double-click to open) with a note beside each.
 * @param {{nodes: any[], edges: any[]}} g the full graph @param {string} rulesCode
 */
function mainGraph(g, rulesCode) {
	const at = (/** @type {string} */ id, /** @type {number} */ x, /** @type {number} */ y) => {
		const n = g.nodes.find((m) => m.id === id);
		if (n) n.position = { x, y };
	};
	const drop = new Set(['evrnet', 'evbnet']); // the rules' redGoal / blueGoal drive the nets now
	const nodes = g.nodes.filter((n) => !drop.has(n.id)).map((n) => ({ ...n, data: { type: n.type, ...n.data } }));
	const edges = g.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target));
	g = { nodes, edges };
	/** @param {string} source @param {string} sourceHandle @param {string} target @param {string} targetHandle */
	const wire = (source, sourceHandle, target, targetHandle) =>
		edges.push({ id: 'e-' + source + '.' + sourceHandle + '-' + target + '.' + targetHandle, source, sourceHandle, target, targetHandle });
	const note = (/** @type {string} */ id, /** @type {string} */ title, /** @type {string} */ text, /** @type {number} */ x, /** @type {number} */ y, /** @type {any} */ o = {}) =>
		nodes.push({ id, type: 'note', position: { x, y }, data: { type: 'note', title, text, color: o.color ?? 'yellow', w: o.w ?? 260, h: o.h ?? 130 } });
	const group = (/** @type {string} */ id, /** @type {string} */ label, /** @type {(n: any) => boolean} */ pick, /** @type {number} */ x, /** @type {number} */ y) =>
		nodes.push({ id, type: 'group', position: { x, y }, data: { type: 'group', label, children: nodes.filter((n) => n.type !== 'group' && n.type !== 'note' && pick(n)).map((n) => n.id), inputs: [], outputs: [] }, class: 'w-[190px]' });

	// ---- the top level: ball → settings → pitch; the rules; the engine -----------------------
	note('n-main', 'Football — read me first',
		'Hit the ball through the **other** team\'s gate.\n' +
		'- **Match Rules** holds the settings — select it, ⓘ tab: first to N goals, match length, own goals, golden goal.\n' +
		'- **Football rules** is the code that *decides* — who scored, what a goal is worth, when it is over. Double-click to read or change it (Ctrl+S).\n' +
		'- The ball, the gates and the kick-off are the **engine** (read-only; *Make editable copy* forks it).',
		-400, 0, { w: 340, h: 250, color: 'blue' });
	at('selball', 0, 60);
	at('rules', 240, 40);
	at('selpitch', 480, 60);
	note('n-settings', 'Match settings', 'The ball is wired into **Match Rules**, which sits on the pitch. Its numbers are what the rules read.', 240, 440, { w: 300, h: 100, color: 'yellow' });
	nodes.push({ id: 'fbcode', type: 'behaviour', position: { x: 760, y: 0 }, data: { type: 'behaviour', label: 'Behaviour', name: 'Football rules', code: rulesCode, main: 1 }, class: 'w-[250px]' });
	nodes.push({ id: 'fbengine', type: 'coderef', position: { x: 760, y: 340 }, data: { type: 'coderef', label: 'Code link', module: 'football', file: 'module.js', title: 'Football engine — the ball, gates, kick-off, the sheet', main: 1 }, class: 'w-[150px]' });
	note('n-engine', 'The engine', 'What the rules call as **kit.football.*** — it sees the ball enter a gate and does what the rules decide on every screen. Double-click to read it.', 760, 520, { w: 260, h: 120, color: 'gray' });

	// ---- the rules' moments, wired: the nets flash ----------------------------------------------
	// a goal INTO the red gate is BLUE's — the red net flashes (arena.js's chains)
	for (const [scored, k] of [['blueGoal', 'r'], ['redGoal', 'b']]) {
		wire('fbcode', scored, 'd' + k + 'net', 'trigger');
		wire('fbcode', scored, 'w' + k + 'net', 'trigger');
	}

	// ---- the groups ------------------------------------------------------------------------
	const has = (/** @type {string[]} */ ids) => (/** @type {any} */ n) => ids.includes(n.id);
	const NETS = ['drnet', 'prnet', 'srnet', 'wrnet', 'xrnet', 'dbnet', 'pbnet', 'sbnet', 'wbnet', 'xbnet'];
	const SHELL = ['evstart', 'gostart', 'evover', 'goover', 'evnew', 'gomenu'];
	const GATES = ['gater', 'selgater', 'gateb', 'selgateb'];
	const PAUSE = ['pkey', 'pausetoggle', 'bresume', 'resumehide', 'bquit', 'doquit', 'quithide'];
	const BOARD = ['records', 'sbvr', 'sbtr', 'sbvb', 'sbtb'];
	const isLamp = (/** @type {any} */ n) => /^(sel)?lamp(red|blue)\d+$/.test(n.id);
	group('g-nets', 'Goal nets flash', has(NETS), 1120, 0);
	group('g-shell', 'Game shell (menu · play · results)', has(SHELL), 1120, 200);
	group('g-gates', 'The two gates', has(GATES), 1120, 400);
	group('g-board', 'Scoreboard & records', has(BOARD), 1120, 560);
	group('g-pause', 'Pause menu', has(PAUSE), 1600, 400);
	group('g-lamps', 'Score lamps', isLamp, 1600, 560);
	const taken = new Set(nodes.filter((n) => n.type === 'group').flatMap((n) => n.data.children));
	const top = new Set(['selball', 'rules', 'selpitch', 'fbcode', 'fbengine']);
	group('g-buttons', 'Match buttons (join, start, rematch)', (n) => !taken.has(n.id) && !top.has(n.id), 1600, 0);
	note('n-nets', 'Goals', 'A goal decided by the rules flashes the net it went into. The game shell follows the match (start → playing, the whistle → results).', 1360, 0, { w: 220, h: 120, color: 'green' });
	note('n-gates', 'Gates & buttons', 'Each **Team Gate** names a gate sensor; the **Match Button** nodes put the physical and HUD buttons to work (join, start, rematch).', 1360, 400, { w: 220, h: 140, color: 'purple' });
	note('n-lamps', 'Lamps & board', 'Twenty lamps light with the score; the scoreboard and the sheet read the engine.', 1840, 560, { w: 220, h: 110, color: 'gray' });
	return g;
}

