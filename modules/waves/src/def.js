// waves — THE DEF, the shape core's scripts/author-templates.cjs builds a game template
// from (the football precedent): objects as `{type, name, color, size, pos, physics}`,
// a graph of `{id, type, position, data}` nodes and canonical `e-<src>-<tgt>[.handle]`
// edges, with Object Selectors naming objects by NAME (the author script resolves them).
// One source: the HUD is hud.js; the arena's graph is the toolbox's recipe run on a fixed
// set of enemy boxes. The integrator pastes `waves.def.json` (emitted by
// `npm run build:waves`) into the author script and stages the template.

import { arenaHud, hudGraph } from './hud.js';
import { arenaRecipe } from './toolbox.js';
import { arenaObjects, enemyObject, CORE, CARD_CAMERA } from './look.js';

const ENEMIES = 4;
// 30: the pads and the parked enemies sit at the capsule's centre height (0.62 = its half
// height + a hair), so an enemy walks ON the ground instead of sunk into it
const Y = 0.62;
const SPAWNS = [[-6, Y, -10], [0, Y, -12], [6, Y, -10]];
const GOAL = [0, 0.5, 6];
const HOME = [0, 0.05, 9];
// the ground's top sits a hair ABOVE y = 0, where the editor grid draws
const GROUND = { size: [30, 0.1, 40], pos: [0, -0.035, -2] };

/** addNodes-shaped `{nodes, edges}` (indices) -> the author script's graph shape
 * @param {{nodes: any[], edges: any[]}} spec @param {string} prefix */
export function toGraph(spec, prefix) {
	const nodes = spec.nodes.map((n, i) => ({
		id: prefix + i,
		type: n.type,
		position: { x: n.x, y: n.y },
		data: { label: n.type, ...(n.data ?? {}) },
		class: 'w-[150px]'
	}));
	const edges = spec.edges.map((e) => {
		const source = prefix + e.from;
		const target = prefix + e.to;
		return {
			id: 'e-' + source + '-' + target + (e.handle ? '.' + e.handle : ''),
			source,
			target,
			...(e.handle ? { targetHandle: e.handle } : {})
		};
	});
	return { nodes, edges };
}

export function wavesDef() {
	const enemyNames = Array.from({ length: ENEMIES }, (_, i) => 'Enemy ' + (i + 1));
	const objects = [
		{ type: 'box', name: 'Ground', color: 0x7a6a60, size: GROUND.size, pos: GROUND.pos, roughness: 0.88, physics: { mode: 'static', friction: 0.7 } },
		// the goal is a TOWER: a rounded stone plinth (still the static box the enemies walk to)
		// under the crystal core the Arena group floats over it
		{ type: 'box', name: 'Goal', color: 0x2e3542, bevel: 0.14, size: [1.6, 1, 1.6], pos: GOAL, roughness: 0.5, metalness: 0.3, physics: { mode: 'static' } },
		// the pads glow at the heart of each portal ring (the Waves node reads their positions)
		...SPAWNS.map((p, i) => ({ type: 'box', name: 'Spawn ' + (i + 1), color: 0xff5a4a, emissive: 0xff3b2e, emissiveIntensity: 1.8, size: [0.6, 0.1, 0.6], pos: p, shadow: false, physics: { mode: 'static' } })),
		// readable figures: a capsule body with a glowing visor — ONE dynamic body each
		...enemyNames.map((name, i) => enemyObject(name, [-6 + i * 1.5, Y, -8])),
		{ type: 'box', name: 'Home', color: 0x6fcf7a, emissive: 0x3fae55, emissiveIntensity: 0.8, size: [1, 0.1, 1], pos: HOME, physics: { mode: 'static' } },
		...arenaObjects({ spawns: SPAWNS, goal: GOAL, home: HOME, ground: GROUND })
	];
	// selectors name objects by NAME in a def; the recipe takes those in place of uuids
	const arena = arenaRecipe({
		enemies: enemyNames,
		goal: 'Goal',
		row: 0,
		playerHealthId: null,
		options: { name: 'enemy', waves: 3, sizeStart: 2, sizeStep: 1, interval: 3, hp: 3, source: 'hit', speed: 1.5, reach: 1.5, enemyDamage: 1, enemyRate: 1, playerName: 'me', playerHp: 10, playerRegen: 0.5, spawnPrefix: 'Spawn' }
	});
	const hud = hudGraph({ name: 'enemy', playerName: 'me', x: 60, y: 40 + (arena.rows + 1) * 200 });
	const a = toGraph(arena, 'wa');
	const h = toGraph(hud, 'wh');
	// 30: the crystal core glows with the player's health (Goal Core, fx.js)
	const coreY = 40 + (arena.rows + 1) * 200 + 1100;
	const core = toGraph(
		{
			nodes: [
				{ type: 'healthvalue', x: 60, y: coreY, data: { name: 'me', read: 'fraction' } },
				{ type: 'wavescore', x: 280, y: coreY, data: { floor: 0.15, spin: 0.6 } },
				{ type: 'objectselector', x: 500, y: coreY, data: { selected: CORE } }
			],
			edges: [
				{ from: 0, to: 1, handle: 'value' },
				{ from: 1, to: 2 }
			]
		},
		'wc'
	);
	return {
		kind: 'game',
		slug: 'waves',
		title: 'Waves',
		description: 'Wave survival: hold the goal against waves of enemies walking in from the spawn points. Knock them down; the round ends when the last wave falls.',
		license: 'CC0-1.0',
		author: 'theprototype',
		tags: ['vr', 'co-op', 'survival'],
		modules: [{ id: 'health', version: '1.0.0' }, { id: 'waves', version: '1.1.0' }],
		installModules: ['health', 'waves'],
		// 30: a warm sunset arena — a gradient sky, horizon fog, the sun low BEHIND the player's
		// spawn (so the enemies walking in are lit from the front), a real ground to the horizon
		env: {
			preset: 'custom',
			base: 'sunset',
			exposure: 1.15,
			background: { top: '#2a3d6e', bottom: '#f2a478' },
			fog: { color: '#d69a86', near: 34, far: 120 },
			ground: { color: '#5a4c44', roughness: 0.95 },
			sun: { color: '#ffd2a8', intensity: 1.8, dir: [0.35, 0.55, 0.75] },
			hemi: { sky: '#b8c8f0', ground: '#6a4a3a', intensity: 1.1 }
		},
		physics: { knock: { enabled: true, gain: 1, maxSpeed: 10, spin: 0.8 }, play: { interaction: 'grab', grounded: true, simOnPlay: true } },
		// the standard shell's post floor: AO -> AgX -> bloom -> SMAA
		post: {
			enabled: true,
			effects: [
				{ id: 'ao', kind: 'ao', enabled: true, params: { aoRadius: 0.6, intensity: 1.2 } },
				{ id: 'tone', kind: 'tonemapping', enabled: true, params: { mode: 'AGX' } },
				{ id: 'bloom', kind: 'bloom', enabled: true, params: { intensity: 0.8, luminanceThreshold: 0.8 } },
				{ id: 'aa', kind: 'smaa', enabled: true, params: {} }
			],
			changedAt: 0
		},
		graphs: { scene: { nodes: [...a.nodes, ...h.nodes, ...core.nodes], edges: [...a.edges, ...h.edges, ...core.edges] } },
		hud: arenaHud(),
		// the editor opens high over the home end; the card is the arena's corner camera
		view: { pos: [11, 10, 17], target: [0, 0, -2] },
		thumb: { camera: CARD_CAMERA },
		objects
	};
}
