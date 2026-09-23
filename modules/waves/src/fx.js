// waves — THE ARENA'S JUICE (30-visuals-mod): the hit flash and the Goal Core node. Both are
// LOCAL looks every peer derives from what it already receives — the knock's hit feed
// (api.onHit fires on every peer for every hit) and a replicated graph value — so nothing
// here is ever sent.

import { flashLevel, coreGlow, FLASH } from './look.js';

/** the colour a kind of enemy dies in */
const POP_COLOR = { grunt: 0xff8a5c, runner: 0xd8ff4a, tank: 0xb070ff };

/**
 * @param {any} api @param {ReturnType<import('./engine.js').createWavesEngine>} engine
 * @param {ReturnType<import('./juice.js').createJuice> | null} [juice]
 * @param {ReturnType<import('./feel.js').createFeel> | null} [feel]
 * @param {((uuid: string) => any) | null} [figureOf] 30c: the Meshy figure standing in for an
 *   enemy — it flashes with it (the enemy's own meshes are hidden on the stand-in layer)
 */
export function registerFx(api, engine, juice = null, feel = null, figureOf = null) {
	// ---- the hit flash: an enemy the knock hits flashes white for FLASH.seconds ------------
	/** @type {Map<string, number>} enemy uuid -> when this peer saw the hit (performance s) */
	const flashes = new Map();
	const clock = () => (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
	const enemyUuids = () => new Set(engine.all().flatMap((s) => s.enemies.map((/** @type {any} */ e) => e.uuid)));
	if (typeof api.onHit === 'function')
		api.onHit((/** @type {any} */ hit) => {
			if (hit?.uuid && enemyUuids().has(hit.uuid)) flashes.set(hit.uuid, clock());
		});

	// 30b: every hurt and every death of an enemy — this peer's shot, a peer's, a knock — from
	// the engine's edges on the replicated counters: a flash, a grunt of pain, and on a kill the
	// pop, its shards and an explosion where it stood
	engine.onEnemy((ev) => {
		flashes.set(ev.uuid, clock());
		if (ev.kind === 'death') {
			juice?.pop(ev.pos, /** @type {any} */ (POP_COLOR)[ev.enemy?.kind] ?? POP_COLOR.grunt);
			feel?.sound('explosion', ev.pos);
		} else feel?.sound('hurt', ev.pos);
	});

	/** paint one enemy's plain (non-glowing) meshes at `level` 0..1 @param {any} object @param {number} level */
	function paint(object, level) {
		object.traverse((/** @type {any} */ mesh) => {
			const m = mesh.material;
			if (!mesh.isMesh || !m?.emissive || Array.isArray(m)) return;
			const base = (m.userData.wvBase ??= { hex: m.emissive.getHex(), intensity: m.emissiveIntensity });
			if (base.hex !== 0) return; // the visor already glows: leave it
			if (level > 0) {
				m.emissive.setHex(0xffffff);
				m.emissiveIntensity = FLASH.peak * level;
			} else {
				m.emissive.setHex(base.hex);
				m.emissiveIntensity = base.intensity;
			}
		});
	}

	api.registerFrameTask(() => {
		if (!flashes.size) return;
		const t = clock();
		for (const [uuid, at] of [...flashes]) {
			const object = api.objectsGroup()?.getObjectByProperty('uuid', uuid);
			const level = flashLevel(t - at);
			if (object) paint(object, level);
			const figure = figureOf?.(uuid);
			if (figure) paint(figure, level);
			if (level === 0) flashes.delete(uuid);
		}
	});

	// ---- Goal Core: its target glows with a 0..1 value (the player's health fraction) -------
	// an EFFECT on a crystal nothing else moves: it spins and bobs FROM ITS BASE POSE (the
	// runtime re-seats the base every frame, so nothing accumulates) and its emissive follows
	// `value` — the core dims as the player it protects loses health
	// (the node's palette entry lives with the family in nodes.js)
	api.registerEffect(
		'wavescore',
		(/** @type {any} */ object, /** @type {any} */ base, /** @type {any} */ data, /** @type {number} */ time) => {
			const m = object.material;
			if (m?.emissive && !Array.isArray(m)) {
				const full = (m.userData.wvCore ??= m.emissiveIntensity || 1);
				m.emissiveIntensity = full * coreGlow(Number(data.value), Number(data.floor ?? 0.15));
			}
			const spin = Number(data.spin ?? 0.6);
			object.rotation.y = (base?.rot?.[1] ?? 0) + time * spin;
			object.position.y = (base?.pos?.[1] ?? object.position.y) + Math.sin(time * 1.3) * 0.08;
		},
		{ inputs: { value: 'number' } }
	);

	return { flashes };
}
