// football — THE ARENA, pure (30-visuals-mod). Everything the TEMPLATE adds around the pitch
// to make it look like a stadium: turf with mowing stripes and line markings, a stadium floor
// that covers the editor grid, four floodlights on poles (one casts the shadows), the two
// scoreboard boards behind the lamp strips, a glowing net in each gate (the score Pulse),
// perimeter boards. None of it is a rule: no body of its own (the group's one collider is a floor
// slab, see floorSlab), no node targets it except the two nets' Play Animation, and the
// toolbox recipe never builds it (it only makes boxes and a sphere).
//
// ONE top-level group, `Arena`, so the scene gains exactly one object (the core game suite
// counts them) and "Fit pitch" can re-lay the whole look in one move. Decoration the editor
// click should pass through carries `pick: 'through'` (fork 3), so a click on the turf still
// selects the Pitch box underneath — the object Match Rules targets.

import { normalizeDims, lampStripY, pitchObjects, NAMES, RED, BLUE } from './pitch.js';

export const ARENA = 'Arena';

/** 30: the decoration group's OWN collider. Core's physics makes every top-level object a fixed
 * body, and a group's default collider is the box around ALL its children — for an arena that
 * box would swallow the play volume (the ball sat inside it and never moved). So the group
 * carries an explicit custom collider: a thin floor slab under the ground, nothing else.
 * @param {number} halfW @param {number} halfD @param {number} top */
export function floorSlab(halfW, halfD, top) {
	const verts = [];
	for (const y of [top - 0.06, top]) for (const x of [-halfW, halfW]) for (const z of [-halfD, halfD]) verts.push(x, y, z);
	return { mode: 'static', collider: 'custom', colliderVerts: verts };
}

export const NET = (/** @type {'red'|'blue'} */ team) => (team === 'red' ? 'Red' : 'Blue') + ' gate net';

const TURF = 0x2f7a3c;
const STRIPE = 0x3b8c48;
const LINE = { color: 0xf4f7f2, emissive: 0xf4f7f2, emissiveIntensity: 0.35, roughness: 0.8, shadow: false, pick: 'through' };
const FLAT = [-Math.PI / 2, 0, 0];

/** @param {any} [dims] */
export function arenaObjects(dims) {
	const d = normalizeDims(dims);
	const hl = d.length / 2;
	const hw = d.width / 2;
	const mouthZ = hl - 0.3;
	const endZ = mouthZ + d.sensorDepth + 0.05;
	const L = endZ * 2; // the pitch box's full length
	/** @type {any[]} */
	const kids = [];
	const flat = (/** @type {string} */ name, /** @type {number} */ w, /** @type {number} */ l, /** @type {number[]} */ pos, /** @type {any} */ look) =>
		kids.push({ type: 'plane', name, size: [w, l], pos, rot: FLAT, ...look });

	// ---- the ground: a stadium floor over the editor grid, the turf over the pitch ----------
	// (the grid draws at y = 0 and the Pitch box's top IS y = 0, which is why the grid showed
	// through it; these sit a hair above)
	flat('Stadium floor', 400, 400, [0, 0.012, 0], { color: 0x4a5462, roughness: 0.9, pick: 'through' });
	flat('Turf', d.width, L, [0, 0.02, 0], { color: TURF, roughness: 0.95, pick: 'through' });
	// mowing stripes: every other band across the length, a shade lighter
	const bands = 8;
	for (let i = 0; i < bands; i += 2)
		flat('Turf stripe ' + (i / 2 + 1), d.width, L / bands, [0, 0.022, -L / 2 + (i + 0.5) * (L / bands)], { color: STRIPE, roughness: 0.95, pick: 'through', shadow: false });

	// ---- markings: thin emissive planes (5 cm lines) ----------------------------------------
	const t = 0.05;
	const y = 0.025;
	const inset = 0.12;
	flat('Touchline left', t, L - 2 * inset, [-hw + inset, y, 0], LINE);
	flat('Touchline right', t, L - 2 * inset, [hw - inset, y, 0], LINE);
	flat('Goal line red', d.width - 2 * inset, t, [0, y, -endZ + inset], LINE);
	flat('Goal line blue', d.width - 2 * inset, t, [0, y, endZ - inset], LINE);
	flat('Halfway line', d.width - 2 * inset, t, [0, y, 0], LINE);
	const circle = Math.min(0.6, hw * 0.4);
	kids.push({ type: 'ring', name: 'Centre circle', r: circle, inner: circle - t, pos: [0, y, 0], rot: FLAT, ...LINE });
	kids.push({ type: 'ring', name: 'Centre spot', r: 0.07, inner: 0.001, pos: [0, y, 0], rot: FLAT, ...LINE });
	// the box in front of each gate
	const boxW = Math.min(d.width - 0.6, d.gateWidth + 0.8);
	const boxD = 0.7;
	for (const sign of [-1, 1]) {
		const T = sign < 0 ? 'red' : 'blue';
		const gz = sign * (endZ - inset);
		flat('Box front ' + T, boxW, t, [0, y, gz - sign * boxD], LINE);
		flat('Box left ' + T, t, boxD, [-boxW / 2, y, gz - sign * (boxD / 2)], LINE);
		flat('Box right ' + T, t, boxD, [boxW / 2, y, gz - sign * (boxD / 2)], LINE);
	}

	// ---- the gates: a glowing net at the back of each sensor (the Pulse plays on a goal),
	// a team light inside, and the scoreboard board behind the lamp strip ---------------------
	for (const team of /** @type {const} */ (['red', 'blue'])) {
		const sign = team === 'red' ? -1 : 1;
		const color = team === 'red' ? RED : BLUE;
		const T = team === 'red' ? 'Red' : 'Blue';
		const netZ = sign * (mouthZ + d.sensorDepth);
		kids.push({
			type: 'plane',
			name: NET(team),
			size: [d.gateWidth, d.gateHeight],
			pos: [0, d.mouthY, netZ],
			color,
			emissive: color,
			emissiveIntensity: 1.2,
			opacity: 0.45,
			side: 'double',
			shadow: false,
			pick: 'through',
			anim: 'pulse'
		});
		kids.push({ type: 'light', name: T + ' gate glow', color, intensity: 1.2, distance: 3, pos: [0, d.mouthY, sign * (mouthZ + d.sensorDepth / 2)] });
		// the board: a dark rounded slab just behind the lamps, a team-colour trim under it
		const lampY = lampStripY(d);
		const boardW = Math.min(d.width - 0.1, 2.5);
		kids.push({ type: 'box', name: T + ' scoreboard', size: [boardW, 0.26, 0.04], bevel: 0.03, pos: [0, lampY, sign * (mouthZ + 0.05)], color: 0x10151d, roughness: 0.4, clearcoat: 0.6 });
		kids.push({ type: 'box', name: T + ' scoreboard trim', size: [boardW, 0.03, 0.05], pos: [0, lampY + 0.145, sign * (mouthZ + 0.05)], color, emissive: color, emissiveIntensity: 2, shadow: false });
	}

	// ---- the glass's aluminium frame: four corner posts and the top rails ------------------
	const H = d.height;
	const METAL = { color: 0xc9d2dc, metalness: 0.8, roughness: 0.3, pick: 'through' };
	for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
		kids.push({ type: 'box', name: 'Glass post ' + (sx < 0 ? 'L' : 'R') + (sz < 0 ? 'red' : 'blue'), size: [0.05, H, 0.05], pos: [sx * (hw + 0.05), H / 2, sz * (endZ + 0.05)], ...METAL });
	for (const sx of [-1, 1]) kids.push({ type: 'box', name: 'Glass rail ' + (sx < 0 ? 'left' : 'right'), size: [0.05, 0.05, L + 0.15], pos: [sx * (hw + 0.05), H + 0.05, 0], ...METAL, shadow: false });
	for (const sz of [-1, 1]) kids.push({ type: 'box', name: 'Glass rail ' + (sz < 0 ? 'red' : 'blue'), size: [d.width + 0.15, 0.05, 0.05], pos: [0, H + 0.05, sz * (endZ + 0.05)], ...METAL, shadow: false });

	// ---- perimeter boards along both touchlines (emissive, outside the glass) ----------------
	for (const sign of [-1, 1]) {
		kids.push({ type: 'box', name: 'Perimeter board ' + (sign < 0 ? 'left' : 'right'), size: [0.08, 0.28, L * 0.8], pos: [sign * (hw + 0.35), 0.16, 0], color: 0x0f1a2a, emissive: 0x3aa0ff, emissiveIntensity: 0.55, roughness: 0.3 });
	}

	// ---- the VR buttons' stands: a column + a base under each button box, so Join / Start /
	// New match read as consoles, not leftover blocks ------------------------------------------
	const buttons = pitchObjects(dims).filter((o) => [NAMES.joinRed, NAMES.joinBlue, NAMES.start, NAMES.newMatch].includes(o.name));
	for (const b of buttons) {
		const [bx, by, bz] = b.pos;
		kids.push({ type: 'cylinder', name: b.name + ' stand', r: 0.045, r2: 0.06, h: by - 0.06, pos: [bx, (by - 0.06) / 2, bz], color: 0x3a4250, metalness: 0.6, roughness: 0.4, pick: 'through' });
		kids.push({ type: 'cylinder', name: b.name + ' stand base', r: 0.2, h: 0.03, pos: [bx, 0.035, bz], color: 0x2a303a, metalness: 0.4, roughness: 0.5, pick: 'through' });
	}

	// ---- the stands: three stepped tiers on every side, seats in the team colours, so the
	// world past the glass is a stadium and not a void -------------------------------------
	const tiers = 3;
	const tierDepth = 0.9;
	const seat = (/** @type {number} */ i) => [0.9, 1, 0.8][i % 3];
	for (const side of /** @type {const} */ (['left', 'right', 'red', 'blue'])) {
		const along = side === 'left' || side === 'right';
		const sign = side === 'left' || side === 'red' ? -1 : 1;
		const span = along ? L + 1.6 : d.width + 1.2;
		const colour = side === 'left' || side === 'red' ? RED : side === 'right' || side === 'blue' ? BLUE : 0xffffff;
		const start = along ? hw + 2.3 : endZ + 2.3;
		for (let i = 0; i < tiers; i++) {
			const h = 0.45 * (i + 1);
			const off = sign * (start + i * tierDepth + tierDepth / 2);
			const pos = along ? [off, h / 2, 0] : [0, h / 2, off];
			const size = along ? [tierDepth, h, span] : [span, h, tierDepth];
			const T = 'Stand ' + side + ' ' + (i + 1);
			kids.push({ type: 'box', name: T, size, pos, color: 0x39414d, roughness: 0.8, pick: 'through' });
			// the seat row on the tier's front edge, lit a little (the crowd's colours)
			const front = sign * (start + i * tierDepth + 0.12);
			kids.push({
				type: 'box',
				name: T + ' seats',
				size: along ? [0.18, 0.14, span - 0.2] : [span - 0.2, 0.14, 0.18],
				pos: along ? [front, h + 0.07, 0] : [0, h + 0.07, front],
				color: colour,
				emissive: colour,
				emissiveIntensity: 0.25 * seat(i),
				roughness: 0.6,
				shadow: false,
				pick: 'through'
			});
		}
	}

	// ---- four floodlights on poles at the corners; ONE casts the shadows ---------------------
	const px = hw + 1.4;
	const pz = endZ + 1.2;
	const poleH = 5.2;
	let n = 0;
	for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
		n++;
		const x = sx * px;
		const z = sz * pz;
		kids.push({ type: 'cylinder', name: 'Floodlight pole ' + n, r: 0.06, r2: 0.09, h: poleH, pos: [x, poleH / 2, z], color: 0x5b6470, metalness: 0.6, roughness: 0.45 });
		kids.push({ type: 'box', name: 'Floodlight head ' + n, size: [0.7, 0.34, 0.14], bevel: 0.04, pos: [x, poleH + 0.1, z], rot: [0.5 * sz, -0.6 * sx * sz, 0], color: 0xf7f3e6, emissive: 0xfff4d6, emissiveIntensity: 3, roughness: 0.3, shadow: false });
		kids.push({
			type: 'light',
			kind: 'spot',
			name: 'Floodlight ' + n,
			color: 0xfff2dc,
			intensity: 70,
			distance: 22,
			decay: 2,
			angle: 0.62,
			penumbra: 0.55,
			pos: [x, poleH, z],
			target: [-sx * 0.3, 0, -sz * 0.4],
			castShadow: n === 1,
			...(n === 1 ? { shadowMapSize: 1024 } : {})
		});
	}

	// the card's camera: the broadcast angle, high on the right touchline
	kids.push({ type: 'camera', name: 'Broadcast camera', pos: [5.6, 3.5, 2.2], lookAt: [0, 0.7, -0.2], fov: 50 });

	return [{ type: 'group', name: ARENA, physics: floorSlab(30, 30, 0.012), children: kids }];
}

/** The Pulse on a goal: each team's net restarts its authored Pulse clip when that team
 * SCORES (the net of the gate the ball went into — the conceding gate lights up), and a
 * Delay stops it again. Graph rows in the pitchGraph node/edge shape, appended by def.js.
 * @param {number} y0 the row the block starts at */
export function arenaGraph(y0) {
	/** @type {any[]} */ const nodes = [];
	/** @type {any[]} */ const edges = [];
	const N = (/** @type {string} */ id, /** @type {string} */ type, /** @type {string} */ label, /** @type {number} */ x, /** @type {number} */ y, /** @type {any} */ data) =>
		nodes.push({ id, type, position: { x, y }, data: { label, ...data }, class: 'w-[150px]' });
	const E = (/** @type {string} */ source, /** @type {string} */ target, /** @type {string} */ handle = '') =>
		edges.push({ id: 'e-' + source + '-' + target + (handle ? '.' + handle : ''), source, target, ...(handle ? { targetHandle: handle } : {}) });
	let y = y0;
	// a goal INTO the red gate is `bluegoal` (blue scored) — the red net flashes
	for (const [team, event] of /** @type {const} */ ([['red', 'bluegoal'], ['blue', 'redgoal']])) {
		const k = team === 'red' ? 'r' : 'b';
		N('ev' + k + 'net', 'fbevent', 'Goal into the ' + team + ' gate', 40, y, { event });
		// a zero-second Delay: Play Animation acts on its trigger's VALUE edge, and an event
		// output is a stamp (the beat-lab note in core's author script)
		N('d' + k + 'net', 'delay', 'Net pulse (0 s)', 280, y, { seconds: 0, pulse: 0.3 });
		N('p' + k + 'net', 'playanim', 'Pulse the ' + team + ' net', 520, y, { clip: 'Pulse', action: 'restart', speed: 1.6 });
		N('s' + k + 'net', 'objectselector', NET(team), 760, y, { selected: NET(team) });
		E('ev' + k + 'net', 'd' + k + 'net', 'trigger');
		E('d' + k + 'net', 'p' + k + 'net', 'trigger');
		E('p' + k + 'net', 's' + k + 'net');
		// ...and three seconds later the loop stops at rest
		N('w' + k + 'net', 'delay', 'Net rest (3 s)', 280, y + 110, { seconds: 3, pulse: 0.3 });
		N('x' + k + 'net', 'playanim', 'Stop the ' + team + ' net', 520, y + 110, { clip: 'Pulse', action: 'stop', speed: 1 });
		E('ev' + k + 'net', 'w' + k + 'net', 'trigger');
		E('w' + k + 'net', 'x' + k + 'net', 'trigger');
		E('x' + k + 'net', 's' + k + 'net');
		y += 260;
	}
	return { nodes, edges, rows: y };
}
