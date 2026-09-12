// The pitch as data — the object list and the graph the recipe and the def share.
import { pitchObjects, pitchGraph, normalizeDims, DEFAULT_DIMS, NAMES, LAMPS_PER_GATE, createCommand } from '../src/pitch.js';
import { pitchHud } from '../src/hud.js';

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	const objects = pitchObjects();
	const byName = new Map(objects.map((o) => [o.name, o]));
	check(objects.length === 6 + 2 * (5 + LAMPS_PER_GATE + 1) + 2 + 1, 'pitchObjects: floor, 5 ghost walls, 2 gates x (4 frame + sensor + 10 lamps + join button), 2 buttons, 1 ball (' + objects.length + ')');
	check(new Set(objects.map((o) => o.name)).size === objects.length, '  every name is unique');
	const ball = byName.get(NAMES.ball);
	check(ball?.physics.mode === 'dynamic' && objects.filter((o) => o.physics?.mode === 'dynamic').length === 1, 'exactly one dynamic body: the ball');
	check(ball.pos[1] === DEFAULT_DIMS.ballY && ball.r === DEFAULT_DIMS.ballRadius, '  served at 1.3 m, radius 0.22');
	const red = byName.get(NAMES.redGate);
	const blue = byName.get(NAMES.blueGate);
	check(red?.physics.sensor === true && blue?.physics.sensor === true && red.pos[2] < 0 && blue.pos[2] > 0, 'the gate sensors are sensor boxes at opposite ends (red -z, blue +z)');
	check(red.size[2] >= 0.5, '  the sensor is >= 0.5 m deep so a 10 m/s ball cannot cross it in a 16 ms step (' + red.size[2] + ')');
	check(Math.abs(red.pos[1] - DEFAULT_DIMS.mouthY) < 1e-9, '  mouths at chest height');
	const endWall = byName.get('Wall red end');
	check(endWall.pos[2] < red.pos[2] - red.size[2] / 2, '  the end wall closes BEHIND the whole sensor');
	check(byName.get(NAMES.joinRed).pos[2] < 0 && byName.get(NAMES.joinBlue).pos[2] > 0, 'the join buttons stand at their own gates');
	const lamps = objects.filter((o) => /lamp/.test(o.name));
	check(lamps.length === 2 * LAMPS_PER_GATE && lamps.every((l) => l.physics.mode === 'static'), '20 static lamps');

	// dims
	const small = normalizeDims({ length: 1, width: 0.5, gateWidth: 9 });
	check(small.length === 2 && small.width === 1.5 && small.gateWidth <= small.width, 'normalizeDims clamps to a playable room and keeps the gate narrower than the pitch');
	const wide = pitchObjects({ length: 10, width: 6 });
	check(wide.find((o) => o.name === NAMES.redGate).pos[2] < red.pos[2], '  counterfactual: a longer pitch puts the gates further out');
	check(createCommand(ball) === '/create Sphere 0.22' && createCommand(red).startsWith('/create Box 1.2 0.8 0.5'), 'createCommand renders the /create the app parses');

	// graph
	const g = pitchGraph();
	const ids = new Set(g.nodes.map((n) => n.id));
	check(g.nodes.every((n) => n.data.label), 'every node carries a label');
	check(g.edges.every((e) => ids.has(e.source) && ids.has(e.target)), 'every edge joins two existing nodes');
	check(new Set(g.edges.map((e) => e.id)).size === g.edges.length, '  edge ids are unique (peer dedupe depends on it)');
	const ballSel = g.nodes.find((n) => n.type === 'objectselector' && n.data.selected === NAMES.ball);
	const ballTargeted = g.edges.some((e) => e.target === ballSel.id && !e.targetHandle);
	check(!ballTargeted, 'NO effect node targets the ball (the runtime re-seats a targeted body every frame)');
	check(g.edges.some((e) => e.source === ballSel.id && e.target === 'rules' && e.targetHandle === 'ball'), '  the ball reaches Match Rules through its `ball` input instead');
	check(g.nodes.filter((n) => n.type === 'fblamp').length === 2 * LAMPS_PER_GATE, 'one Score Lamp node per lamp');
	check(g.nodes.filter((n) => n.type === 'fbbutton').length === 4 && !g.nodes.some((n) => n.type === 'hudbutton'), 'four Match Buttons; no HUD buttons unless asked');
	const withHud = pitchGraph(undefined, { hudButtons: true });
	const fbButtons = withHud.nodes.filter((n) => n.type === 'hudbutton' && String(n.data.element).startsWith('fb-'));
	check(fbButtons.length === 6 && fbButtons.every((n) => n.data.perPlayer === true), '  counterfactual: hudButtons adds six perPlayer HUD Buttons (menu x3, over, pause) wired into `press` (' + fbButtons.length + ')');
	check(fbButtons.every((n) => withHud.edges.some((e) => e.source === n.id && e.targetHandle === 'press')), '  every HUD button reaches a Match Button `press` input');
	check(withHud.nodes.some((n) => n.type === 'keypress' && n.data.code === 'KeyP') && withHud.nodes.filter((n) => n.type === 'hudscreen').length === 3, '  the pause menu rows (P toggles, resume hides, quit hides + menu)');
	const records = withHud.nodes.find((n) => n.type === 'fbrecords');
	check(records.data.element === 'fb-sheet,fb-sheet-play' && records.data.logElement === 'fb-log', '  Records feeds both sheet lists and the log list');
	const remapped = pitchGraph({ [NAMES.ball]: 'uuid-ball' });
	check(remapped.nodes.find((n) => n.id === 'selball').data.selected === 'uuid-ball', 'names remap to uuids for the recipe');
	check(g.nodes.some((n) => n.type === 'setgamestate' && n.data.state === 'over'), 'the game shell follows the match (start/over/menu)');

	// the HUD document and the def
	const hud = pitchHud().scene;
	const hudIds = new Set(hud.screens.flatMap((sc) => sc.elements.map((e) => e.id)));
	check(hud.screens.map((sc) => sc.id).join() === 'menu,hud,pause,over', 'pitchHud: Towers\' four screens (D1 can compare)');
	for (const id of ['fb-join-red', 'fb-join-blue', 'fb-start', 'fb-new-match', 'fb-new-match-pause', 'fb-sheet', 'fb-sheet-play', 'fb-score', 'fb-score-over', 'fb-log'])
		check(hudIds.has(id), '  HUD element ' + id + ' exists for the graph that names it');
}
