// The template def — pure (30-visuals-mod): the standard shell and the menu decision, held to
// what the def actually says. The HUD menu is the ONE menu: the module's DOM card stands down.
import { realmsDef, realmsHud, realmsGraph, MENU_BUTTONS, NAMES } from '../src/def.js';

export function run(check) {
	const def = realmsDef({ x: 10, z: -2 });
	const hud = realmsHud().scene;
	const g = realmsGraph();
	const screen = (id) => hud.screens.find((s) => s.id === id);
	check(screen('menu').input === 'menu' && screen('pause').input === 'menu' && screen('over').input === 'menu', 'menu, pause and victory are core screens with input:menu (the pointer is free: clickable)');
	const ids = new Set(hud.screens.flatMap((s) => s.elements.map((e) => e.id)));
	check(MENU_BUTTONS.every(([el]) => ids.has(el)), 'every wired HUD button exists on a screen');
	check(['dr-start', 'dr-join-p1', 'dr-join-p2'].every((id) => screen('menu').elements.some((e) => e.id === id && e.kind === 'button')), '  the Start screen carries Start + both Join buttons as real buttons');
	check(screen('pause').elements.filter((e) => e.kind === 'button').map((e) => e.label).join('|') === 'Resume|Restart — new dungeon|Quit to menu', '  pause: Resume / Restart / Quit');
	check(screen('over').elements.some((e) => e.kind === 'button' && /again/i.test(e.label)), '  victory offers Play again');
	const menuNode = g.nodes.find((n) => n.type === 'drmenu');
	check(menuNode?.data.show === 'never', 'the module DOM menu stands down (show: never) — exactly ONE menu');
	// every HUD button reaches a Realms Button through a Delay (DEVX #22), perPlayer
	const viaDelay = MENU_BUTTONS.every(([element, action]) => {
		const hb = g.nodes.find((n) => n.type === 'hudbutton' && n.data.element === element && n.data.perPlayer === true);
		const e1 = hb && g.edges.find((e) => e.source === hb.id && e.targetHandle === 'trigger' && g.nodes.find((n) => n.id === e.target)?.type === 'delay');
		const e2 = e1 && g.edges.find((e) => e.source === e1.target && e.targetHandle === 'press');
		return !!e2 && g.nodes.find((n) => n.id === e2.target)?.data.action === action;
	});
	check(viaDelay, 'every menu HUD button (perPlayer) -> Delay -> Realms Button with its action');
	check(!g.edges.some((e) => e.targetHandle === 'press' && g.nodes.find((n) => n.id === e.source)?.type === 'hudbutton'), '  counterfactual: no HUD button wires STRAIGHT into press (it would read undefined)');
	check(def.env.preset === 'custom' && def.env.exposure >= 0.9 && def.env.background?.top && def.env.ground, 'the standard shell: a custom sky (gradient + ground), exposure >= 0.9');
	check(def.post.effects.map((e) => e.kind).join() === 'ao,tonemapping,bloom,smaa', '  post AO -> AgX -> bloom -> SMAA');
	check(!!def.view && def.thumb.camera === NAMES.card && def.objects.some((o) => o.type === 'camera' && o.name === NAMES.card), '  view + thumb.camera (a camera object in the def)');
	check(def.objects.some((o) => o.name === NAMES.lantern && o.particles === 'sparkles'), '  a kit particle preset where it reads (the arch lantern)');
	const ground = def.objects.find((o) => o.name === NAMES.ground);
	check(!!ground && ground.pos[1] > 0 && ground.pos[1] < 0.015 && ground.size[0] >= 200 && ground.pick === 'through', 'a real ground over the editor grid and under the Kit\'s tiles (select-through)');
	check(JSON.stringify(realmsDef({ x: 10, z: -2 })) === JSON.stringify(def), 'the def is deterministic');
}
