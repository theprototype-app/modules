// The pitch as data — the object list and the graph the recipe and the def share.
import { pitchObjects, pitchGraph, normalizeDims, DEFAULT_DIMS, NAMES, LAMPS_PER_GATE, createCommand } from '../src/pitch.js';
import { pitchHud } from '../src/hud.js';
import { footballDef } from '../src/def.js';
import { arenaObjects, arenaGraph, ARENA, NET } from '../src/arena.js';
import { matchClock } from '../src/rules.js';

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
	check(createCommand(ball) === '/create Sphere 0.22' && createCommand(red).startsWith('/create Box 1.5 1 0.5'), 'createCommand renders the /create the app parses');

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
	check(fbButtons.length === 7 && fbButtons.every((n) => n.data.perPlayer === true), '  counterfactual: hudButtons adds seven perPlayer HUD Buttons (menu x3, over x2 — Rematch + Menu, pause) wired into `press` (' + fbButtons.length + ')');
	// 30b: several HUD-driven Match Buttons share ONE target (New match); only the object's own
	// node may claim a click on it, or a click on the physical New match could run Rematch
	const physical = withHud.nodes.filter((n) => n.type === 'fbbutton' && n.data.physical !== false);
	check(physical.length === 4 && new Set(physical.map((n) => withHud.edges.find((e) => e.source === n.id && !e.targetHandle)?.target)).size === 4, '30b: exactly four PHYSICAL Match Buttons, one per button object');
	check(withHud.nodes.some((n) => n.type === 'fbbutton' && n.data.action === 'rematch' && n.data.physical === false), '  the Rematch node is HUD-only (physical: false)');
	// THE BRIDGE: a hudbutton has no runtime value in core, so it must reach a Match
	// Button THROUGH a Delay (which re-emits the stamp as a pulse). A direct edge would
	// read `undefined` in the module and silently do nothing — the bug this guards.
	const viaDelay = (/** @type {any} */ n) => {
		const mid = withHud.edges.find((e) => e.source === n.id && e.targetHandle === 'trigger');
		const delay = mid && withHud.nodes.find((x) => x.id === mid.target && x.type === 'delay');
		return !!delay && withHud.edges.some((e) => e.source === delay.id && e.targetHandle === 'press');
	};
	check(fbButtons.every(viaDelay), '  every HUD button reaches a Match Button `press` through a Delay');
	check(!withHud.edges.some((e) => fbButtons.some((n) => n.id === e.source) && e.targetHandle === 'press'), '  counterfactual: no HUD button wires STRAIGHT into a module input (it would read undefined)');
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
	for (const id of ['fb-join-red', 'fb-join-blue', 'fb-start', 'fb-new-match', 'fb-new-match-pause', 'fb-sheet', 'fb-sheet-play', 'fb-ticker', 'fb-clock', 'fb-score', 'fb-log'])
		check(hudIds.has(id), '  HUD element ' + id + ' exists for the graph that names it');
	const def = footballDef();
	check(def.kind === 'game' && def.slug === 'football' && def.installModules[0] === 'football' && def.objects.length === 42 && def.graphs.scene.nodes.length > 60 && def.hud.scene.screens.length === 4 && def.physics.gravity === 0, 'footballDef: kind game, the module required, 42 objects (the 41 of the pitch + the Arena group), the def graph, four screens, zero-g');

	// ---- 30: the look ---------------------------------------------------------------------
	const shells = objects.filter((o) => /^Wall |^Ceiling$/.test(o.name));
	check(shells.length === 5 && shells.every((o) => o.physical && o.transmission > 0.5 && o.pick === 'through' && o.shadow === false && o.opacity < 0.25),
		'30: the five shells are clean glass (physical + transmission), select-through, cast no shadow, and keep a faint opacity for the recipe');
	const strip = lamps.filter((l) => l.name.startsWith('Red'));
	check(new Set(strip.map((l) => l.pos[1])).size === 1 && strip.every((l) => Math.abs(l.pos[0]) < DEFAULT_DIMS.width / 2 - 0.1),
		'30: each gate\'s ten lamps are ONE strip inside the pitch width');
	check(ball.clearcoat === 1 && objects.filter((o) => o.physics?.mode === 'dynamic').length === 1, '30: the ball is lacquered (clearcoat) and still the one dynamic body');
	check(red.physics.sensor && red.size.join() === '1.5,1,0.5' && Math.abs(red.pos[2] + 2.45) < 1e-9, '30b: the gate mouth is 1.5 x 1.0 (was 1.2 x 0.8), the sensor still 0.5 deep at z -2.45');
	// 30b: the consoles ("the tables inside the court") stand OUTSIDE the touchline and the glass
	const wallRight = byName.get('Wall right');
	const glassX = wallRight.pos[0] + wallRight.size[0] / 2;
	const consoles = [NAMES.joinRed, NAMES.joinBlue, NAMES.start, NAMES.newMatch].map((n) => byName.get(n));
	check(consoles.every((c) => c.pos[0] - c.size[0] / 2 > glassX), '30b: all four button consoles stand outside the right-hand glass (x > ' + glassX.toFixed(3) + ')');
	check(consoles.every((c) => c.pos[0] - c.size[0] / 2 < glassX + 0.5), '  ...within arm\'s reach of it (a player at the glass can press them)');
	check(byName.get(NAMES.joinRed).pos[2] < byName.get(NAMES.start).pos[2] && byName.get(NAMES.start).pos[2] < byName.get(NAMES.newMatch).pos[2] && byName.get(NAMES.newMatch).pos[2] < byName.get(NAMES.joinBlue).pos[2], '  in one row: Join red (red end), Start, New match, Join blue (blue end)');
	const inside = pitchObjects().filter((o) => o.physics?.mode === 'static' && !/^Wall|^Ceiling$|^Pitch$|gate$|post|bar|lamp/i.test(o.name));
	check(inside.every((o) => Math.abs(o.pos[0]) > DEFAULT_DIMS.width / 2), '  counterfactual: nothing else static stands inside the court (' + inside.filter((o) => Math.abs(o.pos[0]) <= DEFAULT_DIMS.width / 2).map((o) => o.name).join(', ') + ')');
	const boards = arenaObjects()[0].children.filter((k) => /^Perimeter board/.test(k.name));
	check(boards.every((b) => Math.abs(b.pos[0]) > consoles[0].pos[0] + 0.25), '  the perimeter boards stand past the consoles');
	check(def.physics.play.spawn?.position?.[2] > 0 && def.physics.play.spawn.yaw === 0 && def.physics.play.locomotion === undefined, '30b: the play block spawns the player on the blue half facing the red gate; no fly / teleport (locomotion absent)');
	const menuTexts = hud.screens.find((sc) => sc.id === 'menu').elements.filter((e) => /^howto-\d/.test(e.id)).map((e) => e.label).join(' ');
	check(/golden goal/i.test(menuTexts) && /First to 5/.test(menuTexts) && /conceded kicks off/.test(menuTexts) && /controller/.test(menuTexts), '30b: the menu says how to play (hit, score, first to 5 / 3:00, golden goal, the kick-off)');
	check(hudIds.has('fb-rematch'), '  the results panel has Rematch');
	const arena = arenaObjects();
	check(arena.length === 1 && arena[0].type === 'group' && arena[0].name === ARENA, 'arenaObjects: ONE top-level group (the scene gains one object)');
	const kids = arena[0].children;
	const slab = arena[0].physics;
	const ys = slab?.colliderVerts?.filter((_, i) => i % 3 === 1) ?? [];
	check(slab?.mode === 'static' && slab.collider === 'custom' && ys.length === 8 && Math.max(...ys) <= 0.02,
		'  the group carries its OWN collider, a floor slab (top <= 0.02): the default box around the whole arena would swallow the ball');
	check(kids.every((k) => !k.physics), '  none of the arena is a physics body (decoration never touches the rules)');
	const floods = kids.filter((k) => k.type === 'light' && k.kind === 'spot');
	check(floods.length >= 2 && floods.length <= 4 && floods.filter((k) => k.castShadow).length === 1, '  2-4 floodlights (spot), exactly ONE casts shadows (' + floods.length + ')');
	const floor = kids.find((k) => k.name === 'Stadium floor');
	const turf = kids.find((k) => k.name === 'Turf');
	check(floor.pos[1] > 0 && turf.pos[1] > floor.pos[1] && floor.size[0] >= 40, '  a real ground ABOVE the editor grid (y 0) and the turf above it');
	check(kids.filter((k) => k.pick === 'through').length >= 10 && turf.pick === 'through', '  the turf and markings are select-through (a click reaches the Pitch box)');
	for (const team of ['red', 'blue']) {
		const net = kids.find((k) => k.name === NET(team));
		check(net?.anim === 'pulse' && net.emissive != null, '  the ' + team + ' net glows and carries a Pulse clip');
	}
	check(kids.some((k) => k.type === 'camera' && k.name === def.thumb.camera) && def.view?.pos && def.view?.target, '  the card camera lives in the arena group; the def has a view');
	const ag = arenaGraph(0);
	const plays = ag.nodes.filter((n) => n.type === 'playanim');
	const viaDelayToPlay = plays.every((p) => ag.edges.some((e) => e.target === p.id && e.targetHandle === 'trigger' && ag.nodes.find((n) => n.id === e.source)?.type === 'delay'));
	check(plays.length === 4 && viaDelayToPlay, 'arenaGraph: four Play Animation nodes (pulse + stop per net), each triggered THROUGH a Delay');
	check(ag.edges.some((e) => e.source === 'evrnet' && ag.nodes.find((n) => n.id === 'evrnet').data.event === 'bluegoal'), '  a goal INTO the red gate (bluegoal) pulses the red net');
	check(def.graphs.scene.nodes.some((n) => n.id === 'prnet') && def.graphs.scene.nodes.some((n) => n.type === 'fbvalue' && n.data.read === 'blue'), '  the def graph carries the pulse block and the scoreboard values');
	check(def.env.exposure >= 0.9 && def.post.effects.map((e) => e.kind).join() === 'ao,tonemapping,bloom,smaa', 'the standard shell: exposure >= 0.9, post AO -> AgX -> bloom -> SMAA');
	check(withHud.nodes.find((n) => n.type === 'fbrecords').data.clockElement === 'fb-clock' && !g.nodes.find((n) => n.type === 'fbrecords').data.clockElement, 'Records feeds the scoreboard clock in the def graph only');
	for (const id of ['fb-red-score', 'fb-blue-score', 'fb-clock', 'fb-ticker'])
		check(hud.screens.find((sc) => sc.id === 'hud').elements.some((e) => e.id === id), '  the scoreboard element ' + id + ' is on the HUD screen');
	const recDef = withHud.nodes.find((n) => n.type === 'fbrecords').data;
	check(!hud.screens.find((sc) => sc.id === 'hud').elements.some((e) => e.id === 'fb-score') && recDef.scoreElement === 'fb-score' && hud.screens.find((sc) => sc.id === 'over').elements.some((e) => e.id === 'fb-score') && recDef.tickerElement === 'fb-ticker',
		'  the score shows ONCE in play (the board\'s numbers): the score list is on the over screen, the ticker is last touch');
	for (const b of [NAMES.joinRed, NAMES.joinBlue, NAMES.start, NAMES.newMatch])
		check(kids.some((k) => k.name === b + ' stand'), '  the ' + b + ' button stands on a console stand');
	check(['left', 'right', 'red', 'blue'].every((side) => kids.filter((k) => k.name.startsWith('Stand ' + side) && !k.name.endsWith('seats')).length === 3), '  stands (three tiers) on all four sides — no void past the glass');
	const standMin = Math.min(...kids.filter((k) => /^Stand (left|right) /.test(k.name)).map((k) => Math.abs(k.pos[0]) - k.size[0] / 2));
	check(standMin > DEFAULT_DIMS.width / 2 + 1.5, '  ...clear of the pitch and the floodlight poles (' + standMin.toFixed(2) + ' m out)');
	check(matchClock({ winBy: 'time', matchSeconds: 180 }, 0) === '3:00' && matchClock({ winBy: 'time', matchSeconds: 180 }, 61.2) === '1:59', 'matchClock: a timed match counts DOWN (3:00, 1:59)');
	check(matchClock({ winBy: 'goals' }, 75.9) === '1:15' && matchClock({}, null) === '0:00', '  a goals match counts UP; no match reads 0:00');
	check(JSON.stringify(def) === JSON.stringify(footballDef()), '  the def is deterministic (byte-identical twice)');
}
