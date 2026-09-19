// health — the module entry. Bundled to one self-contained module.js by esbuild
// (npm run build:health); everything outside comes through `api`.
//
// The mechanic in one breath: a `health` node gives an object (or the local player) hit
// points; `damage` and `heal` nodes fire pulses into a core Counter that feeds it; every
// peer derives the number from the same counters (a late joiner reads the same count in
// the trigger-log handshake), and a player's own points ride their own peerVars row.
// Nobody is an authority, nothing is sent on a timer, and there is no registerStateSync:
// every bit of state is already replicated. See src/ledger.js for the two models.

import { createEngine } from './engine.js';
import { registerNodes } from './nodes.js';
import { registerToolbox } from './toolbox.js';
import { DEFAULTS } from './ledger.js';

export default {
	id: 'health',
	name: 'Health',
	version: '1.0.0',
	description:
		'Hit points for objects and players: damage and heal nodes, death and respawn, converging on every peer with no authority.',

	/** @param {any} api the module SDK surface */
	register(api) {
		if (!api.flow?.addNodes || !api.game?.roundCutoff || !api.peerVars?.setMine || !api.registerValueNode) {
			api.toast('Health needs a newer app build (the game SDK seams are missing)');
			return;
		}
		const engine = createEngine(api);
		registerNodes(api, engine);
		const toolbox = registerToolbox(api, engine);

		// a click on a damageable object: this peer alone saw it, so the pulse REPLICATES
		// (the collectible's model). A pure observer — selection is untouched.
		api.registerClickHandler((/** @type {any} */ object) => {
			const chain = uuidChain(api, object);
			if (chain.length) engine.hitObjects(chain, 'click');
			return false;
		});

		api.hud.registerDebugLine(() => {
			const names = engine.names();
			if (!names.length) return null;
			return names
				.map((name) => {
					const r = engine.read(name);
					return 'health (' + name + '): ' + Math.round(r.hp * 10) / 10 + '/' + r.max + (r.total > 1 ? ' · ' + r.alive + ' of ' + r.total + ' alive' : r.alive ? '' : ' · dead');
				})
				.join(' · ');
		});
		api.hud.registerAction({
			key: 'showhealth',
			label: 'Show health (bar)',
			group: 'Data',
			role: 'drives',
			node: '',
			via: { node: 'healthvalue', data: { name: DEFAULTS.name, read: 'fraction' }, handle: 'value' },
			hint: '0..1 for a Bar (min 0, max 1). Derived from the health nodes, so every peer agrees.'
		});
		api.hud.registerAction({
			key: 'showhp',
			label: 'Show hit points',
			group: 'Data',
			role: 'drives',
			node: '',
			via: { node: 'healthvalue', data: { name: DEFAULTS.name, read: 'current' }, handle: 'value' },
			hint: 'The current hit points as a number — a Text or an Icon Row.'
		});

		api.onSceneClear(() => engine.clear());

		// test/debug hook (never serialized): the flight reads the derivation through this
		if (typeof window !== 'undefined')
			/** @type {any} */ (window).__health = {
				api,
				engine,
				toolbox,
				snapshot: () => engine.all().map((s) => ({ ...s }))
			};
	}
};

/** the clicked MESH up to the top-level object, as a chain of uuids (the collectible's)
 * @param {any} api @param {any} object @returns {string[]} */
function uuidChain(api, object) {
	const root = api.objectsGroup();
	/** @type {string[]} */
	const out = [];
	let current = object;
	while (current && current !== root && out.length < 32) {
		if (current.uuid) out.push(current.uuid);
		current = current.parent;
	}
	return current === root ? out : [];
}
