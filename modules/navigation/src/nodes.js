// navigation — THE NODE FAMILY (group "Navigation").
//
//   navnpc     EFFECT  Enemy: the G5 brain (patrol a Path → hear / see → chase → attack → give up →
//                      return). Put it in the enemy's own graph (the sheet does).
//   navchase   EFFECT  Chase an object (or the nearest player), stop at `stopAt`.
//   navflee    EFFECT  Run from an object (or the nearest player) until `distance` away.
//   navmoveto  EFFECT  Walk to an object; "arrived" when there.
//   navpatrol  EFFECT  Walk a Path's points (loop or back and forth) — edit the path, the walk follows.
//   navwander  EFFECT  Stroll to random walkable spots around home, pausing between.
//   navnoise   EVENT   Make Noise: a pulse on `trigger` makes a noise at `at` (or the player) —
//                      enemies within hearing × loudness come to look.
//   navevent   EVENT   On NPC Event: spotted / heard / attack / lost / gaveup / returned / unreachable /
//                      arrived, for one enemy (`npc`, or the graph's owner) or any. `why` filters
//                      "unreachable" by its reason (off mesh / blocked / too far).
//   navstate   VALUE   NPC State: the state number (0 idle … 5 return), or 1/0 for chasing / alert /
//                      reachable, read from the replicated snapshot (every peer reads the same).
//   navmesh    VALUE   Navmesh: the bake settings (cell size, agent radius / height / climb / slope,
//                      and `ledge` / `jump`: the highest ledge NPCs climb and the widest gap they
//                      jump, m, 0 = off) — one in the scene graph; without it the defaults bake.
//
// Every effect has an `enabled` input: wire a Latch or a Gate into it to switch a behaviour on and
// off (one object may carry several; the highest in the list above wins while enabled).

import { NPC_DEFAULTS, STATES } from './brain.js';
import { BAKE_DEFAULTS } from './bakeDefaults.js';
import { NPC_EVENTS, WHY } from './runtime.js';

const enabledInput = { enabled: 'boolean' };
export const STATE_READS = ['state', 'chasing', 'alert', 'reachable'];

/** @param {any} api @param {ReturnType<import('./runtime.js').createRuntime>} rt */
export function registerNodes(api, rt) {
	api.registerNodeGroup({
		group: 'Navigation',
		items: [
			{
				type: 'navnpc',
				label: 'Enemy (NPC)',
				defaults: { ...NPC_DEFAULTS, path: '', enabled: true, faceOffset: 0 },
				params: [
					{ key: 'sightAngle', kind: 'range', min: 10, max: 360, step: 5 },
					{ key: 'sightRange', kind: 'range', min: 1, max: 60, step: 0.5 },
					{ key: 'hearing', kind: 'range', min: 0, max: 40, step: 0.5 },
					{ key: 'chaseRange', kind: 'range', min: 2, max: 120, step: 1 },
					{ key: 'attackRange', kind: 'range', min: 0.3, max: 10, step: 0.1 },
					{ key: 'attackEvery', kind: 'range', min: 0.2, max: 10, step: 0.1 },
					{ key: 'alert', kind: 'range', min: 0, max: 10, step: 0.25 },
					{ key: 'giveUp', kind: 'range', min: 0.5, max: 30, step: 0.5 },
					{ key: 'speed', kind: 'range', min: 0.2, max: 8, step: 0.1 },
					{ key: 'run', kind: 'range', min: 0.2, max: 12, step: 0.1 },
					{ key: 'faceOffset', kind: 'range', min: -180, max: 180, step: 90 }
				]
			},
			{
				type: 'navchase',
				label: 'Chase',
				defaults: { target: '', speed: 3.5, stopAt: 1.2, maxPath: 0, enabled: true },
				params: [
					{ key: 'speed', kind: 'range', min: 0.2, max: 12, step: 0.1 },
					{ key: 'stopAt', kind: 'range', min: 0.3, max: 10, step: 0.1 },
					{ key: 'maxPath', kind: 'range', min: 0, max: 200, step: 1 }
				]
			},
			{
				type: 'navflee',
				label: 'Flee',
				defaults: { from: '', distance: 8, speed: 3.5, enabled: true },
				params: [
					{ key: 'distance', kind: 'range', min: 1, max: 40, step: 0.5 },
					{ key: 'speed', kind: 'range', min: 0.2, max: 12, step: 0.1 }
				]
			},
			{
				type: 'navmoveto',
				label: 'Move To',
				defaults: { target: '', speed: 2, enabled: true },
				params: [{ key: 'speed', kind: 'range', min: 0.2, max: 12, step: 0.1 }]
			},
			{
				type: 'navpatrol',
				label: 'Patrol (Path)',
				defaults: { path: '', speed: 1.6, enabled: true },
				params: [{ key: 'speed', kind: 'range', min: 0.2, max: 12, step: 0.1 }]
			},
			{
				type: 'navwander',
				label: 'Wander',
				defaults: { radius: 6, pause: 2, speed: 1.2, enabled: true },
				params: [
					{ key: 'radius', kind: 'range', min: 1, max: 50, step: 0.5 },
					{ key: 'pause', kind: 'range', min: 0, max: 20, step: 0.5 },
					{ key: 'speed', kind: 'range', min: 0.2, max: 12, step: 0.1 }
				]
			},
			{
				type: 'navnoise',
				label: 'Make Noise',
				defaults: { loudness: 1, at: '', trigger: 0 },
				params: [{ key: 'loudness', kind: 'range', min: 0.1, max: 5, step: 0.1 }]
			},
			{
				type: 'navevent',
				label: 'On NPC Event',
				defaults: { event: 'spotted', why: 'any', npc: '' },
				params: [
					{ key: 'event', kind: 'select', options: NPC_EVENTS },
					{ key: 'why', kind: 'select', options: WHY }
				]
			},
			{
				type: 'navstate',
				label: 'NPC State',
				defaults: { read: 'state', npc: '' },
				params: [{ key: 'read', kind: 'select', options: STATE_READS }]
			},
			{
				type: 'navmesh',
				label: 'Navmesh',
				defaults: { ...BAKE_DEFAULTS },
				params: [
					{ key: 'cell', kind: 'range', min: 0.08, max: 1, step: 0.02 },
					{ key: 'radius', kind: 'range', min: 0.1, max: 2, step: 0.05 },
					{ key: 'height', kind: 'range', min: 0.4, max: 4, step: 0.1 },
					{ key: 'climb', kind: 'range', min: 0, max: 2, step: 0.05 },
					{ key: 'slope', kind: 'range', min: 5, max: 70, step: 1 },
					{ key: 'ledge', kind: 'range', min: 0, max: 3, step: 0.05 },
					{ key: 'jump', kind: 'range', min: 0, max: 4, step: 0.05 }
				]
			}
		]
	});

	for (const type of ['navnpc', 'navchase', 'navflee', 'navmoveto', 'navpatrol', 'navwander']) {
		const inputs =
			type === 'navnpc' || type === 'navpatrol'
				? { path: 'object', ...enabledInput }
				: type === 'navchase' || type === 'navmoveto'
					? { target: 'object', ...enabledInput }
					: type === 'navflee'
						? { from: 'object', ...enabledInput }
						: { ...enabledInput };
		api.registerEffect(type, (/** @type {any} */ object, /** @type {any} */ base, /** @type {any} */ data, /** @type {number} */ _time, /** @type {any} */ ctx) => rt.drive(type, object, base, data, ctx ?? {}), { inputs });
	}

	// the event nodes' pulses are fired by the runtime (authority only, replicated)
	api.registerValueNode('navnoise', () => 0, { vtype: 'event', inputs: { trigger: 'event', at: 'object' } });
	api.registerValueNode('navevent', () => 0, { vtype: 'event', inputs: { npc: 'object' } });
	// pure of the replicated snapshot (the value-node rule): every peer reads the same state
	api.registerValueNode(
		'navstate',
		(/** @type {any} */ data, /** @type {number} */ _t, /** @type {any} */ ctx) => {
			const npc = typeof data?.npc === 'string' && data.npc && data.npc !== '-None-' ? data.npc : ctx?.graphId && ctx.graphId !== 'scene' ? ctx.graphId : null;
			const s = rt.stateOf(npc);
			const state = s?.state ?? 'idle';
			switch (data?.read) {
				case 'chasing':
					return state === 'chase' || state === 'attack' ? 1 : 0;
				case 'alert':
					return state === 'alert' ? 1 : 0;
				case 'reachable':
					return s && s.why ? 0 : 1;
				default:
					return Math.max(0, STATES.indexOf(state));
			}
		},
		{ vtype: 'number', inputs: { npc: 'object' } }
	);
	api.registerValueNode('navmesh', () => 0, { vtype: 'number' });
}

