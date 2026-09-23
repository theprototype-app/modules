// waves — THE DEF, the shape core's scripts/author-templates.cjs builds a game template
// from (the football precedent): objects as `{type, name, color, size, pos, physics}`,
// a graph of `{id, type, position, data}` nodes and canonical `e-<src>-<tgt>[.handle]`
// edges, with Object Selectors naming objects by NAME (the author script resolves them).
// One source: the HUD is hud.js; the arena's graph is the toolbox's recipe run on a fixed
// set of enemy boxes. The integrator pastes `waves.def.json` (emitted by
// `npm run build:waves`) into the author script and stages the template.

import { arenaHud, hudGraph } from './hud.js';
import { arenaRecipe } from './toolbox.js';
import { arenaObjects, enemyObject, standHeight, CORE, CARD_CAMERA, MODULE_ROOT } from './look.js';
import { kindOf } from './curve.js';

/**
 * 30b: THE ROSTER. The Waves node uses enemies in NAME order, a wave of n the first n — so the
 * names ARE the difficulty curve: level 1 (waves 1-3, sizes 2-4) is grunts, level 2 (5-7)
 * brings the runners, level 3 (8-10) the tanks, levels 4-5 throw everything, faster.
 * The kind is read off the name (curve.js kindOf); the hit points follow the kind.
 */
export const ROSTER = Object.freeze(['Enemy 01', 'Enemy 02', 'Enemy 03', 'Enemy 04', 'Enemy 05 Runner', 'Enemy 06 Runner', 'Enemy 07', 'Enemy 08 Tank', 'Enemy 09 Runner', 'Enemy 10 Tank']);
export const HP = Object.freeze({ grunt: 3, runner: 2, tank: 8 });
/** the run: 5 levels of 3 waves */
export const RUN = Object.freeze({ waves: 15, perLevel: 3, levelSpeed: 0.12, sizeStart: 2, sizeStep: 1, interval: 3, speed: 1.3, stagger: 0.9, reach: 1.7 });
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
	const enemyNames = [...ROSTER];
	const objects = [
		{ type: 'box', name: 'Ground', color: 0x7a6a60, size: GROUND.size, pos: GROUND.pos, roughness: 0.88, physics: { mode: 'static', friction: 0.7 } },
		// the goal is a TOWER: a rounded stone plinth (still the static box the enemies walk to)
		// under the crystal core the Arena group floats over it
		{ type: 'box', name: 'Goal', color: 0x2e3542, bevel: 0.14, size: [1.6, 1, 1.6], pos: GOAL, roughness: 0.5, metalness: 0.3, physics: { mode: 'static' } },
		// the pads glow at the heart of each portal ring (the Waves node reads their positions)
		...SPAWNS.map((p, i) => ({ type: 'box', name: 'Spawn ' + (i + 1), color: 0xff5a4a, emissive: 0xff3b2e, emissiveIntensity: 1.8, size: [0.6, 0.1, 0.6], pos: p, shadow: false, physics: { mode: 'static' } })),
		// readable figures: a capsule body with a glowing visor — ONE dynamic body each; 30b: three
		// kinds, parked in two ranks behind the portals until their wave calls them
		...enemyNames.map((name, i) => enemyObject(name, [-6.75 + (i % 5) * 3.4, standHeight(kindOf(name)), i < 5 ? -14.5 : -16], kindOf(name))),
		{ type: 'box', name: 'Home', color: 0x6fcf7a, emissive: 0x3fae55, emissiveIntensity: 0.8, size: [1, 0.1, 1], pos: HOME, physics: { mode: 'static' } },
		...arenaObjects({ spawns: SPAWNS, goal: GOAL, home: HOME, ground: GROUND })
	];
	// selectors name objects by NAME in a def; the recipe takes those in place of uuids
	const arena = arenaRecipe({
		enemies: enemyNames,
		hps: enemyNames.map((n) => HP[kindOf(n)]),
		goal: 'Goal',
		row: 0,
		playerHealthId: null,
		// 30b: the shooter — 5 levels, the breach (an enemy at the crystal costs 2 of its 10), no
		// zone chains, no regen: the crystal only comes back with a new round. Damage is `wired`:
		// SHOTS fire the damage node themselves; a knock (a hand, or a body standing in a lane —
		// the desktop player spawns on the middle lane) still shoves an enemy but no longer kills it
		options: { name: 'enemy', ...RUN, hp: 3, source: 'wired', enemyDamage: 1, enemyRate: 1, playerName: 'me', playerHp: 10, playerRegen: 0, spawnPrefix: 'Spawn', zone: false, breach: true, breachDamage: 2 }
	});
	const hudY = 40 + (arena.rows + 1) * 200;
	const hud = hudGraph({ name: 'enemy', playerName: 'me', x: 60, y: hudY });
	const a = toGraph(arena, 'wa');
	const h = toGraph(hud, 'wh');
	// 30: the crystal core glows with the player's health (Goal Core, fx.js)
	const coreY = hudY + (hud.rows + 1) * 200;
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
		description: 'A VR shooter: hold the crystal against five levels of waves — grunts, runners and tanks pouring out of the portals. Pick a gun and an ability; shoot them down before they reach it.',
		license: 'CC0-1.0',
		author: 'theprototype',
		tags: ['vr', 'co-op', 'shooter', 'survival'],
		modules: [{ id: 'health', version: '1.0.0' }, { id: 'waves', version: '2.1.0' }],
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
		// 30b: a desktop click is a SHOT, not a grab ('click'); the play block names the spawn —
		// on the home pad, facing the arena — and keeps fly/teleport off (30b C1)
		physics: { knock: { enabled: true, gain: 1, maxSpeed: 10, spin: 0.8 }, play: { interaction: 'click', grounded: true, simOnPlay: true, spawn: { position: [HOME[0], 0, HOME[2]], yaw: 0 }, locomotion: { teleport: false, fly: false } } },
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
		// 30c: the card shows the Meshy figures (they live under the module's own root)
		thumb: { camera: CARD_CAMERA, sceneGroups: [MODULE_ROOT] },
		objects
	};
}
