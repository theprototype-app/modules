// The PURE rules — no THREE, no DOM, no api (node-tested in test/rules.test.mjs).
// game.js applies them to replicated state; the value node reads through them.

export const DEFAULT_RULES = {
	gemShare: 0.7,
	pickupRadius: 0.9,
	allPlayersPortal: true,
	disableFlight: true
};

export const DEFAULT_MENU = {
	show: 'auto',
	button1: 'join-p1',
	button2: 'join-p2',
	button3: 'start',
	button4: 'new-dungeon'
};

/** gems needed to unseal, from the floor's total and the share rule
 * @param {number} total @param {number} collected @param {number} gemShare */
export function gemTotals(total, collected, gemShare) {
	if (!total) return { total: 0, need: 0, have: 0 };
	const share = Math.min(1, Math.max(0.05, Number(gemShare) || 0));
	const need = Math.max(1, Math.ceil(total * share));
	return { total, need, have: Math.min(collected, total) };
}

/** @param {{won: boolean, sealed: boolean, need: number, have: number, topFloor: boolean, allPlayersPortal: boolean, players: number}} s */
export function objectiveText(s) {
	if (s.won) return 'Victory! Press Esc to leave play mode.';
	const missing = Math.max(0, s.need - s.have);
	if (s.sealed)
		return 'Collect ' + missing + ' more gem' + (missing === 1 ? '' : 's') + (s.topFloor ? ' to claim the dragon’s hoard' : ' to unseal the portal');
	if (s.topFloor) return 'The hoard is yours!';
	return s.allPlayersPortal && s.players > 1 ? 'Portal unsealed — stand on it together!' : 'Portal unsealed — step through!';
}

/**
 * The world-space MARKERS Realms puts on the play minimap: uncollected gems and the
 * floor's portals. @param {any} play the Kit's userData.play @param {Set<number>} collected
 */
export function minimapMarkers(play, collected) {
	if (!play) return [];
	const out = [];
	for (const p of play.props ?? []) if (p.kind === 'gem' && !collected.has(p.index)) out.push({ x: p.wx, z: p.wz, kind: 'gem' });
	for (const p of play.portals ?? []) out.push({ x: p.wx, z: p.wz, kind: 'door' });
	return out;
}

/**
 * Travel-together: every OTHER slotted peer stands on the portal (or the rule is off).
 * @param {Record<string, {peerId: string} | null>} slots @param {Record<string, boolean>} onPortal
 * @param {string} me @param {boolean} allPlayersPortal
 */
export function canTravelTogether(slots, onPortal, me, allPlayersPortal) {
	if (!allPlayersPortal) return true;
	const others = Object.values(slots)
		.map((slot) => slot?.peerId)
		.filter((peerId) => peerId && peerId !== me);
	return others.every((peerId) => !!onPortal[peerId]);
}
