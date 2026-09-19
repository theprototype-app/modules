// The pure rules — run WITHOUT the app.
import { gemTotals, objectiveText, minimapMarkers, canTravelTogether, DEFAULT_RULES } from '../src/rules.js';

export function run(check) {
	// gem share -> need
	check(JSON.stringify(gemTotals(10, 3, 0.7)) === JSON.stringify({ total: 10, need: 7, have: 3 }), 'gemTotals: 10 gems at .7 share need 7');
	check(gemTotals(3, 0, 0.05).need === 1, 'need is never below 1');
	check(gemTotals(0, 5, 0.7).need === 0 && gemTotals(0, 5, 0.7).have === 0, 'no gems -> nothing needed, nothing had');
	check(gemTotals(4, 9, 1).have === 4, 'have is capped at the total');
	check(gemTotals(10, 0, 5).need === 10, 'a share above 1 clamps to 1');
	check(gemTotals(10, 0, 0).need === 1 && gemTotals(10, 0, -3).need === 1, 'a zero or negative share still needs ONE gem (the portal can never be free)');
	// objective text
	const base = { won: false, sealed: true, need: 7, have: 5, topFloor: false, allPlayersPortal: true, players: 2 };
	check(objectiveText(base) === 'Collect 2 more gems to unseal the portal', 'objective: sealed, mid floor');
	check(objectiveText({ ...base, have: 6 }).startsWith('Collect 1 more gem to'), 'objective: singular gem');
	check(objectiveText({ ...base, topFloor: true }).endsWith('dragon’s hoard'), 'objective: sealed on the top floor names the hoard');
	check(objectiveText({ ...base, sealed: false }) === 'Portal unsealed — stand on it together!', 'objective: unsealed with two players says together');
	check(objectiveText({ ...base, sealed: false, players: 1 }) === 'Portal unsealed — step through!', 'objective: unsealed solo says step through');
	check(objectiveText({ ...base, sealed: false, allPlayersPortal: false }) === 'Portal unsealed — step through!', 'objective: rule off says step through');
	check(objectiveText({ ...base, won: true }).startsWith('Victory'), 'objective: won');
	// minimap markers from the Kit contract: uncollected gems + portals
	const play = {
		props: [{ kind: 'gem', index: 0, wx: 1, wz: 2 }, { kind: 'gem', index: 1, wx: 3, wz: 4 }, { kind: 'crate', wx: 9, wz: 9 }],
		portals: [{ kind: 'up', wx: 5, wz: 6 }]
	};
	const markers = minimapMarkers(play, new Set([0]));
	check(markers.length === 2 && markers[0].kind === 'gem' && markers[0].x === 3 && markers[1].kind === 'door' && markers[1].x === 5, 'markers: one uncollected gem + the portal, crates ignored');
	check(minimapMarkers(null, new Set()).length === 0, 'markers: no contract -> none');
	// travel together
	const slots = { p1: { peerId: 'a' }, p2: { peerId: 'b' } };
	check(canTravelTogether(slots, { a: true }, 'a', true) === false, 'together: the other player is not on the portal yet');
	check(canTravelTogether(slots, { a: true, b: true }, 'a', true) === true, 'together: both on the portal');
	check(canTravelTogether(slots, {}, 'a', false) === true, 'together: rule off travels alone');
	check(canTravelTogether({ p1: { peerId: 'a' }, p2: null }, {}, 'a', true) === true, 'together: a solo player travels');
	check(DEFAULT_RULES.disableFlight === true && DEFAULT_RULES.gemShare === 0.7, 'defaults: grounded by default, .7 share');
}
