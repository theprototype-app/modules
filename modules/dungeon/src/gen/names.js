// Stage 9 (part) — seeded dungeon names from syllable tables:
// "The Ashen Vaults of Vor'gul". Pure data, node-safe.

const ADJECTIVES = [
	'Ashen', 'Sunken', 'Howling', 'Gilded', 'Mossy', 'Broken', 'Silent',
	'Ember', 'Frozen', 'Obsidian', 'Weeping', 'Forgotten', 'Crimson',
	'Hollow', 'Shattered', 'Verdant', 'Rusted', 'Pale', 'Umbral', 'Thorned'
];

const PLACES = [
	'Vaults', 'Halls', 'Depths', 'Catacombs', 'Warrens', 'Chambers',
	'Galleries', 'Crypts', 'Cisterns', 'Foundry', 'Reliquary', 'Barrows',
	'Passages', 'Sanctum', 'Undercroft', 'Mines', 'Roost', 'Maze'
];

const SYL_A = ['Vor', 'Mal', 'Kar', 'Thu', 'Gor', 'Zan', 'Bel', 'Dra', 'Ny', 'Ul', 'Sha', 'Mor'];
const SYL_B = ['gul', 'thak', 'ric', 'mash', 'dun', 'zir', 'goth', 'ral', 'ssk', 'bar', 'nox', 'vek'];

/** @param {import('./types').Rng} rng */
export function dungeonName(rng) {
	const adjective = rng.pick(ADJECTIVES);
	const place = rng.pick(PLACES);
	if (rng.chance(0.6)) {
		const owner = rng.pick(SYL_A) + (rng.chance(0.5) ? "'" : '') + rng.pick(SYL_B);
		return 'The ' + adjective + ' ' + place + ' of ' + owner;
	}
	return 'The ' + adjective + ' ' + place;
}
