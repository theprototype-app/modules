// waves — THE START A HEADSET CAN REACH (30b P0). The Start button lives on the DOM HUD,
// and core draws no DOM HUD inside a headset — so a VR player could enter the game, see the
// arena, and never begin a round: the game shell stayed on `menu`, `roundUnderway()` stayed
// false and the Waves engine (which walks enemies only inside a round) left them standing.
//
// The fix is a board in the world, in front of the player, whenever this peer is IN the game
// (Play / Interact) in a headset and no round is running: "shoot here to start". A trigger
// press with a controller aimed at it presses Start — the SAME graph path as the DOM button
// (the `hudbutton` node bound to `wv-start` pulses, replicated like a real press, and the
// template's Set Game State starts the round for every peer). A desktop player keeps the
// DOM menu; nothing here runs off a headset.

import { createBoard } from './board.js';
import { aimRay, rayRect, yawOf, createEdges, inGame } from './vr.js';

export const START_ELEMENT = 'wv-start';
const DISTANCE = 2.4;
const DEBOUNCE = 1.2;

/** @param {any} api @param {any} root the module's scene-root group */
export function registerStart(api, root) {
	const board = createBoard(api);
	root.add(board.group);
	const edges = createEdges();
	let pressedAt = -Infinity;
	let placed = false;
	/** 30b P3: a banner shown on the board in a headset when core has no `api.announce` */
	let transient = /** @type {{card: any, until: number} | null} */ (null);
	/** the last run's result card (the board's "again" face) @type {() => any} */
	let resultCard = () => null;
	/** the headset's hands, as the SDK reports them (null when untracked) */
	const hands = () => ['right', 'left'].map((hand) => ({ hand, snap: api.vrHand?.(hand) ?? null }));

	/** is there a Start to press in this scene? (a scene without the template's button has none) */
	const hasStart = () => api.flow.nodes('hudbutton').some((/** @type {any} */ n) => String(n.data?.element ?? '') === START_ELEMENT);

	/** press Start the way the DOM button does: pulse its hudbutton node, REPLICATED */
	function press() {
		const t = performance.now() / 1000;
		if (t - pressedAt < DEBOUNCE) return false;
		pressedAt = t;
		api.fireNodeTrigger('hudbutton', (/** @type {any} */ d) => String(d?.element ?? '') === START_ELEMENT);
		api.hapticPattern ? api.hapticPattern('success') : api.haptic?.(0.6, 80);
		api.playSound?.(api.music ? 'portal' : 'ding');
		return true;
	}

	/** stand the board ahead of the player, facing them: the way the hands point (or the head
	 * toward the arena when no hand is tracked) */
	/** @param {number} [lift] metres above the eye @param {number} [distance] */
	function place(lift = 0.15, distance = DISTANCE) {
		const head = api.playerPosition?.() ?? [0, 1.6, 0];
		const tracked = hands().filter((h) => h.snap?.position && h.snap?.quaternion);
		let yaw = 0;
		if (tracked.length) {
			const d = aimRay(/** @type {any} */ (tracked[0].snap)).dir;
			yaw = yawOf([d[0], 0, d[2]]);
		}
		const at = [head[0] - Math.sin(yaw) * distance, head[1] + lift, head[2] - Math.cos(yaw) * distance];
		board.placeFacing(at, yaw);
		placed = true;
	}

	/** a round is RUNNING only with a finite cutoff: a shell nobody has started answers
	 * roundUnderway() true (the no-Start-button rule) with a null cutoff */
	const running = () => {
		const cutoff = api.game.roundCutoff();
		return typeof cutoff === 'number' && Number.isFinite(cutoff) && api.game.roundUnderway();
	};

	let mode = '';
	function frame() {
		const vrGame = !!api.isVR?.() && inGame(api);
		// a banner first: high over the arena, out of the line of fire, never pressable
		if (transient && performance.now() / 1000 < transient.until && vrGame) {
			board.draw(transient.card);
			if (mode !== 'card') {
				place(0.9, 3.4);
				mode = 'card';
			}
			board.show(true);
			return;
		}
		transient = null;
		if (mode === 'card') {
			placed = false;
			mode = '';
		}
		const want = vrGame && !running() && hasStart();
		if (!want) {
			if (board.visible()) board.show(false);
			placed = false;
			edges.clear();
			return;
		}
		const result = resultCard();
		board.draw(result ? { title: result.title, lines: result.lines, button: 'SHOOT TO PLAY AGAIN', color: result.color } : { title: 'WAVES', lines: ['Hold the crystal against the waves.', 'Aim a controller here and pull the trigger.'], button: 'SHOOT TO START' });
		if (!placed) place();
		board.show(true);
		const rect = board.rect();
		for (const { hand, snap } of hands()) {
			if (!snap?.position || !snap?.quaternion) continue;
			const pulled = edges.edge('trigger-' + hand, !!snap.trigger);
			if (pulled && rayRect(aimRay(snap), rect)) press();
		}
	}

	api.registerFrameTask(() => {
		try {
			frame();
		} catch (error) {
			console.warn('[waves] start board failed', error);
		}
	});

	return {
		board,
		press,
		hasStart,
		visible: () => board.visible(),
		/** a banner on the board for `ms` (the headset's announce fallback) @param {any} card @param {number} ms */
		card(card, ms) {
			transient = { card, until: performance.now() / 1000 + ms / 1000 };
			mode = '';
		},
		/** @param {() => any} fn */
		setResult(fn) {
			resultCard = fn;
		}
	};
}
