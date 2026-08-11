// The shipped bestiary — pure DATA in the shape campaign.js consumes
// ({id, floors: [min, max], weight}). Spawn slots are typed from this table
// (seeded weighted pick); the slots stay data-only in this module (no combat),
// but the typing path and its validation are the spec's, so a future combat
// layer plugs straight in. Injected via generateCampaign's bestiaryTable param
// so gen stays pure (spec keeps the table in game code).

export const BESTIARY = [
	{ id: 'spider', floors: [1, 2], weight: 10 },
	{ id: 'bat', floors: [1, 3], weight: 8 },
	{ id: 'slime', floors: [2, 3], weight: 8 },
	{ id: 'skeleton', floors: [2, 4], weight: 9 },
	{ id: 'goblin', floors: [3, 4], weight: 8 },
	{ id: 'wraith', floors: [3, 5], weight: 6 },
	{ id: 'golem', floors: [4, 5], weight: 4 }
];
