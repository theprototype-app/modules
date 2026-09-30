// waves — THE HUD, as data (the Towers / Stars Room / football shape). 30b: a real front door —
// the MENU (Play · How to play · Loadout · Options), an illustrated HOW TO PLAY, the LOADOUT
// (three guns, three abilities), the OPTIONS (music, sounds, gun hand, vibration) — then the
// play HUD (wave + level, score, the crystal's bar, the ability's charge, the beam's heat, a
// crosshair), the pause screen and the RESULTS. In a headset core draws these screens as its
// VR game panel (30b C2); the menu's buttons are the same buttons there.
//
// Who owns what: the screens follow the game shell (`showWhile`), so a late joiner lands on the
// right one with no wiring. Menu navigation is a LOCAL hudscreen override (a per-player button
// pulse, `perPlayer`), so one player browsing the loadout moves nobody else's screen. The
// loadout and option buttons are per-player pulses the module reads (menu.js); what they show
// back is pushed as local list rows. Start / Again / Restart / Quit replicate: they are the
// round, and the round is everyone's.

const PANEL = { bg: 'rgba(22, 18, 28, 0.93)', radius: 18, border: '1px solid rgba(255, 140, 100, 0.3)' };
const BUTTON = (/** @type {string} */ bg, size = 16) => ({ size, weight: '700', bg, color: '#ffffff', radius: 12 });
const QUIET = { size: 15, weight: '600', bg: '#3a3440', color: '#e6dede', radius: 12 };
const TITLE = (/** @type {number} */ size) => ({ size, weight: '800', color: '#ff9c6b', align: 'center' });
const BODY = { size: 14, color: '#e6dede', align: 'left' };

/** the loadout's buttons: id, label, colour */
export const GUN_BUTTONS = Object.freeze([
	['wv-gun-blaster', 'Blaster', '#1e8fb0', 'Semi-auto. One precise bolt per pull.'],
	['wv-gun-scatter', 'Scatter', '#c46a1c', '7 pellets, slow pump. Brutal up close.'],
	['wv-gun-beam', 'Beam', '#a2308c', 'Hold to burn. Overheats — let it cool.']
]);
export const ABILITY_BUTTONS = Object.freeze([
	['wv-ab-shield', 'Shield', '#1e8fb0', 'Blocks all crystal damage for 3 s.'],
	['wv-ab-slowmo', 'Slow-mo', '#5a4fc0', 'Every enemy at 40% for 4 s.'],
	['wv-ab-pulse', 'Pulse', '#b8901c', 'A shockwave shoves them back.']
]);
export const OPTION_BUTTONS = Object.freeze([
	['wv-opt-music', 'Music'],
	['wv-opt-sfx', 'Sound effects'],
	['wv-opt-hand', 'Gun hand'],
	['wv-opt-haptics', 'Vibration']
]);
/** the per-player navigation: button -> [screen, action] */
export const NAV = Object.freeze([
	['wv-nav-howto', 'howto', 'show'],
	['wv-nav-loadout', 'loadout', 'show'],
	['wv-nav-options', 'options', 'show'],
	['wv-back-howto', 'howto', 'hide'],
	['wv-back-loadout', 'loadout', 'hide'],
	['wv-back-options', 'options', 'hide']
]);

/** a 64 px illustrated tile: a coloured square with a big glyph @param {string} id @param {number} x @param {number} y @param {string} glyph @param {string} bg */
function tile(id, x, y, glyph, bg) {
	return [
		{ id: id + '-bg', kind: 'panel', anchor: 'center', x, y, w: 64, h: 64, z: 1, label: '', style: { bg, radius: 14, border: '1px solid rgba(255,255,255,0.25)' } },
		{ id, kind: 'text', anchor: 'center', x, y, w: 64, h: 64, z: 2, label: glyph, style: { size: 34, color: '#ffffff', align: 'center' } }
	];
}

/** the def's `hud` field */
export function arenaHud() {
	return {
		scene: {
			active: '',
			changedAt: 0,
			screens: [
				{
					id: 'menu',
					name: 'Menu',
					showWhile: 'menu',
					input: 'menu',
					elements: [
						{ id: 'menu-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 520, h: 480, z: 0, label: '', style: PANEL },
						{ id: 'menu-stripe', kind: 'panel', anchor: 'center', x: 0, y: -236, w: 520, h: 8, z: 1, label: '', style: { bg: '#ff7a4a', radius: 4 } },
						{ id: 'title', kind: 'text', anchor: 'center', x: 0, y: -188, w: 460, h: 60, z: 1, label: 'WAVES', style: TITLE(52) },
						{ id: 'subtitle', kind: 'text', anchor: 'center', x: 0, y: -136, w: 440, h: 44, z: 1, label: 'Five levels of enemies pour out of the portals. Pick your gun, hold the crystal.', style: { size: 14, color: '#e6dede', align: 'center' }, wrap: true },
						{ id: 'wv-start', kind: 'button', anchor: 'center', x: 0, y: -68, w: 440, h: 60, z: 1, label: '▶  Play', enabled: true, style: BUTTON('#d9533f', 22) },
						{ id: 'wv-nav-howto', kind: 'button', anchor: 'center', x: 0, y: 2, w: 440, h: 46, z: 1, label: 'How to play', enabled: true, style: QUIET },
						{ id: 'wv-nav-loadout', kind: 'button', anchor: 'center', x: 0, y: 56, w: 440, h: 46, z: 1, label: 'Loadout', enabled: true, style: QUIET },
						{ id: 'wv-nav-options', kind: 'button', anchor: 'center', x: 0, y: 110, w: 440, h: 46, z: 1, label: 'Options', enabled: true, style: QUIET },
						{ id: 'wv-loadout-now', kind: 'list', anchor: 'center', x: 0, y: 160, w: 440, h: 22, z: 1, label: '', rows: [], style: { size: 13, weight: '600', color: '#ffd0b0', align: 'center', bg: 'transparent' } },
						{ id: 'wv-best', kind: 'list', anchor: 'center', x: 0, y: 184, w: 440, h: 22, z: 1, label: '', rows: [], style: { size: 13, color: '#d6c8c8', align: 'center', bg: 'transparent' } },
						{ id: 'menu-hint', kind: 'text', anchor: 'center', x: 0, y: 216, w: 460, h: 20, z: 1, label: 'Trigger / click: shoot  ·  Grip / Q: ability  ·  P: pause', style: { size: 11, color: '#9b8f8f', align: 'center' } }
					]
				},
				{
					id: 'howto',
					name: 'How to play',
					input: 'menu',
					elements: [
						{ id: 'howto-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 640, h: 540, z: 0, label: '', style: PANEL },
						{ id: 'howto-title', kind: 'text', anchor: 'center', x: 0, y: -226, w: 560, h: 44, z: 1, label: 'HOW TO PLAY', style: TITLE(32) },
						...tile('howto-icon-1', -250, -150, '🎯', '#1e8fb0'),
						{ id: 'howto-1', kind: 'text', anchor: 'center', x: 50, y: -150, w: 480, h: 74, z: 1, label: 'SHOOT — pull the trigger (desktop: click). The gun is in your right hand; switch hands in Options.', style: BODY, wrap: true },
						...tile('howto-icon-2', -250, -64, '💎', '#2a8a9a'),
						{ id: 'howto-2', kind: 'text', anchor: 'center', x: 50, y: -64, w: 480, h: 74, z: 1, label: 'HOLD THE CRYSTAL — enemies walk from the portals to it. One that reaches it explodes: −2 crystal. At zero the run is lost.', style: BODY, wrap: true },
						...tile('howto-icon-3', -250, 22, '✋', '#8a5cff'),
						{ id: 'howto-3', kind: 'text', anchor: 'center', x: 50, y: 22, w: 480, h: 74, z: 1, label: 'ABILITY — squeeze the grip on your free hand (desktop: Q): Shield, Slow-mo or Pulse. Then it recharges.', style: BODY, wrap: true },
						...tile('howto-icon-4', -250, 108, '⭐', '#b8901c'),
						{ id: 'howto-4', kind: 'text', anchor: 'center', x: 50, y: 108, w: 480, h: 74, z: 1, label: 'LEVELS — every 3 waves is a new level: runners, then tanks, then faster. Higher levels score more.', style: BODY, wrap: true },
						{ id: 'wv-back-howto', kind: 'button', anchor: 'center', x: 0, y: 212, w: 260, h: 46, z: 1, label: 'Back', enabled: true, style: QUIET }
					]
				},
				{
					id: 'loadout',
					name: 'Loadout',
					input: 'menu',
					elements: [
						{ id: 'loadout-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 660, h: 520, z: 0, label: '', style: PANEL },
						{ id: 'loadout-title', kind: 'text', anchor: 'center', x: 0, y: -214, w: 560, h: 44, z: 1, label: 'LOADOUT', style: TITLE(32) },
						{ id: 'loadout-gun', kind: 'text', anchor: 'center', x: 0, y: -168, w: 600, h: 22, z: 1, label: 'GUN', style: { size: 12, weight: '700', color: '#c8b8b8', align: 'center' } },
						...GUN_BUTTONS.flatMap(([id, label, bg, blurb], i) => [
							{ id, kind: 'button', anchor: 'center', x: -205 + i * 205, y: -126, w: 190, h: 50, z: 1, label, enabled: true, style: BUTTON(bg, 17) },
							{ id: id + '-blurb', kind: 'text', anchor: 'center', x: -205 + i * 205, y: -78, w: 190, h: 40, z: 1, label: blurb, style: { size: 12, color: '#d6c8c8', align: 'center' }, wrap: true }
						]),
						{ id: 'loadout-ability', kind: 'text', anchor: 'center', x: 0, y: -24, w: 600, h: 22, z: 1, label: 'ABILITY', style: { size: 12, weight: '700', color: '#c8b8b8', align: 'center' } },
						...ABILITY_BUTTONS.flatMap(([id, label, bg, blurb], i) => [
							{ id, kind: 'button', anchor: 'center', x: -205 + i * 205, y: 18, w: 190, h: 50, z: 1, label, enabled: true, style: BUTTON(bg, 17) },
							{ id: id + '-blurb', kind: 'text', anchor: 'center', x: -205 + i * 205, y: 66, w: 190, h: 40, z: 1, label: blurb, style: { size: 12, color: '#d6c8c8', align: 'center' }, wrap: true }
						]),
						{ id: 'wv-loadout-pick', kind: 'list', anchor: 'center', x: 0, y: 128, w: 560, h: 28, z: 1, label: '', rows: [], style: { size: 17, weight: '700', color: '#ffd0b0', align: 'center', bg: 'transparent' } },
						{ id: 'wv-back-loadout', kind: 'button', anchor: 'center', x: 0, y: 196, w: 260, h: 46, z: 1, label: 'Back', enabled: true, style: QUIET }
					]
				},
				{
					id: 'options',
					name: 'Options',
					input: 'menu',
					elements: [
						{ id: 'options-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 540, h: 460, z: 0, label: '', style: PANEL },
						{ id: 'options-title', kind: 'text', anchor: 'center', x: 0, y: -184, w: 480, h: 44, z: 1, label: 'OPTIONS', style: TITLE(32) },
						...OPTION_BUTTONS.flatMap(([id, label], i) => [
							{ id, kind: 'button', anchor: 'center', x: -80, y: -112 + i * 60, w: 260, h: 46, z: 1, label, enabled: true, style: QUIET },
							{ id: id + '-v', kind: 'list', anchor: 'center', x: 150, y: -112 + i * 60, w: 170, h: 30, z: 1, label: '', rows: [], style: { size: 16, weight: '700', color: '#ffd0b0', align: 'left', bg: 'transparent' } }
						]),
						{ id: 'options-hint', kind: 'text', anchor: 'center', x: 0, y: 130, w: 480, h: 20, z: 1, label: 'Tap a setting to change it. Saved on this device.', style: { size: 12, color: '#9b8f8f', align: 'center' } },
						{ id: 'wv-back-options', kind: 'button', anchor: 'center', x: 0, y: 182, w: 260, h: 46, z: 1, label: 'Back', enabled: true, style: QUIET }
					]
				},
				{
					id: 'hud',
					name: 'HUD',
					showWhile: 'playing',
					input: 'game',
					elements: [
						{ id: 'wv-banner', kind: 'panel', anchor: 'top-center', x: 0, y: 10, w: 190, h: 86, z: 0, label: '', style: { bg: 'rgba(22, 18, 28, 0.78)', radius: 14, border: '1px solid rgba(255, 140, 100, 0.25)' } },
						{ id: 'wv-wave', kind: 'text', anchor: 'top-center', x: 0, y: 14, w: 170, h: 32, z: 1, label: 'Wave 1', style: { size: 24, weight: '800', color: '#ff9c6b', align: 'center' } },
						{ id: 'wv-level', kind: 'text', anchor: 'top-center', x: 0, y: 46, w: 170, h: 20, z: 1, label: 'LEVEL 1', style: { size: 12, weight: '700', color: '#ffd24a', align: 'center' } },
						{ id: 'wv-left', kind: 'text', anchor: 'top-center', x: 0, y: 66, w: 170, h: 22, z: 1, label: '', style: { size: 13, color: '#e6dede', align: 'center' } },
						{ id: 'wv-score-bg', kind: 'panel', anchor: 'top-left', x: 16, y: 12, w: 180, h: 70, z: 0, label: '', style: { bg: 'rgba(22, 18, 28, 0.78)', radius: 14, border: '1px solid rgba(255, 140, 100, 0.25)' } },
						{ id: 'wv-score-label', kind: 'text', anchor: 'top-left', x: 30, y: 18, w: 150, h: 18, z: 1, label: 'SCORE', style: { size: 11, weight: '700', color: '#c8b8b8', align: 'left' } },
						{ id: 'wv-score', kind: 'text', anchor: 'top-left', x: 30, y: 38, w: 160, h: 36, z: 1, label: '0', style: { size: 28, weight: '800', color: '#ffffff', align: 'left' } },
						{ id: 'wv-hp-label', kind: 'text', anchor: 'bottom-center', x: 0, y: 46, w: 340, h: 18, z: 1, label: 'CRYSTAL', style: { size: 11, weight: '700', color: '#9ff0ff', align: 'center' } },
						{ id: 'wv-hp', kind: 'bar', anchor: 'bottom-center', x: 0, y: 24, w: 340, h: 20, z: 1, label: '', min: 0, max: 1, value: 1, orientation: 'horizontal', showPercent: false, style: { color: '#39e0ff', bg: 'rgba(0,0,0,0.45)', radius: 10 } },
						{ id: 'wv-ability-label', kind: 'list', anchor: 'bottom-right', x: 20, y: 62, w: 200, h: 24, z: 1, label: '', rows: [], rowHeight: 20, style: { size: 11, weight: '700', color: '#ffe7a0', align: 'left', bg: 'transparent' } },
						{ id: 'wv-ability', kind: 'bar', anchor: 'bottom-right', x: 20, y: 46, w: 200, h: 14, z: 1, label: '', min: 0, max: 1, value: 1, orientation: 'horizontal', showPercent: false, style: { color: '#ffd24a', bg: 'rgba(0,0,0,0.45)', radius: 7 } },
						{ id: 'wv-heat-label', kind: 'text', anchor: 'bottom-right', x: 20, y: 30, w: 200, h: 14, z: 1, label: 'HEAT', style: { size: 9, weight: '700', color: '#ff9ce8', align: 'right' } },
						{ id: 'wv-heat', kind: 'bar', anchor: 'bottom-right', x: 20, y: 18, w: 200, h: 10, z: 1, label: '', min: 0, max: 1, value: 0, orientation: 'horizontal', showPercent: false, style: { color: '#ff4fd8', bg: 'rgba(0,0,0,0.45)', radius: 5 } },
						{ id: 'wv-crosshair', kind: 'crosshair', anchor: 'center', x: 0, y: 0, w: 24, h: 24, z: 2, label: '', thickness: 2, gap: 5, dot: true, style: { color: '#ffffff', opacity: 0.85 } },
						{ id: 'wv-kills', kind: 'list', anchor: 'top-right', x: 16, y: 14, w: 220, h: 100, z: 1, label: '', rows: [], style: { size: 13, weight: '600', color: '#ffe0d0', align: 'right', bg: 'transparent' } }
					]
				},
				{
					id: 'pause',
					name: 'Pause',
					input: 'menu',
					elements: [
						{ id: 'pause-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 380, h: 300, z: 0, label: '', style: PANEL },
						{ id: 'pause-title', kind: 'text', anchor: 'center', x: 0, y: -95, w: 260, h: 36, z: 1, label: 'PAUSED', style: { size: 28, weight: '800', color: '#e6dede', align: 'center' } },
						{ id: 'resume-btn', kind: 'button', anchor: 'center', x: 0, y: -30, w: 260, h: 44, z: 1, label: 'Resume', enabled: true, style: BUTTON('#3b7dd8') },
						{ id: 'restart-btn', kind: 'button', anchor: 'center', x: 0, y: 24, w: 260, h: 44, z: 1, label: 'Restart round', enabled: true, style: BUTTON('#d9533f') },
						{ id: 'quit-btn', kind: 'button', anchor: 'center', x: 0, y: 78, w: 260, h: 44, z: 1, label: 'Quit to menu', enabled: true, style: QUIET }
					]
				},
				{
					id: 'over',
					name: 'Results',
					showWhile: 'over',
					input: 'menu',
					elements: [
						{ id: 'over-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 520, h: 440, z: 0, label: '', style: PANEL },
						{ id: 'over-stripe', kind: 'panel', anchor: 'center', x: 0, y: -216, w: 520, h: 8, z: 1, label: '', style: { bg: '#ff7a4a', radius: 4 } },
						{ id: 'over-title', kind: 'text', anchor: 'center', x: 0, y: -176, w: 460, h: 40, z: 1, label: 'RESULTS', style: TITLE(30) },
						// list rows align left (core draws them so): the rows sit in the buttons' column
						{ id: 'wv-result-title', kind: 'list', anchor: 'center', x: 0, y: -124, w: 300, h: 34, z: 1, label: '', rows: ['ROUND OVER'], rowHeight: 30, style: { size: 22, weight: '800', color: '#ffd0b0', align: 'left', bg: 'transparent' } },
						{ id: 'wv-result', kind: 'list', anchor: 'center', x: 0, y: -58, w: 300, h: 80, z: 1, label: '', rows: [], rowHeight: 24, style: { size: 15, color: '#e6dede', align: 'left', bg: 'transparent' } },
						{ id: 'wv-kills-over', kind: 'list', anchor: 'center', x: 0, y: 30, w: 300, h: 76, z: 1, label: '', rows: [], style: { size: 13, color: '#ffe0d0', align: 'left', bg: 'transparent' } },
						{ id: 'wv-again', kind: 'button', anchor: 'center', x: 0, y: 118, w: 300, h: 52, z: 1, label: 'Play again', enabled: true, style: BUTTON('#d9533f', 18) },
						{ id: 'wv-menu', kind: 'button', anchor: 'center', x: 0, y: 176, w: 300, h: 44, z: 1, label: 'Menu', enabled: true, style: QUIET }
					]
				}
			]
		}
	};
}

/**
 * The nodes that drive the HUD, in addNodes shape (indices in `edges` refer to `nodes`).
 * A HUD Button pulses through a Delay (DEVX #22: a hudbutton stamp cannot reach a module
 * input, and Set Game State reads it directly).
 * @param {{name: string, playerName: string, x?: number, y?: number}} o
 */
export function hudGraph(o) {
	const x = o.x ?? 60;
	const y = o.y ?? 40;
	const nodes = [
		{ type: 'hudbutton', x, y, data: { element: 'wv-start' } },
		{ type: 'setgamestate', x: x + 220, y, data: { state: 'playing', outcome: '' } },
		{ type: 'hudbutton', x, y: y + 100, data: { element: 'wv-again' } },
		{ type: 'setgamestate', x: x + 220, y: y + 100, data: { state: 'playing', outcome: '' } },
		{ type: 'wavesvalue', x, y: y + 200, data: { name: o.name, read: 'wave' } },
		{ type: 'hudtext', x: x + 220, y: y + 200, data: { element: 'wv-wave', format: 'Wave {v}', decimals: 0 } },
		{ type: 'wavesvalue', x, y: y + 300, data: { name: o.name, read: 'left' } },
		{ type: 'hudtext', x: x + 220, y: y + 300, data: { element: 'wv-left', format: '{v} left', decimals: 0 } },
		{ type: 'healthvalue', x, y: y + 400, data: { name: o.playerName, read: 'fraction' } },
		{ type: 'hudbar', x: x + 220, y: y + 400, data: { element: 'wv-hp', min: 0, max: 1 } },
		// 30b: the board ranks SCORE (each player's own row), in play and on the results
		{ type: 'leaderboard', x, y: y + 500, data: { variable: 'score', element: 'wv-kills,wv-kills-over', limit: 8 } },
		// 30: the pause menu — P toggles it, Resume hides it, Restart re-enters playing (a fresh
		// round stamp) and Quit goes back to the menu; both close the pause screen
		{ type: 'keypress', x, y: y + 600, data: { code: 'KeyP', edge: 'down', pulse: 0.3 } },
		{ type: 'hudscreen', x: x + 220, y: y + 600, data: { screen: 'pause', action: 'toggle' } },
		{ type: 'hudbutton', x, y: y + 700, data: { element: 'resume-btn' } },
		{ type: 'hudscreen', x: x + 220, y: y + 700, data: { screen: 'pause', action: 'hide' } },
		{ type: 'hudbutton', x, y: y + 800, data: { element: 'restart-btn' } },
		{ type: 'setgamestate', x: x + 220, y: y + 800, data: { state: 'playing', outcome: '', reset: true } },
		{ type: 'hudscreen', x: x + 440, y: y + 800, data: { screen: 'pause', action: 'hide' } },
		{ type: 'hudbutton', x, y: y + 900, data: { element: 'quit-btn' } },
		{ type: 'setgamestate', x: x + 220, y: y + 900, data: { state: 'menu', outcome: '', reset: true } },
		{ type: 'hudscreen', x: x + 440, y: y + 900, data: { screen: 'pause', action: 'hide' } }
	];
	const edges = [
		{ from: 0, to: 1, handle: 'trigger' },
		{ from: 2, to: 3, handle: 'trigger' },
		{ from: 4, to: 5, handle: 'value' },
		{ from: 6, to: 7, handle: 'value' },
		{ from: 8, to: 9, handle: 'value' },
		{ from: 11, to: 12, handle: 'trigger' },
		{ from: 13, to: 14, handle: 'trigger' },
		{ from: 15, to: 16, handle: 'trigger' },
		{ from: 15, to: 17, handle: 'trigger' },
		{ from: 18, to: 19, handle: 'trigger' },
		{ from: 18, to: 20, handle: 'trigger' }
	];
	/** @param {any} node @returns {number} */
	const add = (node) => nodes.push(node) - 1;
	let row = y + 1000;
	// 30b: the results' Menu button goes back to the menu (a round-scoped reset, like Quit)
	{
		const b = add({ type: 'hudbutton', x, y: row, data: { element: 'wv-menu' } });
		const g = add({ type: 'setgamestate', x: x + 220, y: row, data: { state: 'menu', outcome: '', reset: true } });
		edges.push({ from: b, to: g, handle: 'trigger' });
		row += 100;
	}
	// 30b: the play HUD's new readouts — the level, this player's score, the ability's charge,
	// the beam's heat (the last three LOCAL values: each player sees their own)
	for (const [type, data, target, tdata] of /** @type {[string, any, string, any][]} */ ([
		['wavesvalue', { name: o.name, read: 'level' }, 'hudtext', { element: 'wv-level', format: 'LEVEL {v}', decimals: 0 }],
		['wavesplayer', { read: 'score' }, 'hudtext', { element: 'wv-score', format: '{v}', decimals: 0 }],
		['wavesplayer', { read: 'ability' }, 'hudbar', { element: 'wv-ability', min: 0, max: 1 }],
		['wavesplayer', { read: 'heat' }, 'hudbar', { element: 'wv-heat', min: 0, max: 1 }]
	])) {
		const a = add({ type, x, y: row, data });
		const b = add({ type: target, x: x + 220, y: row, data: tdata });
		edges.push({ from: a, to: b, handle: 'value' });
		row += 100;
	}
	// 30b: the menu's navigation — PER-PLAYER button pulses into LOCAL screen changes
	for (const [element, screen, action] of NAV) {
		const b = add({ type: 'hudbutton', x, y: row, data: { element, perPlayer: true } });
		const s = add({ type: 'hudscreen', x: x + 220, y: row, data: { screen, action } });
		edges.push({ from: b, to: s, handle: 'trigger' });
		row += 100;
	}
	// 30b: the loadout and option buttons — per-player pulses the module reads (menu.js)
	for (const [element] of [...GUN_BUTTONS, ...ABILITY_BUTTONS, ...OPTION_BUTTONS]) {
		add({ type: 'hudbutton', x, y: row, data: { element, perPlayer: true } });
		row += 80;
	}
	return { nodes, edges, rows: Math.ceil((row - y) / 200) };
}
