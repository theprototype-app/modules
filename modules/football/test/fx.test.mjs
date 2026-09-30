// 30b: the presentation wrapper — the module feature-detects the Quest round's core
// contract (announce, hapticPattern, the SFX set + music, effects) and falls back on an
// older core. A fake api records what reached it.
import { createFx, burstBudget } from '../src/fx.js';

/** @param {any} extra */
function fakeApi(extra = {}) {
	const got = [];
	const api = {
		got,
		toast: (t) => got.push(['toast', t]),
		playSound: (n, p) => got.push(['playSound', n, p]),
		haptic: (i, ms, hand) => got.push(['haptic', i, ms, hand]),
		isVR: () => false,
		...extra
	};
	return api;
}

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	// ---- 31: the burst budget follows api.quality (and a headset) ----
	check(burstBudget(90, 0, false) === 90 && burstBudget(90, undefined, false) === 90, '31 burstBudget: the best quality (or no api.quality) spends what was asked');
	check(burstBudget(90, 0, true) === 60 && burstBudget(90, 2, false) === 60, '  a headset / level 1-2: two thirds (60 of 90)');
	check(burstBudget(90, 4, false) === 30 && burstBudget(90, 6, true) === 0 && burstBudget(90, 9, false) === 0, '  level 3-5: a third; 6+: none');
	const bursts = [];
	const lowApi = fakeApi({ effects: { burst: (p, o) => bursts.push(o) }, quality: { level: 7, onChange() {} } });
	createFx(lowApi).burst([0, 1, 0], { kind: 'confetti', count: 90 });
	const midApi = fakeApi({ effects: { burst: (p, o) => bursts.push(o) }, quality: { level: 1, onChange() {} }, isVR: () => true });
	createFx(midApi).burst([0, 1, 0], { kind: 'confetti', count: 90 });
	check(bursts.length === 1 && bursts[0].count === 60 && bursts[0].kind === 'confetti', '  fx.burst reads api.quality: level 7 sends NO burst, a headset at level 1 sends 60 (' + JSON.stringify(bursts) + ')');

	// ---- the 30b core: every call goes straight through ----
	const api = fakeApi({
		announce: (t, o) => api.got.push(['announce', t, o]),
		hapticPattern: (n, h) => api.got.push(['hapticPattern', n, h]),
		music: { play: (p, o) => api.got.push(['music', p, o]), stop: () => api.got.push(['music-stop']) },
		effects: { burst: (p, o) => api.got.push(['burst', p, o]) }
	});
	const fx = createFx(api);
	fx.announce('GOAL!', { sub: 'Red 1 - 0 Blue', toast: true, color: '#f00' });
	const a = api.got.find((g) => g[0] === 'announce');
	check(!!a && a[1] === 'GOAL!' && a[2].sub === 'Red 1 - 0 Blue' && !('toast' in a[2]), 'announce reaches api.announce with its sub (the toast flag stays ours)');
	check(!api.got.some((g) => g[0] === 'toast'), '  and no toast when the banner exists');
	fx.sound('kick', [1, 2, 3]);
	check(api.got.some((g) => g[0] === 'playSound' && g[1] === 'kick' && g[2][2] === 3), 'sound: the C5 name goes to playSound with its position');
	fx.burst([0, 1, 0], { kind: 'confetti', color: '#f00', count: 90 });
	check(api.got.some((g) => g[0] === 'burst' && g[2].kind === 'confetti'), 'burst reaches api.effects.burst');
	fx.haptic('success');
	check(api.got.some((g) => g[0] === 'hapticPattern' && g[1] === 'success'), 'haptic presets go to api.hapticPattern');
	fx.music('stadium', { volume: 0.5 });
	fx.stopMusic();
	check(api.got.some((g) => g[0] === 'music' && g[1] === 'stadium') && api.got.some((g) => g[0] === 'music-stop'), 'music plays and stops through api.music');
	const log = fx.log();
	check(log.length === 6 && log.every((c) => c.native), 'the log records every call as native (' + log.length + ')');

	// ---- a 1.17 core: the nearest thing it has ----
	const old = fakeApi();
	const fo = createFx(old);
	fo.announce('GOAL!', { sub: 'Red 1 - 0 Blue', toast: true });
	check(old.got.some((g) => g[0] === 'toast' && /GOAL!/.test(g[1]) && /Red 1 - 0 Blue/.test(g[1])), 'no api.announce: a goal banner becomes a toast on desktop');
	fo.announce('3', { ms: 800 });
	check(old.got.filter((g) => g[0] === 'toast').length === 1, '  counterfactual: a countdown digit is NOT toasted');
	const vr = fakeApi({ isVR: () => true });
	createFx(vr).announce('GOAL!', { toast: true });
	check(!vr.got.some((g) => g[0] === 'toast'), '  and nothing is toasted into a headset');
	fo.sound('goal');
	fo.sound('cheer');
	check(old.got.some((g) => g[0] === 'playSound' && g[1] === 'bell') && !old.got.some((g) => g[1] === 'cheer' || g[1] === 'goal'), 'no api.music (pre-C5): goal falls back to a ping, cheer is silent (never an unknown name)');
	fo.haptic('success', 'left');
	check(old.got.some((g) => g[0] === 'haptic' && g[1] === 0.8 && g[3] === 'left'), 'no hapticPattern: the preset becomes a plain pulse on api.haptic');
	fo.burst([0, 0, 0], { kind: 'confetti' });
	fo.music('stadium');
	check(!old.got.some((g) => g[0] === 'burst' || g[0] === 'music'), 'no effects / music: nothing is called');
	check(fo.log().every((c) => c.native === false || c.kind === 'pulse'), 'the log marks those calls not-native');
}
