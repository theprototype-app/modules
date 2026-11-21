// navigation — THE RECAST HALF (runs inside the bake worker; node tests drive it directly).
//
// One NavWorld = one baked navmesh (a recast TileCache, so moving props can stand in it as
// temporary obstacles), one Detour Crowd (the NPCs) and one NavMeshQuery (reachability).
// Everything is WORLD space metres, y up. Nothing here knows about three.js, the app or peers:
// the module's main half feeds it plain arrays and reads plain arrays back.
//
// G6 (unreachable) lives here: `reach(from, target)` says whether a target can be walked to, and
// when it cannot, WHY and the CLOSEST point it can reach:
//   'off mesh'  the target stands nowhere walkable (on a roof, in the air, inside a wall)
//   'blocked'   it is on the mesh but no path joins the two (a closed gap, an obstacle across a corridor)
//   'too far'   a path exists but is longer than the walker's limit
// The crowd is then sent to that closest point and STOPS there (no re-request every frame: the main
// half re-asks only when the target moves or a second passes), so an NPC never jitters in place.

import {
	init as recastInit,
	Crowd,
	NavMeshQuery,
	getNavMeshPositionsAndIndices
} from '@recast-navigation/core';
import { generateTileCache } from '@recast-navigation/generators';

import { BAKE_DEFAULTS, normalizeBake } from './bakeDefaults.js';
export { BAKE_DEFAULTS, normalizeBake };

/** the recast config a bake uses, in VOXELS where recast wants voxels @param {typeof BAKE_DEFAULTS} s */
export function recastConfig(s) {
	return {
		cs: s.cell,
		ch: s.cellHeight,
		walkableSlopeAngle: s.slope,
		walkableHeight: Math.max(1, Math.ceil(s.height / s.cellHeight)),
		walkableClimb: Math.max(0, Math.floor(s.climb / s.cellHeight)),
		walkableRadius: Math.max(0, Math.ceil(s.radius / s.cell)),
		maxSimplificationError: 1.3,
		tileSize: 48,
		expectedLayersPerTile: 4,
		maxObstacles: 128,
		maxVertsPerPoly: 6,
		detailSampleDist: 6,
		detailSampleMaxError: 1,
		mergeRegionArea: 20,
		borderSize: 0
	};
}

let ready = /** @type {Promise<void> | null} */ (null);
/** load the wasm once @param {(() => Promise<any>) | undefined} [factory] */
export function initRecast(factory) {
	if (!ready) ready = recastInit(factory);
	return ready;
}

const v3 = (/** @type {number[]} */ p) => ({ x: p[0], y: p[1], z: p[2] });
const arr = (/** @type {{x: number, y: number, z: number}} */ p) => [p.x, p.y, p.z];
const dxz = (/** @type {number[]} */ a, /** @type {number[]} */ b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** the length of a polyline @param {number[][]} pts */
export function pathLength(pts) {
	let n = 0;
	for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
	return n;
}

/** the point `dist` metres along a polyline @param {number[][]} pts @param {number} dist */
export function pointAlong(pts, dist) {
	let left = dist;
	for (let i = 1; i < pts.length; i++) {
		const a = pts[i - 1];
		const b = pts[i];
		const seg = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
		if (seg >= left && seg > 0) {
			const t = left / seg;
			return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
		}
		left -= seg;
	}
	return pts[pts.length - 1] ?? null;
}

export class NavWorld {
	/**
	 * @param {{positions: Float32Array | number[], indices: Uint32Array | number[], bake?: any, maxAgents?: number}} input
	 */
	constructor(input) {
		this.settings = normalizeBake(input.bake);
		const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
		const positions = input.positions instanceof Float32Array ? input.positions : new Float32Array(input.positions);
		const indices = input.indices instanceof Uint32Array ? input.indices : new Uint32Array(input.indices);
		this.inputTriangles = indices.length / 3;
		/** @type {any} */
		const res = generateTileCache(/** @type {any} */ (positions), /** @type {any} */ (indices), /** @type {any} */ (recastConfig(this.settings)));
		this.bakeMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
		this.ok = !!res.success;
		this.error = res.success ? '' : String(res.error ?? 'bake failed');
		this.tileCache = res.tileCache;
		this.navMesh = res.navMesh;
		this.maxAgents = Math.max(1, Math.min(256, input.maxAgents ?? 64));
		/** key -> {agent, goal, params} @type {Map<string, any>} */
		this.agents = new Map();
		/** key -> {ref, kind, pos, size} @type {Map<string, any>} */
		this.obstacles = new Map();
		this.dirtyTiles = false;
		if (!this.ok) return;
		this.query = new NavMeshQuery(this.navMesh);
		this.query.defaultQueryHalfExtents = { x: 1, y: 2, z: 1 };
		this.crowd = new Crowd(this.navMesh, { maxAgents: this.maxAgents, maxAgentRadius: Math.max(1, this.settings.radius * 2) });
	}

	/** walkable triangles for the overlay (world space) */
	debugMesh() {
		if (!this.ok) return { positions: new Float32Array(0), indices: new Uint32Array(0) };
		const [positions, indices] = getNavMeshPositionsAndIndices(this.navMesh);
		return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
	}

	/** the walkable area, m² (a cheap measure the tests and the caps read) */
	area() {
		const { positions: p, indices: ix } = this.debugMesh();
		let a = 0;
		for (let i = 0; i + 2 < ix.length; i += 3) {
			const ax = p[ix[i] * 3], az = p[ix[i] * 3 + 2];
			const bx = p[ix[i + 1] * 3], bz = p[ix[i + 1] * 3 + 2];
			const cx = p[ix[i + 2] * 3], cz = p[ix[i + 2] * 3 + 2];
			a += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
		}
		return a;
	}

	/** the closest walkable point to `p` within `half` m, or null @param {number[]} p @param {number[]} [half] */
	closest(p, half = [2, 4, 2]) {
		if (!this.ok) return null;
		const r = this.query.findClosestPoint(v3(p), { halfExtents: v3(half) });
		return r.success && r.polyRef ? { point: arr(r.point), ref: r.polyRef } : null;
	}

	/**
	 * Can `from` walk to `target`? (G6)
	 * @param {number[]} from @param {number[]} target @param {{maxPath?: number, offMesh?: number}} [opts]
	 * @returns {{ok: boolean, why: '' | 'off mesh' | 'blocked' | 'too far', goal: number[] | null, path: number[][], length: number}}
	 */
	reach(from, target, opts = {}) {
		const fail = (/** @type {any} */ why, /** @type {number[] | null} */ goal, /** @type {number[][]} */ path = []) => ({ ok: false, why, goal, path, length: pathLength(path) });
		if (!this.ok) return fail('off mesh', null);
		const start = this.closest(from, [2, 4, 2]);
		if (!start) return fail('off mesh', null);
		const tol = Math.max(0.6, opts.offMesh ?? this.settings.radius * 2.5);
		// a wide search first: where is the walkable ground nearest the target?
		const end = this.closest(target, [6, 6, 6]);
		if (!end) return fail('off mesh', start.point);
		let why = /** @type {'' | 'off mesh' | 'blocked' | 'too far'} */ ('');
		if (dxz(end.point, target) > tol || Math.abs(end.point[1] - target[1]) > this.settings.height + 0.5) why = 'off mesh';
		const fp = this.query.findPath(start.ref, end.ref, v3(start.point), v3(end.point), { maxPathPolys: 512 });
		if (!fp.success || fp.polys.size <= 0) {
			fp.polys?.destroy?.();
			return fail(why || 'blocked', start.point);
		}
		const lastRef = fp.polys.get(fp.polys.size - 1);
		const partial = lastRef !== end.ref;
		let goal = end.point;
		if (partial) {
			const c = this.query.closestPointOnPoly(lastRef, v3(end.point));
			goal = c.success ? arr(c.closestPoint) : start.point;
		}
		const sp = this.query.findStraightPath(v3(start.point), v3(goal), fp.polys, { maxStraightPathPoints: 128 });
		fp.polys.destroy();
		/** @type {number[][]} */
		const path = [];
		if (sp.success) for (let i = 0; i < sp.straightPathCount; i++) path.push([sp.straightPath.get(i * 3), sp.straightPath.get(i * 3 + 1), sp.straightPath.get(i * 3 + 2)]);
		sp.straightPath?.destroy?.();
		sp.straightPathFlags?.destroy?.();
		sp.straightPathRefs?.destroy?.();
		if (!path.length) path.push(start.point, goal);
		const length = pathLength(path);
		if (partial) return { ok: false, why: why || 'blocked', goal, path, length };
		const maxPath = opts.maxPath ?? Infinity;
		if (length > maxPath) {
			const g = pointAlong(path, maxPath);
			return { ok: false, why: why || 'too far', goal: g, path, length };
		}
		if (why) return { ok: false, why, goal, path, length };
		return { ok: true, why: '', goal, path, length };
	}

	/** a random walkable point within `radius` of `around` (Wander, Flee) — `rand` is the caller's
	 * seeded generator, so a test can pin it @param {number[]} around @param {number} radius */
	randomAround(around, radius) {
		if (!this.ok) return null;
		const start = this.closest(around);
		if (!start) return null;
		const r = this.query.findRandomPointAroundCircle(v3(start.point), radius, { startRef: start.ref });
		return r.success ? arr(r.randomPoint) : null;
	}

	// ---- the crowd ------------------------------------------------------------------------------

	/** make or update an agent @param {string} key @param {number[]} pos @param {{radius?: number, height?: number, speed?: number, accel?: number}} p */
	agent(key, pos, p = {}) {
		if (!this.ok) return null;
		const params = {
			radius: Math.max(0.1, Math.min(this.settings.radius * 2, p.radius ?? this.settings.radius)),
			height: p.height ?? this.settings.height,
			maxSpeed: Math.max(0.05, p.speed ?? 2),
			maxAcceleration: p.accel ?? 10,
			collisionQueryRange: (p.radius ?? this.settings.radius) * 12,
			pathOptimizationRange: (p.radius ?? this.settings.radius) * 30,
			separationWeight: 2
		};
		const held = this.agents.get(key);
		if (held) {
			const was = held.params;
			if (was.maxSpeed !== params.maxSpeed || was.radius !== params.radius || was.maxAcceleration !== params.maxAcceleration) {
				held.agent.updateParameters(params);
				held.params = params;
			}
			return held;
		}
		if (this.crowd.getAgentCount() >= this.maxAgents && this.agents.size >= this.maxAgents) return null;
		const at = this.closest(pos) ?? { point: pos };
		const agent = this.crowd.addAgent(v3(at.point), params);
		if (!agent) return null;
		const entry = { agent, goal: /** @type {number[] | null} */ (null), params };
		this.agents.set(key, entry);
		return entry;
	}

	/** @param {string} key */
	removeAgent(key) {
		const e = this.agents.get(key);
		if (!e) return;
		this.crowd.removeAgent(e.agent);
		this.agents.delete(key);
	}

	/** walk to a point (already resolved by `reach`), or stop (null) @param {string} key @param {number[] | null} goal */
	moveTo(key, goal) {
		const e = this.agents.get(key);
		if (!e) return false;
		if (!goal) {
			if (e.goal) e.agent.resetMoveTarget();
			e.goal = null;
			return true;
		}
		if (e.goal && Math.hypot(goal[0] - e.goal[0], goal[1] - e.goal[1], goal[2] - e.goal[2]) < 0.05) return true;
		e.goal = goal;
		return e.agent.requestMoveTarget(v3(goal));
	}

	/** put an agent somewhere (a respawn, a peer's correction) @param {string} key @param {number[]} pos */
	teleport(key, pos) {
		const e = this.agents.get(key);
		if (!e) return;
		const at = this.closest(pos) ?? { point: pos };
		e.agent.teleport(v3(at.point));
		e.goal = null;
	}

	// ---- temporary obstacles (moving props) ---------------------------------------------------

	/**
	 * Sync the obstacle set: every entry `{key, min, max}` (a world AABB). New ones are added, gone
	 * ones removed, one that moved more than 0.15 m (or resized) is re-added. Returns how many changed.
	 * @param {{key: string, min: number[], max: number[]}[]} list
	 */
	syncObstacles(list) {
		if (!this.ok) return 0;
		let changed = 0;
		const seen = new Set();
		for (const o of list) {
			seen.add(o.key);
			const c = [(o.min[0] + o.max[0]) / 2, o.min[1], (o.min[2] + o.max[2]) / 2];
			const half = [Math.max(0.05, (o.max[0] - o.min[0]) / 2), Math.max(0.05, (o.max[1] - o.min[1]) / 2), Math.max(0.05, (o.max[2] - o.min[2]) / 2)];
			const held = this.obstacles.get(o.key);
			if (held && Math.hypot(held.c[0] - c[0], held.c[1] - c[1], held.c[2] - c[2]) < 0.15 && Math.abs(held.half[0] - half[0]) < 0.05 && Math.abs(held.half[2] - half[2]) < 0.05) continue;
			if (held) this.tileCache.removeObstacle(held.ref);
			const r = this.tileCache.addBoxObstacle(v3([c[0], c[1] + half[1], c[2]]), v3(half), 0);
			if (r.success) this.obstacles.set(o.key, { ref: r.obstacle, c, half });
			else this.obstacles.delete(o.key);
			changed++;
		}
		for (const [key, held] of this.obstacles) {
			if (seen.has(key)) continue;
			this.tileCache.removeObstacle(held.ref);
			this.obstacles.delete(key);
			changed++;
		}
		if (changed) this.dirtyTiles = true;
		return changed;
	}

	/** step the crowd and rebuild any tiles an obstacle touched @param {number} dt */
	step(dt) {
		if (!this.ok) return { tilesChanged: false };
		let tilesChanged = false;
		if (this.dirtyTiles) {
			// a few passes per frame at most: a burst of obstacle edits finishes over the next frames
			for (let i = 0; i < 4; i++) {
				const u = this.tileCache.update(this.navMesh);
				tilesChanged = true;
				if (u.upToDate) {
					this.dirtyTiles = false;
					break;
				}
			}
		}
		// the REAL elapsed time, in substeps: a slow frame (a phone, a busy tab) must not slow the walk
		let left = Math.min(0.5, Math.max(0, dt));
		while (left > 1e-4) {
			const h = Math.min(1 / 30, left);
			this.crowd.update(h);
			left -= h;
		}
		return { tilesChanged };
	}

	/** every agent's live state @returns {{key: string, pos: number[], vel: number[], corners: number[][]}[]} */
	read() {
		const out = [];
		for (const [key, e] of this.agents) {
			out.push({ key, pos: arr(e.agent.position()), vel: arr(e.agent.velocity()), corners: e.goal ? e.agent.corners().map(arr) : [] });
		}
		return out;
	}

	destroy() {
		try {
			this.crowd?.destroy();
			this.query?.destroy();
			this.tileCache?.destroy();
			this.navMesh?.destroy();
		} catch {
			/* already gone */
		}
		this.ok = false;
	}
}
