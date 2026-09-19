// health — WALKING THE GRAPH, pure over `api.flow.nodes()` / `api.flow.edges()` snapshots.
//
// The chain a damage source rides, as the recipe wires it and as a user may re-wire it:
//
//   [any event]──trigger──▶ damage ──▶ counter.pulse ──▶ health.damage ◀──target── objectselector
//                                        ▲                       ▲
//                       healthreset ─────┘ (reset)     heal ──▶ counter.pulse ──▶ health.heal
//
// A `damage` node hurts WHATEVER HEALTH IT FEEDS (through a counter, or wired straight in);
// it never names a target itself. A `health` node names its object through its `target`
// input (an Object Selector wired IN — a value, not an effect target, so the runtime never
// pins the object's pose); a node in an object's own graph implicitly owns that object.

const SCENE = 'scene';

/** @param {any[]} nodes @param {any[]} edges */
export function indexGraph(nodes, edges) {
	/** @type {Map<string, any>} */
	const byId = new Map(nodes.map((n) => [n.id, n]));
	/** @type {Map<string, any[]>} */
	const bySource = new Map();
	/** @type {Map<string, any[]>} */
	const byTarget = new Map();
	for (const edge of edges) {
		if (!bySource.has(edge.source)) bySource.set(edge.source, []);
		bySource.get(edge.source)?.push(edge);
		if (!byTarget.has(edge.target)) byTarget.set(edge.target, []);
		byTarget.get(edge.target)?.push(edge);
	}
	return { byId, bySource, byTarget, nodes, edges };
}

/** @typedef {ReturnType<typeof indexGraph>} GraphIndex */

/** the object uuids a health node acts on: Object Selectors wired into `target` win, and
 * a node in an object's own graph implicitly owns it
 * @param {any} node @param {GraphIndex} g @returns {string[]} */
export function targetsOf(node, g) {
	/** @type {string[]} */
	const out = [];
	let wired = false;
	for (const edge of g.byTarget.get(node.id) ?? []) {
		if ((edge.targetHandle ?? null) !== 'target') continue;
		const src = g.byId.get(edge.source);
		if (src?.type !== 'objectselector') continue;
		wired = true;
		const selected = String(src.data?.selected ?? '');
		if (selected && selected !== '-None-') out.push(selected);
	}
	if (!wired && node.graphId && node.graphId !== SCENE) out.push(node.graphId);
	return out;
}

/** the node ids wired INTO `nodeId` on `handle`
 * @param {string} nodeId @param {string} handle @param {GraphIndex} g @returns {string[]} */
export function sourcesInto(nodeId, handle, g) {
	return (g.byTarget.get(nodeId) ?? [])
		.filter((e) => (e.targetHandle ?? null) === handle)
		.map((e) => e.source);
}

/**
 * Every health node a pulse from `node` reaches, and through which input: directly
 * (`damage -> health.damage`) or through one counter (`damage -> counter.pulse ->
 * health.damage`). `via` is the health input the chain lands on.
 * @param {any} node @param {GraphIndex} g
 * @returns {{health: any, via: 'damage'|'heal', counter: any|null}[]}
 */
export function chainsOf(node, g) {
	/** @type {{health: any, via: 'damage'|'heal', counter: any|null}[]} */
	const out = [];
	const seen = new Set();
	/** @param {any} health @param {string} via @param {any} counter */
	const add = (health, via, counter) => {
		const key = health.id + ':' + via + ':' + (counter?.id ?? '');
		if (seen.has(key)) return;
		seen.add(key);
		out.push({ health, via: via === 'heal' ? 'heal' : 'damage', counter });
	};
	for (const edge of g.bySource.get(node.id) ?? []) {
		const target = g.byId.get(edge.target);
		if (!target) continue;
		const handle = edge.targetHandle ?? null;
		if (target.type === 'health' && (handle === 'damage' || handle === 'heal')) add(target, handle, null);
		if (target.type === 'counter' && (handle === 'pulse' || handle === null)) {
			for (const next of g.bySource.get(target.id) ?? []) {
				const health = g.byId.get(next.target);
				const h2 = next.targetHandle ?? null;
				if (health?.type === 'health' && (h2 === 'damage' || h2 === 'heal')) add(health, h2, target);
			}
		}
	}
	return out;
}

/**
 * What feeds a health node's `damage` and `heal` inputs — the counters (or any value
 * node) whose values the ledger sums.
 * @param {any} health @param {GraphIndex} g
 * @returns {{damage: any[], heal: any[]}}
 */
export function feedersOf(health, g) {
	const pick = (/** @type {string} */ handle) =>
		sourcesInto(health.id, handle, g).map((id) => g.byId.get(id)).filter(Boolean);
	return { damage: pick('damage'), heal: pick('heal') };
}

/** the stamp source a damage/heal node listens to: whatever is wired into its `trigger`
 * @param {any} node @param {GraphIndex} g @returns {string[]} */
export function triggerSourcesOf(node, g) {
	return sourcesInto(node.id, 'trigger', g);
}

/** the object wired into a damage node's `zone` input (an Object Selector), or null
 * @param {any} node @param {GraphIndex} g @returns {string|null} */
export function zoneOf(node, g) {
	for (const edge of g.byTarget.get(node.id) ?? []) {
		if ((edge.targetHandle ?? null) !== 'zone') continue;
		const src = g.byId.get(edge.source);
		if (src?.type !== 'objectselector') continue;
		const selected = String(src.data?.selected ?? '');
		if (selected && selected !== '-None-') return selected;
	}
	return null;
}

/** @param {any} node @returns {string} */
export const nameOf = (node) => String(node?.data?.name ?? '').trim() || 'hp';

/**
 * THE RECIPE for one object (or the local player when `uuid` is null), laid out on one
 * row. Returned in `api.flow.addNodes` shape; indices in `edges` refer to `nodes`.
 * @param {{uuid: string|null, row: number, health: Record<string, any>, damage: Record<string, any>}} spec
 * @param {{col?: number, rowHeight?: number, x?: number, y?: number}=} layout
 */
export function recipe(spec, layout = {}) {
	const COL = layout.col ?? 220;
	const ROW = layout.rowHeight ?? 200;
	const x0 = layout.x ?? 60;
	const y = (layout.y ?? 40) + spec.row * ROW;
	const name = String(spec.health.name ?? '').trim() || 'hp';
	const health = { ...spec.health, name, scope: spec.uuid ? 'object' : 'player' };
	/** @type {any[]} */
	const nodes = [
		{ type: 'damage', x: x0, y, data: { ...spec.damage } },
		{ type: 'counter', x: x0 + COL, y, data: { op: 'up', step: 1 } },
		{ type: 'health', x: x0 + 2 * COL, y, data: health },
		{ type: 'healthreset', x: x0, y: y + 100, data: { name } }
	];
	/** @type {any[]} */
	const edges = [
		{ from: 0, to: 1, handle: 'pulse' },
		{ from: 1, to: 2, handle: 'damage' },
		{ from: 3, to: 1, handle: 'reset' }
	];
	if (spec.uuid) {
		nodes.push({ type: 'objectselector', x: x0 + 3 * COL, y, data: { selected: spec.uuid } });
		edges.push({ from: 4, to: 2, handle: 'target' });
	}
	return { nodes, edges };
}
