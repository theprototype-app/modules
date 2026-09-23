// 30b — the game's FEEL, pure: where a floor starts (api.setSpawn), the footstep clock, the
// feel table (sounds / bursts / haptics / banners). Built on the Kit's REAL contract.
import { spawnFor, standable, yawFacing, footstep, feel, STRIDE } from '../src/juice.js';
import { generateCampaign } from '../../dungeon/src/gen/campaign.js';
import { playPayload } from '../../dungeon/src/contract.js';

export function run(check) {
	// yaw: three.js rotation.y, 0 faces -Z; forward = (-sin yaw, -cos yaw)
	for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
		const y = yawFacing(dx, dz);
		check(Math.abs(-Math.sin(y) - dx) < 1e-9 && Math.abs(-Math.cos(y) - dz) < 1e-9, 'yawFacing(' + dx + ',' + dz + ') = ' + y.toFixed(2) + ' faces that way (forward = (-sin, -cos))');
	}
	const campaign = generateCampaign(1337, { levelCount: 5 });
	let ok = 0, faced = 0, offPortal = 0, apart = 0;
	const floors = campaign.floors.length;
	for (let k = 1; k <= floors; k++) {
		const play = playPayload(campaign, k);
		const s0 = spawnFor(play, 0), s1 = spawnFor(play, 1);
		const [x, y, z] = s0.position;
		if (y === 0 && standable(play, x, z) && standable(play, s1.position[0], s1.position[2])) ok++;
		// facing open floor: 2 m ahead is standable
		if (standable(play, x - Math.sin(s0.yaw) * 2, z - Math.cos(s0.yaw) * 2)) faced++;
		const down = play.portals.find((p) => p.kind === 'down');
		if (k === 1) {
			const e = play.rooms[0];
			if (!down && Math.hypot(x - e.cx, z - e.cz) < 0.01) offPortal++;
		} else if (down && Math.hypot(x - down.wx, z - down.wz) > 1.2) offPortal++;
		if (Math.hypot(s1.position[0] - x, s1.position[2] - z) > 0.5) apart++;
	}
	check(ok === floors, 'spawnFor: every floor\'s start (P1 and P2) is standable ground at the feet (y 0) on the WALK raster (' + ok + '/' + floors + ')');
	check(faced === floors, '  facing open floor, never a wall (' + faced + '/' + floors + ')');
	check(offPortal === floors, '  floor 1 at the entrance hall (the arch); a climbed floor BESIDE its down portal, stepped off the ring (' + offPortal + '/' + floors + ')');
	check(apart === floors, '  P2 stands beside P1, not inside them (' + apart + '/' + floors + ')');
	check(spawnFor(null) === null && spawnFor({}) === null, '  no contract: no spawn (never a throw)');
	// the counterfactual: the naive start (the down portal itself) stands ON the portal
	const p2 = playPayload(campaign, 2);
	const down2 = p2.portals.find((p) => p.kind === 'down');
	check(Math.hypot(spawnFor(p2).position[0] - down2.wx, spawnFor(p2).position[2] - down2.wz) > 1.05, '  (the portal ring is 1.05 m: the start is outside it)');
	// many seeds: the start is always standable
	let bad = 0;
	for (let seed = 1; seed <= 20; seed++) {
		const c = generateCampaign(seed * 104729);
		c.floors.forEach((_, i) => { const pl = playPayload(c, i + 1); const s = spawnFor(pl, 1); if (!s || !standable(pl, s.position[0], s.position[2])) bad++; });
	}
	check(bad === 0, '  over 20 seeds x every floor, P2\'s start is always standable');
	// the facing is the LONGEST clear view: never shorter than any of the four axis directions
	const clear = (pl, x, z, dx, dz) => { let d = 0; while (d < 12 && standable(pl, x + dx * (d + 0.25), z + dz * (d + 0.25))) d += 0.25; return d; };
	let shortSighted = 0, spawns = 0;
	for (let seed = 1; seed <= 20; seed++) {
		const c = generateCampaign(seed * 7727);
		c.floors.forEach((_, i) => {
			const pl = playPayload(c, i + 1);
			const s = spawnFor(pl, 0);
			const [x, , z] = s.position;
			const ahead = clear(pl, x, z, -Math.sin(s.yaw), -Math.cos(s.yaw));
			const axes = Math.max(...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => clear(pl, x, z, dx, dz)));
			spawns++;
			if (ahead + 1e-9 < axes) shortSighted++;
		});
	}
	check(shortSighted === 0, '  over ' + spawns + ' starts the player faces the longest clear view (never a nearer wall than any axis offers)');
	// footsteps
	const clock = {};
	check(footstep(clock, { x: 0, z: 0 }) === false, 'footstep: the first frame only sets the clock');
	let steps = 0;
	for (let i = 1; i <= 100; i++) if (footstep(clock, { x: i * 0.05, z: 0 })) steps++;
	check(steps === Math.floor(5 / STRIDE), '  5 m of walking = ' + steps + ' steps (one per ' + STRIDE + ' m)');
	let still = 0;
	for (let i = 0; i < 100; i++) if (footstep(clock, { x: 5, z: 0 })) still++;
	check(still === 0, '  standing still: silence');
	check(footstep(clock, { x: 40, z: 0 }) === false && clock.walked === 0, '  a teleport (a floor change, a spawn) is not a step');
	// the feel table
	const gem = feel('gem', { local: true, color: 0x39e0c0 });
	check(gem.sound === 'coin' && gem.burst.kind === 'sparkle' && gem.burst.color === 0x39e0c0 && gem.haptic, 'feel: a gem = coin + sparkle burst in its colour + a haptic for the picker');
	check(feel('gem', { local: false }).haptic === null, '  a PEER\'s pickup plays its sound + sparkle but never buzzes your hands');
	const unseal = feel('unseal', { local: true });
	check(unseal.sound === 'portal' && unseal.burst && /unseal/i.test(unseal.announce.text), '  the portal unsealing = portal sound + sparks + a banner');
	const fl = feel('floor', { floor: 3, name: 'The Ash Halls' });
	check(fl.sound === 'levelup' && fl.announce.text === 'Floor 3' && fl.announce.sub === 'The Ash Halls', '  a new floor = levelup + announce("Floor 3")');
	check(feel('start', { floor: 1 }).music === 'dungeon', '  the start = the dungeon music');
	check(feel('step').sound === 'step' && feel('victory', { local: true }).burst.kind === 'confetti', '  footsteps = step; victory = confetti');
	const SDK = ['click', 'pop', 'whoosh', 'success', 'fail', 'hit', 'kick', 'shoot', 'laser', 'explosion', 'coin', 'levelup', 'goal', 'whistle', 'cheer', 'step', 'ring', 'sparkle', 'hurt', 'portal'];
	const used = ['gem', 'unseal', 'floor', 'start', 'victory', 'step'].map((e) => feel(e, { local: true }).sound);
	check(used.every((s) => SDK.includes(s)), '  every sound is one of core\'s C5 built-ins (' + used.join(', ') + ')');
	const HAPT = ['tap', 'bump', 'hit', 'success', 'fail', 'rumble', 'heartbeat'];
	check(['gem', 'unseal', 'victory'].every((e) => HAPT.includes(feel(e, { local: true }).haptic)), '  every haptic is one of core\'s C4 presets');
}
