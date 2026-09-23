// football — THE DOM HUD, as data (B2). The headset never sees this (HudLayer hides in
// VR, F8); a desktop peer and the editor do. It reads the SAME nodes the physical UI
// reads: the four `fb-*` HUD Buttons pulse the Match Button nodes (perPlayer, so a press
// is the presser's alone), the `fb-score` / `fb-sheet` / `fb-log` lists are filled by the
// Records node through api.hud.rows, and the screens follow the game shell the Football
// Event nodes drive. Towers' menu / hud / pause / over shape, so D1 can compare.

const PANEL = { bg: 'rgba(12, 18, 28, 0.9)', radius: 18, border: '1px solid rgba(255, 212, 94, 0.28)' };
const BUTTON = (bg) => ({ size: 16, weight: '700', bg, color: '#ffffff', radius: 12 });
const RED_BG = '#c94a4a';
const BLUE_BG = '#3b7dd8';
const GREEN_BG = '#3f9a61';

/** 30: the in-play SCOREBOARD — a dark bar with a red and a blue block (their big numbers are
 * HUD Texts the def's Football Value nodes drive), the match clock between them (a list the
 * Records node fills with one m:ss row) and a one-line ticker under it (last touch). The
 * `RED x — y BLUE` list (`fb-score`) is on the over screen, so the score never shows twice. @param {number} y */
function scoreboard(y) {
	const block = (/** @type {string} */ team, /** @type {number} */ x, /** @type {string} */ bg) => [
		{ id: 'sb-' + team + '-block', kind: 'panel', anchor: 'top-center', x, y: y + 6, w: 118, h: 60, z: 1, label: '', style: { bg, radius: 12 } },
		{ id: 'sb-' + team + '-name', kind: 'text', anchor: 'top-center', x, y: y + 8, w: 100, h: 16, z: 2, label: team.toUpperCase(), style: { size: 11, weight: '800', color: 'rgba(255,255,255,0.85)', align: 'left' } },
		{ id: 'fb-' + team + '-score', kind: 'text', anchor: 'top-center', x, y: y + 22, w: 100, h: 42, z: 2, label: '0', style: { size: 34, weight: '800', color: '#ffffff', align: 'left' } }
	];
	return [
		{ id: 'sb-panel', kind: 'panel', anchor: 'top-center', x: 0, y, w: 400, h: 72, z: 0, label: '', style: { bg: 'rgba(10, 14, 22, 0.92)', radius: 16, border: '1px solid rgba(255, 255, 255, 0.12)' } },
		...block('red', -134, RED_BG),
		...block('blue', 134, BLUE_BG),
		{ id: 'fb-clock', kind: 'list', anchor: 'top-center', x: 0, y: y + 12, w: 74, h: 34, z: 2, label: '', rows: [], rowHeight: 30, style: { size: 26, weight: '800', color: '#ffd45e', align: 'center', bg: 'transparent', pad: 0 } },
		{ id: 'sb-label', kind: 'text', anchor: 'top-center', x: 0, y: y + 46, w: 62, h: 18, z: 2, label: 'FOOTBALL', style: { size: 10, weight: '700', color: '#8b97a8', align: 'center' } },
		{ id: 'fb-ticker', kind: 'list', anchor: 'top-center', x: 0, y: y + 76, w: 400, h: 22, z: 1, label: '', rows: [], rowHeight: 18, style: { size: 12, color: '#c8d0dc', align: 'center', bg: 'transparent', pad: 0 } }
	];
}

/** the def's `hud` field */
export function pitchHud() {
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
						{ id: 'menu-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 500, h: 420, z: 0, label: '', style: PANEL },
						{ id: 'menu-stripe-red', kind: 'panel', anchor: 'center', x: -125, y: -200, w: 250, h: 8, z: 1, label: '', style: { bg: RED_BG, radius: 4 } },
						{ id: 'menu-stripe-blue', kind: 'panel', anchor: 'center', x: 125, y: -200, w: 250, h: 8, z: 1, label: '', style: { bg: BLUE_BG, radius: 4 } },
						{ id: 'title', kind: 'text', anchor: 'center', x: 0, y: -150, w: 424, h: 54, z: 1, label: 'FOOTBALL', style: { size: 44, weight: '800', color: '#ffd45e', align: 'left' } },
						{ id: 'subtitle', kind: 'text', anchor: 'center', x: 0, y: -98, w: 424, h: 44, z: 1, label: 'Pick a side, then Start. Hit the floating ball with your hands; a ball through the other gate is a goal.', style: { size: 14, color: '#d8dee9', align: 'left' }, wrap: true },
						{ id: 'fb-join-red', kind: 'button', anchor: 'center', x: -112, y: -28, w: 200, h: 48, z: 1, label: 'Join RED', enabled: true, style: BUTTON(RED_BG) },
						{ id: 'fb-join-blue', kind: 'button', anchor: 'center', x: 112, y: -28, w: 200, h: 48, z: 1, label: 'Join BLUE', enabled: true, style: BUTTON(BLUE_BG) },
						{ id: 'fb-start', kind: 'button', anchor: 'center', x: 0, y: 36, w: 424, h: 52, z: 1, label: 'Start match', enabled: true, style: { ...BUTTON(GREEN_BG), size: 18 } },
						{ id: 'fb-sheet', kind: 'list', anchor: 'center', x: 0, y: 112, w: 424, h: 62, z: 1, label: '', rows: [], style: { size: 12, color: '#c8d0dc', align: 'center', bg: 'rgba(255, 255, 255, 0.05)', radius: 10 } },
						{ id: 'menu-hint', kind: 'text', anchor: 'center', x: 0, y: 176, w: 424, h: 30, z: 1, label: 'Walk into the ball to knock it  ·  Grab: hold click  ·  Pause: P', style: { size: 12, color: '#8b97a8', align: 'left' }, wrap: true }
					]
				},
				{
					id: 'hud',
					name: 'HUD',
					showWhile: 'playing',
					input: 'game',
					elements: [
						...scoreboard(12),
						{ id: 'fb-sheet-play', kind: 'list', anchor: 'top-right', x: 16, y: 14, w: 380, h: 96, z: 1, label: '', rows: [], style: { size: 12, weight: '600', color: '#e5e9f0', align: 'right', bg: 'transparent' } },
						{ id: 'play-hint', kind: 'text', anchor: 'bottom-center', x: 0, y: 12, w: 520, h: 20, z: 1, label: 'Hit the ball toward the other gate.  Press P to pause.', style: { size: 11, color: '#c8d0dc', align: 'center' } }
					]
				},
				{
					id: 'pause',
					name: 'Pause',
					input: 'menu',
					elements: [
						{ id: 'pause-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 380, h: 300, z: 0, label: '', style: PANEL },
						{ id: 'pause-title', kind: 'text', anchor: 'center', x: 0, y: -95, w: 260, h: 36, z: 1, label: 'PAUSED', style: { size: 28, weight: '800', color: '#e5e9f0', align: 'left' } },
						{ id: 'resume-btn', kind: 'button', anchor: 'center', x: 0, y: -30, w: 260, h: 44, z: 1, label: 'Resume', enabled: true, style: BUTTON(BLUE_BG) },
						{ id: 'fb-new-match-pause', kind: 'button', anchor: 'center', x: 0, y: 24, w: 260, h: 44, z: 1, label: 'New match', enabled: true, style: BUTTON(GREEN_BG) },
						{ id: 'quit-btn', kind: 'button', anchor: 'center', x: 0, y: 78, w: 260, h: 44, z: 1, label: 'Quit to menu', enabled: true, style: { size: 15, weight: '600', bg: '#3a4150', color: '#e5e9f0', radius: 12 } }
					]
				},
				{
					id: 'over',
					name: 'Match over',
					showWhile: 'over',
					input: 'menu',
					elements: [
						{ id: 'over-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 480, h: 380, z: 0, label: '', style: PANEL },
						{ id: 'over-title', kind: 'text', anchor: 'center', x: 0, y: -140, w: 440, h: 44, z: 1, label: 'MATCH OVER', style: { size: 34, weight: '800', color: '#ffd45e', align: 'left' } },
						{ id: 'fb-score', kind: 'list', anchor: 'center', x: 0, y: -74, w: 440, h: 64, z: 1, label: '', rows: [], style: { size: 18, weight: '700', color: '#e5e9f0', align: 'center', bg: 'rgba(255, 255, 255, 0.05)', radius: 10 } },
						{ id: 'fb-log', kind: 'list', anchor: 'center', x: 0, y: 20, w: 440, h: 100, z: 1, label: '', rows: [], style: { size: 12, color: '#c8d0dc', align: 'center', bg: 'transparent' } },
						{ id: 'fb-new-match', kind: 'button', anchor: 'center', x: 0, y: 128, w: 260, h: 48, z: 1, label: 'New match', enabled: true, style: BUTTON(GREEN_BG) }
					]
				}
			]
		}
	};
}

/** the HUD list ids the Records node writes, by screen — one Records node per id set */
export const HUD_LISTS = {
	sheet: ['fb-sheet', 'fb-sheet-play'],
	score: ['fb-score'],
	ticker: ['fb-ticker'],
	log: ['fb-log'],
	clock: ['fb-clock']
};
