// waves — THE MENU'S CHOICES (30b P4). The Loadout and Options screens are ordinary HUD buttons
// (so core's VR game panel shows and presses them like any other, 30b C2), each bound to a
// PER-PLAYER hudbutton node: a press stays in this peer's own trigger log. This file watches
// those nodes' stamps and turns a new one into the choice — the gun, the ability, the music,
// the sounds, the gun hand, the vibration — saved on this device (prefs.js) and shown back as
// local list rows. It also keeps the game's music playing (30b C5 `api.music`, `arcade`) while
// this player is in the game, at the chosen volume, and adds the enemies' footsteps.
//
// FIRST SIGHT NEVER FIRES: a stamp already there when a node is first seen is history.

import { GUN_IDS, gunOf } from './guns.js';
import { ABILITY_IDS, HANDS, MUSIC, cycle } from './prefs.js';
import { abilityOf } from './abilities.js';
import { inGame } from './vr.js';

/** what each button does to the prefs @type {Record<string, (p: any) => any>} */
export const ACTIONS = Object.freeze({
	...Object.fromEntries(GUN_IDS.map((id) => ['wv-gun-' + id, () => ({ gun: id })])),
	...Object.fromEntries(ABILITY_IDS.map((id) => ['wv-ab-' + id, () => ({ ability: id })])),
	'wv-opt-music': (/** @type {any} */ p) => ({ music: cycle(MUSIC, p.music) }),
	'wv-opt-sfx': (/** @type {any} */ p) => ({ sfx: !p.sfx }),
	'wv-opt-hand': (/** @type {any} */ p) => ({ hand: cycle(HANDS, p.hand) }),
	'wv-opt-haptics': (/** @type {any} */ p) => ({ haptics: !p.haptics })
});
/** the music preset's volume per option */
export const MUSIC_VOLUME = Object.freeze({ off: 0, low: 0.35, high: 0.7 });

const cap = (/** @type {string} */ s) => s.charAt(0).toUpperCase() + s.slice(1);

/** the rows every choice shows back, pure @param {any} p */
export function menuRows(p) {
	const gun = gunOf(p.gun).name;
	const ability = abilityOf(p.ability).name;
	return {
		'wv-loadout-now': [gun + ' + ' + ability],
		'wv-loadout-pick': ['Selected: ' + gun + ' + ' + ability],
		'wv-opt-music-v': [cap(p.music)],
		'wv-opt-sfx-v': [p.sfx ? 'On' : 'Off'],
		'wv-opt-hand-v': [p.hand === 'both' ? 'Both' : cap(p.hand)],
		'wv-opt-haptics-v': [p.haptics ? 'On' : 'Off'],
		'wv-ability-label': [ability.toUpperCase() + (p.hand === 'both' ? ' — left grip / Q' : ' — grip / Q')]
	};
}

/**
 * @param {any} api
 * @param {ReturnType<import('./engine.js').createWavesEngine>} engine
 * @param {ReturnType<import('./prefs.js').createPrefs>} prefs
 * @param {ReturnType<import('./feel.js').createFeel>} feel
 */
export function registerMenu(api, engine, prefs, feel) {
	/** hudbutton node id -> the stamp acted on (null = seeded, none yet) */
	const acted = new Map();
	const pressed = /** @type {string[]} */ ([]);

	function pushRows() {
		for (const [id, rows] of Object.entries(menuRows(prefs.get()))) api.hud.rows(id, rows);
	}

	function sweep() {
		for (const node of api.flow.nodes('hudbutton')) {
			const element = String(node.data?.element ?? '');
			const act = ACTIONS[element];
			if (!act) continue;
			const stamp = api.flow.triggerStamp(node.id)?.stamp ?? null;
			if (!acted.has(node.id)) {
				acted.set(node.id, stamp);
				continue;
			}
			if (stamp === null || acted.get(node.id) === stamp) continue;
			acted.set(node.id, stamp);
			prefs.set(act(prefs.get()));
			pressed.push(element);
			if (pressed.length > 40) pressed.shift();
			feel.sound('click');
			feel.haptic('tap');
		}
	}

	// ---- the music: the arcade loop while this player is in the game ------------------------
	let playing = /** @type {string | null} */ (null);
	function music() {
		if (!api.music?.play) return;
		const p = prefs.get();
		const volume = /** @type {any} */ (MUSIC_VOLUME)[p.music] ?? 0;
		const want = inGame(api) && volume > 0 && engine.all().length > 0 ? 'arcade@' + volume : null;
		if (want === playing) return;
		if (want) api.music.play('arcade', { volume });
		else api.music.stop?.();
		playing = want;
	}

	// ---- footsteps: the nearest walking enemy, quietly --------------------------------------------
	let lastStep = 0;
	function steps() {
		const t = performance.now() / 1000;
		if (t - lastStep < 0.42 || !inGame(api)) return;
		const me = api.playerPosition?.();
		if (!me) return;
		let best = null;
		let bestD = 12;
		for (const e of engine.targets()) {
			if (!e.walking) continue;
			const o = api.objectsGroup()?.getObjectByProperty('uuid', e.uuid);
			if (!o) continue;
			const p = o.getWorldPosition(new api.THREE.Vector3());
			const d = Math.hypot(p.x - me[0], p.z - me[2]);
			if (d < bestD) {
				bestD = d;
				best = p.toArray();
			}
		}
		if (!best) return;
		lastStep = t;
		feel.sound('step', best);
	}

	let last = 0;
	let lastRows = 0;
	api.registerFrameTask(() => {
		const t = performance.now() / 1000;
		try {
			steps();
			if (t - last < 0.1) return;
			last = t;
			sweep();
			music();
			// a scene load drops the pushed rows: put them back (a list is written into, not bound)
			if (t - lastRows > 1) {
				lastRows = t;
				pushRows();
			}
		} catch (error) {
			console.warn('[waves] menu failed', error);
		}
	});
	prefs.onChange(() => {
		pushRows();
		music();
	});
	pushRows();

	return { sweep, pressed, pushRows, playing: () => playing };
}
