// FOOTBALL — THE RULES. Who scored, whether it counts, what a goal is worth, how long the
// celebration lasts, who kicks off, and when the match is over. Edit anything here and press
// Ctrl+S: the match carries on under your rules, on every player's screen.
//
// How it plugs into the Main graph:
//   the Match Rules node    the match SETTINGS (mode, first to N goals, match length, own goals,
//                           golden goal) — select it and change them in the ⓘ panel
//   this file               the DECISIONS made with those settings
//   kit.football.*          the football ENGINE (the module): it watches the ball, tells these
//                           rules when the ball goes into a gate (football.ballInGate) and once a
//                           second of play (football.clock), and does what they decide
//                           (kit.football.goal, kit.football.endMatch) on every peer — the score,
//                           the sheet, the GOAL banner, the kick-off nudge, the match log
//   outputs                 the score and the moments (redGoal / blueGoal flash the nets, final
//                           puts the game shell on its results screen)
//
// The rules run on ONE player's machine (the session's authority — the peer stepping the
// physics) and everything they decide reaches everyone.

/** what one goal adds to the score */
const GOAL_POINTS = 1;

const otherTeam = (team) => (team === 'red' ? 'blue' : 'red');

/**
 * Who scores, and does it count? The LAST TOUCH decides: a ball into the red gate is a goal for
 * blue — credited to whoever touched it last, or an own goal if that was a red player.
 */
function attribute({ gateTeam, toucher, toucherTeam, mode, ownGoals }) {
	if (mode === 'practice') return { team: null, by: null, own: false, counts: false, credit: null, reason: 'practice' };
	if (mode === 'freeforall') {
		if (!toucher) return { team: null, by: null, own: false, counts: false, credit: null, reason: 'nobody touched it' };
		return { team: null, by: toucher, own: false, counts: true, credit: 'goals', reason: 'free for all' };
	}
	const scoring = otherTeam(gateTeam);
	if (!toucher || !toucherTeam) return { team: scoring, by: null, own: false, counts: true, credit: null, reason: toucher ? 'spectator touch' : 'no touch' };
	if (toucherTeam === scoring) return { team: scoring, by: toucher, own: false, counts: true, credit: 'goals', reason: 'goal' };
	// a defender put it in their own gate
	if (ownGoals === 'ignore') return { team: scoring, by: toucher, own: true, counts: false, credit: null, reason: 'own goal ignored' };
	return { team: scoring, by: toucher, own: true, counts: true, credit: 'owngoals', reason: 'own goal' };
}

/**
 * Is the match over? First to `goalsToWin` (and ahead), or the higher score when time runs out;
 * level at the whistle plays on as a GOLDEN GOAL (or ends a draw, if the settings say so).
 */
function outcome({ score, settings: s, elapsed, playerGoals }) {
	if (s.mode === 'practice') return null;
	const byGoals = s.winBy === 'goals' || s.winBy === 'either';
	const byTime = s.winBy === 'time' || s.winBy === 'either';
	if (byGoals) {
		if (s.mode === 'freeforall') {
			for (const [id, n] of Object.entries(playerGoals)) if (n >= s.goalsToWin) return { winner: id, reason: 'goals' };
		} else {
			if (score.red >= s.goalsToWin && score.red > score.blue) return { winner: 'red', reason: 'goals' };
			if (score.blue >= s.goalsToWin && score.blue > score.red) return { winner: 'blue', reason: 'goals' };
		}
	}
	if (byTime && elapsed >= s.matchSeconds) {
		if (s.mode === 'freeforall') {
			const counts = Object.entries(playerGoals).sort((a, b) => b[1] - a[1]);
			const tie = counts.length > 1 && counts[0][1] === counts[1][1];
			if (tie && s.tie === 'golden') return null;
			return { winner: counts.length && !tie ? counts[0][0] : 'draw', reason: 'time' };
		}
		if (score.red === score.blue) return s.tie === 'golden' ? null : { winner: 'draw', reason: 'time' };
		return { winner: score.red > score.blue ? 'red' : 'blue', reason: 'time' };
	}
	return null;
}

export default behaviour({
	name: 'Football rules',

	params: {
		/** the ball rests in the net this long after a goal, then the kick-off countdown runs */
		celebrateSeconds: { value: 2.5, min: 0.5, max: 8, step: 0.5, unit: 's', label: 'Goal celebration' }
	},

	state: {
		red: 0,
		blue: 0,
		lastGoal: '', // "RED 2 — 1 BLUE (own goal)"
		result: '' // "RED wins · 5 — 3"
	},

	outputs: ['red', 'blue', 'lastGoal', 'result', 'redGoal', 'blueGoal', 'ownGoal', 'final'],

	on: {
		/** the ball went into a gate while it was live */
		'football.ballInGate'({ gate, gateTeam, toucher, toucherTeam, mode }) {
			const settings = kit.football.settings();
			const a = attribute({ gateTeam, toucher, toucherTeam, mode, ownGoals: settings.ownGoals });
			// the conceding team (the gate's owner) kicks off after the celebration
			kit.football.goal({ gate, gateTeam, ...a, points: GOAL_POINTS, celebrate: this.params.celebrateSeconds, kickTeam: gateTeam });
			this.readScore();
			this.state.lastGoal = 'RED ' + this.state.red + ' — ' + this.state.blue + ' BLUE' + (a.own ? ' (own goal)' : a.counts ? '' : ' (' + a.reason + ')');
			// the moments, wired on the Main graph (the nets flash, the game shell follows)
			if (a.counts && a.team) this.emit(a.team === 'red' ? 'redGoal' : 'blueGoal');
			if (a.counts && a.own) this.emit('ownGoal');
			// a winning goal is celebrated first — the whistle can blow once that is over
			this.after(this.params.celebrateSeconds + 0.1, 'checkEnd');
		},
		/** once a second of play */
		'football.clock'() {
			this.readScore();
			this.checkEnd();
		}
	},

	readScore() {
		const score = kit.football.score();
		this.state.red = score.red;
		this.state.blue = score.blue;
	},

	/** the final whistle, when the settings say the match is decided */
	checkEnd() {
		const o = outcome({ score: kit.football.score(), settings: kit.football.settings(), elapsed: kit.football.elapsed(), playerGoals: kit.football.playerGoals() });
		if (!o) return;
		if (!kit.football.endMatch(o)) return;
		const who = o.winner === 'draw' ? 'Draw' : o.winner === 'red' ? 'RED wins' : o.winner === 'blue' ? 'BLUE wins' : 'A player wins';
		this.state.result = who + (o.reason === 'time' ? " — time's up" : '') + ' · ' + this.state.red + ' — ' + this.state.blue;
		this.emit('final');
	}
});
