// football — THE PITCH AS DATA, pure. `pitchObjects(dims)` is the object list a pitch is
// made of (the def's `objects` shape from core's author-templates.cjs: type, name, size,
// pos, colour, emissive, opacity, physics) and `pitchGraph(names)` the node graph that
// wires the Football nodes to it. The toolbox's "Build pitch" recipe creates exactly
// these through api.create / api.physics.set / api.flow.addNodes, and the orchestrator's
// FOOTBALL_DEF is the same two lists serialised — one source, two consumers.
//
// Frame: the pitch is centred on the origin, LENGTH runs along z (gates at -z for red,
// +z for blue), WIDTH along x, y up. B3 sizes it for a real room by default.

export const RED = 0xd94a4a;
export const BLUE = 0x4a7dd9;
export const LAMP_DIM = 0x22262e;
export const LAMPS_PER_GATE = 10;

/** B3 defaults: a living room. Mouths centred at chest height, ball served at 1.3 m. */
export const DEFAULT_DIMS = {
	length: 5,
	width: 3,
	height: 2.4,
	gateWidth: 1.2,
	gateHeight: 0.8,
	mouthY: 1.35,
	ballY: 1.3,
	ballRadius: 0.22,
	sensorDepth: 0.5
};

/** @param {any} v @param {number} lo @param {number} hi @param {number} d */
function num(v, lo, hi, d) {
	const n = Number(v);
	return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
}

/** Clamp dims to what fits a room and a headset. @param {any} raw */
export function normalizeDims(raw) {
	const r = raw && typeof raw === 'object' ? raw : {};
	const d = DEFAULT_DIMS;
	const length = num(r.length, 2, 30, d.length);
	const width = num(r.width, 1.5, 20, d.width);
	return {
		length,
		width,
		height: num(r.height, 1.8, 8, d.height),
		gateWidth: num(r.gateWidth, 0.5, Math.min(width, 6), Math.min(d.gateWidth, width)),
		gateHeight: num(r.gateHeight, 0.3, 3, d.gateHeight),
		mouthY: num(r.mouthY, 0.5, 2.2, d.mouthY),
		ballY: num(r.ballY, 0.3, 2.2, d.ballY),
		ballRadius: num(r.ballRadius, 0.08, 0.6, d.ballRadius),
		sensorDepth: num(r.sensorDepth, 0.3, 1.5, d.sensorDepth)
	};
}

/** Object names — the contract the graph, the recipe and the flight all read. */
export const NAMES = {
	pitch: 'Pitch',
	ball: 'Football',
	redGate: 'Red gate',
	blueGate: 'Blue gate',
	joinRed: 'Join red',
	joinBlue: 'Join blue',
	start: 'Start match',
	newMatch: 'New match',
	lamp: (/** @type {string} */ team, /** @type {number} */ i) => (team === 'red' ? 'Red' : 'Blue') + ' lamp ' + i
};

/**
 * Every object of a pitch, in creation order. Static everything, one dynamic ball.
 * @param {any} [dims]
 */
export function pitchObjects(dims) {
	const d = normalizeDims(dims);
	const hl = d.length / 2;
	const hw = d.width / 2;
	const wall = 0.05;
	const mouthZ = hl - 0.3; // the gate mouth sits 30 cm in from the end wall
	const sensorZ = mouthZ + d.sensorDepth / 2;
	const endZ = mouthZ + d.sensorDepth + 0.05; // the end wall closes just past the sensor
	const post = 0.06;
	/** @type {any[]} */
	const out = [];
	const stat = (/** @type {any} */ extra) => ({ mode: 'static', ...(extra ?? {}) });

	// the floor is the pitch; the real floor when colocated
	out.push({ type: 'box', name: NAMES.pitch, color: 0x3a4a3d, size: [d.width, wall, endZ * 2], pos: [0, -wall / 2, 0], roughness: 0.95, physics: stat({ friction: 0.6 }) });
	// six invisible walls keep the ball in play (floor above is the seventh face)
	const ghost = { color: 0x9ee6ff, opacity: 0.06 };
	out.push({ type: 'box', name: 'Wall left', ...ghost, size: [wall, d.height, endZ * 2], pos: [-hw - wall / 2, d.height / 2, 0], physics: stat() });
	out.push({ type: 'box', name: 'Wall right', ...ghost, size: [wall, d.height, endZ * 2], pos: [hw + wall / 2, d.height / 2, 0], physics: stat() });
	out.push({ type: 'box', name: 'Wall red end', ...ghost, size: [d.width, d.height, wall], pos: [0, d.height / 2, -endZ - wall / 2], physics: stat() });
	out.push({ type: 'box', name: 'Wall blue end', ...ghost, size: [d.width, d.height, wall], pos: [0, d.height / 2, endZ + wall / 2], physics: stat() });
	out.push({ type: 'box', name: 'Ceiling', ...ghost, size: [d.width, wall, endZ * 2], pos: [0, d.height + wall / 2, 0], physics: stat() });

	for (const team of /** @type {const} */ (['red', 'blue'])) {
		const sign = team === 'red' ? -1 : 1;
		const color = team === 'red' ? RED : BLUE;
		const z = sign * mouthZ;
		const gx = d.gateWidth / 2;
		const gy = d.gateHeight / 2;
		const frame = { color, emissive: color, emissiveIntensity: 0.9, roughness: 0.4 };
		const T = team === 'red' ? 'Red' : 'Blue';
		out.push({ type: 'box', name: T + ' post left', ...frame, size: [post, d.gateHeight + post, post], pos: [-gx, d.mouthY, z], physics: stat() });
		out.push({ type: 'box', name: T + ' post right', ...frame, size: [post, d.gateHeight + post, post], pos: [gx, d.mouthY, z], physics: stat() });
		out.push({ type: 'box', name: T + ' bar top', ...frame, size: [d.gateWidth + post, post, post], pos: [0, d.mouthY + gy, z], physics: stat() });
		out.push({ type: 'box', name: T + ' bar bottom', ...frame, size: [d.gateWidth + post, post, post], pos: [0, d.mouthY - gy, z], physics: stat() });
		// the sensor: a box BEHIND the mouth, deep enough that a 10 m/s ball cannot cross
		// it in one 16 ms step (0.16 m) — the B4 tunnelling note
		out.push({
			type: 'box',
			name: team === 'red' ? NAMES.redGate : NAMES.blueGate,
			color,
			opacity: 0.12,
			size: [d.gateWidth, d.gateHeight, d.sensorDepth],
			pos: [0, d.mouthY, sign * sensorZ],
			physics: stat({ sensor: true, collider: 'box' })
		});
		// score lamps: two rows of five above the bar, lit from the outside in by fblamp
		const lampY0 = d.mouthY + gy + 0.25;
		for (let i = 1; i <= LAMPS_PER_GATE; i++) {
			const row = i <= 5 ? 0 : 1;
			const col = (i - 1) % 5;
			out.push({
				type: 'box',
				name: NAMES.lamp(team, i),
				color: LAMP_DIM,
				emissive: LAMP_DIM,
				emissiveIntensity: 0.2,
				size: [0.16, 0.16, 0.06],
				pos: [-0.5 + col * 0.25, lampY0 + row * 0.22, z],
				physics: stat()
			});
		}
		// the join button stands AT the gate: claiming a team is walking to your end
		out.push({
			type: 'box',
			name: team === 'red' ? NAMES.joinRed : NAMES.joinBlue,
			color,
			emissive: color,
			emissiveIntensity: 0.5,
			size: [0.3, 0.12, 0.3],
			pos: [sign * -1 * (hw - 0.3), 1.05, sign * (mouthZ - 0.6)],
			physics: stat()
		});
	}
	// Start / New match at the pitch's side, within reach from the centre line
	out.push({ type: 'box', name: NAMES.start, color: 0x4c9e6a, emissive: 0x4c9e6a, emissiveIntensity: 0.5, size: [0.3, 0.12, 0.3], pos: [hw - 0.3, 1.05, -0.35], physics: stat() });
	out.push({ type: 'box', name: NAMES.newMatch, color: 0x8a8f9a, emissive: 0x8a8f9a, emissiveIntensity: 0.4, size: [0.3, 0.12, 0.3], pos: [hw - 0.3, 1.05, 0.35], physics: stat() });
	// the ball, last: one dynamic body, floating (the scene's zero-g block keeps it up)
	out.push({
		type: 'sphere',
		name: NAMES.ball,
		color: 0xf2f2f2,
		r: d.ballRadius,
		pos: [0, d.ballY, 0],
		roughness: 0.6,
		physics: { mode: 'dynamic', mass: 0.45, restitution: 0.7, friction: 0.2 }
	});
	return out;
}

/** The scene-physics block the pitch needs (fork 2: floating ball). Moon = gravity -1.6. */
export const PITCH_PHYSICS = {
	gravity: 0,
	ground: { enabled: false },
	damping: { linear: 0.35, angular: 0.5 },
	ccd: true,
	knock: { enabled: true, gain: 1, maxSpeed: 10, spin: 0.8 },
	play: { interaction: 'grab', grounded: false, simOnPlay: true }
};

/** The `/create` command for one object. @param {any} o */
export function createCommand(o) {
	if (o.type === 'sphere') return '/create Sphere ' + o.r;
	const [w, h, dpt] = o.size;
	return '/create Box ' + w + ' ' + h + ' ' + dpt;
}

/**
 * The graph, with Object Selectors keyed by NAME (the author script remaps names to
 * uuids; the recipe passes `names` = {name: uuid} and gets uuids straight away).
 * Layout: one row per binding, the Towers `N`/`E` conventions.
 * @param {Record<string, string>} [names] name -> uuid; absent = keep the name
 * @param {{hudButtons?: boolean}} [opts] also wire the DOM HUD's buttons (the def does)
 */
export function pitchGraph(names, opts = {}) {
	const sel = (/** @type {string} */ name) => names?.[name] ?? name;
	/** @type {any[]} */ const nodes = [];
	/** @type {any[]} */ const edges = [];
	const N = (id, type, label, x, y, data) => {
		nodes.push({ id, type, position: { x, y }, data: { label, ...data }, class: 'w-[150px]' });
		return id;
	};
	const E = (source, target, handle) => {
		edges.push({ id: 'e-' + source + '-' + target + (handle ? '.' + handle : ''), source, target, ...(handle ? { targetHandle: handle } : {}) });
	};
	let y = 40;
	const row = () => (y += 150);

	// Match Rules sits on the pitch (a static object — a football node may never TARGET
	// the ball, the runtime re-seats a targeted object's base pose every frame) and names
	// the ball through its object input
	N('rules', 'fbrules', 'Match Rules', 280, y, {});
	N('selpitch', 'objectselector', 'Pitch', 520, y, { selected: sel(NAMES.pitch) });
	E('rules', 'selpitch');
	N('selball', 'objectselector', 'Football', 40, y, { selected: sel(NAMES.ball) });
	E('selball', 'rules', 'ball');
	row();
	N('gater', 'fbgate', 'Red gate', 280, y, { team: 'red' });
	N('selgater', 'objectselector', 'Red gate sensor', 520, y, { selected: sel(NAMES.redGate) });
	E('gater', 'selgater');
	row();
	N('gateb', 'fbgate', 'Blue gate', 280, y, { team: 'blue' });
	N('selgateb', 'objectselector', 'Blue gate sensor', 520, y, { selected: sel(NAMES.blueGate) });
	E('gateb', 'selgateb');
	row();
	// the sheet + the scoreboard rows (HUD list ids the def's HUD document carries)
	N('records', 'fbrecords', 'Records', 280, y, {
		show: 'all',
		element: opts.hudButtons ? 'fb-sheet,fb-sheet-play' : 'fb-sheet',
		scoreElement: opts.hudButtons ? 'fb-score,fb-score-over' : 'fb-score',
		logElement: opts.hudButtons ? 'fb-log' : ''
	});
	E('records', 'selpitch');
	row();
	// the physical buttons: each fbbutton targets its button object; a click on the
	// object (desktop or VR trigger) runs the action on the clicker's peer
	const buttons = [
		['bjoinr', NAMES.joinRed, 'join-red'],
		['bjoinb', NAMES.joinBlue, 'join-blue'],
		['bstart', NAMES.start, 'start'],
		['bnew', NAMES.newMatch, 'new-match']
	];
	for (const [id, name, action] of buttons) {
		N(id, 'fbbutton', 'Button: ' + action, 280, y, { action });
		N('sel' + id, 'objectselector', name, 520, y, { selected: sel(name) });
		E(id, 'sel' + id);
		if (opts.hudButtons) {
			// the DOM HUD's button of the same action pulses the same node, LOCALLY
			N('h' + id, 'hudbutton', 'HUD ' + action, 40, y, { element: 'fb-' + action, perPlayer: true });
			E('h' + id, id, 'press');
		}
		row();
	}
	// score lamps, one node per lamp
	for (const team of ['red', 'blue']) {
		for (let i = 1; i <= LAMPS_PER_GATE; i++) {
			const id = 'lamp' + team + i;
			const x = 40 + ((i - 1) % 5) * 240;
			if ((i - 1) % 5 === 0 && i > 1) row();
			N(id, 'fblamp', (team === 'red' ? 'Red' : 'Blue') + ' lamp ' + i, x, y, { team, index: i });
			N('sel' + id, 'objectselector', NAMES.lamp(team, i), x, y + 70, { selected: sel(NAMES.lamp(team, i)) });
			E(id, 'sel' + id);
		}
		row();
	}
	if (opts.hudButtons) {
		// the over screen's and the pause menu's New match buttons: their own Match Button
		// nodes (two edges into one `press` handle would not OR — the last wins)
		for (const [id, element] of [['bnewover', 'fb-new-match'], ['bnewpause', 'fb-new-match-pause']]) {
			N(id, 'fbbutton', 'Button: new-match (' + element + ')', 280, y, { action: 'new-match' });
			E(id, 'selbnew');
			N('h' + id, 'hudbutton', 'HUD ' + element, 40, y, { element, perPlayer: true });
			E('h' + id, id, 'press');
			row();
		}
		// pause / resume / quit while playing: Towers' rows verbatim (P toggles the menu)
		N('pkey', 'keypress', 'Press P', 40, y, { code: 'KeyP', edge: 'down', pulse: 0.3 });
		N('pausetoggle', 'hudscreen', 'Toggle pause menu', 280, y, { screen: 'pause', action: 'toggle' });
		E('pkey', 'pausetoggle', 'trigger');
		row();
		N('bresume', 'hudbutton', 'Resume button', 40, y, { element: 'resume-btn' });
		N('resumehide', 'hudscreen', 'Close pause menu', 280, y, { screen: 'pause', action: 'hide' });
		E('bresume', 'resumehide', 'trigger');
		row();
		N('bquit', 'hudbutton', 'Quit to menu button', 40, y, { element: 'quit-btn' });
		N('doquit', 'setgamestate', 'Quit to menu', 280, y, { state: 'menu', outcome: '', reset: true });
		N('quithide', 'hudscreen', 'Close pause on quit', 520, y, { screen: 'pause', action: 'hide' });
		E('bquit', 'doquit', 'trigger');
		E('bquit', 'quithide', 'trigger');
		row();
	}
	// the game shell follows the match: start -> playing, over -> over (the DOM HUD's
	// screens hang off these; a headset reads the lamps instead)
	N('evstart', 'fbevent', 'On match start', 40, y, { event: 'start' });
	N('gostart', 'setgamestate', 'Match: playing', 280, y, { state: 'playing', outcome: '', reset: false });
	E('evstart', 'gostart', 'trigger');
	row();
	N('evover', 'fbevent', 'On match over', 40, y, { event: 'over' });
	N('goover', 'setgamestate', 'Match: over', 280, y, { state: 'over', outcome: 'Match over', reset: false });
	E('evover', 'goover', 'trigger');
	row();
	N('evnew', 'fbevent', 'On new match', 40, y, { event: 'reset' });
	N('gomenu', 'setgamestate', 'Match: menu', 280, y, { state: 'menu', outcome: '', reset: true });
	E('evnew', 'gomenu', 'trigger');
	row();
	// a goal chimes at its gate through api.playSound on every peer (each applies the
	// same goal op), so no sound node and no audio asset is needed here
	return { nodes, edges };
}
