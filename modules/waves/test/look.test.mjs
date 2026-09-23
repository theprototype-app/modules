// the arena's look — pure (30-visuals-mod): the rule objects keep their contract, the look is
// one group, the standard shell holds, the juice is a pure function of time.
import { wavesDef, ROSTER } from '../src/def.js';
import { arenaObjects, enemyObject, flashLevel, coreGlow, FLASH, ARENA, CORE, CARD_CAMERA } from '../src/look.js';

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	const d = wavesDef();
	const top = d.objects.map((o) => o.name);
	check(['Ground', 'Goal', 'Spawn 1', 'Spawn 2', 'Spawn 3', 'Home', ...ROSTER].every((n) => top.includes(n)), 'the rule objects keep their names (30b: a roster of ten enemies)');
	const enemies = d.objects.filter((o) => /^Enemy \d\d/.test(o.name));
	const bodies = (/** @type {any} */ o) => [o, ...(o.children ?? []).flatMap(bodies)].filter((x) => x.physics?.mode === 'dynamic');
	check(enemies.length === 10 && enemies.every((e) => bodies(e).length === 1 && e.physics?.mode === 'dynamic' && e.physics.collider === 'capsule' && e.physics.freeze?.rx && e.physics.freeze?.rz && !e.physics.freeze?.ry), 'every enemy is ONE dynamic body (the group), a capsule collider kept upright (tilt locked) — the health/knock contract');
	check(enemies.every((e) => e.children.some((c) => c.type === 'capsule') && e.children.some((c) => /visor/.test(c.name) && c.emissiveIntensity > 1)), '  a capsule figure with a glowing visor');
	check(d.objects.filter((o) => o.physics?.mode === 'dynamic').length === 10, '  and nothing else in the scene is dynamic');
	const arena = d.objects.find((o) => o.name === ARENA);
	check(!!arena && arena.type === 'group' && d.objects.filter((o) => o.type === 'group' && !/^Enemy/.test(o.name)).length === 1, 'the look is ONE top-level group');
	const ys = arena.physics?.colliderVerts?.filter((/** @type {any} */ _, /** @type {number} */ i) => i % 3 === 1) ?? [];
	check(arena.physics?.collider === 'custom' && ys.length === 8 && Math.max(...ys) <= 0.015, '  the group\'s collider is a floor slab under the ground (its default box would swallow the enemies)');
	const flat = (/** @type {any[]} */ l) => l.flatMap((o) => [o, ...flat(o.children ?? [])]);
	const kids = flat(arena.children);
	check(kids.every((k) => !k.physics) && !kids.some((k) => /^Spawn/.test(k.name)), '  no body in it, and nothing in it is named Spawn… (the spawn-point prefix)');
	check(kids.filter((k) => /^Portal \d$/.test(k.name)).length === 3 && kids.filter((k) => k.particles?.preset === 'sparkles').length === 3, '  a sparkling portal ring over each spawn pad (a kit particle preset)');
	check(kids.some((k) => k.name === CORE && k.emissive != null) && d.graphs.scene.nodes.some((n) => n.type === 'wavescore') && d.graphs.scene.nodes.some((n) => n.type === 'objectselector' && n.data.selected === CORE), '  the crystal core, driven by a Goal Core node');
	const far = kids.filter((k) => /^Mesa /.test(k.name) && Math.hypot(k.pos[0], k.pos[2]) > 60);
	check(far.length >= 6 && kids.some((k) => k.name === 'Outer floor' && k.size[0] >= 200), 'no void past the border: a floor to the horizon and mesas on it');
	const ground = d.objects.find((o) => o.name === 'Ground');
	check(ground.pos[1] + ground.size[1] / 2 > 0, 'the ground\'s top sits ABOVE the editor grid (y 0)');
	check(d.env.preset === 'custom' && d.env.exposure >= 0.9 && d.post.effects.map((e) => e.kind).join() === 'ao,tonemapping,bloom,smaa', 'the standard shell: custom sky, exposure >= 0.9, AO -> AgX -> bloom -> SMAA');
	check(!!d.view && d.thumb.camera === CARD_CAMERA && kids.some((k) => k.type === 'camera' && k.name === CARD_CAMERA), '  view + thumb.camera (in the arena group)');
	check(flashLevel(0) === 1 && flashLevel(FLASH.seconds / 2) === 0.5 && flashLevel(FLASH.seconds) === 0 && flashLevel(-1) === 0, 'flashLevel: 1 at the hit, fading, 0 after');
	check(coreGlow(1) === 1 && coreGlow(0) === 0.15 && coreGlow(0.5) > coreGlow(0.25) && coreGlow(NaN) === 1, 'coreGlow: full at full health, never dark, monotonic');
	check(JSON.stringify(enemyObject('E', [0, 0, 0])) === JSON.stringify(enemyObject('E', [0, 0, 0])) && arenaObjects({ spawns: [[0, 0, -5]], goal: [0, 0, 5], home: [0, 0, 8], ground: { size: [10, 0.1, 10], pos: [0, 0, 0] } }).length === 1, 'the builders are deterministic, one group');
}
