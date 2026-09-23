// Pure rules — run WITHOUT the app. Every rule is proven with its COUNTERFACTUAL: the
// same call with one input flipped must give the other answer, or the test is only
// checking that a constant is a constant.
import {
	normalizeRules, DEFAULT_RULES, emptySlots, teamOf, canJoin, applySlot, freeVanished, swapSlots,
	attributeGoal, applyGoal, matchOutcome, secondsLeft, serveDirection, serveImpulse,
	matchLogEntry, appendMatchLog, scoreLine, hash32,
	balancedTeam, goldenGoal, matchPhase, countdownNumber, startKickTeam, kickoffImpulse, playedSeconds, bannerScore, CELEBRATE_SECONDS, teamSpawn
} from '../src/rules.js';

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	// ---- normalize ----
	const n = normalizeRules({ mode: 'duel', goalsToWin: 99, matchSeconds: 1, serveDelay: 'x', bogus: 1 });
	check(n.mode === 'duel' && n.goalsToWin === 20 && n.matchSeconds === 30 && n.serveDelay === DEFAULT_RULES.serveDelay && !('bogus' in n), 'normalizeRules clamps ranges, keeps a valid select, drops unknown fields');
	check(normalizeRules({ mode: 'nope' }).mode === DEFAULT_RULES.mode, '  counterfactual: an unknown mode falls back to the default');

	// ---- slots ----
	let slots = emptySlots();
	slots = applySlot(slots, 'red', 'A');
	slots = applySlot(slots, 'blue', 'B');
	check(teamOf(slots, 'A') === 'red' && teamOf(slots, 'B') === 'blue' && teamOf(slots, 'C') === null, 'applySlot seats A red, B blue; an unslotted peer has no team');
	const moved = applySlot(slots, 'blue', 'A');
	check(teamOf(moved, 'A') === 'blue' && !moved.red.includes('A'), 'joining the other team leaves the first (one seat per peer)');
	const spectating = applySlot(slots, 'none', 'A');
	check(teamOf(spectating, 'A') === null && spectating.blue.includes('B'), "'none' frees the seat and touches nobody else");
	check(canJoin(slots, 'red', 'C', 'duel').ok === false, 'duel refuses a second red');
	check(canJoin(slots, 'red', 'C', 'teams').ok === true, '  counterfactual: teams mode takes a second red');
	check(canJoin(slots, 'red', 'A', 'duel').ok === true, '  counterfactual: the peer already in the seat may "join" it again');
	check(canJoin(slots, 'none', 'C', 'duel').ok === true, '  spectating is always allowed');
	const { slots: pruned, freed } = freeVanished(slots, ['A']);
	check(freed.length === 1 && freed[0] === 'B' && pruned.blue.length === 0 && pruned.red.includes('A'), 'freeVanished drops the disconnected peer and keeps the live one');
	check(freeVanished(slots, ['A', 'B']).freed.length === 0, '  counterfactual: everyone live, nothing freed');
	const swapped = swapSlots(slots);
	check(teamOf(swapped, 'A') === 'blue' && teamOf(swapped, 'B') === 'red', 'swapSlots trades ends');

	// ---- attribution: ball into the RED gate ----
	const base = { gateTeam: 'red', slots, mode: 'teams', ownGoals: 'count' };
	const goal = attributeGoal({ ...base, lastTouch: { by: 'B', team: 'blue', at: 1 } });
	check(goal.team === 'blue' && goal.by === 'B' && goal.own === false && goal.counts && goal.credit === 'goals', "an attacker's last touch: goal for blue, on B's goals row");
	const own = attributeGoal({ ...base, lastTouch: { by: 'A', team: 'red', at: 1 } });
	check(own.team === 'blue' && own.by === 'A' && own.own === true && own.counts && own.credit === 'owngoals', "  counterfactual: the defender's last touch: still blue's goal, on A's OWN GOALS row");
	const ignored = attributeGoal({ ...base, ownGoals: 'ignore', lastTouch: { by: 'A', team: 'red', at: 1 } });
	check(ignored.counts === false && ignored.own === true, "  counterfactual: ownGoals 'ignore' — the own goal does not count");
	const nobody = attributeGoal({ ...base, lastTouch: null });
	check(nobody.team === 'blue' && nobody.by === null && nobody.counts && nobody.credit === null, 'no touch at all: blue scores, nobody is credited');
	const spectator = attributeGoal({ ...base, lastTouch: { by: 'C', team: null, at: 1 } });
	check(spectator.team === 'blue' && spectator.by === null && spectator.counts, "a spectator's touch counts for the attackers and credits nobody");
	const stale = attributeGoal({ ...base, slots: swapped, lastTouch: { by: 'B', team: 'blue', at: 1 } });
	check(stale.own === true && stale.by === 'B', '  the toucher\'s team is read from the slots at GOAL time (B swapped to red -> own goal)');
	const practice = attributeGoal({ ...base, mode: 'practice', lastTouch: { by: 'B', team: 'blue', at: 1 } });
	check(practice.counts === false, 'practice scores nothing');
	const ffa = attributeGoal({ ...base, mode: 'freeforall', lastTouch: { by: 'A', team: 'red', at: 1 } });
	check(ffa.team === null && ffa.by === 'A' && ffa.counts && ffa.credit === 'goals' && ffa.own === false, 'free for all: whoever touched it last scores, whichever gate');
	check(attributeGoal({ ...base, mode: 'freeforall', lastTouch: null }).counts === false, '  counterfactual: free for all with no touch scores nobody');
	const blueGate = attributeGoal({ ...base, gateTeam: 'blue', lastTouch: { by: 'A', team: 'red', at: 1 } });
	check(blueGate.team === 'red' && blueGate.credit === 'goals', '  counterfactual: the same touch into the BLUE gate is a red goal');

	// ---- score ----
	const s1 = applyGoal({ red: 0, blue: 0 }, goal);
	check(s1.blue === 1 && s1.red === 0, 'applyGoal bumps the scoring team');
	check(applyGoal({ red: 0, blue: 0 }, ignored).blue === 0, '  counterfactual: an ignored goal leaves the score alone');

	// ---- outcome ----
	const r5 = { ...DEFAULT_RULES, goalsToWin: 5, winBy: 'goals' };
	check(matchOutcome({ score: { red: 5, blue: 2 }, rules: r5, elapsed: 10 }) ?.winner === 'red', 'goals: 5 wins');
	check(matchOutcome({ score: { red: 4, blue: 2 }, rules: r5, elapsed: 10 }) === null, '  counterfactual: 4 does not');
	check(matchOutcome({ score: { red: 5, blue: 2 }, rules: r5, elapsed: 9999 }) ?.winner === 'red', '  goals mode ignores the clock');
	check(matchOutcome({ score: { red: 1, blue: 0 }, rules: { ...r5, winBy: 'goals' }, elapsed: 9999 }) === null, '  counterfactual: time up in goals mode ends nothing');
	const rt = { ...DEFAULT_RULES, winBy: 'time', matchSeconds: 60 };
	check(matchOutcome({ score: { red: 1, blue: 0 }, rules: rt, elapsed: 60 }) ?.reason === 'time', 'time: the clock ends it');
	check(matchOutcome({ score: { red: 1, blue: 0 }, rules: rt, elapsed: 59 }) === null, '  counterfactual: one second early ends nothing');
	check(matchOutcome({ score: { red: 2, blue: 2 }, rules: { ...rt, tie: 'draw' }, elapsed: 60 }) ?.winner === 'draw', "  level on time is a draw with tie: 'draw'");
	check(matchOutcome({ score: { red: 2, blue: 2 }, rules: rt, elapsed: 60 }) === null, "  30b: level on time plays on (golden goal, the default tie)");
	check(matchOutcome({ score: { red: 3, blue: 2 }, rules: rt, elapsed: 75 }) ?.winner === 'red', '  30b: ...and the next goal wins it');
	check(matchOutcome({ score: { red: 9, blue: 0 }, rules: rt, elapsed: 10 }) === null, '  time mode ignores goals');
	const re = { ...DEFAULT_RULES, winBy: 'either', goalsToWin: 3, matchSeconds: 60 };
	check(matchOutcome({ score: { red: 3, blue: 0 }, rules: re, elapsed: 10 }) ?.reason === 'goals' && matchOutcome({ score: { red: 1, blue: 0 }, rules: re, elapsed: 60 }) ?.reason === 'time', 'either: first of the two');
	check(matchOutcome({ score: { red: 9, blue: 0 }, rules: { ...r5, mode: 'practice' }, elapsed: 9999 }) === null, 'practice never ends');
	const rf = { ...DEFAULT_RULES, mode: 'freeforall', goalsToWin: 2 };
	check(matchOutcome({ score: { red: 0, blue: 0 }, rules: rf, elapsed: 0, playerGoals: { A: 2, B: 1 } }) ?.winner === 'A', 'free for all: the player reaching the goals wins');
	check(matchOutcome({ score: { red: 0, blue: 0 }, rules: { ...rf, winBy: 'time', matchSeconds: 30, tie: 'draw' }, elapsed: 30, playerGoals: { A: 1, B: 1 } }) ?.winner === 'draw', "  free for all on time with a tie is a draw (tie: 'draw')");
	check(matchOutcome({ score: { red: 0, blue: 0 }, rules: { ...rf, winBy: 'time', matchSeconds: 30 }, elapsed: 30, playerGoals: { A: 1, B: 1 } }) === null, '  30b: ...a golden goal by default');
	check(secondsLeft(rt, 20) === 40 && secondsLeft(r5, 20) === null, 'secondsLeft counts down in time mode and is null in goals mode');

	// ---- the serve ----
	const d1 = serveDirection(1000);
	const d2 = serveDirection(1000);
	check(Math.abs(Math.hypot(d1[0], d1[1], d1[2]) - 1) < 1e-9 && d1[1] === 0 && d1.join() === d2.join(), 'serveDirection is a unit vector in the pitch plane and deterministic per stamp');
	let differs = false;
	for (let at = 1; at < 40; at++) if (serveDirection(at)[2] * d1[2] < 0) differs = true;
	check(differs, '  counterfactual: other stamps serve toward the other gate');
	check(Math.abs(serveDirection(7)[0]) <= 0.3 + 1e-9, '  the sideways lean is bounded');
	const centred = serveImpulse([0, 1, 0], [0, 1, 0], 0.45, 3, 1000);
	check(Math.abs(Math.hypot(...centred) - 1.35) < 1e-9, 'serveImpulse at the centre = mass x speed along the serve direction (0.45 x 3)');
	const back = serveImpulse([0, 1, 2.4], [0, 1, 0], 0.45, 3, 1000);
	check(back[2] < 0 && Math.abs(back[0]) < 1e-9, '  counterfactual: a ball in a gate is kicked back toward the centre');
	check(hash32(1, 'a') !== hash32(1, 'b') && hash32(1, 'a') === hash32(1, 'a'), 'hash32 is stable and distinguishes parts');

	// ---- the sheet ----
	const entry = matchLogEntry({ at: 1234.9, score: { red: 2, blue: 1 }, winner: 'red', rows: [{ name: 'Ann', goals: 2 }, { name: 'Bob', goals: 0 }] });
	check(entry.at === 1234 && entry.red === 2 && entry.scorers.length === 1 && entry.scorers[0].name === 'Ann', 'matchLogEntry keeps names, drops non-scorers');
	let log = [];
	for (let i = 0; i < 60; i++) log = appendMatchLog(log, { at: i }, 50);
	check(log.length === 50 && log[0].at === 10 && log[49].at === 59, 'appendMatchLog caps at 50, newest kept');
	check(appendMatchLog(null, { at: 1 }).length === 1, '  a missing log starts one');
	check(scoreLine({ red: 3, blue: 2 }) === 'RED 3 — 2 BLUE', 'scoreLine');
	const draw = matchLogEntry({ at: 5, score: { red: 1, blue: 1 }, winner: 'draw', rows: [] });
	check(draw.winner === 'draw' && draw.scorers.length === 0, '  a scoreless draw logs with no scorers');
	const capped = appendMatchLog([{ at: 1 }], { at: 2 }, 1);
	check(capped.length === 1 && capped[0].at === 2, '  counterfactual: cap 1 keeps only the newest');

	// ---- 30b: the casual defaults and the match flow ----
	check(DEFAULT_RULES.winBy === 'either' && DEFAULT_RULES.goalsToWin === 5 && DEFAULT_RULES.matchSeconds === 180 && DEFAULT_RULES.tie === 'golden', '30b defaults: first to 5 OR 3:00, a tie goes to a golden goal');
	check(normalizeRules({ tie: 'nope' }).tie === 'golden' && normalizeRules({ tie: 'draw' }).tie === 'draw', '  tie normalises (unknown -> golden)');
	const d = { ...DEFAULT_RULES };
	check(matchOutcome({ score: { red: 5, blue: 1 }, rules: d, elapsed: 10 }) ?.reason === 'goals', '  the defaults end on the fifth goal...');
	check(matchOutcome({ score: { red: 2, blue: 1 }, rules: d, elapsed: 180 }) ?.reason === 'time', '  ...or on the 3:00 whistle with a lead');
	check(matchOutcome({ score: { red: 2, blue: 1 }, rules: d, elapsed: 179 }) === null, '  counterfactual: 2:59 ends nothing');
	check(goldenGoal({ score: { red: 1, blue: 1 }, rules: d, elapsed: 181 }) === true, 'goldenGoal: level past the whistle');
	check(goldenGoal({ score: { red: 2, blue: 1 }, rules: d, elapsed: 181 }) === false && goldenGoal({ score: { red: 1, blue: 1 }, rules: d, elapsed: 100 }) === false, '  counterfactual: a lead, or time left, is no golden goal');
	check(goldenGoal({ score: { red: 1, blue: 1 }, rules: { ...d, tie: 'draw' }, elapsed: 181 }) === false && goldenGoal({ score: { red: 1, blue: 1 }, rules: { ...d, winBy: 'goals' }, elapsed: 9999 }) === false, "  counterfactual: tie 'draw' or a goals-only match never goes golden");

	let bal = emptySlots();
	check(balancedTeam(bal, 'blue') === 'blue' && balancedTeam(bal) === 'red', 'balancedTeam: an empty pitch seats you in the half you stand in');
	bal = applySlot(bal, 'red', 'A');
	check(balancedTeam(bal, 'red') === 'blue', '  ...and otherwise on the smaller team, whatever half you stand in');
	bal = applySlot(bal, 'blue', 'B');
	check(balancedTeam(bal, 'blue') === 'blue', '  counterfactual: level teams go back to your half');

	const st = { started: true, outcome: null, celebrateUntil: 0, serveAt: 0 };
	check(matchPhase({ started: false, outcome: null }, 5) === 'menu' && matchPhase({ started: false, outcome: { winner: 'red' } }, 5) === 'over', 'matchPhase: menu before a match, over after one');
	check(matchPhase({ ...st, serveAt: 10 }, 8) === 'countdown' && matchPhase(st, 8) === 'live', '  countdown while a kick-off is due, live otherwise');
	check(matchPhase({ ...st, celebrateUntil: 10, serveAt: 13 }, 9) === 'celebrate' && matchPhase({ ...st, celebrateUntil: 10, serveAt: 13 }, 11) === 'countdown', '  a goal celebrates first, then counts down');
	check(CELEBRATE_SECONDS >= 2 && CELEBRATE_SECONDS <= 3, '  the celebration is 2-3 s (' + CELEBRATE_SECONDS + ')');
	check(countdownNumber(13, 10) === 3 && countdownNumber(13, 10.5) === 3 && countdownNumber(13, 11.2) === 2 && countdownNumber(13, 12.9) === 1, 'countdownNumber reads 3, 2, 1');
	check(countdownNumber(13, 13) === 0 && countdownNumber(0, 5) === 0, '  counterfactual: 0 once the kick-off is due, or with none pending');
	let reds = 0;
	for (let at = 0; at < 64; at++) if (startKickTeam(at + 0.123) === 'red') reds++;
	check(startKickTeam(42.5) === startKickTeam(42.5) && reds > 10 && reds < 54, 'startKickTeam is seeded by the stamp and fair-ish (' + reds + '/64 red)');

	const redG = [0, 1.35, -2.45];
	const blueG = [0, 1.35, 2.45];
	const kr = kickoffImpulse('red', redG, blueG, 0.45, 0.5, 100);
	const kb = kickoffImpulse('blue', redG, blueG, 0.45, 0.5, 100);
	check(kr[2] < 0 && kb[2] > 0 && kr[1] === 0, "kickoffImpulse rolls the ball into the KICKING team's own half (red -z, blue +z)");
	check(Math.abs(Math.hypot(...kr) - 0.225) < 1e-9, '  impulse = mass x speed (0.45 x 0.5)');
	const lean = Math.abs(kr[0]) / Math.hypot(kr[0], kr[2]);
	check(lean > 0.5 && lean < 0.65, '  it leans ~35 degrees to the side, never straight at the team\'s own net (' + lean.toFixed(2) + ')');
	const turned = kickoffImpulse('red', [2.45, 1, 0], [-2.45, 1, 0], 1, 1, 100);
	check(turned[0] > 0.7, '  counterfactual: a pitch along x rolls toward the red gate on +x');

	check(playedSeconds({ clockBase: 0, liveSince: 0 }, 50) === 0 && playedSeconds({ clockBase: 12, liveSince: 0 }, 50) === 12, 'playedSeconds: a stopped clock holds its base');
	check(playedSeconds({ clockBase: 12, liveSince: 40 }, 50) === 22, '  a live stretch adds to it');
	check(bannerScore({ red: 2, blue: 1 }) === 'Red 2 - 1 Blue', 'bannerScore reads "Red 2 - 1 Blue"');

	const faces = (yaw) => [-Math.sin(yaw), -Math.cos(yaw)];
	const sb = teamSpawn('blue', redG, blueG);
	check(Math.abs(sb.position[2] - 1.6) < 1e-9 && sb.position[1] === 0 && Math.abs(faces(sb.yaw)[1] + 1) < 1e-9, 'teamSpawn: blue starts 1.6 m into its own half (+z), feet at 0, facing the red gate (-z)');
	const sr = teamSpawn('red', redG, blueG);
	check(Math.abs(sr.position[2] + 1.6) < 1e-9 && Math.abs(faces(sr.yaw)[1] - 1) < 1e-9, '  counterfactual: red starts in the red half facing +z');
	const sx = teamSpawn('red', [2.45, 1, 0], [-2.45, 1, 0]);
	check(Math.abs(sx.position[0] - 1.6) < 1e-9 && Math.abs(faces(sx.yaw)[0] + 1) < 1e-9, '  a pitch along x: red at +x facing -x');
}
