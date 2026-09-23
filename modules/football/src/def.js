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

export function footballDef() {
	return {
		kind: 'game',
		slug: 'football',
		title: 'Football',
		description:
			'VR football: hit the floating ball with your hands, a ball through the other gate is a goal. Pick a side, Start, five goals wins. Colocation-ready.',
		license: 'CC0-1.0',
		author: 'theprototype',
		tags: ['vr', 'competitive', 'colocation', 'physics'],
		modules: [{ id: 'football', version: '1.0.0' }],
		installModules: ['football'],
		// 30: a floodlit stadium at dusk — a gradient sky, fog on the horizon, a low warm
		// sun + a cool sky fill, exposure over the 0.9 floor
		env: {
			preset: 'custom',
			base: 'sunset',
			exposure: 1.1,
			background: { top: '#1f3a66', bottom: '#e6a57a' },
			fog: { color: '#b9a3a0', near: 28, far: 90 },
			ground: { color: '#4a5462', roughness: 0.95 },
			sun: { color: '#ffd8b0', intensity: 1.1, dir: [-0.5, 0.45, -0.6] },
			hemi: { sky: '#a9c2ea', ground: '#5a4a3a', intensity: 1.2 }
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
		graphs: { scene: fullGraph() },
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
