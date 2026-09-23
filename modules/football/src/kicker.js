// football — THE KICKER (30b): the controller tip knocks the ball, a click kicks it, and the
// ball sounds when it bounces. The arithmetic is kick.js (pure); this file feeds it.
//
//   the tip     — each VR hand's ray origin pushed TIP_OFFSET forward (api.vrHand), carried
//                 into the OBJECTS GROUP's frame (the physics frame: a bent VR world rig must
//                 not put the hand and the ball in two spaces), a small velocity ring per
//                 hand, one kick per pass (armStep). Only in Interact/Play (game.localActive):
//                 in Edit the ball is the gizmo's.
//   the click   — a click (desktop Interact/Play, the VR trigger) ON the ball within
//                 CLICK_REACH kicks it away from the player at CLICK_KICK_SPEED.
//   the wire    — `{op: 'kick', uuid, impulse, speed, by, at, probe}` from the kicker. Every
//                 peer applies the touch (game.applyKick: last touch, the `kick` sound); the
//                 physics initiator alone applies the impulse — AUTHORING §4.1's
//                 authoritative model, the throw/knock rule.
//   no doubles  — core's knock probes the same hand. A tip kick within DEDUPE_MS of this
//                 peer's own core hit on the ball is dropped here, and the initiator drops a
//                 remote kick that follows that peer's core hit (game.applyKick).
//   bounces     — every peer watches the ball it renders; a sharp turn at speed is a wall,
//                 a post or the glass: a `hit` sound there (no message, like the countdown).

import {
	TIP_RADIUS,
	MIN_KICK_SPEED,
	DEDUPE_MS,
	CLICK_REACH,
	CLICK_KICK_SPEED,
	tipPoint,
	pushSample,
	ringVelocity,
	kickContact,
	kickImpulse,
	kickHaptic,
	bounced,
	armStep
} from './kick.js';

/** a test feed drives a hand for this long after its last sample (ms) */
const FEED_HOLD_MS = 600;
/** bounce sounds: at most one per this many ms, and none this soon after a touch */
const BOUNCE_GAP_MS = 160;

/** @param {any} api @param {ReturnType<import('./game.js').createGame>} game */
export function createKicker(api, game) {
	const THREE = api.THREE;
	/** @type {Record<'left'|'right', {t: number, p: number[]}[]>} */
	const rings = { left: [], right: [] };
	const arms = { left: { spent: false }, right: { spent: false } };
	/** @type {Record<'left'|'right', number>} a synthetic feed owns the hand until then */
	const fedUntil = { left: 0, right: 0 };
	/** @type {{t: number, p: number[]}[]} the ball's rendered poses (group frame) */
	const ballRing = [];
	/** @type {{t: number, v: number[]}[]} */
	const velHistory = [];
	let lastBounce = 0;
	let kicks = 0;
	const _v = new THREE.Vector3();
	/** @type {{key: string, r: number}} */
	let radiusCache = { key: '', r: 0.22 };

	/** the ball's radius in the group frame (bounding sphere x largest scale) @param {any} o */
	function ballRadius(o) {
		const key = (o.geometry?.uuid ?? '') + '|' + o.scale.x + '|' + o.scale.y + '|' + o.scale.z;
		if (radiusCache.key !== key) {
			if (o.geometry && !o.geometry.boundingSphere) o.geometry.computeBoundingSphere?.();
			const r = o.geometry?.boundingSphere?.radius ?? 0.22;
			radiusCache = { key, r: r * Math.max(Math.abs(o.scale.x), Math.abs(o.scale.y), Math.abs(o.scale.z)) };
		}
		return radiusCache.r;
	}

	const mass = (/** @type {any} */ o) => Number(o?.userData?.physics?.mass) || 0.45;

	/** a WORLD point into the objects group's frame @param {number[]} p */
	function toGroup(p) {
		const group = api.objectsGroup();
		_v.fromArray(p);
		if (group) {
			group.updateWorldMatrix(true, false);
			group.worldToLocal(_v);
		}
		return _v.toArray();
	}

	/** this peer's last core hit on the ball (performance.now ms) — set by game's onHit */
	let lastCoreHit = -Infinity;
	function noteCoreHit() {
		lastCoreHit = performance.now();
	}

	/**
	 * Fire one kick: apply it here (the touch, the sound; the impulse if this peer steps the
	 * world), send it, buzz the hand. @param {any} o the ball @param {number[]} n
	 * @param {number} approach @param {string} probe @param {'left'|'right'} [hand]
	 */
	function fire(o, n, approach, probe, hand) {
		const ballVel = ringVelocity(ballRing);
		const impulse = kickImpulse(n, approach, mass(o), ballVel);
		const speed = Math.hypot(impulse[0], impulse[1], impulse[2]) / mass(o);
		if (!(speed > 0)) return false;
		const data = { op: 'kick', uuid: o.uuid, impulse, speed, by: game.me(), at: api.now(), probe };
		game.applyKick(data, true);
		api.send(data);
		game.fx.pulse(kickHaptic(speed), 40, hand);
		kicks++;
		return true;
	}

	/** one hand's contact test against the ball @param {'left'|'right'} hand @param {any} o */
	function evaluate(hand, o) {
		const ring = rings[hand];
		if (ring.length < 2) return 0;
		const tip = ring[ring.length - 1].p;
		const ballR = ballRadius(o);
		const reach = TIP_RADIUS + ballR;
		const c = kickContact(tip, ringVelocity(ring), TIP_RADIUS, o.position.toArray(), ringVelocity(ballRing), ballR);
		if (!armStep(arms[hand], c.distance, reach)) return 0;
		// resting inside or pulling away: nothing, and the tip stays ARMED (core's rule — a
		// hand parked in the ball that then shoves it still kicks)
		if (c.approach <= MIN_KICK_SPEED) return 0;
		arms[hand].spent = true;
		// core's knock already took this touch (the same hand, the same swing) — on the PAGE
		// clock: a test feed's `now` is its own
		if (performance.now() - lastCoreHit < DEDUPE_MS) return 0;
		return fire(o, c.n, c.approach, 'tip-' + hand, hand) ? 1 : 0;
	}

	/** is this viewer kicking — a headset in Interact/Play (or a test feed driving a hand) */
	const tipsLive = () => !!api.isVR?.() && game.localActive();

	/** per frame, every peer */
	function tick() {
		const o = game.ball();
		if (!o) {
			ballRing.length = 0;
			return;
		}
		const now = performance.now();
		pushSample(ballRing, o.position.toArray(), now);
		watchBounce(o, now);
		if (!tipsLive()) {
			rings.left.length = 0;
			rings.right.length = 0;
			return;
		}
		for (const hand of /** @type {const} */ (['left', 'right'])) {
			if (now < fedUntil[hand]) continue; // a synthetic feed owns this hand
			const snap = api.vrHand?.(hand);
			if (!snap?.position) {
				rings[hand].length = 0;
				continue;
			}
			pushSample(rings[hand], toGroup(tipPoint(snap.position, snap.quaternion ?? null)), now);
			evaluate(hand, o);
		}
	}

	/** the ball sounds where it bounces @param {any} o @param {number} now */
	function watchBounce(o, now) {
		const v = ringVelocity(ballRing);
		velHistory.push({ t: now, v });
		while (velHistory.length > 2 && now - velHistory[0].t > 220) velHistory.shift();
		if (game.phase() !== 'live' && game.phase() !== 'menu') return;
		if (now - lastBounce < BOUNCE_GAP_MS || now - game.lastTouchMs() < BOUNCE_GAP_MS) return;
		const old = velHistory.find((e) => now - e.t >= 100);
		if (!old || !bounced(old.v, v)) return;
		lastBounce = now;
		velHistory.length = 0;
		game.fx.sound('hit', o.getWorldPosition(new THREE.Vector3()).toArray());
	}

	/**
	 * The TEST hook (and the only seam a headless run has to a hand): drive `hand`'s tip with
	 * a WORLD pose on the caller's own clock, exactly the path api.vrHand feeds, and evaluate.
	 * @param {'left'|'right'} hand @param {number[]} worldPos @param {number[] | null} worldQuat @param {number} tMs
	 * @returns {{kicks: number, live: boolean}}
	 */
	function feed(hand, worldPos, worldQuat, tMs) {
		const o = game.ball();
		const live = tipsLive();
		if (!o || !live) return { kicks: 0, live };
		fedUntil[hand] = performance.now() + FEED_HOLD_MS;
		pushSample(rings[hand], toGroup(tipPoint(worldPos, worldQuat)), tMs);
		return { kicks: evaluate(hand, o), live };
	}

	/**
	 * A click on the ball kicks it away from the player (desktop Interact/Play, the VR
	 * trigger) — within CLICK_REACH, so the ball is kicked, not sniped. @param {any} mesh
	 * @returns {boolean} consumed
	 */
	function clickKick(mesh) {
		const o = game.ball();
		if (!o || !game.localActive()) return false;
		let cursor = mesh;
		while (cursor && cursor !== o) cursor = cursor.parent;
		if (!cursor) return false;
		const player = typeof api.playerPosition === 'function' ? api.playerPosition() : null;
		const ballWorld = o.getWorldPosition(new THREE.Vector3());
		if (!player) return false;
		const d = [ballWorld.x - player[0], (ballWorld.y - player[1]) * 0.4, ballWorld.z - player[2]];
		const dist = Math.hypot(ballWorld.x - player[0], ballWorld.y - player[1], ballWorld.z - player[2]);
		if (dist > CLICK_REACH) return false;
		const l = Math.hypot(d[0], d[1], d[2]) || 1;
		// the world direction into the group frame (rotation only)
		const group = api.objectsGroup();
		const dir = new THREE.Vector3(d[0] / l, d[1] / l, d[2] / l);
		if (group) dir.applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()).invert());
		const ballVel = ringVelocity(ballRing);
		const n = dir.toArray();
		const along = ballVel[0] * n[0] + ballVel[1] * n[1] + ballVel[2] * n[2];
		fire(o, n, Math.max(0, CLICK_KICK_SPEED - along), 'click');
		return true;
	}

	return { tick, feed, clickKick, noteCoreHit, kicks: () => kicks, tipsLive };
}
