// the graph walk over api.flow snapshots, and the recipe's shape — no app
import { indexGraph, targetsOf, chainsOf, feedersOf, triggerSourcesOf, recipe, nameOf } from '../src/graph.js';

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	const n = (id, type, data = {}, graphId = 'scene') => ({ id, type, graphId, data });
	const e = (source, target, targetHandle = null) => ({ id: 'e-' + source + '-' + target + (targetHandle ? '.' + targetHandle : ''), source, target, targetHandle });

	// the recipe's chain: click -> damage -> counter.pulse -> health.damage -> selector
	const nodes = [
		n('dmg', 'damage', { amount: 2, source: 'click' }),
		n('cnt', 'counter', { op: 'up', step: 1 }),
		n('hp', 'health', { name: 'hp', scope: 'object' }),
		n('sel', 'objectselector', { selected: 'crate-uuid' }),
		n('rst', 'healthreset', { name: 'hp' }),
		n('heal', 'heal', { amount: 1 }),
		n('hcnt', 'counter', {}),
		n('click', 'onclick', {}),
		n('direct', 'damage', { amount: 1 }),
		n('owner', 'health', { name: 'owner' }, 'owner-uuid')
	];
	const edges = [
		e('dmg', 'cnt', 'pulse'),
		e('cnt', 'hp', 'damage'),
		e('hp', 'sel'),
		e('rst', 'cnt', 'reset'),
		e('heal', 'hcnt', 'pulse'),
		e('hcnt', 'hp', 'heal'),
		e('click', 'dmg', 'trigger'),
		e('direct', 'hp', 'damage')
	];
	const g = indexGraph(nodes, edges);

	check(targetsOf(g.byId.get('hp'), g).join() === 'crate-uuid', 'a health targets the object its selector names');
	check(targetsOf(g.byId.get('owner'), g).join() === 'owner-uuid', 'a health in an object graph implicitly targets its owner');
	check(targetsOf(g.byId.get('direct'), g).length === 0, 'a node with neither has no target');

	const chains = chainsOf(g.byId.get('dmg'), g);
	check(chains.length === 1 && chains[0].health.id === 'hp' && chains[0].via === 'damage' && chains[0].counter?.id === 'cnt', 'damage -> counter -> health.damage resolves to the health, via damage, through the counter');
	const healChains = chainsOf(g.byId.get('heal'), g);
	check(healChains.length === 1 && healChains[0].via === 'heal', 'heal -> counter -> health.heal lands on the heal input');
	const directChains = chainsOf(g.byId.get('direct'), g);
	check(directChains.length === 1 && directChains[0].counter === null, 'damage wired straight into health.damage resolves with no counter');
	check(chainsOf(g.byId.get('rst'), g).length === 0, 'COUNTERFACTUAL: a reset wire is not a damage chain (it lands on counter.reset)');

	const feeders = feedersOf(g.byId.get('hp'), g);
	check(feeders.damage.map((f) => f.id).sort().join() === 'cnt,direct' && feeders.heal.map((f) => f.id).join() === 'hcnt', 'a health knows what feeds each input');
	check(triggerSourcesOf(g.byId.get('dmg'), g).join() === 'click', 'a damage node knows the event wired into its trigger');
	check(nameOf({ data: { name: '  hp ' } }) === 'hp' && nameOf({ data: {} }) === 'hp', 'names trim and default');

	// ---- the recipe ----------------------------------------------------------------------
	const r = recipe({ uuid: 'u1', row: 2, health: { name: 'enemy', max: 3, deathAction: 'respawn' }, damage: { amount: 2, source: 'click' } });
	check(r.nodes.map((x) => x.type).join() === 'damage,counter,health,healthreset,objectselector', 'object recipe: damage, counter, health, reset, selector');
	check(r.nodes[2].data.scope === 'object' && r.nodes[2].data.whilePlaying === true && r.nodes[2].data.name === 'enemy', 'the health carries the form and core\'s whilePlaying flag');
	check(r.nodes[3].data.name === 'enemy', 'the reset node carries the same name');
	check(r.nodes[4].data.selected === 'u1', 'the selector names the object');
	check(JSON.stringify(r.edges) === JSON.stringify([{ from: 0, to: 1, handle: 'pulse' }, { from: 1, to: 2, handle: 'damage' }, { from: 3, to: 1, handle: 'reset' }, { from: 2, to: 4 }]), 'the wires: pulse, damage, reset, target');
	check(r.nodes[0].y === 40 + 2 * 200 && r.nodes[3].y === r.nodes[0].y + 100, 'row 2 sits two rows down, the reset under the damage');
	const p = recipe({ uuid: null, row: 0, health: { name: 'hp' }, damage: { amount: 1, source: 'wired' } });
	check(p.nodes.length === 4 && p.nodes[2].data.scope === 'player' && p.edges.length === 3, 'player recipe: no selector, scope player');
	const twice = JSON.stringify(recipe({ uuid: 'u1', row: 0, health: {}, damage: {} }));
	check(twice === JSON.stringify(recipe({ uuid: 'u1', row: 0, health: {}, damage: {} })), 'the recipe is deterministic');
}
