// the arena recipe, the HUD graph and the def — shapes, no app
import { arenaRecipe } from '../src/toolbox.js';
import { hudGraph, arenaHud } from '../src/hud.js';
import { wavesDef, toGraph } from '../src/def.js';

/** @param {string} el @param {any} h */
const btn0 = (el, h) => h.nodes.findIndex((/** @type {any} */ n) => n.type === 'hudbutton' && n.data.element === el);

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	const o = { name: 'enemy', waves: 2, sizeStart: 2, sizeStep: 1, interval: 1, hp: 2, source: 'click', speed: 4, reach: 1.5, enemyDamage: 1, enemyRate: 1, playerName: 'me', playerHp: 10, playerRegen: 0, spawnPrefix: 'Spawn' };
	const r = arenaRecipe({ enemies: ['e1', 'e2', 'e3'], goal: 'g', options: o, row: 0, playerHealthId: null });
	const types = r.nodes.reduce((m, n) => ((m[n.type] = (m[n.type] ?? 0) + 1), m), {});
	check(types.waves === 1 && types.wavesevent === 1 && types.setgamestate === 1, 'one Waves node, one over event, one Set Game State');
	check(types.health === 4 && types.healthreset === 4, 'a health + reset per enemy and one for the player');
	check(types.damage === 7 && types.counter === 7 && types.heal === 3 && types.objectselector === 7, 'per enemy: a damage, two counters, a heal, a zone damage, two selectors; plus the player chain and the goal');
	const w = r.nodes.findIndex((n) => n.type === 'waves');
	check(r.edges.some((e) => e.to === w && e.handle === 'goal' && r.nodes[e.from].data.selected === 'g'), 'the goal selector wires into waves.goal');
	const over = r.nodes.findIndex((n) => n.type === 'wavesevent');
	const set = r.nodes.findIndex((n) => n.type === 'setgamestate');
	check(r.edges.some((e) => e.from === over && e.to === set && e.handle === 'trigger') && r.nodes[set].data.state === 'over', 'over -> Set Game State (over)');
	const player = r.nodes.findIndex((n) => n.type === 'health' && n.data.scope === 'player');
	const zones = r.nodes.map((n, i) => [n, i]).filter(([n]) => n.type === 'damage' && n.data.source === 'zone').map(([, i]) => i);
	check(zones.length === 3 && zones.every((z) => r.edges.some((e) => e.from === z && e.to === player && e.handle === 'damage')), 'every enemy\'s zone damage wires straight into the player health');
	check(zones.every((z) => r.edges.some((e) => e.to === z && e.handle === 'zone' && r.nodes[e.from].type === 'objectselector')), 'and takes its enemy as the zone');
	const heals = r.nodes.map((n, i) => [n, i]).filter(([n]) => n.type === 'heal').map(([, i]) => i);
	check(heals.every((h) => { const c = r.edges.find((e) => e.from === h && e.handle === 'pulse')?.to; return typeof c === 'number' && r.nodes[c].type === 'counter' && r.edges.some((e) => e.from === c && e.handle === 'heal' && r.nodes[e.to].type === 'health'); }), 'heal -> counter.pulse -> health.heal per enemy');
	check(r.nodes.filter((n) => n.type === 'health' && n.data.scope === 'object').every((n) => n.data.name === 'enemy' && n.data.max === 2 && n.data.deathAction === 'hide'), 'enemy healths carry the name, hp and hide');
	check(r.rows === 4, 'four rows: the run row and one per enemy');
	const again = arenaRecipe({ enemies: ['e1'], goal: null, options: o, row: 2, playerHealthId: 'existing' });
	check(!again.nodes.some((n) => n.type === 'health' && n.data.scope === 'player') && again.edges.some((e) => e.to === 'existing' && e.handle === 'damage'), 'with a player health already there the zone wires into it, no second player chain');
	check(!again.edges.some((e) => e.handle === 'goal'), 'no goal: no goal wire');
	check(JSON.stringify(arenaRecipe({ enemies: ['e1'], goal: 'g', options: o, row: 0, playerHealthId: null })) === JSON.stringify(arenaRecipe({ enemies: ['e1'], goal: 'g', options: o, row: 0, playerHealthId: null })), 'the recipe is deterministic');

	const h = hudGraph({ name: 'enemy', playerName: 'me' });
	check(h.nodes.filter((n) => n.type === 'hudbutton' && !n.data.perPlayer).length === 6 && h.nodes.filter((n) => n.type === 'setgamestate').length === 5, 'six shared HUD buttons (Start, Again, Resume, Restart, Quit, Menu), five Set Game States');
	check(h.nodes.filter((n) => n.type === 'hudbutton' && n.data.perPlayer).length === 6 + 3 + 3 + 4, '30b: sixteen PER-PLAYER buttons: 6 menu moves, 3 guns, 3 abilities, 4 options');
	const navs = h.nodes.map((n, i) => [n, i]).filter(([n]) => n.type === 'hudbutton' && /^wv-(nav|back)-/.test(n.data.element));
	check(navs.length === 6 && navs.every(([n, i]) => h.edges.some((e) => e.from === i && h.nodes[e.to].type === 'hudscreen' && (n.data.element.startsWith('wv-nav-') ? h.nodes[e.to].data.action === 'show' : h.nodes[e.to].data.action === 'hide'))), '30b: How to play / Loadout / Options open their screen, Back closes it (a local screen)');
	check(h.edges.some((e) => e.from === btn0('wv-menu', h) && h.nodes[e.to].type === 'setgamestate' && h.nodes[e.to].data.state === 'menu'), '30b: the results\' Menu button goes to the menu');
	for (const [read, target, el] of [['score', 'hudtext', 'wv-score'], ['ability', 'hudbar', 'wv-ability'], ['heat', 'hudbar', 'wv-heat']])
		check(h.edges.some((e) => h.nodes[e.from].type === 'wavesplayer' && h.nodes[e.from].data.read === read && h.nodes[e.to].type === target && h.nodes[e.to].data.element === el), '30b: Waves Player (' + read + ') drives ' + el);
	check(h.edges.some((e) => h.nodes[e.from].type === 'wavesvalue' && h.nodes[e.from].data.read === 'level' && h.nodes[e.to].data.element === 'wv-level'), '30b: the level drives wv-level');
	const pk = h.nodes.findIndex((n) => n.type === 'keypress' && n.data.code === 'KeyP');
	check(pk >= 0 && h.edges.some((e) => e.from === pk && h.nodes[e.to].type === 'hudscreen' && h.nodes[e.to].data.action === 'toggle' && h.nodes[e.to].data.screen === 'pause'), '30: P toggles the pause screen');
	const btn = (/** @type {string} */ el) => h.nodes.findIndex((n) => n.type === 'hudbutton' && n.data.element === el);
	check(h.edges.some((e) => e.from === btn('restart-btn') && h.nodes[e.to].type === 'setgamestate' && h.nodes[e.to].data.state === 'playing' && h.nodes[e.to].data.reset === true), '  Restart re-enters playing with a fresh round');
	check(h.edges.some((e) => e.from === btn('quit-btn') && h.nodes[e.to].type === 'setgamestate' && h.nodes[e.to].data.state === 'menu'), '  Quit goes to the menu');
	check(['resume-btn', 'restart-btn', 'quit-btn'].every((el) => h.edges.some((e) => e.from === btn(el) && h.nodes[e.to].type === 'hudscreen' && h.nodes[e.to].data.action === 'hide')), '  and every pause button closes the pause screen');
	check(h.nodes.some((n) => n.type === 'healthvalue' && n.data.read === 'fraction') && h.nodes.some((n) => n.type === 'hudbar' && n.data.max === 1), 'the player bar reads the health fraction');
	check(h.nodes.some((n) => n.type === 'leaderboard' && n.data.variable === 'score'), '30b: the leaderboard ranks the score rows');
	const screens = arenaHud().scene.screens.map((s) => s.id + ':' + (s.showWhile ?? '-'));
	check(screens.join() === 'menu:menu,howto:-,loadout:-,options:-,hud:playing,pause:-,over:over', 'seven screens: menu / hud / over follow the shell; how-to, loadout, options and pause are opened (' + screens.join() + ')');
	const all = arenaHud().scene.screens.flatMap((sc) => sc.elements.map((e) => e.id));
	check(new Set(all).size === all.length, 'every element id is unique across the screens');
	const buttons = arenaHud().scene.screens.flatMap((sc) => sc.elements.filter((e) => e.kind === 'button').map((e) => e.id));
	const bound = new Set(h.nodes.filter((n) => n.type === 'hudbutton').map((n) => n.data.element));
	check(buttons.every((b) => bound.has(b)) && [...bound].every((b) => buttons.includes(b)), 'every button has its hudbutton node and every node its button (' + buttons.length + ')');
	const howto = arenaHud().scene.screens.find((sc) => sc.id === 'howto');
	check(howto.elements.filter((e) => /^howto-icon-\d$/.test(e.id)).length === 4 && howto.elements.filter((e) => /^howto-\d$/.test(e.id)).every((e) => e.label.length > 40), '30b: How to play is four illustrated rows (a glyph tile + a line each)');
	const kills = arenaHud().scene.screens.find((sc) => sc.id === 'hud').elements.find((e) => e.id === 'wv-kills');
	check(kills.style.bg === 'transparent' && kills.rows.length === 0, '30: the leaderboard has no box of its own — empty, it draws nothing');

	const g = toGraph({ nodes: [{ type: 'a', x: 1, y: 2, data: { k: 1 } }, { type: 'b', x: 3, y: 4 }], edges: [{ from: 0, to: 1, handle: 'trigger' }, { from: 1, to: 0 }] }, 'p');
	check(g.nodes[0].id === 'p0' && g.nodes[0].position.x === 1 && g.nodes[0].data.k === 1 && g.nodes[0].data.label === 'a', 'toGraph: ids, positions, data with a label');
	check(g.edges[0].id === 'e-p0-p1.trigger' && g.edges[0].targetHandle === 'trigger' && g.edges[1].id === 'e-p1-p0' && !('targetHandle' in g.edges[1]), 'toGraph: canonical edge ids');
	const d = wavesDef();
	check(d.kind === 'game' && d.installModules.join() === 'health,waves' && d.objects.length === 17 && d.hud.scene.screens.length === 7, 'wavesDef: game, both modules, seventeen objects (16 rule objects + the Arena group), seven screens');
	check(d.graphs.scene.nodes.every((n) => n.id && n.position && n.data.label) && d.graphs.scene.edges.every((e) => e.id.startsWith('e-')), 'the def graph is in the author script\'s shape');
	const allNames = (/** @type {any[]} */ list) => list.flatMap((o) => [o.name, ...allNames(o.children ?? [])]);
	check(d.graphs.scene.nodes.filter((n) => n.type === 'objectselector').every((n) => allNames(d.objects).includes(n.data.selected)), 'every selector names an object of the def (groups included)');
	check(JSON.stringify(wavesDef()) === JSON.stringify(wavesDef()), 'the def is deterministic (byte-identical twice)');
}
