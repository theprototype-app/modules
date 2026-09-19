// health — THE NODE FAMILY (group "Health").
//
//   health       VALUE (its hp). Names its object through the `target` input (an Object
//                Selector wire; a node in an object's own graph implicitly owns it) and
//                owns the numbers: `max`, `scope`, `regen`, `deathAction`, `respawnDelay`.
//                Inputs `damage` / `heal` (numbers — wire the counters) and `respawnAt`
//                (an object: where a player comes back). NOT an effect, on purpose: the
//                runtime re-seats an effect target's base pose every frame (football's
//                "no node may target the ball"), and a damageable thing must be free to
//                move — an enemy walks, a crate gets knocked. So the engine hides a dead
//                object itself, in play only, and gives back exactly what it hid.
//   damage       EVENT out. Fires hit points into whatever health it feeds. `source`
//                says what sets it off: a wired event (`trigger` in), a click, a touch,
//                a zone, a knock (H2); `amount` is points per event.
//   heal         EVENT out, the same shape with the opposite sign.
//   healthreset  EVENT out. Wire it into the counters' `reset`; the module fires it on
//                a new round and on a respawn — locally on every peer, same moment.
//   healthvalue  VALUE. `current` / `max` / `fraction` / `alive` for a name — `fraction`
//                is what a HUD Bar wants, and it is why nobody has to wire a Math node.
//   healthevent  EVENT out. `death` / `damage` / `respawn` / `reset` for a name, fired
//                locally on every peer from the same derived edge.

import { DEFAULTS, SCOPES, DEATH_ACTIONS, DAMAGE_SOURCES, SCALES, MAX_PULSES } from './ledger.js';

export const READS = ['fraction', 'current', 'max', 'alive'];
export const EVENTS = ['death', 'damage', 'respawn', 'reset'];

/** @param {any} api @param {ReturnType<import('./engine.js').createEngine>} engine */
export function registerNodes(api, engine) {
	api.registerNodeGroup({
		group: 'Health',
		items: [
			{
				type: 'health',
				label: 'Health',
				defaults: { ...DEFAULTS, target: '', damage: 0, heal: 0, respawnAt: '' },
				params: [
					{ key: 'name', kind: 'text', placeholder: DEFAULTS.name, maxLength: 40 },
					{ key: 'scope', kind: 'select', options: SCOPES },
					{ key: 'max', kind: 'range', min: 1, max: 100, step: 1 },
					{ key: 'regen', kind: 'range', min: 0, max: 10, step: 0.5 },
					{ key: 'deathAction', kind: 'select', options: DEATH_ACTIONS },
					{ key: 'respawnDelay', kind: 'range', min: 0, max: 30, step: 1 }
				]
			},
			{
				type: 'damage',
				label: 'Damage',
				defaults: { amount: 1, source: 'wired', radius: 1.5, perSecond: 1, scale: 'none', speedRef: 3, trigger: 0, zone: '' },
				params: [
					{ key: 'amount', kind: 'range', min: 1, max: MAX_PULSES, step: 1 },
					{ key: 'source', kind: 'select', options: DAMAGE_SOURCES },
					{ key: 'radius', kind: 'range', min: 0.5, max: 10, step: 0.5 },
					{ key: 'perSecond', kind: 'range', min: 0.5, max: 10, step: 0.5 },
					{ key: 'scale', kind: 'select', options: SCALES },
					{ key: 'speedRef', kind: 'range', min: 0.5, max: 10, step: 0.5 }
				]
			},
			{
				type: 'heal',
				label: 'Heal',
				defaults: { amount: 1, trigger: 0 },
				params: [{ key: 'amount', kind: 'range', min: 1, max: MAX_PULSES, step: 1 }]
			},
			{
				type: 'healthreset',
				label: 'Health Reset',
				defaults: { name: DEFAULTS.name },
				params: [{ key: 'name', kind: 'text', placeholder: DEFAULTS.name, maxLength: 40 }]
			},
			{
				type: 'healthvalue',
				label: 'Health Value',
				defaults: { name: DEFAULTS.name, read: 'fraction' },
				params: [
					{ key: 'name', kind: 'text', placeholder: DEFAULTS.name, maxLength: 40 },
					{ key: 'read', kind: 'select', options: READS }
				]
			},
			{
				type: 'healthevent',
				label: 'Health Event',
				defaults: { name: DEFAULTS.name, event: 'death' },
				params: [
					{ key: 'name', kind: 'text', placeholder: DEFAULTS.name, maxLength: 40 },
					{ key: 'event', kind: 'select', options: EVENTS }
				]
			}
		]
	});

	// THE NUMBER: a health node reads as its own hp, so a card shows it live and a HUD
	// can take it straight. The derivation is the engine's (one place), never a copy here.
	api.registerValueNode(
		'health',
		(/** @type {any} */ _data, /** @type {number} */ _time, /** @type {any} */ ctx) => engine.stateOf(ctx?.id)?.hp ?? 0,
		{ vtype: 'number', inputs: { target: 'object', damage: 'number', heal: 'number', respawnAt: 'object' } }
	);

	// the event nodes: their pulses are fired by the engine through api.fireNodeTrigger
	api.registerValueNode('damage', () => 0, { vtype: 'event', inputs: { trigger: 'event', zone: 'object' } });
	api.registerValueNode('heal', () => 0, { vtype: 'event', inputs: { trigger: 'event' } });
	api.registerValueNode('healthreset', () => 0, { vtype: 'event' });
	api.registerValueNode('healthevent', () => 0, { vtype: 'event' });

	api.registerValueNode(
		'healthvalue',
		(/** @type {any} */ data) => {
			const r = engine.read(String(data?.name ?? '').trim() || DEFAULTS.name);
			switch (String(data?.read ?? 'fraction')) {
				case 'current':
					return r.hp;
				case 'max':
					return r.max;
				case 'alive':
					return r.alive;
				default:
					return r.fraction;
			}
		},
		{ vtype: 'number' }
	);
}
