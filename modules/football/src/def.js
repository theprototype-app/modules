// football — THE DEF (B4), the shape core's scripts/author-templates.cjs builds a game
// template from (kind, slug, modules, installModules, env, physics, post, graphs, hud,
// objects). One source: the objects and graph are pitch.js, the HUD is hud.js. The
// orchestrator pastes/imports `football.def.json` (emitted by `npm run build:football`)
// into the author script and runs `--only football` against the scenes checkout.

import { pitchObjects, pitchGraph, PITCH_PHYSICS, DEFAULT_DIMS } from './pitch.js';
import { pitchHud } from './hud.js';

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
		env: { preset: 'daylight', exposure: 0.9 },
		physics: PITCH_PHYSICS,
		post: {
			enabled: true,
			effects: [
				{ id: 'tone', kind: 'tonemapping', enabled: true, params: { mode: 'AGX' } },
				{ id: 'bloom', kind: 'bloom', enabled: true, params: { intensity: 0.6, luminanceThreshold: 0.8 } },
				{ id: 'aa', kind: 'smaa', enabled: true, params: {} }
			],
			changedAt: 0
		},
		graphs: { scene: pitchGraph(undefined, { hudButtons: true }) },
		hud: pitchHud(),
		objects: pitchObjects(DEFAULT_DIMS)
	};
}
