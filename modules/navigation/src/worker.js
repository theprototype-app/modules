// navigation — THE BAKE WORKER (bundled to assets/nav-worker.js, a classic worker started from a blob).
// Holds the ONE NavWorld (navCore.js): bakes, steps the crowd, answers reach / random-point queries.
// Every message is {id, op, ...}; every reply {id, ok, ...} (the client matches them by id).
import Factory from '@recast-navigation/wasm';
import { initRecast, NavWorld } from './navCore.js';

/** @type {NavWorld | null} */
let world = null;

/** @param {any} msg */
async function handle(msg) {
	switch (msg.op) {
		case 'init': {
			const wasmUrl = String(msg.wasmUrl ?? '');
			await initRecast(() => Factory({ locateFile: () => wasmUrl }));
			return {};
		}
		case 'bake': {
			world?.destroy();
			world = new NavWorld({ positions: msg.positions, indices: msg.indices, bake: msg.bake, maxAgents: msg.maxAgents });
			if (!world.ok) return { baked: false, error: world.error, ms: world.bakeMs };
			const dbg = world.debugMesh();
			return {
				baked: true,
				ms: world.bakeMs,
				links: world.links.length,
				linkMs: world.linkMs,
				triangles: world.inputTriangles,
				area: world.area(),
				debug: dbg,
				settings: world.settings,
				transfer: [dbg.positions.buffer, dbg.indices.buffer]
			};
		}
		case 'step': {
			if (!world?.ok) return { agents: [], tilesChanged: false };
			// agents: [{key, pos, speed, radius, goal | null, teleport?}] — added / updated / removed to match
			const keep = new Set();
			for (const a of msg.agents ?? []) {
				keep.add(a.key);
				const fresh = !world.agents.has(a.key);
				const e = world.agent(a.key, a.pos, { speed: a.speed, radius: a.radius });
				if (!e) continue;
				if (a.teleport && !fresh) world.teleport(a.key, a.pos);
				world.moveTo(a.key, a.goal ?? null);
			}
			for (const key of [...world.agents.keys()]) if (!keep.has(key)) world.removeAgent(key);
			if (msg.obstacles) world.syncObstacles(msg.obstacles);
			const t0 = performance.now();
			const { tilesChanged } = world.step(msg.dt ?? 1 / 30);
			/** @type {any} */
			const out = { agents: world.read(), tilesChanged, full: world.agents.size >= world.maxAgents };
			// the worker's own cost (step + read): a reply can wait on a busy main thread, so round trips overstate it
			out.stepMs = performance.now() - t0;
			// players' FEET: a camera or an avatar head snapped down to the walkable ground under it
			if (msg.probe) out.probes = msg.probe.map((/** @type {any} */ q) => ({ key: q.key, point: world.closest(q.p, [1, 2.5, 1])?.point ?? null }));
			if (tilesChanged && msg.wantDebug) {
				out.debug = world.debugMesh();
				out.transfer = [out.debug.positions.buffer, out.debug.indices.buffer];
			}
			return out;
		}
		case 'reach': {
			// many at once: [{key, from, target, maxPath}]
			if (!world?.ok) return { results: (msg.list ?? []).map((/** @type {any} */ q) => ({ key: q.key, ok: false, why: 'off mesh', goal: null, path: [] })) };
			return { results: (msg.list ?? []).map((/** @type {any} */ q) => ({ key: q.key, ...world.reach(q.from, q.target, { maxPath: q.maxPath }) })) };
		}
		case 'random': {
			if (!world?.ok) return { points: [] };
			return { points: (msg.list ?? []).map((/** @type {any} */ q) => ({ key: q.key, point: world.randomAround(q.around, q.radius) })) };
		}
		case 'closest': {
			if (!world?.ok) return { points: [] };
			return { points: (msg.list ?? []).map((/** @type {any} */ q) => ({ key: q.key, point: world.closest(q.p, q.half)?.point ?? null })) };
		}
		case 'drop': {
			world?.destroy();
			world = null;
			return {};
		}
		default:
			throw new Error('unknown op ' + msg.op);
	}
}

self.onmessage = async (event) => {
	const msg = event.data ?? {};
	try {
		const out = await handle(msg);
		const transfer = out?.transfer ?? [];
		if (out) delete out.transfer;
		self.postMessage({ id: msg.id, ok: true, ...out }, transfer);
	} catch (error) {
		self.postMessage({ id: msg.id, ok: false, error: error instanceof Error ? error.message : String(error) });
	}
};
