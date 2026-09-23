// The Kit's look numbers — pure (30-visuals-mod). What makes the dungeon torch-lit instead of
// black, held to measurable floors: every theme's lifted wall reads, the tiles clear the editor
// grid, the light count stays capped, the flicker is deterministic.
import { LOOK, luma, lift, mix, stoneTint, flameFlicker, pickLights } from '../src/look.js';
import { THEMES } from '../src/gen/campaign.js';

export function run(check) {
	check(LOOK.floorTop > 0 && LOOK.floorTop < 0.05, 'the tiles\' top sits a hair ABOVE the editor grid (y 0)');
	check(LOOK.lightBudget <= 8, 'point lights stay capped at 8 per floor (the frame budget) (' + LOOK.lightBudget + ')');
	const walls = THEMES.map((t) => luma(stoneTint(t.wallTint, LOOK.wallLift)));
	check(walls.every((l) => l >= LOOK.minWallLuma), 'every theme\'s lifted wall reads (luma >= ' + LOOK.minWallLuma + '): ' + walls.map((l) => l.toFixed(3)).join(' '));
	check(THEMES.every((t) => luma(t.wallTint) < LOOK.minWallLuma), '  counterfactual: the raw theme walls do NOT (' + THEMES.map((t) => luma(t.wallTint).toFixed(3)).join(' ') + ')');
	check(THEMES.every((t) => t.floorTints.every((c) => luma(stoneTint(c, LOOK.floorLift)) > luma(c))), 'every floor tint is lifted');
	check(mix(0x000000, 0xffffff, 0.5) === 0x808080 && mix(0x123456, 0xabcdef, 0) === 0x123456, 'mix blends per channel and is the identity at 0');
	const dist = (/** @type {number} */ a, /** @type {number} */ b) => [16, 8, 0].reduce((d, sh) => d + Math.abs(((a >> sh) & 255) - ((b >> sh) & 255)), 0);
	check(THEMES.every((t) => dist(mix(t.wallTint, LOOK.stone, LOOK.stoneMix), LOOK.stone) < dist(t.wallTint, LOOK.stone)), 'the stone mix moves every theme wall toward the warm stone grey');
	check(lift(0xffffff, 3) === 0xffffff && lift(0x102030, 1) === 0x102030, 'lift clamps each channel and is the identity at 1');
	check(flameFlicker(12.5, 3, 4) === flameFlicker(12.5, 3, 4) && flameFlicker(12.5, 3, 4) !== flameFlicker(12.5, 9, 4), 'the flame flicker is a pure function of time and the torch (same on every peer, different per torch)');
	const ks = Array.from({ length: 200 }, (_, i) => flameFlicker(i * 0.05, 1, 2));
	check(Math.min(...ks) > 0.75 && Math.max(...ks) < 1.25, '  and stays within +-25% of the flame');
	const spots = Array.from({ length: 40 }, (_, i) => ({ x: i, z: 0 }));
	const picked = pickLights(spots, { x: 30.2, z: 0 }, 8);
	check(picked.length === 8 && new Set(picked).size === 8, 'pickLights: never more than the budget, no light twice');
	check([30, 31, 29].every((i) => picked.slice(0, 3).includes(i)), '  the three flames nearest the entrance hall come first (the spawn is torch-lit)');
	check(picked.slice(3).some((i) => i < 10) && picked.slice(3).some((i) => i > 20 && i < 29), '  the rest spread over the level');
	check([9, 12, 17, 20, 23, 41, 100].every((n) => pickLights(spots.slice(0, Math.min(n, 40)).concat(Array.from({ length: Math.max(0, n - 40) }, (_, i) => ({ x: 50 + i, z: 1 }))), { x: 0, z: 0 }, 8).length === 8),
		'  ALWAYS exactly 8 lights when a floor has >= 8 flames (a changing light count recompiles every lit material on travel)');
	check(pickLights(spots.slice(0, 5), null, 8).length === 5, '  and every flame when it has fewer');
	check(pickLights(spots, null, 8).length === 8 && pickLights([], null, 8).length === 0 && pickLights(spots, null, 0).length === 0, '  no focus: an even spread; nothing to light: nothing');
	check(LOOK.flameIntensity > 1, 'flames are emissive over 1 (bloom catches them)');
}
