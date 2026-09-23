// the menu's choices — pure (30b P4).
import { ACTIONS, menuRows, MUSIC_VOLUME } from '../src/menu.js';
import { DEFAULT_PREFS, normalize } from '../src/prefs.js';
import { GUN_BUTTONS, ABILITY_BUTTONS, OPTION_BUTTONS } from '../src/hud.js';

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	const ids = [...GUN_BUTTONS, ...ABILITY_BUTTONS, ...OPTION_BUTTONS].map((b) => b[0]);
	check(ids.every((id) => typeof ACTIONS[id] === 'function') && Object.keys(ACTIONS).every((id) => ids.includes(id)), 'every loadout / option button has its action, and every action its button');
	let p = normalize(null);
	const press = (/** @type {string} */ id) => (p = normalize({ ...p, ...ACTIONS[id](p) }));
	press('wv-gun-scatter');
	press('wv-ab-shield');
	check(p.gun === 'scatter' && p.ability === 'shield', 'a gun and an ability button pick them');
	press('wv-opt-music');
	check(p.music === 'high', 'Music cycles low -> high');
	press('wv-opt-music');
	press('wv-opt-music');
	check(p.music === 'low', '  -> off -> low');
	press('wv-opt-hand');
	check(p.hand === 'left', 'Gun hand cycles right -> left');
	press('wv-opt-hand');
	check(p.hand === 'both', '  -> both');
	press('wv-opt-sfx');
	press('wv-opt-haptics');
	check(p.sfx === false && p.haptics === false, 'Sounds and Vibration toggle');
	const rows = menuRows(p);
	check(rows['wv-loadout-now'][0] === 'Scatter + Shield' && rows['wv-opt-hand-v'][0] === 'Both' && rows['wv-opt-sfx-v'][0] === 'Off' && rows['wv-opt-music-v'][0] === 'Low', 'menuRows: what each choice shows back');
	check(rows['wv-ability-label'][0].startsWith('SHIELD') && menuRows(DEFAULT_PREFS)['wv-ability-label'][0] === 'PULSE — grip / Q', 'the play HUD names the ability and its button');
	check(MUSIC_VOLUME.off === 0 && MUSIC_VOLUME.low > 0 && MUSIC_VOLUME.high > MUSIC_VOLUME.low, 'music volumes: off / low / high');
}
