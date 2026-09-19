// THE NODE (group "Dungeon Kit"): the recipe as a node. Its (replicated) data
// regenerates the identical campaign on every peer and broadcasts nothing at all —
// the node IS the recipe (rule ownership, the dungeon-realms pattern). A template
// carries it wired to an Object Selector, which answers DEVX #10 without an SDK call.
//
// Runtime reality (SDK v1): a module node is an EFFECT node — it runs when wired to
// an Object Selector, or unwired inside any object's own graph (the implicit-owner
// rule). Range params get wireable input sockets for free (a Number node feeds `seed`).

export const NODE_TYPE = 'dkdungeon';

/** @param {any} api @param {ReturnType<import('./kit.js').createKit>} core */
export function registerNodes(api, core) {
	const { kit } = core;

	api.registerNodeGroup({
		group: 'Dungeon Kit',
		items: [
			{
				type: NODE_TYPE,
				label: 'Dungeon',
				defaults: { seed: 1337, roomCount: 0, levelCount: 5, loopChance: 0.15, gemDensity: 1, apply: false },
				params: [
					{ key: 'seed', kind: 'range', min: 0, max: 999999, step: 1 },
					{ key: 'roomCount', kind: 'range', min: 0, max: 60, step: 2 },
					{ key: 'levelCount', kind: 'range', min: 1, max: 9, step: 1 },
					{ key: 'loopChance', kind: 'range', min: 0, max: 0.5, step: 0.05 },
					{ key: 'gemDensity', kind: 'range', min: 0.25, max: 2, step: 0.05 },
					{ key: 'apply', kind: 'toggle' }
				]
			}
		]
	});

	api.registerEffect(NODE_TYPE, (object, base, data) => {
		if (!data.apply) return;
		const seed = Math.max(0, Math.round(Number(data.seed) || 0));
		const params = {
			roomCount: Math.round(Number(data.roomCount) || 0),
			levelCount: Math.round(Number(data.levelCount) || 5),
			loopChance: Number(data.loopChance ?? 0.15),
			gemDensity: Number(data.gemDensity ?? 1)
		};
		const current = kit.state();
		const same =
			current.seed === seed &&
			current.params.roomCount === params.roomCount &&
			current.params.levelCount === params.levelCount &&
			Math.abs((current.params.loopChance ?? 0.15) - params.loopChance) < 1e-9 &&
			Math.abs((current.params.gemDensity ?? 1) - params.gemDensity) < 1e-9;
		if (same) return;
		// the node data replicates with the graph: every peer regenerates the SAME
		// dungeon locally — deterministic model, no op needed
		kit.generate(seed, params, { broadcast: false });
	});
}
