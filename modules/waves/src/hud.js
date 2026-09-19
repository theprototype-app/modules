// waves — THE DOM HUD, as data (the Towers / Stars Room / football shape): a menu that
// starts the round, a play screen with the wave, the enemies left and the player's
// health bar, and an over screen with the run log. The screens follow the game shell
// (`showWhile`), so a late joiner lands on the right one with no wiring. The lists and the
// bar are driven by ordinary nodes (see `hudGraph`): Waves Value -> HUD Text, Health
// Value -> HUD Bar, Leaderboard on the `kills` rows.

const PANEL = { bg: 'rgba(24, 20, 30, 0.92)', radius: 16, border: '1px solid rgba(220, 120, 120, 0.25)' };
const BUTTON = (bg) => ({ size: 16, weight: '600', bg, color: '#ffffff', radius: 10 });

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
						{ id: 'menu-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 460, h: 340, z: 0, label: '', style: PANEL },
						{ id: 'title', kind: 'text', anchor: 'center', x: 0, y: -120, w: 400, h: 54, z: 1, label: 'WAVES', style: { size: 40, weight: '700', color: '#ff9c6b', align: 'center' } },
						{ id: 'subtitle', kind: 'text', anchor: 'center', x: 0, y: -66, w: 420, h: 44, z: 1, label: 'Hold the goal. Every wave brings more enemies; the round ends when the last one falls.', style: { size: 14, color: '#e6dede', align: 'center' }, wrap: true },
						{ id: 'wv-start', kind: 'button', anchor: 'center', x: 0, y: 10, w: 220, h: 48, z: 1, label: 'Start', enabled: true, style: BUTTON('#c94a4a') },
						{ id: 'wv-log', kind: 'list', anchor: 'center', x: 0, y: 90, w: 420, h: 80, z: 1, label: '', rows: [], style: { size: 12, color: '#d6c8c8', align: 'center' } }
					]
				},
				{
					id: 'hud',
					name: 'HUD',
					showWhile: 'playing',
					input: 'game',
					elements: [
						{ id: 'wv-wave', kind: 'text', anchor: 'top-center', x: 0, y: 14, w: 320, h: 34, z: 1, label: 'Wave 1', style: { size: 22, weight: '700', color: '#ff9c6b', align: 'center' } },
						{ id: 'wv-left', kind: 'text', anchor: 'top-center', x: 0, y: 48, w: 320, h: 24, z: 1, label: '', style: { size: 14, color: '#e6dede', align: 'center' } },
						{ id: 'wv-hp', kind: 'bar', anchor: 'bottom-center', x: 0, y: 24, w: 320, h: 18, z: 1, label: '', min: 0, max: 1, value: 1, orientation: 'horizontal', showPercent: false, style: { color: '#6fcf7a', bg: 'rgba(0,0,0,0.35)', radius: 9 } },
						{ id: 'wv-kills', kind: 'list', anchor: 'top-right', x: 16, y: 14, w: 220, h: 100, z: 1, label: '', rows: [], style: { size: 12, color: '#d6c8c8', align: 'right' } }
					]
				},
				{
					id: 'over',
					name: 'Round over',
					showWhile: 'over',
					input: 'menu',
					elements: [
						{ id: 'over-panel', kind: 'panel', anchor: 'center', x: 0, y: 0, w: 460, h: 340, z: 0, label: '', style: PANEL },
						{ id: 'over-title', kind: 'text', anchor: 'center', x: 0, y: -120, w: 420, h: 40, z: 1, label: 'ARENA CLEARED', style: { size: 30, weight: '700', color: '#ff9c6b', align: 'center' } },
						{ id: 'wv-kills-over', kind: 'list', anchor: 'center', x: 0, y: -50, w: 420, h: 90, z: 1, label: '', rows: [], style: { size: 14, color: '#e6dede', align: 'center' } },
						{ id: 'wv-log-over', kind: 'list', anchor: 'center', x: 0, y: 40, w: 420, h: 70, z: 1, label: '', rows: [], style: { size: 12, color: '#d6c8c8', align: 'center' } },
						{ id: 'wv-again', kind: 'button', anchor: 'center', x: 0, y: 115, w: 220, h: 44, z: 1, label: 'Again', enabled: true, style: BUTTON('#3b7dd8') }
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
		{ type: 'leaderboard', x, y: y + 500, data: { variable: 'kills', element: 'wv-kills,wv-kills-over', limit: 8 } }
	];
	const edges = [
		{ from: 0, to: 1, handle: 'trigger' },
		{ from: 2, to: 3, handle: 'trigger' },
		{ from: 4, to: 5, handle: 'value' },
		{ from: 6, to: 7, handle: 'value' },
		{ from: 8, to: 9, handle: 'value' }
	];
	return { nodes, edges };
}
