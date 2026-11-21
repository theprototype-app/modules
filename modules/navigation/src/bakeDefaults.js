// navigation — the bake settings (a leaf: the main bundle reads them without pulling recast in).

/** bake settings an author can change (the Navmesh node), with their clamps */
export const BAKE_DEFAULTS = Object.freeze({
	/** voxel size across, m — smaller = finer mesh, slower bake */
	cell: 0.2,
	/** voxel height, m */
	cellHeight: 0.15,
	/** the widest NPC, m: the mesh keeps this far from walls */
	radius: 0.4,
	/** the tallest NPC, m: ceilings lower than this are not walkable */
	height: 1.8,
	/** the highest step an NPC walks up, m */
	climb: 0.45,
	/** the steepest slope, degrees */
	slope: 45
});

/** @type {Record<string, number[]>} */
const CLAMP = {
	cell: [0.08, 1],
	cellHeight: [0.05, 0.5],
	radius: [0.1, 2],
	height: [0.4, 4],
	climb: [0, 2],
	slope: [5, 70]
};

/** @param {any} raw @returns {typeof BAKE_DEFAULTS} */
export function normalizeBake(raw) {
	/** @type {any} */
	const out = { ...BAKE_DEFAULTS };
	for (const k of Object.keys(BAKE_DEFAULTS)) {
		const v = Number(raw?.[k]);
		if (Number.isFinite(v)) out[k] = Math.min(CLAMP[k][1], Math.max(CLAMP[k][0], v));
	}
	return out;
}

