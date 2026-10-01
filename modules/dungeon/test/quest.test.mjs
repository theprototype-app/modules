// 31 — the Quest round (D1: "In VR there is stuttering when I'm moving through the dungeon").
// Pure: what the Kit draws per quality tier, the torch cull, the glow fade, the light slots
// being the SAME algorithm as round 2 without its per-frame garbage, and a GC count proving
// the per-frame path allocates nothing.
import { PerformanceObserver } from 'node:perf_hooks';
import { LOOK, LIT, kitQuality, nearSpots, glowFadeAt, stepLightSlots } from '../src/look.js';

/** round 2's stepLightSlots, verbatim — the reference the allocation-free one must match */
function stepLightSlotsV2(slots, spots, focus, dt) {
	if (!slots.length || !spots.length) return slots;
	const rate = Math.max(0, dt) / LIT.lightFade;
	let wanted;
	if (focus) {
		const held = new Set(slots.map((s) => s.torch));
		wanted = spots
			.map((p, i) => ({ i, d: Math.hypot(p.x - focus.x, p.z - focus.z) - (held.has(i) ? LIT.lightStickiness : 0) }))
			.sort((a, b) => a.d - b.d || a.i - b.i)
			.slice(0, slots.length)
			.map((e) => e.i);
	} else wanted = slots.map((s) => s.torch).filter((t) => t >= 0);
	const want = new Set(wanted);
	for (const s of slots) {
		if (s.torch >= 0 && want.has(s.torch)) s.w = Math.min(1, s.w + rate);
		else {
			s.w = Math.max(0, s.w - rate);
			if (s.w === 0) s.torch = -1;
		}
	}
	const holding = new Set(slots.map((s) => s.torch));
	const free = wanted.filter((t) => !holding.has(t));
	for (const s of slots) if (s.torch < 0 && free.length) s.torch = free.shift();
	return slots;
}

/** mulberry32 */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export async function run(check) {
	// ---- the tiers ----------------------------------------------------------------------------
	const t0 = kitQuality(0, false), t0vr = kitQuality(0, true), tAbsent = kitQuality(undefined, false);
	check(t0.tier === 0 && t0.lights === LOOK.lightBudget && tAbsent.tier === 0, 'kitQuality: level 0 (or no api.quality) on a desktop is the full look (' + t0.lights + ' lights)');
	check(t0vr.tier === 1 && t0vr.lights <= 2, '  a HEADSET is at least tier 1: <= 2 real-time lights (the Quest budget)');
	const tiers = [0, 1, 2, 3, 5, 6, 9, 42].map((l) => kitQuality(l, false));
	check(tiers.every((t, i) => i === 0 || (t.tier >= tiers[i - 1].tier && t.lights <= tiers[i - 1].lights && t.solidRadius <= tiers[i - 1].solidRadius && t.glowRadius <= tiers[i - 1].glowRadius)), '  a higher level never draws more (lights, torch radius, glow radius all non-increasing)');
	check(tiers[tiers.length - 1].tier === 3 && !tiers[tiers.length - 1].halos && tiers[1].tier === 1 && tiers[3].tier === 2, '  levels 1-2 -> tier 1, 3-5 -> tier 2, 6+ -> tier 3 (no halos)');
	check(tiers.every((t) => t.glowRadius > t.solidRadius && t.glowRadius <= 30), '  flames glow farther than the torch bodies are drawn, never past the dungeon fog (30 m)');
	check(kitQuality(NaN, false).tier === 0 && kitQuality(-3, true).tier === 1, '  garbage levels read as 0');

	// ---- the cull -----------------------------------------------------------------------------
	const row = Array.from({ length: 50 }, (_, i) => ({ x: i, z: 0 }));
	const out = new Int32Array(row.length);
	const n = nearSpots(row, { x: 10, z: 0 }, 4, out);
	check(n === 9 && Array.from(out.subarray(0, n)).join() === '6,7,8,9,10,11,12,13,14', 'nearSpots: the spots within the radius, in index order (' + Array.from(out.subarray(0, n)).join() + ')');
	check(nearSpots(row, null, 4, out) === 50, '  no focus (the editor): every spot');
	check(nearSpots([], { x: 0, z: 0 }, 4, out) === 0, '  nothing to draw: nothing');
	check(glowFadeAt(0, 20, 5) === 1 && glowFadeAt(15, 20, 5) === 1 && glowFadeAt(17.5, 20, 5) === 0.5 && glowFadeAt(20, 20, 5) === 0 && glowFadeAt(30, 20, 5) === 0, 'glowFadeAt: full inside, a linear fade over the last metres, ZERO at the cull radius (no pop when culled)');

	// ---- the light slots: identical to round 2 ---------------------------------------------
	let same = 0, total = 0, firstDiff = '';
	for (let trial = 0; trial < 60; trial++) {
		const r = rng(trial + 1);
		// every other trial on an INTEGER grid: exact distance ties everywhere (the tie order —
		// by index — is part of the algorithm)
		const grid = trial % 2 === 1;
		const q = () => (grid ? Math.floor(r() * 12) : r() * 40);
		const spots = Array.from({ length: 5 + Math.floor(r() * 60) }, () => ({ x: q(), z: q() }));
		const budget = 1 + Math.floor(r() * 6);
		const a = Array.from({ length: budget }, (_, k) => ({ torch: k < spots.length ? k : -1, w: 1 }));
		const b = a.map((s) => ({ ...s }));
		let focus = { x: q(), z: q() };
		for (let f = 0; f < 240; f++) {
			if (f % 40 === 0) focus = r() < 0.15 ? null : { x: q(), z: q() };
			else if (focus) focus = grid ? { x: focus.x + Math.round(r() * 2 - 1), z: focus.z + Math.round(r() * 2 - 1) } : { x: focus.x + (r() - 0.5), z: focus.z + (r() - 0.5) };
			stepLightSlots(a, spots, focus, 1 / 72);
			stepLightSlotsV2(b, spots, focus, 1 / 72);
			total++;
			if (JSON.stringify(a) === JSON.stringify(b)) same++;
			else if (!firstDiff) firstDiff = 'trial ' + trial + ' frame ' + f + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b);
		}
	}
	check(same === total, 'stepLightSlots is round 2\'s algorithm frame for frame (' + same + '/' + total + ' frames over 60 random walks)' + (firstDiff ? ' FIRST DIFF ' + firstDiff : ''));

	// ---- no garbage per frame ---------------------------------------------------------------
	// count the garbage collections a long walk triggers: the old light step (fresh objects,
	// a sort and three Sets a frame) forces scavenges; the per-frame path of the Kit must not
	const gcs = async (fn) => {
		let count = 0;
		const obs = new PerformanceObserver((list) => (count += list.getEntries().length));
		obs.observe({ entryTypes: ['gc'] });
		fn();
		await new Promise((r) => setTimeout(r, 50));
		obs.disconnect();
		return count;
	};
	const spots = Array.from({ length: 240 }, (_, i) => ({ x: (i * 7.3) % 60, z: (i * 3.1) % 50 }));
	const walk = (step) => () => {
		const slots = [0, 1, 2, 3].map((t) => ({ torch: t, w: 1 }));
		const focus = { x: 0, z: 0 };
		const vis = new Int32Array(spots.length);
		for (let f = 0; f < 20000; f++) {
			focus.x = (f * 0.01) % 60;
			focus.z = (f * 0.007) % 50;
			step(slots, spots, focus, 1 / 72);
			nearSpots(spots, focus, 14, vis);
			glowFadeAt(f % 30, 22, 6);
		}
	};
	walk(stepLightSlots)(); // warm the JIT
	// the harness's own collections (the observer, the timer, the heap the earlier suites left):
	// an empty walk is the floor every count is read against
	const idle = await gcs(walk(() => {}));
	const newGc = await gcs(walk(stepLightSlots));
	const oldGc = await gcs(walk(stepLightSlotsV2));
	check(oldGc - idle > 5, '  (premise: round 2\'s light step collects garbage over a 20000-frame walk: ' + oldGc + ' GCs, idle ' + idle + ')');
	check(newGc - idle <= 1, 'the per-frame path (light slots + cull + fade) allocates nothing: ' + newGc + ' GCs over a 20000-frame walk (idle ' + idle + ')');
}
