// waves — THE NODE FAMILY (group "Waves").
//
//   waves        VALUE (the current wave). Owns the run: `name` (the enemies' health
//                name), `waves`, `sizeStart`/`sizeStep` (the size curve), `interval`
//                (seconds between waves), `speed`/`stagger` (the walk), `reach`,
//                `spawnPrefix` (objects named Spawn… are the spawn points). Input `goal`
//                (an object the enemies walk to). Enemies = every health node carrying
//                the name; the wave is derived from their hit counters.
//   wavesvalue   VALUE. `wave` / `left` (alive in this wave) / `size` / `waves` / `done`.
//   wavesevent   EVENT out. `start` / `wave` / `over`, fired locally on every peer from
//                the same derived edge — wire `over` into Set Game State (over).

import { DEFAULTS } from './curve.js';

export const READS = ['wave', 'left', 'size', 'waves', 'done'];
export const EVENTS = ['wave', 'over', 'start'];

/** @param {any} api @param {ReturnType<import('./engine.js').createWavesEngine>} engine */
export function registerNodes(api, engine) {
	api.registerNodeGroup({
		group: 'Waves',
		items: [
			{
				type: 'waves',
				label: 'Waves',
				defaults: { ...DEFAULTS, spawnPrefix: 'Spawn', goal: '' },
				params: [
					{ key: 'name', kind: 'text', placeholder: DEFAULTS.name, maxLength: 40 },
					{ key: 'waves', kind: 'range', min: 1, max: 50, step: 1 },
					{ key: 'sizeStart', kind: 'range', min: 1, max: 50, step: 1 },
					{ key: 'sizeStep', kind: 'range', min: 0, max: 20, step: 1 },
					{ key: 'interval', kind: 'range', min: 0, max: 60, step: 0.5 },
					{ key: 'speed', kind: 'range', min: 0.1, max: 20, step: 0.1 },
					{ key: 'stagger', kind: 'range', min: 0, max: 10, step: 0.1 },
					{ key: 'reach', kind: 'range', min: 0.5, max: 10, step: 0.5 },
					{ key: 'spawnPrefix', kind: 'text', placeholder: 'Spawn', maxLength: 40 }
				]
			},
			{
				type: 'wavesvalue',
				label: 'Waves Value',
				defaults: { name: DEFAULTS.name, read: 'wave' },
				params: [
					{ key: 'name', kind: 'text', placeholder: DEFAULTS.name, maxLength: 40 },
					{ key: 'read', kind: 'select', options: READS }
				]
			},
			{
				// 30: the goal's crystal glows with a 0..1 value (fx.js) — the player's health
				type: 'wavescore',
				label: 'Goal Core',
				defaults: { value: 1, floor: 0.15, spin: 0.6 },
				params: [
					{ key: 'floor', kind: 'range', min: 0, max: 1, step: 0.05 },
					{ key: 'spin', kind: 'range', min: 0, max: 4, step: 0.1 }
				]
			},
			{
				type: 'wavesevent',
				label: 'Waves Event',
				defaults: { name: DEFAULTS.name, event: 'wave' },
				params: [
					{ key: 'name', kind: 'text', placeholder: DEFAULTS.name, maxLength: 40 },
					{ key: 'event', kind: 'select', options: EVENTS }
				]
			}
		]
	});

	api.registerValueNode(
		'waves',
		(/** @type {any} */ _data, /** @type {number} */ _time, /** @type {any} */ ctx) => engine.stateOf(ctx?.id)?.wave ?? 0,
		{ vtype: 'number', inputs: { goal: 'object' } }
	);
	api.registerValueNode(
		'wavesvalue',
		(/** @type {any} */ data) => {
			const s = engine.read(String(data?.name ?? '').trim() || DEFAULTS.name);
			if (!s) return 0;
			switch (String(data?.read ?? 'wave')) {
				case 'left':
					return s.alive;
				case 'size':
					return s.size;
				case 'waves':
					return s.curve.waves;
				case 'done':
					return s.done ? 1 : 0;
				default:
					return s.wave;
			}
		},
		{ vtype: 'number' }
	);
	api.registerValueNode('wavesevent', () => 0, { vtype: 'event' });
}
