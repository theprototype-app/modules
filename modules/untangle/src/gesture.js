// The pointer GESTURE — press-drag-release AND click-to-pick / click-to-drop, one state
// machine, no THREE (the board answers `pickAt`; this file only decides WHEN).
//
// Why window CAPTURE-phase listeners and not core's click path: core dispatches a module
// click on a short STATIONARY pointerup (the editor's select rule, and play's tap), so a
// press that moves never reaches a module at all — and until it is released OrbitControls
// is orbiting the camera under the dot. The SDK has no pointerdown seam and no click-miss
// seam on the api (core's `moduleClickMissHandlers` exists but only vrPatch reaches it), so
// the module listens on `window` in the capture phase, which runs BEFORE the canvas's own
// listeners (OrbitControls, Scene's pick, play's tap). A press ON A DOT, and the drop click
// while carrying, stop propagation there: that gesture belongs to the board, so the camera
// does not orbit under it and nothing else selects or taps. Every other press passes
// through untouched. VR has no pointer events — the trigger still goes through the click
// handler in index.js.
//
// The listeners are the module's own, so they are JOURNALLED here (`detach`) and index.js
// calls it when a newer copy of the module registers (a dev reload) — the SDK gives a
// module no dispose hook of its own.

export const TAP_PX = 6; // travel below this is a click, not a drag
export const HOLD_MS = 500; // a press held this long drops on release even without travel

/**
 * @param {{
 *   target: any,
 *   locked: () => boolean,
 *   isViewport: (event: any) => boolean,
 *   active: () => boolean,
 *   carrying: () => boolean,
 *   pickAt: (event: any) => number,
 *   pick: (i: number, how: string) => void,
 *   drop: (how: string, event?: any) => void,
 *   rotateStart?: (event: any) => boolean,
 *   rotateBy?: (dx: number, dy: number) => void,
 *   now?: () => number
 * }} hooks
 */
export function createGesture(hooks) {
	const now = hooks.now ?? (() => performance.now());
	/** @type {{id: number, x: number, y: number, t: number, travel: number} | null} the live press on a dot */
	let press = null;
	let clickCarry = false; // a TAP picked the dot: it follows until the next click
	/** @type {number | null} the pointer whose pointerup belongs to a drop we already made */
	let swallowUp = null;
	/** @type {{id: number, x: number, y: number, touch: boolean} | null} */
	let rotate = null;
	let menuSuppressUntil = 0;
	/** @type {Map<number, {x: number, y: number}>} live touches, for the two-finger rotate */
	const touches = new Map();
	let lastUp = 'none';

	const mid = () => {
		let x = 0;
		let y = 0;
		for (const t of touches.values()) {
			x += t.x;
			y += t.y;
		}
		return { x: x / Math.max(1, touches.size), y: y / Math.max(1, touches.size) };
	};

	/** @param {any} e */
	function down(e) {
		if (!hooks.active()) return;
		if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
		// two fingers on the viewport rotate the globe (never while a dot is carried)
		if (touches.size === 2 && hooks.rotateStart && !hooks.carrying() && hooks.isViewport(e) && hooks.rotateStart(e)) {
			const m = mid();
			rotate = { id: -1, x: m.x, y: m.y, touch: true };
			press = null;
			e.stopPropagation();
			return;
		}
		if (e.button === 2) {
			if (hooks.rotateStart && !hooks.carrying() && hooks.isViewport(e) && hooks.rotateStart(e)) {
				rotate = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: false };
				menuSuppressUntil = now() + 60000;
				e.stopPropagation();
			}
			return;
		}
		if (e.button !== 0) return;
		if (hooks.carrying()) {
			// while carrying, a click ANYWHERE drops — the board, the sky, or a HUD button
			// (the button still gets its press: only a viewport click is swallowed)
			const viewport = hooks.isViewport(e);
			press = null;
			clickCarry = false;
			hooks.drop(viewport ? 'click' : 'ui', e);
			if (viewport) {
				swallowUp = e.pointerId;
				e.stopPropagation();
			}
			return;
		}
		if (!hooks.isViewport(e)) return;
		const i = hooks.pickAt(e);
		if (i < 0) return;
		press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now(), travel: 0 };
		clickCarry = false;
		hooks.pick(i, 'press');
		e.stopPropagation();
	}

	/** @param {any} e */
	function move(e) {
		if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (rotate) {
			if (rotate.touch && touches.size >= 2) {
				const m = mid();
				hooks.rotateBy?.(m.x - rotate.x, m.y - rotate.y);
				rotate.x = m.x;
				rotate.y = m.y;
			} else if (!rotate.touch && e.pointerId === rotate.id) {
				// under a lock clientX is pinned, so the travel is the movement delta
				const dx = hooks.locked() ? e.movementX ?? 0 : e.clientX - rotate.x;
				const dy = hooks.locked() ? e.movementY ?? 0 : e.clientY - rotate.y;
				hooks.rotateBy?.(dx, dy);
				rotate.x = e.clientX;
				rotate.y = e.clientY;
			}
			return;
		}
		if (press && e.pointerId === press.id) {
			if (hooks.locked()) press.travel += Math.abs(e.movementX ?? 0) + Math.abs(e.movementY ?? 0);
			else press.travel = Math.max(press.travel, Math.hypot(e.clientX - press.x, e.clientY - press.y));
		}
	}

	/** @param {any} e */
	function up(e) {
		touches.delete(e.pointerId);
		if (swallowUp === e.pointerId) {
			swallowUp = null;
			lastUp = 'swallowed';
			e.stopPropagation();
			return;
		}
		if (rotate && (rotate.touch ? touches.size < 2 : e.pointerId === rotate.id)) {
			rotate = null;
			menuSuppressUntil = now() + 400; // the contextmenu trails the pointerup
			lastUp = 'rotate';
			e.stopPropagation();
			return;
		}
		if (!press || e.pointerId !== press.id) return;
		const held = now() - press.t;
		const moved = press.travel > TAP_PX;
		press = null;
		e.stopPropagation();
		if (!hooks.carrying()) return;
		if (moved || held > HOLD_MS) {
			lastUp = 'release';
			hooks.drop('release', e);
		} else {
			lastUp = 'tap';
			clickCarry = true;
		}
	}

	/** @param {any} e */
	function cancel(e) {
		touches.delete(e.pointerId);
		if (rotate && !rotate.touch && e.pointerId === rotate.id) rotate = null;
		if (press && e.pointerId === press.id) {
			press = null;
			if (hooks.carrying()) hooks.drop('cancel', e);
		}
	}

	/** @param {any} e */
	function menu(e) {
		if (rotate || now() < menuSuppressUntil) {
			e.preventDefault();
			e.stopPropagation();
		}
	}

	const target = hooks.target;
	target.addEventListener('pointerdown', down, true);
	target.addEventListener('pointermove', move, true);
	target.addEventListener('pointerup', up, true);
	target.addEventListener('pointercancel', cancel, true);
	target.addEventListener('contextmenu', menu, true);

	return {
		detach() {
			target.removeEventListener('pointerdown', down, true);
			target.removeEventListener('pointermove', move, true);
			target.removeEventListener('pointerup', up, true);
			target.removeEventListener('pointercancel', cancel, true);
			target.removeEventListener('contextmenu', menu, true);
			press = null;
			rotate = null;
		},
		/** a carry that ended elsewhere (a scene clear, a level change, the VR path) */
		reset() {
			press = null;
			clickCarry = false;
		},
		/** 'press' while held, 'click' while a tap carries, 'none' otherwise */
		carryMode: () => (press ? 'press' : clickCarry ? 'click' : 'none'),
		rotating: () => !!rotate,
		lastUp: () => lastUp
	};
}
