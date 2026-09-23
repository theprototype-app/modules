// The template def (roadmap 30 P4) — the Games-tab standard shell (fork 11), checked
// structurally WITHOUT the app: every screen, every button wired, the look rules, the pins.
import { readFileSync } from 'node:fs';
import { untangleDef, BOARD } from '../src/def.js';
import mod from '../src/index.js';

export function run(check) {
	const d = untangleDef();
	const screens = Object.fromEntries(d.hud.scene.screens.map((s) => [s.id, s]));
	const els = (id) => screens[id]?.elements ?? [];
	const has = (id, el) => els(id).some((e) => e.id === el);
	const graph = d.graphs.scene;
	const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
	const wiredTo = (src) => graph.edges.filter((e) => e.source === src).map((e) => byId[e.target]);

	// ---- the standard shell ----
	check(screens.menu?.showWhile === 'menu' && screens.menu.input === 'menu' && has('menu', 'start-btn'), 'menu screen: shown in menu, pointer free, a Start button');
	check(els('menu').some((e) => e.kind === 'mod-untangle-levels'), 'the menu carries the module level grid (mode, 30 levels, Continue, Reset)');
	check(screens.hud?.showWhile === 'playing' && has('hud', 'ut-level') && has('hud', 'ut-crossings') && els('hud').some((e) => e.kind === 'mod-untangle-stats' && e.show === 'play'), 'HUD while playing: level, crossings, time + best');
	check(screens.solved?.showWhile === 'over' && screens.solved.input === 'menu' && has('solved', 'next-btn') && has('solved', 'menu-btn') && els('solved').some((e) => e.kind === 'mod-untangle-stats' && e.show === 'result'), 'a SOLVED screen (over): Next, Menu, this time vs best');
	check(!!screens.pause && has('pause', 'resume-btn') && has('pause', 'quit-btn'), 'a pause screen: Resume, Quit');
	// every HUD button a node reads exists, and every button on a screen is wired
	const hudButtons = graph.nodes.filter((n) => n.type === 'hudbutton');
	const allEls = new Set(d.hud.scene.screens.flatMap((s) => s.elements.map((e) => e.id)));
	check(hudButtons.every((n) => allEls.has(n.data.element)), 'every HUD Button node names an element that exists');
	const buttonEls = d.hud.scene.screens.flatMap((s) => s.elements.filter((e) => e.kind === 'button').map((e) => e.id));
	check(buttonEls.every((id) => hudButtons.some((n) => n.data.element === id)), 'every button on every screen is wired (' + buttonEls.join(', ') + ')');
	check(graph.nodes.filter((n) => n.type === 'hudtext').every((n) => allEls.has(n.data.element)), 'every HUD Text node names an element that exists');
	const solvedTargets = wiredTo('evsolved').map((n) => n?.type + ':' + (n?.data?.state ?? ''));
	check(solvedTargets.includes('setgamestate:over'), 'a solve moves the shell to over (the solved screen)');
	check(wiredTo('bnext').some((n) => n?.type === 'setgamestate' && n.data.state === 'playing'), 'Next -> playing (the module advances on a round start over a solved board)');
	check(wiredTo('evstart').some((n) => n?.type === 'setgamestate' && n.data.state === 'playing'), 'Continue (Untangle Event start) -> playing');
	check(wiredTo('bmenu').some((n) => n?.type === 'setgamestate' && n.data.state === 'menu'), 'Menu -> menu');

	// ---- the board node ----
	const board = graph.nodes.find((n) => n.type === 'utboard');
	check(board?.data.level === 1 && BOARD.level === 1, 'the template starts on level 1 (the only level a new player has opened)');
	check(board?.data.autoAdvance === false, 'autoAdvance off: the solved screen owns "next"');

	// ---- the look rules ----
	check(!d.objects.some((o) => o.type === 'light' && (o.kind ?? 'point') === 'point'), 'no point lights (their falloff banded into the "rainbow blotches")');
	check(!d.objects.some((o) => o.type === 'light' && o.kind === 'spot'), 'no spot lights on the big surfaces either (same banding)');
	const floor = d.objects.find((o) => o.name === 'Floor');
	const fh = floor?.size ? floor.size[1] : floor?.h;
	check(!!floor && floor.pos[1] - fh / 2 >= -1e-9 && floor.pos[1] + fh / 2 > 0.01, 'the floor is a raised stage (never coplanar with the sky ground disc at y = 0)');
	check(!d.hud.scene.screens.some((sc) => sc.elements.some((e) => e.id === 'ut-solved')), 'no lone "solved this session" readout floating top-right (the card says it)');
	check(d.objects.length === 6 && ['Floor', 'Back wall', 'Pedestal', 'Board frame', 'Lamp left', 'Lamp right'].every((n) => d.objects.some((o) => o.name === n)), 'the six object names the scene always had (the object list reads the same)');
	check(d.env?.preset === 'custom' && (d.env.exposure ?? 1) >= 0.9 && !!d.env.background?.top, 'a custom sky with a readable exposure (>= 0.9)');
	const kinds = d.post.effects.map((e) => e.kind).join('>');
	check(kinds === 'ao>tonemapping>bloom>smaa' && d.post.effects[1].params.mode === 'AGX', 'post = AO -> AgX -> bloom -> SMAA (the fork-11 floor)');
	check(d.physics.play.cursor === 'free', 'play.cursor free (the real cursor drags; a core without it keeps the lock + crosshair)');
	check(Array.isArray(d.view?.pos) && Array.isArray(d.view?.target) && d.thumb?.sceneGroups?.includes('untangle-module'), 'view + thumb.sceneGroups: the card shows the board');

	// ---- the pins ----
	const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
	check(mod.version === manifest.version && d.modules[0].version === mod.version, 'module entry, manifest and def agree on the version (' + mod.version + ')');
	const emitted = JSON.parse(readFileSync(new URL('../untangle.def.json', import.meta.url), 'utf8'));
	check(JSON.stringify(emitted) === JSON.stringify(d), 'untangle.def.json is the emitted def (npm run build:untangle)');
}
