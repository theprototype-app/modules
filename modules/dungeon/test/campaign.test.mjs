// Stage-03 acceptance — campaign stack, portals, typing, ramps, determinism.
import { generateCampaign, roomCountFor, validateCampaign, THEMES } from '../src/gen/campaign.js';
import { FLOOR } from '../src/gen/dungeon.js';

export function run(check) {
	// 50-seed sweep: levelCount floors, valid portal chain, legal spawn types
	let ok = 0;
	for (let seed = 1; seed <= 50; seed++) {
		try {
			const campaign = generateCampaign(seed);
			const failures = validateCampaign(campaign);
			if (failures.length === 0 && campaign.floors.length === 5) ok++;
			else console.log('  seed ' + seed + ': ' + failures.join('; '));
		} catch (error) {
			console.log('  seed ' + seed + ' THREW: ' + error.message);
		}
	}
	check(ok === 50, '50-seed campaign sweep: ' + ok + '/50 valid');

	// determinism: same seed => identical campaign checksum x3
	const sums = [1, 2, 3].map(() => generateCampaign(1234).checksum);
	check(sums[0] === sums[1] && sums[1] === sums[2], 'campaign checksum identical across 3 runs (' + sums[0] + ')');

	// floors within one campaign are distinct
	{
		const campaign = generateCampaign(5);
		const floorSums = new Set(campaign.floors.map((f) => f.checksum));
		check(floorSums.size === 5, 'floors have distinct checksums (' + floorSums.size + '/5)');
	}

	// ramps match the formulas at i = 1, 3, 5
	check(roomCountFor(1, {}) === 34 && roomCountFor(3, {}) === 46 && roomCountFor(5, {}) === 58,
		'roomCount ramp 34/46/58 at floors 1/3/5');
	check(roomCountFor(3, { roomCount: 20 }) === 20, 'explicit roomCount overrides the ramp');
	{
		const campaign = generateCampaign(9);
		const floor3 = campaign.floors[2];
		const nonBoss = floor3.rooms.filter((r) => r.type !== 'boss' && r.type !== 'dragon');
		const minDifficulty = Math.min(...nonBoss.map((r) => r.difficulty));
		check(minDifficulty >= 0.15 + 0.2 - 1e-9, 'floor 3 difficulty bias +0.2 applied (min ' + minDifficulty.toFixed(2) + ')');
		check(campaign.floors.every((f, i) => f.theme.id === THEMES[i % THEMES.length].id), 'themes cycle crypt→sewer→forge→frost→roost');
	}

	// spawn typing: every spawn's monster type is legal for its floor
	{
		const campaign = generateCampaign(21);
		const table = { spider: [1, 2], bat: [1, 3], slime: [2, 3], skeleton: [2, 4], goblin: [3, 4], wraith: [3, 5], golem: [4, 5] };
		let illegal = 0, untyped = 0, varietyMiss = 0;
		campaign.floors.forEach((floor, k) => {
			const i = k + 1;
			floor.spawns.forEach((s) => {
				if (!s.type) untyped++;
				else if (i < table[s.type][0] || i > table[s.type][1]) illegal++;
			});
			const legal = Object.entries(table).filter(([, [lo, hi]]) => i >= lo && i <= hi).map(([id]) => id);
			if (floor.spawns.length >= 12) {
				const present = new Set(floor.spawns.map((s) => s.type));
				if (!legal.every((id) => present.has(id))) varietyMiss++;
			}
		});
		check(untyped === 0 && illegal === 0, 'all spawns typed and legal for their floor');
		check(varietyMiss === 0, 'variety pass: every legal type appears on >= 12-slot floors');
	}

	// injection path: a fake custom species picked ONLY on its floors
	{
		const fakeTable = [
			{ id: 'spider', floors: [1, 5], weight: 1 },
			{ id: 'customfake', floors: [2, 4], weight: 50 }
		];
		const campaign = generateCampaign(33, {}, fakeTable);
		let onLegal = 0, offLegal = 0;
		campaign.floors.forEach((floor, k) => {
			const i = k + 1;
			const count = floor.spawns.filter((s) => s.type === 'customfake').length;
			if (i >= 2 && i <= 4) onLegal += count;
			else offLegal += count;
		});
		check(onLegal > 0 && offLegal === 0, 'injected species on floors 2-4 only (' + onLegal + ' picks, ' + offLegal + ' illegal)');
	}

	// portal chain + world offsets: floor k+1's DOWN portal lands on floor k's UP portal
	{
		const campaign = generateCampaign(77);
		let aligned = 0;
		for (let k = 1; k < campaign.floors.length; k++) {
			const up = campaign.floors[k - 1].portals.find((p) => p.kind === 'up');
			const down = campaign.floors[k].portals.find((p) => p.kind === 'down');
			if (
				up && down &&
				campaign.floors[k - 1].ox + up.x === campaign.floors[k].ox + down.x &&
				campaign.floors[k - 1].oy + up.y === campaign.floors[k].oy + down.y
			)
				aligned++;
		}
		check(aligned === 4, 'world offsets align all 4 portal pairs (' + aligned + '/4)');
		const top = campaign.floors[4];
		check(!top.portals.some((p) => p.kind === 'up'), 'top floor has no UP portal');
		check(top.rooms.some((r) => r.type === 'dragon'), 'top floor boss room is the dragon arena');
		const gated = campaign.floors.slice(0, 4).every((f) => f.portals.find((p) => p.kind === 'up')?.gated === true);
		check(gated, 'every intermediate UP portal is gated');
	}

	// every portal stands on FLOOR and is BFS-reachable
	{
		const campaign = generateCampaign(55);
		let bad = 0;
		campaign.floors.forEach((floor) => {
			floor.portals.forEach((portal) => {
				const i = portal.y * floor.W + portal.x;
				if (floor.grid[i] !== FLOOR || floor.bfs[i] < 0) bad++;
			});
		});
		check(bad === 0, 'all portals on reachable floor cells');
	}
}
