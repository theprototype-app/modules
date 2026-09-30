// 30b — the pure half of the game's FEEL: where each floor starts (api.setSpawn), when a
// footstep sounds, which built-in sound/effect/haptic a game event plays. No THREE, no DOM, no
// api (node-tested in test/juice.test.mjs); game.js calls the SDK with what these return.

/** core's walker test (dungeonPlay.walkable, verbatim): can a circle of radius r stand at (x, z)
 * on the Kit's published WALK raster? @param {any} play @param {number} x @param {number} z */
export function standable(play, x, z, r = 0.3) {
	const { grid, width, height, minX, minY, floorValue } = play;
	for (const [ox, oz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
		const cx = Math.floor(x + ox - minX);
		const cz = Math.floor(z + oz - minY);
		if (cx < 0 || cz < 0 || cx >= width || cz >= height) return false;
		if (grid[cz * width + cx] !== floorValue) return false;
	}
	return true;
}

/** the three.js yaw that FACES (dx, dz): rotation.y, 0 faces -Z @param {number} dx @param {number} dz */
export function yawFacing(dx, dz) {
	return Math.atan2(-dx, -dz);
}

/** how far (metres, 0.25 m steps) a walker can go from (x, z) along (dx, dz) @param {any} play */
function clearDistance(play, x, z, dx, dz, max = 12) {
	let d = 0;
	while (d < max && standable(play, x + dx * (d + 0.25), z + dz * (d + 0.25))) d += 0.25;
	return d;
}

/** the direction (of 16) with the longest clear view of floor from (x, z) @param {any} play */
function bestFacing(play, x, z) {
	let best = { dx: 0, dz: -1, dist: -1 };
	for (let i = 0; i < 16; i++) {
		const a = (i / 16) * Math.PI * 2;
		const dx = Math.round(Math.sin(a) * 1e9) / 1e9, dz = Math.round(-Math.cos(a) * 1e9) / 1e9;
		const dist = clearDistance(play, x, z, dx, dz);
		if (dist > best.dist) best = { dx, dz, dist };
	}
	return best;
}

/**
 * Where a floor STARTS, for the player in party slot `slot` (0 = P1, 1 = P2, ...):
 * floor 1 — the entrance room's centre (the arch); a floor you climbed to — beside its DOWN
 * portal (which stands where the portal you took stood), 1.6 m OFF it so nobody arrives on a
 * portal, on the side with the most open floor. Facing the longest clear view (into the
 * dungeon, never at a wall or a pillar). Players stand side by side (0.8 m apart) where the
 * floor allows. Returns null without a contract.
 * @param {any} play the Kit's userData.play @param {number} [slot]
 * @returns {{position: [number, number, number], yaw: number} | null}
 */
export function spawnFor(play, slot = 0) {
	if (!play?.grid || !play.rooms?.length) return null;
	const down = (play.portals ?? []).find((p) => p.kind === 'down');
	const entrance = play.rooms[0];
	let x = down ? down.wx : entrance.cx, z = down ? down.wz : entrance.cz;
	let face = bestFacing(play, x, z);
	if (down) {
		let best = null;
		for (let i = 0; i < 8; i++) {
			const a = (i / 8) * Math.PI * 2;
			const cx = down.wx + Math.sin(a) * 1.6, cz = down.wz - Math.cos(a) * 1.6;
			if (!standable(play, cx, cz)) continue;
			const f = bestFacing(play, cx, cz);
			if (!best || f.dist > best.f.dist) best = { x: cx, z: cz, f };
		}
		if (best) ({ x, z, f: face } = best);
	}
	// side by side: slot 1 to the right of slot 0, slot 2 to the left, ...
	if (slot > 0) {
		const side = slot % 2 === 1 ? 1 : -1;
		const k = Math.ceil(slot / 2) * 0.8;
		// right of facing (fx, fz) is (-fz, fx) in x/z
		const sx = x - face.dz * side * k, sz = z + face.dx * side * k;
		if (standable(play, sx, sz)) { x = sx; z = sz; }
		else if (standable(play, x + face.dz * side * k, z - face.dx * side * k)) { x += face.dz * side * k; z -= face.dx * side * k; }
	}
	return { position: [x, 0, z], yaw: yawFacing(face.dx, face.dz) };
}

/** metres of walking between two footsteps */
export const STRIDE = 0.75;

/**
 * The footstep clock: feed it the viewer's position each frame; it returns true on the frame a
 * stride completes. Horizontal distance only; a jump of more than 3 m in one frame (a spawn, a
 * floor change, a teleport) is not walking and resets it. Mutates `s`.
 * @param {{x?: number, z?: number, walked?: number}} s @param {{x: number, z: number}} pos
 */
export function footstep(s, pos) {
	if (s.x == null || s.z == null) {
		s.x = pos.x; s.z = pos.z; s.walked = 0;
		return false;
	}
	const d = Math.hypot(pos.x - s.x, pos.z - s.z);
	s.x = pos.x; s.z = pos.z;
	if (d > 3) { s.walked = 0; return false; }
	s.walked = (s.walked ?? 0) + d;
	if (s.walked >= STRIDE) { s.walked -= STRIDE; return true; }
	return false;
}

/**
 * THE FEEL TABLE — what each game event plays on the SDK (C4 haptics, C5 sounds + music, C6
 * bursts, C2 announce). `local` = this peer did it (the haptic is theirs); a replicated event
 * from a peer plays its sound and effect but never buzzes your hands.
 * @param {'gem' | 'unseal' | 'floor' | 'start' | 'victory' | 'step'} event
 * @param {{local?: boolean, floor?: number, name?: string, color?: number}} [ctx]
 */
export function feel(event, ctx = {}) {
	switch (event) {
		case 'gem': return { sound: 'coin', burst: { kind: 'sparkle', color: ctx.color, count: 24 }, haptic: ctx.local ? 'success' : null };
		case 'unseal': return { sound: 'portal', burst: { kind: 'sparks', color: ctx.color, count: 40 }, haptic: ctx.local ? 'bump' : null, announce: { text: 'The portal unseals!', sub: 'Step onto it together' } };
		case 'floor': return { sound: 'levelup', announce: { text: 'Floor ' + ctx.floor, sub: ctx.name } };
		case 'start': return { sound: 'success', music: 'dungeon', announce: { text: 'Floor ' + (ctx.floor ?? 1), sub: ctx.name } };
		case 'victory': return { sound: 'cheer', burst: { kind: 'confetti', count: 80 }, haptic: ctx.local ? 'success' : null, announce: { text: 'The hoard is yours!', sub: 'Every floor cleared' } };
		case 'step': return { sound: 'step' };
		default: return {};
	}
}
