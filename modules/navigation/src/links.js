// navigation — JUMP AND CLIMB (roadmap 92 row 5). Runs in the bake worker with navCore.js.
//
// THE GROUND. A TileCache navmesh has no detail mesh: a polygon's height is a plane through its
// corners, so a polygon that spans a step (rises up to `climb`) puts the NPC inside the step, and a
// flat floor sits a voxel (~0.1 m) above the real one. `TriGrid` holds the bake's own triangles in an
// xz grid; `groundAt` drops a ray from just above the navmesh height and the NPC stands on what it hits.
//
// THE LINKS. With `ledge` (max climb-up, m) or `jump` (max gap, m) above 0, after the first bake we
// walk the navmesh's boundary edges (a triangle edge no other triangle shares), probe outward along
// each edge's normal and look for walkable ground:
//   a JUMP   at about the same height (within `climb`) no further than jump + 2 x radius away
//            (the mesh is eroded by the radius on both lips, so the PHYSICAL gap is the mesh gap - 2r)
//   a CLIMB  higher by more than `climb` and at most `ledge`, within 2 x radius + a margin
// A candidate is kept only if the body clears it (rays along the arc at the feet and the head miss
// every triangle — so a link never goes THROUGH a wall or a fence), if the two ends are not already
// joined by a short walk, and if no kept link already joins the same spots (spacing). Kept links
// become Detour off-mesh connections (bidirectional: a climb is also the drop back down) and every
// tile is rebuilt from the tile cache with them (navCore.js; no second rasterisation). Capped at
// MAX_LINKS; the probes are budgeted, so a huge scene stops looking, it never hangs a bake. With
// ledge = jump = 0 nothing here runs and the bake is the one it always was, byte for byte. The
// settings are the BAKE's (one navmesh serves every NPC), not per NPC.
//
// THE TRAVERSAL. Detour moves an agent over a link in a straight line (start → end, both on the
// mesh). `linkPose` turns that into what the NPC shows: a JUMP keeps Detour's xz and lifts y on a
// parabola between the two ground heights; a CLIMB rises straight up at the foot of the ledge, then
// steps onto the top (a drop is the reverse: step off, then fall). Between links the NPC stands on
// the ground (groundAt), so it never floats and never sinks into a step.

const d3 = (/** @type {number[]} */ a, /** @type {number[]} */ b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dxz = (/** @type {number[]} */ a, /** @type {number[]} */ b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

export const MAX_LINKS = 256;
/** findClosestPoint calls one link search may spend (a big scene stops looking; it never stalls) */
export const PROBE_BUDGET = 120000;

/** the triangles of the bake in an xz grid, for rays (link clearance) and the ground under an NPC */
export class TriGrid {
	/** @param {Float32Array} positions @param {Uint32Array} indices */
	constructor(positions, indices) {
		this.p = positions;
		this.ix = indices;
		const n = (this.n = indices.length / 3);
		let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
		for (let i = 0; i < positions.length; i += 3) {
			const x = positions[i], z = positions[i + 2];
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (z < minZ) minZ = z;
			if (z > maxZ) maxZ = z;
		}
		if (!n) {
			minX = minZ = maxX = maxZ = 0;
		}
		this.minX = minX;
		this.minZ = minZ;
		// 1 m cells, coarser when the scene is huge or its triangles would fill too many cells
		let cell = 1;
		let gw = 0, gh = 0, total = 0;
		for (;;) {
			gw = this.gw = Math.floor((maxX - minX) / cell) + 1;
			gh = this.gh = Math.floor((maxZ - minZ) / cell) + 1;
			if (gw * gh > 2e6 && cell < 4096) {
				cell *= 2;
				continue;
			}
			total = 0;
			for (let t = 0; t < n; t++) {
				const [x0, z0, x1, z1] = this.#cells(t, cell);
				total += (x1 - x0 + 1) * (z1 - z0 + 1);
			}
			if (total > 3e6 && cell < 4096) {
				cell *= 2;
				continue;
			}
			break;
		}
		this.cell = cell;
		this.gw = gw;
		this.gh = gh;
		const start = new Uint32Array(gw * gh + 1);
		for (let t = 0; t < n; t++) {
			const [x0, z0, x1, z1] = this.#cells(t, cell);
			for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) start[cz * gw + cx + 1]++;
		}
		for (let i = 1; i < start.length; i++) start[i] += start[i - 1];
		const fill = start.slice(0, gw * gh);
		const items = new Uint32Array(total);
		for (let t = 0; t < n; t++) {
			const [x0, z0, x1, z1] = this.#cells(t, cell);
			for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) items[fill[cz * gw + cx]++] = t;
		}
		this.start = start;
		this.items = items;
		this.stamp = new Uint32Array(n);
		this.query = 0;
	}

	/** the cell range a triangle's xz box covers @param {number} t @param {number} cell */
	#cells(t, cell) {
		const p = this.p, ix = this.ix;
		const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3;
		const lx = Math.min(p[a], p[b], p[c]), hx = Math.max(p[a], p[b], p[c]);
		const lz = Math.min(p[a + 2], p[b + 2], p[c + 2]), hz = Math.max(p[a + 2], p[b + 2], p[c + 2]);
		return [this.#cx(lx, cell), this.#cz(lz, cell), this.#cx(hx, cell), this.#cz(hz, cell)];
	}
	#cx(/** @type {number} */ x, cell = this.cell) {
		return Math.max(0, Math.min(this.gw - 1, Math.floor((x - this.minX) / cell)));
	}
	#cz(/** @type {number} */ z, cell = this.cell) {
		return Math.max(0, Math.min(this.gh - 1, Math.floor((z - this.minZ) / cell)));
	}

	/** the first hit along a → b as a fraction 0..1, or -1 (two-sided Möller–Trumbore)
	 * @param {number[]} a @param {number[]} b */
	ray(a, b) {
		if (!this.n) return -1;
		const q = ++this.query;
		if (q >= 0xffffffff) {
			this.stamp.fill(0);
			this.query = 1;
		}
		const p = this.p, ix = this.ix;
		const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
		const x0 = this.#cx(Math.min(a[0], b[0])), x1 = this.#cx(Math.max(a[0], b[0]));
		const z0 = this.#cz(Math.min(a[2], b[2])), z1 = this.#cz(Math.max(a[2], b[2]));
		let best = -1;
		for (let cz = z0; cz <= z1; cz++) {
			for (let cx = x0; cx <= x1; cx++) {
				const c = cz * this.gw + cx;
				for (let k = this.start[c]; k < this.start[c + 1]; k++) {
					const t = this.items[k];
					if (this.stamp[t] === this.query) continue;
					this.stamp[t] = this.query;
					const i0 = ix[t * 3] * 3, i1 = ix[t * 3 + 1] * 3, i2 = ix[t * 3 + 2] * 3;
					const e1x = p[i1] - p[i0], e1y = p[i1 + 1] - p[i0 + 1], e1z = p[i1 + 2] - p[i0 + 2];
					const e2x = p[i2] - p[i0], e2y = p[i2 + 1] - p[i0 + 1], e2z = p[i2 + 2] - p[i0 + 2];
					const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
					const det = e1x * hx + e1y * hy + e1z * hz;
					if (Math.abs(det) < 1e-12) continue;
					const inv = 1 / det;
					const sx = a[0] - p[i0], sy = a[1] - p[i0 + 1], sz = a[2] - p[i0 + 2];
					const u = (sx * hx + sy * hy + sz * hz) * inv;
					if (u < 0 || u > 1) continue;
					const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
					const v = (dx * qx + dy * qy + dz * qz) * inv;
					if (v < 0 || u + v > 1) continue;
					const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
					if (tt >= 0 && tt <= 1 && (best < 0 || tt < best)) best = tt;
				}
			}
		}
		return best;
	}

	/** the first surface straight down from `top` to `bottom` at (x, z), or null */
	groundAt(/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ top, /** @type {number} */ bottom) {
		const t = this.ray([x, top, z], [x, bottom, z]);
		return t < 0 ? null : top + (bottom - top) * t;
	}
}

/** the triangle edges no other triangle shares, with a point inside (the third vertex)
 * @param {Float32Array} p @param {Uint32Array} ix */
export function boundaryEdges(p, ix) {
	/** @type {Map<string, number>} */
	const ids = new Map();
	const vid = (/** @type {number} */ i) => {
		const key = Math.round(p[i * 3] * 1000) + ',' + Math.round(p[i * 3 + 1] * 1000) + ',' + Math.round(p[i * 3 + 2] * 1000);
		let id = ids.get(key);
		if (id === undefined) ids.set(key, (id = ids.size));
		return id;
	};
	/** @type {Map<string, {n: number, a: number, b: number, c: number}>} */
	const edges = new Map();
	for (let t = 0; t + 2 < ix.length; t += 3) {
		const v = [ix[t], ix[t + 1], ix[t + 2]];
		const id = v.map(vid);
		for (let e = 0; e < 3; e++) {
			const i = id[e], j = id[(e + 1) % 3];
			const key = i < j ? i + '_' + j : j + '_' + i;
			const held = edges.get(key);
			if (held) held.n++;
			else edges.set(key, { n: 1, a: v[e], b: v[(e + 1) % 3], c: v[(e + 2) % 3] });
		}
	}
	const at = (/** @type {number} */ i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
	const out = [];
	for (const e of edges.values()) if (e.n === 1) out.push({ a: at(e.a), b: at(e.b), inside: at(e.c) });
	return out;
}

/** a link: ends a, b (navmesh points), their GROUND heights, the kind, a jump's apex (m above the
 * straight line), a climb's foot (where it rises / lands at the low end, xz on the ground)
 * @typedef {{a: number[], b: number[], ya: number, yb: number, kind: 'jump' | 'climb', apex: number, foot: number[] | null}} Link */

/** the jump's apex above the straight line between its ends, m @param {number} len */
export const jumpApex = (len) => Math.min(1.2, 0.3 + 0.15 * len);

/**
 * Find the links a bake's settings allow (see the header).
 * @param {{closest: (p: number[], half?: number[]) => {point: number[]} | null, shortWalk: (a: number[], b: number[], limit: number) => boolean, debugMesh: () => {positions: Float32Array, indices: Uint32Array}}} world
 * @param {TriGrid} grid
 * @param {{cell: number, radius: number, height: number, climb: number, ledge: number, jump: number}} s
 * @returns {{links: Link[], probes: number, candidates: number}}
 */
export function findLinks(world, grid, s) {
	/** @type {Link[]} */
	const links = [];
	const wantJump = s.jump > 0;
	const wantLedge = s.ledge > s.climb;
	if (!wantJump && !wantLedge) return { links, probes: 0, candidates: 0 };
	const { positions, indices } = world.debugMesh();
	const edges = boundaryEdges(positions, indices);
	const r = s.radius;
	const cs = s.cell;
	const step = Math.max(0.1, cs);
	const reachJump = wantJump ? s.jump + 2 * r + step : 0;
	const reachLedge = wantLedge ? 2 * r + 3 * step + 0.2 : 0;
	const maxS = Math.max(reachJump, reachLedge);
	const spacing = Math.max(1.2, 3 * r);
	const yTol = Math.max(0.1, s.climb);
	let probes = 0;
	let candidates = 0;
	const inside = (/** @type {number[]} */ at, /** @type {number} */ y, /** @type {number} */ halfY) => {
		probes++;
		const c = world.closest([at[0], y, at[2]], [step * 0.25, halfY, step * 0.25]);
		return c && dxz(c.point, at) < 0.03 ? c.point : null;
	};
	const ground = (/** @type {number[]} */ q) => grid.groundAt(q[0], q[2], q[1] + s.climb + 0.1, q[1] - s.climb - 0.3) ?? q[1];
	// the kept links' ends in a spacing-sized xz hash: "is a link already here?" without a scan
	/** @type {Map<string, any[]>} */
	const hash = new Map();
	const hkey = (/** @type {number} */ x, /** @type {number} */ z) => Math.floor(x / spacing) + ',' + Math.floor(z / spacing);
	const around = (/** @type {number[]} */ p) => {
		const out = [];
		const cx = Math.floor(p[0] / spacing), cz = Math.floor(p[2] / spacing);
		for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const L of hash.get(cx + i + ',' + (cz + j)) ?? []) out.push(L);
		return out;
	};
	const keep = (/** @type {any} */ L) => {
		links.push(L);
		for (const p of [L.a, L.b]) {
			const k = hkey(p[0], p[2]);
			const list = hash.get(k);
			if (list) list.push(L);
			else hash.set(k, [L]);
		}
	};
	const taken = (/** @type {number[]} */ a, /** @type {number[]} */ b) =>
		around(a).some((L) => (d3(L.a, a) < spacing && d3(L.b, b) < spacing) || (d3(L.a, b) < spacing && d3(L.b, a) < spacing));
	const nearStart = (/** @type {number[]} */ a) => around(a).some((L) => d3(L.a, a) < spacing * 0.5 || d3(L.b, a) < spacing * 0.5);
	/** does the body clear the way? rays at the feet (+0.25) and the head along the traversal */
	const clear = (/** @type {any} */ L) => {
		const feet = 0.25;
		const head = Math.max(feet + 0.1, s.height - 0.15);
		if (L.kind === 'jump') {
			const N = 6;
			for (const off of [feet, head]) {
				let prev = null;
				for (let i = 0; i <= N; i++) {
					const u = i / N;
					const pt = [L.a[0] + (L.b[0] - L.a[0]) * u, L.ya + (L.yb - L.ya) * u + L.apex * 4 * u * (1 - u) + off, L.a[2] + (L.b[2] - L.a[2]) * u];
					if (prev && grid.ray(prev, pt) >= 0) return false;
					prev = pt;
				}
			}
			return true;
		}
		// a climb from the low end up to the high end: up at the FOOT of the ledge, then across the top
		const lo = L.ya <= L.yb ? { p: L.a, y: L.ya } : { p: L.b, y: L.yb };
		const hi = L.ya <= L.yb ? { p: L.b, y: L.yb } : { p: L.a, y: L.ya };
		// the mesh lip can sit closer to the wall than the radius (contour simplification): rise a
		// little further out, so the body never scrapes into the ledge on the way up
		const dx = hi.p[0] - lo.p[0], dz = hi.p[2] - lo.p[2];
		const len = Math.hypot(dx, dz) || 1;
		const t = grid.ray([lo.p[0], lo.y + feet, lo.p[2]], [hi.p[0], lo.y + feet, hi.p[2]]);
		const wall = t < 0 ? len : t * len;
		let push = Math.max(0, r - wall);
		const back = [lo.p[0] - (dx / len) * push, lo.y + feet, lo.p[2] - (dz / len) * push];
		if (push > 0 && grid.ray([lo.p[0], lo.y + feet, lo.p[2]], back) >= 0) push = 0;
		L.foot = [lo.p[0] - (dx / len) * push, lo.y, lo.p[2] - (dz / len) * push];
		const f = L.foot;
		if (grid.ray([f[0], lo.y + feet, f[2]], [f[0], hi.y + head, f[2]]) >= 0) return false;
		for (const off of [feet, head]) if (grid.ray([f[0], hi.y + off, f[2]], [hi.p[0], hi.y + off, hi.p[2]]) >= 0) return false;
		return true;
	};
	outer: for (const e of edges) {
		const ex = e.b[0] - e.a[0], ez = e.b[2] - e.a[2];
		const len = Math.hypot(ex, ez);
		if (len < 1e-3) continue;
		// the outward normal (away from the triangle's own third vertex)
		let nx = ez / len, nz = -ex / len;
		const mx = (e.a[0] + e.b[0]) / 2, mz = (e.a[2] + e.b[2]) / 2;
		if ((e.inside[0] - mx) * nx + (e.inside[2] - mz) * nz > 0) {
			nx = -nx;
			nz = -nz;
		}
		const samples = Math.max(1, Math.round(len / 0.5));
		for (let k = 0; k < samples; k++) {
			if (links.length >= MAX_LINKS || probes >= PROBE_BUDGET) break outer;
			const u = (k + 0.5) / samples;
			const p = [e.a[0] + ex * u, e.a[1] + (e.b[1] - e.a[1]) * u, e.a[2] + ez * u];
			if (nearStart(p)) continue;
			/** @type {any} */
			let found = null;
			for (let d = step; d <= maxS + 1e-6; d += step) {
				const at = [p[0] + nx * d, p[1], p[2] + nz * d];
				const same = inside(at, p[1], yTol);
				if (same) {
					if (d <= step + 1e-6) break; // the mesh goes on: a seam between tiles, not an edge
					if (!wantJump) break;
					// the PHYSICAL gap, from the triangles (the mesh lips sit a radius back, give or take a
					// voxel): 5 cm steps along the normal, from the last ground to the next
					const y = ground(p);
					const solid = (/** @type {number} */ t) => grid.groundAt(p[0] + nx * t, p[2] + nz * t, y + yTol, y - yTol) !== null;
					let edge = -1, far = -1;
					for (let t = 0; t <= d + 1e-6; t += 0.05) {
						const g = solid(t);
						if (!g && edge < 0) edge = t;
						if (g && edge >= 0) {
							far = t;
							break;
						}
					}
					if (edge < 0 || far < 0 || far - edge > s.jump + 0.05) break;
					const deeper = inside([at[0] + nx * step, 0, at[2] + nz * step], same[1], yTol);
					found = { b: deeper ?? same, kind: 'jump' };
					break;
				}
				if (wantLedge && d <= reachLedge) {
					const halfY = (s.ledge - s.climb) / 2 + 0.1;
					const up = inside(at, p[1] + s.climb + halfY - 0.05, halfY);
					if (up && up[1] - p[1] > s.climb * 0.5) {
						const deeper = inside([at[0] + nx * step, 0, at[2] + nz * step], up[1], 0.2);
						found = { b: deeper ?? up, kind: 'climb' };
						break;
					}
				}
			}
			if (!found) continue;
			candidates++;
			const ya = ground(p);
			const yb = ground(found.b);
			const rise = yb - ya;
			if (found.kind === 'climb' && (rise <= s.climb * 0.5 || rise > s.ledge + 0.05)) continue;
			if (found.kind === 'jump' && Math.abs(rise) > yTol + 0.05) continue;
			if (taken(p, found.b)) continue;
			/** @type {any} */
			const L = { a: p, b: found.b, ya, yb, kind: found.kind, apex: found.kind === 'jump' ? jumpApex(dxz(p, found.b)) : 0, foot: null };
			if (!clear(L)) continue;
			// already a short walk between the two? (a seam, a corner, a ramp next to the ledge)
			if (world.shortWalk(p, found.b, 2 * d3(p, found.b) + 2)) continue;
			keep(L);
		}
	}
	return { links, probes, candidates };
}

/**
 * Where an NPC on a link shows. `u` is Detour's progress (0 at the start, 1 at the end), `from` the
 * end it set off from ('a' or 'b'), `pos` Detour's own (straight-line) position.
 * @param {Link} L @param {'a' | 'b'} from @param {number} u @param {number[]} pos
 */
export function linkPose(L, from, u, pos) {
	const S = from === 'a' ? L.a : L.b;
	const E = from === 'a' ? L.b : L.a;
	const y0 = from === 'a' ? L.ya : L.yb;
	const y1 = from === 'a' ? L.yb : L.ya;
	u = Math.max(0, Math.min(1, u));
	if (L.kind === 'jump') return [pos[0], y0 + (y1 - y0) * u + L.apex * 4 * u * (1 - u), pos[2]];
	const mix = (/** @type {number[]} */ p, /** @type {number[]} */ q, /** @type {number} */ f) => [p[0] + (q[0] - p[0]) * f, p[2] + (q[2] - p[2]) * f];
	// the low end's foot: where the body rises (or lands) clear of the ledge's face
	const foot = L.foot ?? (y1 >= y0 ? S : E);
	const seg = (/** @type {number} */ a, /** @type {number} */ b) => Math.max(0, Math.min(1, (u - a) / (b - a)));
	if (y1 >= y0) {
		// climb: back off to the foot (on the ground), rise straight up (ease out), step across the top
		if (u < 0.15) {
			const [x, z] = mix(S, foot, seg(0, 0.15));
			return [x, y0, z];
		}
		if (u < 0.55) {
			const f = seg(0.15, 0.55);
			return [foot[0], y0 + (y1 - y0) * (1 - (1 - f) * (1 - f)), foot[2]];
		}
		const [x, z] = mix(foot, E, seg(0.55, 1));
		return [x, y1, z];
	}
	// drop: step off the top to above the foot, fall straight down (accelerating), settle on the lip
	if (u < 0.4) {
		const [x, z] = mix(S, foot, seg(0, 0.4));
		return [x, y0, z];
	}
	if (u < 0.85) {
		const f = seg(0.4, 0.85);
		return [foot[0], y0 + (y1 - y0) * f * f, foot[2]];
	}
	const [x, z] = mix(foot, E, seg(0.85, 1));
	return [x, y1, z];
}
