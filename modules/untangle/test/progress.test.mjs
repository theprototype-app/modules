// Progress + storage — run WITHOUT the app (fakes for localStorage and api.storage).
import {
	MAX_LEVEL,
	PROGRESS_KEY,
	STORAGE_PREFIX,
	defaultProgress,
	normalizeProgress,
	recordSolve,
	isUnlocked,
	isSolved,
	continueLevel,
	bestOf,
	formatTime,
	makeStorage
} from '../src/progress.js';

/** a Storage fake; `failWrites` makes setItem throw like Safari private mode / a full quota */
function fakeLocal({ failWrites = false } = {}) {
	const map = new Map();
	return {
		map,
		getItem: (k) => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => {
			if (failWrites) throw new Error('QuotaExceededError');
			map.set(k, String(v));
		},
		removeItem: (k) => map.delete(k)
	};
}

export function run(check) {
	// ---- the unlock rules ----
	const p0 = defaultProgress();
	check(p0['2d'].unlocked === 1 && p0['3d'].unlocked === 1 && p0['2d'].solved.length === 0, 'default: level 1 open in both modes, nothing solved');
	check(isUnlocked(p0, '2d', 1) && !isUnlocked(p0, '2d', 2) && !isUnlocked(p0, '2d', 0) && !isUnlocked(p0, '2d', MAX_LEVEL + 1), 'default: 1 unlocked, 2 locked, out-of-range never unlocked');
	const r1 = recordSolve(p0, '2d', 1, 32000);
	check(r1.unlockedNew && r1.newBest && isUnlocked(r1.progress, '2d', 2) && !isUnlocked(r1.progress, '2d', 3), 'solving 1 opens 2 (and only 2)');
	check(isSolved(r1.progress, '2d', 1) && bestOf(r1.progress, '2d', 1) === 32000, 'the solve and its time are banked');
	check(p0['2d'].unlocked === 1 && !isSolved(p0, '2d', 1), 'recordSolve returns a NEW object (the input is untouched)');
	check(!isUnlocked(r1.progress, '3d', 2) && r1.progress['3d'].unlocked === 1, 'modes are separate: a 2D solve opens nothing in 3D');
	const r2 = recordSolve(r1.progress, '2d', 1, 40000);
	check(!r2.unlockedNew && !r2.newBest && bestOf(r2.progress, '2d', 1) === 32000, 'a slower re-solve keeps the best, opens nothing new');
	const r3 = recordSolve(r2.progress, '2d', 1, 20000);
	check(r3.newBest && bestOf(r3.progress, '2d', 1) === 20000, 'a faster re-solve is a new best');
	const r4 = recordSolve(r3.progress, '2d', 7, null);
	check(r4.progress['2d'].unlocked === 8 && bestOf(r4.progress, '2d', 7) === null, 'solving a level a peer chose opens the one after it; an untimed solve records no best');
	const top = recordSolve(defaultProgress(), '2d', MAX_LEVEL, 5000);
	check(top.progress['2d'].unlocked === MAX_LEVEL && !isUnlocked(top.progress, '2d', MAX_LEVEL + 1), 'the last level opens nothing past ' + MAX_LEVEL);
	check(continueLevel(defaultProgress(), '2d') === 1 && continueLevel(r3.progress, '2d') === 2, 'Continue = the lowest open level not yet solved');
	const all = recordSolve(recordSolve(defaultProgress(), '3d', 1, 1).progress, '3d', 2, 1).progress;
	check(continueLevel(all, '3d') === 3, 'Continue after solving 1 and 2 is 3');

	// ---- reset ----
	check(JSON.stringify(normalizeProgress(defaultProgress())) === JSON.stringify(defaultProgress()), 'reset = the default, round-trips through normalize');

	// ---- corrupt values fall back to defaults ----
	for (const bad of [null, undefined, 42, 'x', [], { '2d': 'nope' }, { '2d': [] }]) {
		check(JSON.stringify(normalizeProgress(bad)) === JSON.stringify(defaultProgress()), 'corrupt ' + JSON.stringify(bad) + ' -> defaults');
	}
	const partly = normalizeProgress({ '2d': { unlocked: 'many', solved: [1, 2, 'x', 99, 2, -1], best: { 1: 900, 2: -5, zz: 7, 40: 3 } } });
	check(partly['2d'].unlocked === 3 && JSON.stringify(partly['2d'].solved) === '[1,2]' && JSON.stringify(partly['2d'].best) === '{"1":900}', 'a half-corrupt mode keeps what is valid (solved [1,2] -> unlocked 3, best {1: 900})');
	check(normalizeProgress({ '2d': { unlocked: 999 } })['2d'].unlocked === 1, 'an out-of-range unlocked falls back to 1');

	// ---- the key format: 1.16 wrapper and 1.17 api.storage agree ----
	const local = fakeLocal();
	const store = makeStorage({}, () => local);
	check(store.kind === 'local', 'no api.storage (a 1.16 core) -> the module wrapper');
	check(store.set(PROGRESS_KEY, r1.progress) === true, 'the wrapper writes');
	check(STORAGE_PREFIX + PROGRESS_KEY === 'tp:mod:untangle:progress' && local.map.has('tp:mod:untangle:progress'), 'the key is tp:mod:untangle:progress (the core api.storage format)');
	check(JSON.stringify(JSON.parse(local.map.get('tp:mod:untangle:progress'))) === JSON.stringify(r1.progress), 'the value is plain JSON');
	check(JSON.stringify(store.get(PROGRESS_KEY)) === JSON.stringify(r1.progress), 'and reads back');
	local.map.set('tp:mod:untangle:progress', '{not json');
	check(store.get(PROGRESS_KEY) === null && JSON.stringify(normalizeProgress(store.get(PROGRESS_KEY))) === JSON.stringify(defaultProgress()), 'a corrupt stored string reads as absent -> defaults');
	const failing = fakeLocal({ failWrites: true });
	const mem = makeStorage({}, () => failing);
	check(mem.set(PROGRESS_KEY, { a: 1 }) === false && JSON.stringify(mem.get(PROGRESS_KEY)) === '{"a":1}', 'a throwing setItem falls back to memory for the session (never throws)');
	const noStore = makeStorage({}, () => {
		throw new Error('SecurityError');
	});
	check(noStore.set(PROGRESS_KEY, 5) === false && noStore.get(PROGRESS_KEY) === 5, 'touching localStorage throwing (sandboxed) -> memory');
	store.remove(PROGRESS_KEY);
	check(store.get(PROGRESS_KEY) === null && !local.map.has('tp:mod:untangle:progress'), 'remove clears it');
	const calls = [];
	const apiStore = makeStorage({ storage: { get: (k) => (calls.push('get:' + k), { '2d': { unlocked: 4 } }), set: (k, v) => (calls.push('set:' + k), true), remove: (k) => calls.push('rm:' + k) } }, () => local);
	check(apiStore.kind === 'api' && apiStore.get(PROGRESS_KEY)['2d'].unlocked === 4 && apiStore.set(PROGRESS_KEY, 1) && calls.join() === 'get:progress,set:progress', 'api.storage present (core 1.17) -> it is used, with the bare key (core namespaces it)');
	check(makeStorage({ storage: { get: () => { throw new Error('x'); }, set: () => false } }).get('k') === null, 'a throwing api.storage.get reads as absent');

	// ---- the HUD time format ----
	check(formatTime(0) === '0:00' && formatTime(65400) === '1:05' && formatTime(null) === '—', 'm:ss, and an em dash for no time');
}
