// The node family (group "Dungeon Realms") — the RULE surface, not the engine. A
// node OWNS a rule group while it is alive in a running graph: its (replicated)
// node data overrides the module defaults on every peer identically, so no extra
// netcode is needed. Remove the node and the defaults return within a second.
//
// 21-C C6: the Dungeon (recipe) node moved to the Kit (`dkdungeon`); the Game HUD
// node is DELETED, not ported — the HUD is core HUD elements the template authors,
// and this module publishes VALUES into them: `drvalue` (a number for a HUD Text /
// Compare / Gate), `drrows` (lines into a HUD list element by id, the football
// Records shape) and `drevent` (an event a Counter / Set Game State / Sound wires
// to, pulsed on the peer where the event happened — fireNodeTrigger replicates).

import { DEFAULT_RULES, DEFAULT_MENU } from './rules.js';

const EXPIRE_FRAMES = 40; // node gone from the graph -> defaults return

export const EVENTS = ['start', 'gem', 'unseal', 'travel', 'victory', 'reset'];
export const READS = ['gems', 'need', 'total', 'level', 'levels', 'players', 'started', 'won', 'sealed', 'score'];
export const ROWS = ['objective', 'players', 'level', 'gems', 'all'];
/** 30: what a Realms Button does — the menu's actions, plus `quit` (back to the Start screen,
 * the round reset on every peer) */
export const BUTTON_ACTIONS = ['join-p1', 'join-p2', 'start', 'new-dungeon', 'quit'];

/** @param {any} api @param {ReturnType<import('./game.js').createGame>} game */
export function registerNodes(api, game) {
	let frame = 0;
	const seen = { rules: -1, menu: -1 };
	/** @type {Record<string, number>} prop name -> last seen frame */
	const propSeen = {};
	/** @type {Map<string, number>} node id -> last `press` level (rising-edge detection) */
	const pressLevel = new Map();

	const MENU_OPTIONS = ['none', 'join-p1', 'join-p2', 'start', 'resume', 'new-dungeon'];

	api.registerNodeGroup({
		group: 'Dungeon Realms',
		items: [
			{
				type: 'drrules',
				label: 'Game Rules',
				defaults: { ...DEFAULT_RULES },
				params: [
					{ key: 'gemShare', kind: 'range', min: 0.05, max: 1, step: 0.05 },
					{ key: 'pickupRadius', kind: 'range', min: 0.4, max: 3, step: 0.1 },
					{ key: 'allPlayersPortal', kind: 'toggle' },
					{ key: 'disableFlight', kind: 'toggle' }
				]
			},
			{
				type: 'drmenu',
				label: 'Start Menu',
				defaults: { ...DEFAULT_MENU },
				params: [
					{ key: 'show', kind: 'select', options: ['auto', 'always', 'never'] },
					{ key: 'button1', kind: 'select', options: MENU_OPTIONS },
					{ key: 'button2', kind: 'select', options: MENU_OPTIONS },
					{ key: 'button3', kind: 'select', options: MENU_OPTIONS },
					{ key: 'button4', kind: 'select', options: MENU_OPTIONS }
				]
			},
			{
				type: 'drprop',
				label: 'Prop Counter',
				defaults: { prop: 'score', initial: 0, showInHud: true },
				params: [
					{ key: 'prop', kind: 'select', options: ['score', 'keys', 'skulls', 'torches'] },
					{ key: 'initial', kind: 'range', min: 0, max: 100, step: 1 },
					{ key: 'showInHud', kind: 'toggle' }
				]
			},
			{
				type: 'drvalue',
				label: 'Realms Value',
				defaults: { read: 'gems' },
				params: [{ key: 'read', kind: 'select', options: READS }]
			},
			{
				type: 'drrows',
				label: 'Realms HUD Rows',
				defaults: { element: '', show: 'objective' },
				params: [
					{ key: 'element', kind: 'text', placeholder: 'HUD list id', maxLength: 40 },
					{ key: 'show', kind: 'select', options: ROWS }
				]
			},
			{
				// 30: the menu on core HUD screens — a HUD Button (through a Delay, DEVX #22) or an
				// On Click pulses `press`, and the action runs on the presser's peer
				type: 'drbutton',
				label: 'Realms Button',
				defaults: { action: 'start', press: 0 },
				params: [{ key: 'action', kind: 'select', options: BUTTON_ACTIONS }]
			},
			{
				type: 'drevent',
				label: 'Realms Event',
				defaults: { event: 'start' },
				params: [{ key: 'event', kind: 'select', options: EVENTS }]
			}
		]
	});

	/** shallow-compare + assign; marks the GUI dirty only on real change */
	const assign = (target, next) => {
		let changed = false;
		for (const key of Object.keys(next)) {
			if (target[key] !== next[key]) {
				target[key] = next[key];
				changed = true;
			}
		}
		if (changed) game.markGuiDirty();
	};

	api.registerEffect('drrules', (object, base, data) => {
		seen.rules = frame;
		assign(game.config.rules, {
			gemShare: Math.min(1, Math.max(0.05, data.gemShare ?? DEFAULT_RULES.gemShare)),
			pickupRadius: data.pickupRadius ?? DEFAULT_RULES.pickupRadius,
			allPlayersPortal: !!(data.allPlayersPortal ?? DEFAULT_RULES.allPlayersPortal),
			disableFlight: !!(data.disableFlight ?? DEFAULT_RULES.disableFlight)
		});
	});

	api.registerEffect('drmenu', (object, base, data) => {
		seen.menu = frame;
		assign(game.config.menu, {
			show: data.show ?? DEFAULT_MENU.show,
			button1: data.button1 ?? DEFAULT_MENU.button1,
			button2: data.button2 ?? DEFAULT_MENU.button2,
			button3: data.button3 ?? DEFAULT_MENU.button3,
			button4: data.button4 ?? DEFAULT_MENU.button4
		});
	});

	api.registerEffect('drprop', (object, base, data) => {
		const name = data.prop ?? 'score';
		propSeen[name] = frame;
		const existing = game.config.props[name];
		const next = { initial: Math.round(data.initial ?? 0), showInHud: !!(data.showInHud ?? true) };
		if (!existing || existing.initial !== next.initial || existing.showInHud !== next.showInHud) {
			game.config.props[name] = next;
			game.markGuiDirty();
		}
	});

	// ---- 30: Realms Button — a rising `press` runs a menu action -------------------------
	// the football Match Button rule: act on the rising edge, never on the level first seen (a
	// joiner arriving inside a pulse must not press a button it never touched)
	api.registerEffect(
		'drbutton',
		(object, base, data, time, ctx) => {
			const level = Number(data.press) > 0 ? 1 : 0;
			const key = ctx?.id ?? object.uuid;
			const was = pressLevel.get(key);
			pressLevel.set(key, level);
			if (was === undefined || was === level || level !== 1) return;
			const action = BUTTON_ACTIONS.includes(data.action) ? data.action : 'start';
			game.menuAction(action);
		},
		// 'number': a Delay's pulse, an On Click, a Compare all drive it (DEVX #22)
		{ inputs: { press: 'number' } }
	);

	// ---- the HUD half: rows into a core HUD list element, by id ------------------------
	/** @type {Record<string, string>} node id -> last pushed rows (push on change only) */
	const lastRows = {};
	api.registerEffect('drrows', (object, base, data, time, ctx) => {
		if (!api.hud?.rows) return;
		const element = String(data.element ?? '').trim();
		if (!element) return;
		const rows = rowsFor(data.show ?? 'objective');
		const key = JSON.stringify(rows);
		const id = ctx?.id ?? element;
		if (lastRows[id] === key) return;
		lastRows[id] = key;
		api.hud.rows(element, rows);
	});

	/** @param {string} show */
	function rowsFor(show) {
		const s = game.state;
		const p = game.play();
		const { total, need, have } = game.gemTotals();
		const level = p ? 'LEVEL ' + s.floorIndex + ' / ' + s.levelCount + ' · ' + p.name : 'no dungeon';
		const gems = have + ' / ' + need + ' needed · ' + total + ' hidden';
		const players = ['p1', 'p2']
			.filter((slot) => s.slots[slot])
			.map((slot) => slot.toUpperCase() + ' ' + s.slots[slot].name + (s.slots[slot].peerId === (api.peerId() ?? 'me') ? ' (you)' : ''));
		const props = Object.entries(game.config.props)
			.filter(([, def]) => def.showInHud)
			.map(([name, def]) => name + ': ' + (s.propValues[name] ?? def.initial ?? 0));
		if (show === 'objective') return p ? [game.objective()] : [];
		if (show === 'players') return players;
		if (show === 'level') return p ? [level] : [];
		if (show === 'gems') return p ? [gems, ...props] : [];
		return p ? [gems, level, ...players, ...props, game.objective()] : [];
	}

	// ---- the readable half: a number a core HUD Text / Compare / Gate consumes --------------
	// PURE of (data) over replicated state: collected/slots/started ride this module's
	// ops + state sync, the floor rides the Kit's (the value-node contract)
	api.registerValueNode(
		'drvalue',
		(data) => {
			const s = game.state;
			const { total, need, have } = game.gemTotals();
			switch (data?.read) {
				case 'need': return need;
				case 'total': return total;
				case 'level': return s.seed == null ? 0 : s.floorIndex;
				case 'levels': return s.levelCount;
				case 'players': return game.players();
				case 'started': return s.started ? 1 : 0;
				case 'won': return s.wonAt ? 1 : 0;
				case 'sealed': return s.seed != null && game.sealed() ? 1 : 0;
				case 'score': return s.propValues.score ?? game.config.props.score?.initial ?? 0;
				default: return have;
			}
		},
		{ vtype: 'number' }
	);
	// the event half is pulsed by game.js on the ORIGINATING peer (fireNodeTrigger replicates)
	api.registerValueNode('drevent', () => 0, { vtype: 'event' });
	game.onEvent((event) => {
		if (typeof api.fireNodeTrigger !== 'function') return;
		api.fireNodeTrigger('drevent', (data) => (data?.event ?? 'start') === event);
	});

	/** called from the module frame task: expire configs whose node vanished */
	function tick() {
		frame++;
		if (seen.rules >= 0 && frame - seen.rules > EXPIRE_FRAMES) {
			seen.rules = -1;
			assign(game.config.rules, { ...DEFAULT_RULES });
		}
		if (seen.menu >= 0 && frame - seen.menu > EXPIRE_FRAMES) {
			seen.menu = -1;
			assign(game.config.menu, { ...DEFAULT_MENU });
		}
		for (const [name, at] of Object.entries(propSeen)) {
			if (frame - at > EXPIRE_FRAMES) {
				delete propSeen[name];
				delete game.config.props[name];
				game.markGuiDirty();
			}
		}
	}

	return { tick, rowsFor };
}
