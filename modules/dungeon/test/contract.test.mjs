// The play contract — pure, node-run. What core and Dungeon Realms both read.
import { generateCampaign } from '../src/gen/campaign.js';
import { FLOOR } from '../src/gen/dungeon.js';
import { playPayload, mergeMarkers, normalizeParams, CONTRACT_VERSION } from '../src/contract.js';

export function run(check) {
	const campaign = generateCampaign(1234);
	const play = playPayload(campaign, 1);
	// the dungeonPlay.js half is byte-shaped: grid + dims + offsets + rooms + floorValue
	check(play.grid === campaign.floors[0].grid && play.width === campaign.floors[0].W && play.height === campaign.floors[0].H, 'raster, width and height are the floor\'s own');
	check(play.minX === campaign.floors[0].ox && play.minY === campaign.floors[0].oy, 'minX/minY are the campaign world offsets');
	check(play.floorValue === FLOOR, 'floorValue is FLOOR');
	check(play.rooms[0].type === 'entrance', 'rooms are spawn-ordered: the entrance comes first');
	const depths = play.rooms.slice(1).map((r) => r.depth);
	check(depths.every((d, i) => i === 0 || depths[i - 1] <= d), 'then by depth (both players spawn near the start)');
	// the seam half
	check(play.contract === CONTRACT_VERSION && play.seed === 1234 && play.floorIndex === 1 && play.levelCount === 5, 'seam: contract version, seed, floorIndex, levelCount');
	const gems = play.props.filter((p) => p.kind === 'gem');
	check(gems.length >= 4 && gems.every((g) => typeof g.index === 'number' && typeof g.wx === 'number' && typeof g.wz === 'number'), 'gem props carry index + world coords (' + gems.length + ')');
	const up = play.portals.find((p) => p.kind === 'up');
	check(!!up && up.gated === true && up.wx === up.x + play.minX + 0.5, 'the gated UP portal is in world coordinates');
	// floor 2's DOWN portal stands exactly where floor 1's UP portal stands (world space)
	const play2 = playPayload(campaign, 2);
	const down = play2.portals.find((p) => p.kind === 'down');
	check(!!down && down.wx === up.wx && down.wz === up.wz, 'floor 2 DOWN portal lands on floor 1 UP portal in world space');
	// world coords sit on FLOOR cells of the raster the same record publishes
	const onFloor = gems.every((g) => play.grid[(Math.floor(g.wz - play.minY)) * play.width + Math.floor(g.wx - play.minX)] === FLOOR);
	check(onFloor, 'every gem world coordinate resolves to a FLOOR cell of the published raster');
	// defaults: grounded, no markers
	check(play.grounded === true && Array.isArray(play.markers) && play.markers.length === 0, 'a bare Kit publishes grounded:true and NO markers');
	check(playPayload(campaign, 1, { grounded: false }).grounded === false, 'grounded can be overridden by a rule module');
	check(playPayload(campaign, 9) === null, 'a floor past the campaign is null, never a throw');
	// markers merge by owner name order, garbage dropped
	const merged = mergeMarkers({ zeta: [{ x: 1, z: 2, kind: 'gem' }], alpha: [{ x: 3, z: 4 }, { x: 'no' }] });
	check(merged.length === 2 && merged[0].x === 3 && merged[0].kind === 'marker' && merged[1].kind === 'gem', 'mergeMarkers: owner order, kind default, garbage dropped');
	// params clamp
	const p = normalizeParams({ roomCount: 999, loopChance: -1, levelCount: 0, gemDensity: 5 });
	check(p.roomCount === 60 && p.loopChance === 0 && p.levelCount === 1 && p.gemDensity === 2, 'normalizeParams clamps into the generator ranges');
	check(Object.keys(normalizeParams({})).length === 0, 'normalizeParams leaves absent params absent');
}
