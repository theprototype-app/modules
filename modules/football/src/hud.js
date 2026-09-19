// football — THE DOM HUD, as data (B2). The headset never sees this (HudLayer hides in
// VR, F8); a desktop peer and the editor do. It reads the SAME nodes the physical UI
// reads: the four `fb-*` HUD Buttons pulse the Match Button nodes (perPlayer, so a press
// is the presser's alone), the `fb-score` / `fb-sheet` / `fb-log` lists are filled by the
// Records node through api.hud.rows, and the screens follow the game shell the Football
// Event nodes drive. Towers' menu / hud / pause / over shape, so D1 can compare.

const PANEL = { bg: 'rgba(20, 26, 36, 0.92)', radius: 16, border: '1px solid rgba(136, 192, 208, 0.25)' };
const BUTTON = (bg) => ({ size: 16, weight: '600', bg, color: '#ffffff', radius: 10 });

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
						{ id: 'menu-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 480, h: 400, z: 0, label: '', style: PANEL },
						{ id: 'title', kind: 'text', anchor: 'center', x: 0, y: -150, w: 400, h: 54, z: 1, label: 'FOOTBALL', style: { size: 40, weight: '700', color: '#ffd45e', align: 'center' } },
						{ id: 'subtitle', kind: 'text', anchor: 'center', x: 0, y: -100, w: 440, h: 44, z: 1, label: 'Pick a side, then Start. Hit the floating ball with your hands; a ball through the other gate is a goal.', style: { size: 14, color: '#d8dee9', align: 'center' }, wrap: true },
						{ id: 'fb-join-red', kind: 'button', anchor: 'center', x: -110, y: -30, w: 190, h: 44, z: 1, label: 'Join RED', enabled: true, style: BUTTON('#c94a4a') },
						{ id: 'fb-join-blue', kind: 'button', anchor: 'center', x: 110, y: -30, w: 190, h: 44, z: 1, label: 'Join BLUE', enabled: true, style: BUTTON('#3b7dd8') },
						{ id: 'fb-start', kind: 'button', anchor: 'center', x: 0, y: 30, w: 220, h: 48, z: 1, label: 'Start match', enabled: true, style: BUTTON('#4c9e6a') },
						{ id: 'fb-sheet', kind: 'list', anchor: 'center', x: 0, y: 105, w: 440, h: 70, z: 1, label: '', rows: [], style: { size: 12, color: '#c8d0dc', align: 'center' } },
						{ id: 'menu-hint', kind: 'text', anchor: 'center', x: 0, y: 165, w: 440, h: 30, z: 1, label: 'Walk into the ball to knock it  ·  Grab: hold click  ·  Pause: P', style: { size: 12, color: '#8b97a8', align: 'center' }, wrap: true }
					]
				},
				{
					id: 'hud',
					name: 'HUD',
					showWhile: 'playing',
					input: 'game',
					elements: [
						{ id: 'fb-score', kind: 'list', anchor: 'top-center', x: 0, y: 14, w: 420, h: 70, z: 1, label: '', rows: [], style: { size: 18, weight: '600', color: '#e5e9f0', align: 'center' } },
						{ id: 'fb-sheet-play', kind: 'list', anchor: 'top-right', x: 16, y: 14, w: 260, h: 120, z: 1, label: '', rows: [], style: { size: 12, color: '#c8d0dc', align: 'right' } },
						{ id: 'play-hint', kind: 'text', anchor: 'bottom-center', x: 0, y: 12, w: 520, h: 20, z: 1, label: 'Hit the ball toward the other gate.  Press P to pause.', style: { size: 11, color: '#8b97a8', align: 'center' } }
					]
				},
				{
					id: 'pause',
					name: 'Pause',
					input: 'menu',
					elements: [
						{ id: 'pause-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 380, h: 300, z: 0, label: '', style: PANEL },
						{ id: 'pause-title', kind: 'text', anchor: 'center', x: 0, y: -95, w: 340, h: 36, z: 1, label: 'PAUSED', style: { size: 26, weight: '700', color: '#e5e9f0', align: 'center' } },
						{ id: 'resume-btn', kind: 'button', anchor: 'center', x: 0, y: -30, w: 240, h: 42, z: 1, label: 'Resume', enabled: true, style: BUTTON('#3b7dd8') },
						{ id: 'fb-new-match-pause', kind: 'button', anchor: 'center', x: 0, y: 22, w: 240, h: 42, z: 1, label: 'New match', enabled: true, style: BUTTON('#4c9e6a') },
						{ id: 'quit-btn', kind: 'button', anchor: 'center', x: 0, y: 74, w: 240, h: 42, z: 1, label: 'Quit to menu', enabled: true, style: { size: 15, weight: '500', bg: '#3a4150', color: '#e5e9f0', radius: 10 } }
					]
				},
				{
					id: 'over',
					name: 'Match over',
					showWhile: 'over',
					input: 'menu',
					elements: [
						{ id: 'over-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 460, h: 360, z: 0, label: '', style: PANEL },
						{ id: 'over-title', kind: 'text', anchor: 'center', x: 0, y: -130, w: 420, h: 40, z: 1, label: 'MATCH OVER', style: { size: 30, weight: '700', color: '#ffd45e', align: 'center' } },
						{ id: 'fb-score-over', kind: 'list', anchor: 'center', x: 0, y: -70, w: 420, h: 60, z: 1, label: '', rows: [], style: { size: 16, color: '#e5e9f0', align: 'center' } },
						{ id: 'fb-log', kind: 'list', anchor: 'center', x: 0, y: 20, w: 420, h: 100, z: 1, label: '', rows: [], style: { size: 12, color: '#c8d0dc', align: 'center' } },
						{ id: 'fb-new-match', kind: 'button', anchor: 'center', x: 0, y: 120, w: 220, h: 44, z: 1, label: 'New match', enabled: true, style: BUTTON('#3b7dd8') }
					]
				}
			]
		}
	};
}

/** the HUD list ids the Records node writes, by screen — one Records node per id set */
export const HUD_LISTS = {
	sheet: ['fb-sheet', 'fb-sheet-play'],
	score: ['fb-score', 'fb-score-over'],
	log: ['fb-log']
};
