// the Meshy figures and guns (30c) — the pure rules, and the packaged files' contract
import { readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
	STAND_IN_LAYER,
	HELPER_LAYER,
	FIGURES,
	footDrop,
	fitScale,
	yawTo,
	turnToward,
	gait,
	walkRate,
	figureShown,
	sinkDepth,
	deathOver,
	DEATH_SECONDS,
	SINK,
	GUN_FITS,
	gunFit,
	fromGrip
} from '../src/figures.js';
import { ENEMY_LOOKS, standHeight } from '../src/look.js';
import { KINDS } from '../src/curve.js';

const here = dirname(fileURLToPath(import.meta.url));
const mod = join(here, '..');
// assets.js imports the loader chunk as text (esbuild) — read its table as source instead
const ASSET_FILES = Object.fromEntries(
	[...readFileSync(join(mod, 'src/assets.js'), 'utf8').matchAll(/^\t(\w+): '(assets\/[^']+)'/gm)].map((m) => [m[1], m[2]])
);

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	// ---- the stand-in -----------------------------------------------------------------
	check(STAND_IN_LAYER !== 0 && STAND_IN_LAYER !== HELPER_LAYER && STAND_IN_LAYER !== 31 && STAND_IN_LAYER < 32, 'the stand-in layer is none of core\'s (0 drawn, 1 the editor\'s helpers, 31 overload guard)');
	const av = readFileSync(join(mod, 'src/avatars.js'), 'utf8');
	check(/onBeforeRender/.test(av) && /onAfterRender/.test(av) && !/layers\.set\(/.test(av), '  the hop lasts one render (onBeforeRender -> onAfterRender), bits flipped, never set');
	check(Object.keys(FIGURES).sort().join() === Object.keys(KINDS).sort().join() && Object.keys(FIGURES).every((k) => k in ENEMY_LOOKS), 'a figure for every enemy kind');
	for (const k of Object.keys(FIGURES)) {
		const l = /** @type {any} */ (ENEMY_LOOKS)[k];
		const capsule = 2 * l.r + l.h;
		const f = /** @type {any} */ (FIGURES)[k];
		check(Math.abs(f.height - capsule) / capsule < 0.2, '  ' + k + ': the figure stands about as tall as its capsule (' + f.height + ' vs ' + capsule.toFixed(2) + ' m) — the hit volume matches what you see');
		check(Math.abs(standHeight(k) - footDrop(k) - 0.05) < 0.011, '  ' + k + ': the feet go to the capsule\'s bottom (stand height ' + standHeight(k) + ' - drop ' + footDrop(k) + ')');
	}
	check(FIGURES.tank.height > FIGURES.grunt.height && FIGURES.grunt.height > FIGURES.runner.height, 'a tank towers over a grunt, a runner is the smallest');
	check(FIGURES.runner.walk === 'run' && FIGURES.grunt.walk === 'walk' && FIGURES.tank.walk === 'walk', 'the runner RUNS (Meshy\'s running clip), the others walk');

	check(fitScale(2, 1) === 0.5 && fitScale(0, 1) === 1 && fitScale(1, NaN) === 1, 'fitScale: bind height -> the kind\'s height; degenerate -> 1');
	check(Math.abs(yawTo([0, 0, 0], [0, 0, 5])) < 1e-9 && Math.abs(yawTo([0, 0, 0], [5, 0, 0]) - Math.PI / 2) < 1e-9 && yawTo([1, 0, 1], [1, 3, 1]) === 0, 'yawTo: +Z faces the goal; straight up / on the spot -> 0');
	check(Math.abs(turnToward(0, 1, 0.1, 6) - 0.6) < 1e-9 && turnToward(0, 0.1, 0.1, 6) === 0.1, 'turnToward: at most rate x dt, snaps when close');
	check(Math.abs(turnToward(3, -3, 0.01, 6) - 3.06) < 1e-9, '  the short way round (3 -> -3 turns UP through pi)');

	const walk = gait({ speed: 0 }, [0, 0, 0], [0, 0, 0.1], 0.1, 0);
	check(walk.forward && walk.speed > 0.9 && walk.speed <= 1, 'gait: 1 m/s straight ahead, smoothed toward it');
	check(!gait({ speed: 1 }, [0, 0, 0], [0, 0, -0.05], 0.1, 0).forward, '  a shove backwards is not forwards (the walk does not play over a knockback slide)');
	check(gait({ speed: 1 }, [0, 0, 0], [0, -30, 20], 0.1, 0).speed < 1, '  a teleport (the portal, the stash) is no walk');
	check(gait({ speed: 0.4 }, [0, 0, 0], [0, 0, 1], 0, 0).speed === 0.4, '  no time, no change');

	check(walkRate(0, 1.1) === 0 && walkRate(0.02, 1.1) === 0, 'walkRate: standing -> the clip holds');
	check(Math.abs(walkRate(1.1, 1.1) - 1) < 1e-9 && Math.abs(walkRate(2.2, 1.1) - 2) < 1e-9, '  the clip\'s own pace at its own speed, twice as fast at twice the speed');
	check(walkRate(100, 1.1) === 2.5 && walkRate(0.05, 1.1) === 0.2, '  clamped (a slow-mo crawl, a sprint)');
	const kindSpeeds = Object.entries(KINDS).map(([k, v]) => walkRate(1.5 * v.speed, /** @type {any} */ (FIGURES)[k].clipSpeed));
	check(kindSpeeds.every((r) => r >= 0.5 && r <= 2), '  at the default walk speed every kind plays its clip at 0.5-2x (' + kindSpeeds.map((r) => r.toFixed(2)).join(', ') + ')');

	check(figureShown({ visible: true, y: 0.6, dying: false }) && !figureShown({ visible: false, y: 0.6, dying: false }) && !figureShown({ visible: true, y: -30, dying: false }), 'figureShown: with its enemy, never under the arena (the stash)');
	check(figureShown({ visible: true, y: -30, dying: true }), '  but a death plays where it fell, even once the enemy is stashed');
	check(sinkDepth(0) === 0 && sinkDepth(DEATH_SECONDS) === 0 && sinkDepth(DEATH_SECONDS + SINK.seconds) === SINK.depth && sinkDepth(DEATH_SECONDS + SINK.seconds / 2) === SINK.depth / 2, 'sinkDepth: the fall plays, then it sinks away');
	check(!deathOver(0) && !deathOver(DEATH_SECONDS + SINK.seconds - 0.01) && deathOver(DEATH_SECONDS + SINK.seconds) && deathOver(NaN), 'deathOver after the fall and the sink (NaN: over)');

	// ---- the guns -----------------------------------------------------------------------
	for (const id of ['blaster', 'scatter', 'beam']) {
		const f = /** @type {any} */ (GUN_FITS)[id];
		const m = fromGrip(f.muzzle, f.grip);
		check(m[2] < -0.18 && m[2] > -0.3 && Math.abs(m[0]) < 0.01 && m[1] > 0 && m[1] < 0.08, id + ': the muzzle is 18-30 cm down -Z from the grip, a little above it (' + m.map((v) => v.toFixed(3)).join(', ') + ')');
		check([f.grip, f.muzzle, f.cell].every((p) => Math.abs(p[0]) <= 0.07 && Math.abs(p[1]) <= 0.09 && Math.abs(p[2]) <= 0.16), '  grip, muzzle and cell sit inside the 30 cm gun');
	}
	check(gunFit('nope') === GUN_FITS.blaster, 'gunFit: an unknown gun fits like the Blaster');

	// ---- the packaged files -------------------------------------------------------------
	const manifest = JSON.parse(readFileSync(join(mod, 'manifest.json'), 'utf8'));
	const files = Object.values(ASSET_FILES);
	check(files.length === 7 && ['blaster', 'scatter', 'beam', 'grunt', 'runner', 'tank', 'crystal'].every((k) => k in ASSET_FILES), 'seven models: three guns, three enemies, the crystal');
	check(files.every((f) => manifest.files.includes(f)) && manifest.files.includes('module.js'), 'the manifest lists every model (a URL install fetches only what `files` names)');
	check(files.every((f) => existsSync(join(mod, f))), '  and every one is in the module folder');
	const sizes = files.map((f) => (existsSync(join(mod, f)) ? statSync(join(mod, f)).size : Infinity));
	check(sizes.every((s) => s <= 2 * 1024 * 1024), '  each <= 2 MB (' + sizes.map((s) => (s / 1048576).toFixed(2)).join(', ') + ' MB)');
	check(sizes.reduce((a, b) => a + b, 0) <= 10 * 1024 * 1024, '  together <= 10 MB (' + (sizes.reduce((a, b) => a + b, 0) / 1048576).toFixed(2) + ' MB)');
	const glbOk = files.every((f) => {
		const b = readFileSync(join(mod, f));
		const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
		const exts = [...(json.extensionsRequired ?? [])];
		return b.toString('ascii', 0, 4) === 'glTF' && exts.every((e) => !/draco|meshopt|basisu|webp/i.test(e));
	});
	check(glbOk, '  plain glTF-binary: no Draco / Meshopt / KTX2 / WebP the bundled loader has no decoder for');
	const skinned = ['grunt', 'runner', 'tank'].map((k) => {
		const b = readFileSync(join(mod, /** @type {any} */ (ASSET_FILES)[k]));
		const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
		return { k, skins: json.skins?.length ?? 0, clips: (json.animations ?? []).map((/** @type {any} */ a) => a.name) };
	});
	check(skinned.every((s) => s.skins === 1 && ['walk', 'run', 'hit', 'death'].every((c) => s.clips.includes(c))), 'every enemy is rigged (one skin) with walk / run / hit / death (' + skinned.map((s) => s.k + ':' + s.clips.join('/')).join(' ') + ')');
	const bundle = readFileSync(join(mod, 'module.js'), 'utf8');
	check(bundle.includes('__wavesTHREE') && bundle.includes('GLTFLoader') && !/from\s*["']three["']/.test(bundle), 'module.js carries the loader chunk, bound to the runtime three (no import of a second three)');
}
