// waves — THE DOM HUD, as data (the Towers / Stars Room / football shape): a menu that
// starts the round, a play screen with the wave, the enemies left and the player's
// health bar, and an over screen with the run log. The screens follow the game shell
// (`showWhile`), so a late joiner lands on the right one with no wiring. The lists and the
// bar are driven by ordinary nodes (see `hudGraph`): Waves Value -> HUD Text, Health
// Value -> HUD Bar, Leaderboard on the `kills` rows.

const PANEL = { bg: 'rgba(22, 18, 28, 0.92)', radius: 18, border: '1px solid rgba(255, 140, 100, 0.3)' };
const BUTTON = (bg) => ({ size: 16, weight: '700', bg, color: '#ffffff', radius: 12 });

/** the def's `hud` field. 30: the standard shell — a Start screen, the play HUD, a Pause
 * screen (P: Resume / Restart / Quit) and the round-over screen. The kills leaderboard has NO
 * box of its own (bg transparent): an empty list draws nothing, so the panel that sat empty
 * top-right before the first kill is gone until there are rows to show. */
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
						{ id: 'menu-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 480, h: 360, z: 0, label: '', style: PANEL },
						{ id: 'menu-stripe', kind: 'panel', anchor: 'center', x: 0, y: -176, w: 480, h: 8, z: 1, label: '', style: { bg: '#ff7a4a', radius: 4 } },
						{ id: 'title', kind: 'text', anchor: 'center', x: 0, y: -122, w: 420, h: 56, z: 1, label: 'WAVES', style: { size: 46, weight: '800', color: '#ff9c6b', align: 'left' } },
						{ id: 'subtitle', kind: 'text', anchor: 'center', x: 0, y: -66, w: 420, h: 44, z: 1, label: 'Hold the crystal. Every wave brings more enemies through the portals; the round ends when the last one falls.', style: { size: 14, color: '#e6dede', align: 'left' }, wrap: true },
						{ id: 'wv-start', kind: 'button', anchor: 'center', x: 0, y: 8, w: 420, h: 54, z: 1, label: 'Start', enabled: true, style: { ...BUTTON('#d9533f'), size: 20 } },
						{ id: 'wv-log', kind: 'list', anchor: 'center', x: 0, y: 92, w: 420, h: 76, z: 1, label: '', rows: [], style: { size: 12, color: '#d6c8c8', align: 'left', bg: 'transparent' } },
						{ id: 'menu-hint', kind: 'text', anchor: 'center', x: 0, y: 150, w: 420, h: 20, z: 1, label: 'Knock them down: walk into them or grab and throw  ·  P pauses', style: { size: 11, color: '#9b8f8f', align: 'left' } }
					]
				},
				{
					id: 'hud',
					name: 'HUD',
					showWhile: 'playing',
					input: 'game',
					elements: [
						{ id: 'wv-banner', kind: 'panel', anchor: 'top-center', x: 0, y: 10, w: 150, h: 68, z: 0, label: '', style: { bg: 'rgba(22, 18, 28, 0.78)', radius: 14, border: '1px solid rgba(255, 140, 100, 0.25)' } },
						{ id: 'wv-wave', kind: 'text', anchor: 'top-center', x: 0, y: 14, w: 122, h: 34, z: 1, label: 'Wave 1', style: { size: 24, weight: '800', color: '#ff9c6b', align: 'left' } },
						{ id: 'wv-left', kind: 'text', anchor: 'top-center', x: 0, y: 48, w: 122, h: 24, z: 1, label: '', style: { size: 14, color: '#e6dede', align: 'left' } },
						{ id: 'wv-hp-label', kind: 'text', anchor: 'bottom-center', x: 0, y: 46, w: 340, h: 18, z: 1, label: 'HEALTH', style: { size: 10, weight: '700', color: '#c8e6cc', align: 'left' } },
						{ id: 'wv-hp', kind: 'bar', anchor: 'bottom-center', x: 0, y: 24, w: 340, h: 20, z: 1, label: '', min: 0, max: 1, value: 1, orientation: 'horizontal', showPercent: false, style: { color: '#6fcf7a', bg: 'rgba(0,0,0,0.45)', radius: 10 } },
						{ id: 'wv-kills', kind: 'list', anchor: 'top-right', x: 16, y: 14, w: 220, h: 100, z: 1, label: '', rows: [], style: { size: 13, weight: '600', color: '#ffe0d0', align: 'right', bg: 'transparent' } }
					]
				},
				{
					id: 'pause',
					name: 'Pause',
					input: 'menu',
					elements: [
						{ id: 'pause-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 380, h: 300, z: 0, label: '', style: PANEL },
						{ id: 'pause-title', kind: 'text', anchor: 'center', x: 0, y: -95, w: 260, h: 36, z: 1, label: 'PAUSED', style: { size: 28, weight: '800', color: '#e6dede', align: 'left' } },
						{ id: 'resume-btn', kind: 'button', anchor: 'center', x: 0, y: -30, w: 260, h: 44, z: 1, label: 'Resume', enabled: true, style: BUTTON('#3b7dd8') },
						{ id: 'restart-btn', kind: 'button', anchor: 'center', x: 0, y: 24, w: 260, h: 44, z: 1, label: 'Restart round', enabled: true, style: BUTTON('#d9533f') },
						{ id: 'quit-btn', kind: 'button', anchor: 'center', x: 0, y: 78, w: 260, h: 44, z: 1, label: 'Quit to menu', enabled: true, style: { size: 15, weight: '600', bg: '#3a3440', color: '#e6dede', radius: 12 } }
					]
				},
				{
					id: 'over',
					name: 'Round over',
					showWhile: 'over',
					input: 'menu',
					elements: [
						{ id: 'over-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 480, h: 360, z: 0, label: '', style: PANEL },
						{ id: 'over-title', kind: 'text', anchor: 'center', x: 0, y: -126, w: 420, h: 44, z: 1, label: 'ARENA CLEARED', style: { size: 32, weight: '800', color: '#ff9c6b', align: 'left' } },
						{ id: 'wv-kills-over', kind: 'list', anchor: 'center', x: 0, y: -50, w: 420, h: 90, z: 1, label: '', rows: [], style: { size: 14, color: '#e6dede', align: 'center', bg: 'transparent' } },
						{ id: 'wv-log-over', kind: 'list', anchor: 'center', x: 0, y: 40, w: 420, h: 70, z: 1, label: '', rows: [], style: { size: 12, color: '#d6c8c8', align: 'center', bg: 'transparent' } },
						{ id: 'wv-again', kind: 'button', anchor: 'center', x: 0, y: 124, w: 260, h: 48, z: 1, label: 'Again', enabled: true, style: BUTTON('#d9533f') }
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
		{ type: 'leaderboard', x, y: y + 500, data: { variable: 'kills', element: 'wv-kills,wv-kills-over', limit: 8 } },
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
	return { nodes, edges };
}
