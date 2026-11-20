// Test geometry helpers: boxes as world triangles (the shape api.colliderGeometry hands a bake).
export function boxTris(min, max, pos, idx) {
	const base = pos.length / 3;
	const [nx, ny, nz] = min;
	const [xx, xy, xz] = max;
	pos.push(nx, ny, nz, xx, ny, nz, xx, ny, xz, nx, ny, xz, nx, xy, nz, xx, xy, nz, xx, xy, xz, nx, xy, xz);
	const f = [4, 7, 6, 4, 6, 5, 0, 1, 2, 0, 2, 3, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
	for (const k of f) idx.push(base + k);
}
/** a 20 x 20 floor (top at y 0) with a wall across x = 0 from z = -10 to z = gapAt, a 2 m gap, then the rest */
export function arena({ gap = true, size = 10 } = {}) {
	const pos = [];
	const idx = [];
	boxTris([-size, -0.2, -size], [size, 0, size], pos, idx);
	if (gap) {
		boxTris([-0.25, 0, -size], [0.25, 2.5, 4], pos, idx);
		boxTris([-0.25, 0, 6], [0.25, 2.5, size], pos, idx);
	} else boxTris([-0.25, 0, -size], [0.25, 2.5, size], pos, idx);
	// a raised block nobody can climb (a roof at y 3)
	boxTris([-8, 0, -8], [-6, 3, -6], pos, idx);
	return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
