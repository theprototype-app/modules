// waves — THE ABILITY IN YOUR OTHER HAND (30b P2). The loadout's ability fires on the free
// hand's GRIP (a headset) or Q (a desktop), in the game, while a round runs:
//   Shield  — a bubble around you; while it holds, the damage THIS player would take is not
//             taken (a LOCAL rule: your own health is your own row)
//   Slow-mo — a replicated window: every peer walks every enemy at 40%
//   Pulse   — a shockwave from your feet: the shoves are computed here, once, and replicated
// then it recharges; `readiness()` feeds the HUD's ability bar and a buzz says "ready again".

import { abilityOf, freshCharge, use, readiness, active, pulseShoves } from './abilities.js';
import { abilityHand } from './guns.js';
import { createEdges, inGame } from './vr.js';

/**
 * @param {any} api
 * @param {ReturnType<import('./engine.js').createWavesEngine>} engine
 * @param {any} root
 * @param {ReturnType<import('./prefs.js').createPrefs>} prefs
 * @param {ReturnType<import('./feel.js').createFeel>} feel
 */
export function registerPowers(api, engine, root, prefs, feel) {
	const THREE = api.THREE;
	const edges = createEdges();
	let charge = freshCharge();
	let wasReady = true;
	const clock = () => performance.now() / 1000;
	const log = /** @type {{id: string, at: number, shoves?: number}[]} */ ([]);

	// ---- the looks: a bubble for the Shield, a ring on the floor for the Pulse ------------------
	const glow = (/** @type {number} */ color, /** @type {number} */ opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
	const bubble = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 2), glow(0x39e0ff, 0.14));
	bubble.name = 'Waves shield';
	bubble.visible = false;
	const bubbleEdges = new THREE.LineSegments(new THREE.EdgesGeometry(bubble.geometry), new THREE.LineBasicMaterial({ color: 0x7ff6ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
	bubble.add(bubbleEdges);
	const wave = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 48).rotateX(Math.PI / 2), glow(0xffd24a, 0.9));
	wave.name = 'Waves pulse';
	wave.visible = false;
	root.add(bubble, wave);
	let waveAt = -Infinity;
	/** @type {number[]} */
	let waveFrom = [0, 0, 0];

	/** @param {any} object @param {number[]} p */
	const placeWorld = (object, p) => {
		const v = new THREE.Vector3(p[0], p[1], p[2]);
		object.parent?.worldToLocal(v);
		object.position.copy(v);
	};

	// ---- the desktop key ------------------------------------------------------------------------
	let keyPressed = false;
	if (typeof window !== 'undefined')
		window.addEventListener(
			'keydown',
			(e) => {
				if (e.code !== 'KeyQ' || e.repeat) return;
				const t = /** @type {any} */ (e.target);
				if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? ''))) return;
				keyPressed = true;
			},
			true
		);

	const running = () => {
		const cutoff = api.game.roundCutoff();
		return typeof cutoff === 'number' && Number.isFinite(cutoff) && api.game.roundUnderway();
	};

	/** THE PRESS: use the loadout's ability if it is charged @param {string=} hand */
	function trigger(hand) {
		const a = abilityOf(prefs.get().ability);
		const t = clock();
		const r = use(a, charge, t);
		if (!r.ok) {
			feel.haptic('tap', hand);
			return false;
		}
		charge = r.state;
		wasReady = false;
		const me = api.playerPosition?.() ?? [0, 1.6, 0];
		const entry = { id: a.id, at: t, shoves: 0 };
		if (a.id === 'slowmo') {
			const now = api.now();
			engine.addFx({ k: 'slow', at: now, until: now + a.duration });
		} else if (a.id === 'pulse') {
			const enemies = engine.targets().map((e) => {
				const o = api.objectsGroup()?.getObjectByProperty('uuid', e.uuid);
				return { uuid: e.uuid, kind: e.kind, pos: o ? o.getWorldPosition(new THREE.Vector3()).toArray() : null };
			});
			const d = pulseShoves(enemies, me, a);
			entry.shoves = Object.keys(d).length;
			if (entry.shoves) engine.addFx({ k: 'push', at: api.now(), d });
			waveAt = t;
			waveFrom = [me[0], Math.max(0.06, me[1] - 1.5), me[2]];
			api.effects?.burst?.(waveFrom, { kind: 'sparkle', color: '#ffd24a', count: 30 });
		}
		log.push(entry);
		if (log.length > 20) log.shift();
		feel.sound(a.sound, me);
		feel.haptic(a.id === 'pulse' ? 'rumble' : 'success', hand);
		return true;
	}

	function frame() {
		const t = clock();
		const game = inGame(api) && running();
		const vr = !!api.isVR?.();
		const a = abilityOf(prefs.get().ability);
		if (game) {
			if (vr) {
				const hand = abilityHand(prefs.get().hand);
				const snap = api.vrHand?.(hand);
				if (edges.edge('grip-' + hand, !!snap?.gripped)) trigger(hand);
			} else if (keyPressed) trigger();
		} else edges.clear();
		keyPressed = false;
		// ready again: one buzz
		const ready = readiness(a, charge, t) >= 1;
		if (ready && !wasReady && game) feel.haptic('heartbeat', abilityHand(prefs.get().hand));
		wasReady = ready;
		// the Shield's bubble follows the head while it holds
		const shielded = game && charge.id === 'shield' && active(charge, t);
		bubble.visible = shielded;
		if (shielded) {
			placeWorld(bubble, api.playerPosition?.() ?? [0, 1.6, 0]);
			const left = charge.activeUntil - t;
			bubble.material.opacity = 0.1 + 0.06 * Math.sin(t * 9) * (left < 0.8 ? 2 : 1);
			bubble.rotation.y = t * 0.6;
		}
		// the Pulse's ring runs out across the floor
		const age = (t - waveAt) / 0.45;
		wave.visible = age >= 0 && age < 1;
		if (wave.visible) {
			placeWorld(wave, waveFrom);
			const r = 0.3 + (abilityOf('pulse').radius - 0.3) * Math.sqrt(age);
			wave.scale.set(r, 1 + 2 * (1 - age), r);
			wave.material.opacity = 0.9 * (1 - age);
		}
	}

	api.registerFrameTask(() => {
		try {
			frame();
		} catch (error) {
			console.warn('[waves] ability failed', error);
		}
	});

	return {
		trigger,
		log,
		/** 0..1 charged (1 ready) */
		readiness: () => readiness(abilityOf(prefs.get().ability), charge, clock()),
		/** is THIS player shielded now — the damage rule reads it */
		shielded: () => charge.id === 'shield' && active(charge, clock()),
		/** is a slow window on (anyone's) */
		slowed: () => engine.all().some((s) => (s.slows ?? []).some((/** @type {any} */ w) => api.now() >= w.at && api.now() < w.until)),
		reset: () => {
			charge = freshCharge();
		}
	};
}
