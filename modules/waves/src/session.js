// waves — THE RUN AS A PLAYER LIVES IT (30b P3): the banners ("Wave 4", "LEVEL 2 — runners!"),
// the level-up sound and confetti, a breach's blast, the results panel when the run ends, and
// the best run remembered on this device. Every moment here is a LOCAL edge the engine derives
// on every peer from replicated state, so nothing is sent.
//
// Banners go through `api.announce` (30b C2: the desktop HUD and the VR panel). Without it: a
// desktop toast for the big moments only, and in a headset the world board (start.js).


const BEST_KEY = 'best';
/** what a new level brings, for its banner */
const LEVEL_NEWS = { 2: 'Runners incoming — fast and fragile', 3: 'Tanks! Heavy, slow, worth 400', 4: 'Everything, faster', 5: 'The last stand' };

/** @param {number} n */
const fmt = (n) => Math.round(n).toLocaleString('en-US');

/** the best of two runs: the higher score, then the higher level @param {any} a @param {any} b */
export function betterRun(a, b) {
	if (!a) return b;
	if (!b) return a;
	if (b.score !== a.score) return b.score > a.score ? b : a;
	return (b.level ?? 0) > (a.level ?? 0) ? b : a;
}

/** the results panel's lines, pure @param {{won: boolean, level: number, wave: number, waves: number, score: number, kills: number, best: any, isBest: boolean}} r */
export function resultLines(r) {
	return {
		title: r.won ? 'ARENA CLEARED' : 'CRYSTAL DESTROYED',
		lines: [
			(r.won ? 'All ' + r.waves + ' waves held' : 'Fell on wave ' + r.wave + ' of ' + r.waves) + ' · level ' + r.level,
			'Score ' + fmt(r.score) + ' · ' + r.kills + (r.kills === 1 ? ' kill' : ' kills'),
			r.isBest ? 'NEW BEST!' : 'Best: ' + fmt(r.best?.score ?? 0) + ' · level ' + (r.best?.level ?? 1)
		]
	};
}

/**
 * @param {any} api
 * @param {ReturnType<import('./engine.js').createWavesEngine>} engine
 * @param {ReturnType<import('./juice.js').createJuice>} juice
 * @param {ReturnType<import('./feel.js').createFeel>} feel
 * @param {ReturnType<import('./prefs.js').createPrefs>} prefs
 * @param {{card: (c: any, ms: number) => void} | null} board the headset's fallback banner
 */
export function registerSession(api, engine, juice, feel, prefs, board) {
	let best = api.storage?.get?.(BEST_KEY, null) ?? null;
	/** @type {any} */
	let result = null;
	const said = /** @type {{text: string, sub?: string}[]} */ ([]);

	/** a banner @param {string} text @param {{sub?: string, ms?: number, color?: string, big?: boolean}} [o] */
	function announce(text, o = {}) {
		said.push({ text, sub: o.sub });
		if (said.length > 30) said.shift();
		if (typeof api.announce === 'function') {
			api.announce(text, { sub: o.sub, ms: o.ms ?? 1800, color: o.color });
			return;
		}
		if (api.isVR?.()) board?.card({ title: text, lines: o.sub ? [o.sub] : [], color: o.color }, o.ms ?? 1800);
		else if (o.big) api.toast?.(o.sub ? text + ' — ' + o.sub : text);
	}

	/** the goal's crystal, where the confetti flies from @param {any} s */
	const crystal = (s) => (s?.goal ? [s.goal[0], s.goal[1] + 1.6, s.goal[2]] : [0, 2, 0]);

	/** the player's own crystal health (the run's player chain), 0 = destroyed */
	function crystalHp() {
		const node = api.flow.nodes('health').find((/** @type {any} */ n) => n.data?.scope === 'player');
		return node ? Number(api.flow.nodeValue(node.id)) : NaN;
	}
	/** did the crystal just die? its health value (republished ~6/s, so it can lag the round's
	 * end) or a FRESH stamp on a `healthevent death` node — the pulse that ended the round */
	function crystalFell() {
		if (crystalHp() <= 0) return true;
		return api.flow.nodes('healthevent').some((/** @type {any} */ n) => {
			if (String(n.data?.event ?? '') !== 'death') return false;
			const st = api.flow.triggerStamp(n.id);
			return !!st && st.stamp !== null && Number(st.age) < 3;
		});
	}
	/** a round that ended without a win: a result only if the crystal fell — asked again for a
	 * moment, because the shell can leave the round a tick before the value catches up (a Quit
	 * or a Restart never becomes a result) @type {{s: any, until: number} | null} */
	let pendingLoss = null;

	function pushRows() {
		api.hud.rows('wv-best', best ? ['Best: ' + fmt(best.score) + ' · level ' + best.level] : ['No best run yet']);
		if (result) {
			const r = resultLines(result);
			api.hud.rows('wv-result-title', [r.title]);
			api.hud.rows('wv-result', r.lines);
		}
	}

	engine.onRun((ev) => {
		const s = ev.s;
		if (ev.kind === 'start') {
			// a new round: this player's own score and kills start at zero (their own rows)
			api.peerVars.setMine('score', 0);
			api.peerVars.setMine('kills', 0);
			result = null;
			api.hud.clearRows('wv-result');
			api.hud.clearRows('wv-result-title');
			announce('WAVE 1', { sub: 'Hold the crystal!', color: '#ff9c6b' });
			feel.sound('whistle');
		} else if (ev.kind === 'wave') {
			announce('Wave ' + s.wave, { sub: s.perLevel ? 'Level ' + s.level : undefined, ms: 1300 });
			feel.sound('whoosh');
		} else if (ev.kind === 'level') {
			announce('LEVEL ' + s.level, { sub: /** @type {any} */ (LEVEL_NEWS)[s.level] ?? 'Faster', color: '#ffd24a', big: true });
			feel.sound('levelup');
			feel.haptic('success');
			const c = crystal(s);
			if (api.effects?.burst) api.effects.burst(c, { kind: 'confetti', count: 80 });
			else juice.pop(c, 0xffd24a);
		} else if (ev.kind === 'breach') {
			juice.pop(ev.pos ?? crystal(s), 0xff3b2e);
			feel.sound(ev.blocked ? 'ring' : 'explosion', ev.pos);
			feel.haptic(ev.blocked ? 'bump' : 'fail');
			if (!ev.blocked) api.effects?.burst?.(crystal(s), { kind: 'sparks', color: '#ff3b2e', count: 30 });
		} else if (ev.kind === 'over') {
			if (ev.won) finish(s, true);
			else pendingLoss = { s, until: performance.now() / 1000 + 1.5 };
		}
		pushRows();
	});

	/** THE RESULT: the best, the rows, the banner @param {any} s @param {boolean} won */
	function finish(s, won) {
		const run = { score: Number(api.peerVars.mine('score', 0)) || 0, level: s.level ?? 1, wave: s.wave, at: Date.now() };
		const isBest = !best || betterRun(best, run) === run;
		if (isBest) {
			best = run;
			api.storage?.set?.(BEST_KEY, best);
		}
		result = { won, level: run.level, wave: s.wave, waves: s.curve.waves, score: run.score, kills: Number(api.peerVars.mine('kills', 0)) || 0, best, isBest };
		const r = resultLines(result);
		announce(r.title, { sub: r.lines[1], color: won ? '#6fcf7a' : '#ff5a4a', ms: 2600, big: true });
		feel.sound(won ? 'cheer' : 'fail');
		feel.haptic(won ? 'success' : 'fail');
		if (won) {
			if (api.effects?.burst) api.effects.burst(crystal(s), { kind: 'confetti', count: 120 });
			else juice.pop(crystal(s), 0x6fcf7a);
		}
		pushRows();
	}

	let lastRows = 0;
	api.registerFrameTask(() => {
		// a scene load drops the pushed rows: put them back once a second
		const now = performance.now() / 1000;
		if (now - lastRows > 1) {
			lastRows = now;
			pushRows();
		}
		if (!pendingLoss) return;
		if (crystalFell()) {
			const s = pendingLoss.s;
			pendingLoss = null;
			finish(s, false);
		} else if (performance.now() / 1000 > pendingLoss.until) pendingLoss = null;
	});

	pushRows();

	return {
		best: () => best,
		result: () => result,
		said,
		announce,
		pushRows
	};
}
