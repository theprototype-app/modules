// waves — THE ABILITIES, pure (30b P2). One is carried at a time (the loadout), fired by the free
// hand's GRIP in a headset or Q on a desktop, then it recharges:
//   Shield   blocks all damage to you for 3 s                        (LOCAL: your own health)
//   Slow-mo  every enemy walks at 40% for 4 s                         (REPLICATED: everyone's enemies)
//   Pulse    a shockwave shoves every enemy near you back along its lane (REPLICATED)
// This file is the numbers and the cooldown rule; powers.js does the rest.

export const ABILITIES = Object.freeze({
	shield: Object.freeze({ id: 'shield', name: 'Shield', duration: 3, cooldown: 12, color: 0x39e0ff, sound: 'ring', blurb: 'Blocks all damage for 3 s.' }),
	slowmo: Object.freeze({ id: 'slowmo', name: 'Slow-mo', duration: 4, cooldown: 16, color: 0x8a7dff, sound: 'whoosh', blurb: 'Enemies at 40% speed for 4 s.' }),
	pulse: Object.freeze({ id: 'pulse', name: 'Pulse', duration: 0.45, cooldown: 8, color: 0xffd24a, sound: 'kick', radius: 6, push: 3.2, blurb: 'A shockwave shoves nearby enemies back.' })
});

/** @param {any} id @returns {typeof ABILITIES.pulse} */
export function abilityOf(id) {
	return /** @type {any} */ (ABILITIES)[String(id)] ?? ABILITIES.pulse;
}

/** a fresh charge: ready now */
export const freshCharge = () => ({ readyAt: -Infinity, activeUntil: -Infinity, id: '' });

/**
 * Use the ability at `t` if it is charged. A different ability than the last one used starts
 * charged only if the old cooldown is over (no swapping around a cooldown).
 * @param {ReturnType<typeof abilityOf>} a @param {ReturnType<typeof freshCharge>} s @param {number} t
 * @returns {{ok: boolean, state: ReturnType<typeof freshCharge>}}
 */
export function use(a, s, t) {
	if (t < s.readyAt) return { ok: false, state: s };
	return { ok: true, state: { readyAt: t + a.cooldown, activeUntil: t + a.duration, id: a.id } };
}

/** 0..1 how charged it is (1 = ready) @param {ReturnType<typeof abilityOf>} a @param {ReturnType<typeof freshCharge>} s @param {number} t */
export function readiness(a, s, t) {
	if (!(t < s.readyAt)) return 1;
	return Math.max(0, Math.min(1, 1 - (s.readyAt - t) / a.cooldown));
}

/** is it running right now @param {ReturnType<typeof freshCharge>} s @param {number} t */
export const active = (s, t) => t < s.activeUntil;

/**
 * THE PULSE'S SHOVE, computed by the player who fires it (and then replicated as-is): every
 * enemy within `radius` on the ground is pushed back, harder the closer it stood; a tank
 * barely moves. Rounded to centimetres so the event stays small.
 * @param {{uuid: string, pos: number[] | null, kind: string}[]} enemies @param {number[]} at the player
 * @param {{radius: number, push: number}} a @returns {Record<string, number>}
 */
export function pulseShoves(enemies, at, a) {
	/** @type {Record<string, number>} */
	const out = {};
	for (const e of enemies) {
		if (!e.pos) continue;
		const d = Math.hypot(e.pos[0] - at[0], e.pos[2] - at[2]);
		if (d > a.radius) continue;
		const m = a.push * (1 - 0.5 * (d / a.radius)) * (e.kind === 'tank' ? 0.35 : 1);
		out[e.uuid] = Math.round(m * 100) / 100;
	}
	return out;
}
