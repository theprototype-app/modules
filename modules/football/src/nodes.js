// football — THE NODE FAMILY (group "Football"), the dungeon-realms rule-ownership
// pattern: a node alive in a running graph owns its rule group on every peer (its node
// data is replicated, so every peer reads the same rules with no netcode); gone from the
// graph, the defaults (or the toolbox's host settings) return within a second.
//
// A module effect node runs only when it is wired to an Object Selector (or sits in an
// object's own graph), and the runtime RE-SEATS a targeted object's base pose every frame
// — so no node here may ever target the BALL. Match Rules targets the pitch and names the
// ball through its `ball` object input; Team Gate targets the gate's sensor box; Button
// targets the button object; Score Lamp targets one lamp. The two value nodes (Football
// Value, Football Event) need no target at all.

import { MODES, WIN_BY, SERVE, OWN_GOALS, ACTIONS, DEFAULT_RULES, teamOf } from './rules.js';
import { RED, BLUE, LAMP_DIM } from './pitch.js';

const EXPIRE_FRAMES = 40;

/** @param {any} api @param {ReturnType<import('./game.js').createGame>} game */
export function registerNodes(api, game) {
	let frame = 0;
	let rulesSeen = -1;
	/** @type {Record<string, number>} gate uuid -> last frame seen */
	const gateSeen = {};
	/** @type {Map<string, {action: string, frame: number, id: string}>} button object uuid -> action */
	const buttons = new Map();
	/** @type {Map<string, number>} node id -> last `press` level (rising-edge detection) */
	const pressLevel = new Map();
	/** @type {Map<string, number>} node id -> last `trigger` level (Serve) */
	const serveLevel = new Map();

	api.registerNodeGroup({
		group: 'Football',
		items: [
			{
				type: 'fbrules',
				label: 'Match Rules',
				defaults: { ...DEFAULT_RULES, ball: '', apply: true },
				params: [
					{ key: 'mode', kind: 'select', options: MODES },
					{ key: 'winBy', kind: 'select', options: WIN_BY },
					{ key: 'goalsToWin', kind: 'range', min: 1, max: 20, step: 1 },
					{ key: 'matchSeconds', kind: 'range', min: 30, max: 1800, step: 10 },
					{ key: 'serve', kind: 'select', options: SERVE },
					{ key: 'serveDelay', kind: 'range', min: 0.5, max: 5, step: 0.1 },
					{ key: 'serveSpeed', kind: 'range', min: 0.5, max: 10, step: 0.1 },
					{ key: 'ownGoals', kind: 'select', options: OWN_GOALS },
					{ key: 'apply', kind: 'toggle' }
				]
			},
			{
				type: 'fbgate',
				label: 'Team Gate',
				defaults: { team: 'red', label: '' },
				params: [
					{ key: 'team', kind: 'select', options: ['red', 'blue'] },
					{ key: 'label', kind: 'text', placeholder: 'gate label', maxLength: 24 }
				]
			},
			{
				type: 'fbbutton',
				label: 'Match Button',
				defaults: { action: 'start', press: 0 },
				params: [{ key: 'action', kind: 'select', options: ACTIONS }]
			},
			{
				type: 'fbserve',
				label: 'Serve',
				defaults: { trigger: 0 },
				params: []
			},
			{
				type: 'fblamp',
				label: 'Score Lamp',
				defaults: { team: 'red', index: 1 },
				params: [
					{ key: 'team', kind: 'select', options: ['red', 'blue'] },
					{ key: 'index', kind: 'range', min: 1, max: 20, step: 1 }
				]
			},
			{
				type: 'fbrecords',
				label: 'Records',
				defaults: { show: 'all', element: 'fb-sheet', scoreElement: 'fb-score', logElement: '' },
				params: [
					{ key: 'show', kind: 'select', options: ['goals', 'touches', 'owngoals', 'all'] },
					{ key: 'element', kind: 'text', placeholder: 'HUD list id (sheet)', maxLength: 40 },
					{ key: 'scoreElement', kind: 'text', placeholder: 'HUD list id (score)', maxLength: 40 },
					{ key: 'logElement', kind: 'text', placeholder: 'HUD list id (match log)', maxLength: 40 }
				]
			},
			{
				type: 'fbvalue',
				label: 'Football Value',
				defaults: { read: 'red' },
				params: [
					{
						key: 'read',
						kind: 'select',
						options: ['red', 'blue', 'goals', 'myteam', 'lastteam', 'started', 'left', 'players', 'serves', 'mygoals', 'matches']
					}
				]
			},
			{
				type: 'fbevent',
				label: 'Football Event',
				defaults: { event: 'goal' },
				params: [{ key: 'event', kind: 'select', options: ['goal', 'redgoal', 'bluegoal', 'serve', 'start', 'over', 'reset', 'touch'] }]
			}
		]
	});

	// ---- Match Rules: owns the rules and names the ball --------------------------------
	api.registerEffect(
		'fbrules',
		(object, base, data) => {
			if (data.apply === false) return;
			rulesSeen = frame;
			const next = {
				mode: data.mode,
				winBy: data.winBy,
				goalsToWin: data.goalsToWin,
				matchSeconds: data.matchSeconds,
				serve: data.serve,
				serveDelay: data.serveDelay,
				serveSpeed: data.serveSpeed,
				ownGoals: data.ownGoals
			};
			if (JSON.stringify(game.config.rules) !== JSON.stringify(next)) game.config.rules = next;
			// the wired Object Selector's value is the ball's uuid; an unwired node falls
			// back to an object NAMED Football (the def's name)
			const wired = typeof data.ball === 'string' && data.ball && data.ball !== '-None-' ? data.ball : null;
			const uuid = wired ?? api.objectsGroup()?.getObjectByName('Football')?.uuid ?? null;
			if (uuid !== game.config.ballUuid) game.config.ballUuid = uuid;
		},
		{ inputs: { ball: 'object' } }
	);

	// ---- Team Gate: the object this node targets IS the gate's sensor ---------------------
	api.registerEffect('fbgate', (object, base, data) => {
		const team = data.team === 'blue' ? 'blue' : 'red';
		gateSeen[object.uuid] = frame;
		const current = game.config.gates[object.uuid];
		if (!current || current.team !== team || current.label !== (data.label ?? ''))
			game.config.gates[object.uuid] = { team, label: data.label ?? '' };
	});

	// ---- Match Button: a click on the target object, or a rising `press`, acts ------------
	api.registerEffect(
		'fbbutton',
		(object, base, data, time, ctx) => {
			const action = ACTIONS.includes(data.action) ? data.action : 'none';
			buttons.set(object.uuid, { action, frame, id: ctx?.id ?? object.uuid });
			// a HUD Button (perPlayer) or an On Click wired into `press` reads 1 for its
			// pulse window; act on the rising edge, and never on the level first seen (a
			// joiner arriving inside a pulse must not press a button it never touched)
			const level = Number(data.press) > 0 ? 1 : 0;
			const key = ctx?.id ?? object.uuid;
			const was = pressLevel.get(key);
			pressLevel.set(key, level);
			if (was === undefined || was === level) return;
			if (level === 1) game.act(action);
		},
		// 'number', not 'event': a pulse reaches a module node as a VALUE (1 while the
		// window is open), and an event output coerces to a number — so an On Click, a
		// Delay bridging a HUD Button, a Compare or a Toggle all drive this input
		{ inputs: { press: 'number' } }
	);

	// ---- Serve: a rising trigger serves now (an On Rest, a Delay, a button) ----------------
	api.registerEffect(
		'fbserve',
		(object, base, data, time, ctx) => {
			const level = Number(data.trigger) > 0 ? 1 : 0;
			const key = ctx?.id ?? object.uuid;
			const was = serveLevel.get(key);
			serveLevel.set(key, level);
			if (was === undefined || was === level) return;
			if (level === 1) game.serve('button');
		},
		{ inputs: { trigger: 'number' } } // the `press` rule, one node over
	);

	// ---- Score Lamp: lit while its team's score reaches its index ----------------------------
	api.registerEffect('fblamp', (object, base, data) => {
		const team = data.team === 'blue' ? 'blue' : 'red';
		const index = Math.max(1, Math.round(Number(data.index) || 1));
		const lit = (game.state.score[team] ?? 0) >= index;
		const material = object.material;
		if (!material || Array.isArray(material)) return;
		const want = lit ? (team === 'red' ? RED : BLUE) : LAMP_DIM;
		if (material.userData.fbLit === lit && material.userData.fbTeam === team) return;
		material.userData.fbLit = lit;
		material.userData.fbTeam = team;
		material.color?.setHex(want);
		if (material.emissive) {
			material.emissive.setHex(want);
			material.emissiveIntensity = lit ? 1.4 : 0.2;
		}
	});

	// ---- Records: rows into HUD lists (the sheet, the score line, the saved log) ----------
	let lastRows = '';
	api.registerEffect('fbrecords', (object, base, data) => {
		if (!api.hud?.rows) return;
		const show = data.show ?? 'all';
		const rows = game.sheetRows().map((r) => {
			const team = r.team ? r.team.toUpperCase() : 'watching';
			if (show === 'goals') return r.name + ' — ' + r.goals;
			if (show === 'touches') return r.name + ' — ' + r.touches;
			if (show === 'owngoals') return r.name + ' — ' + r.owngoals;
			return r.name + ' (' + team + ') — ' + r.goals + ' goals · ' + r.touches + ' touches · ' + r.owngoals + ' own';
		});
		const touch = game.state.lastTouch ? 'last touch: ' + game.nameOf(game.state.lastTouch.by) : 'last touch: —';
		const left = game.secondsLeft();
		const score = [game.scoreLine(), touch, ...(left == null ? [] : [Math.ceil(left) + 's left']), ...(game.state.outcome ? [game.outcomeText()] : [])];
		const log = game.matchLog().slice(-8).reverse().map((m) => 'RED ' + m.red + ' — ' + m.blue + ' BLUE · ' + m.winner);
		const key = JSON.stringify([rows, score, log]);
		if (key === lastRows) return;
		lastRows = key;
		// an element field may name SEVERAL lists (comma-separated): the menu's sheet and
		// the in-play sheet are two elements on two screens fed by one node
		const each = (/** @type {any} */ field, /** @type {string[]} */ list) => {
			for (const id of String(field ?? '').split(',')) if (id.trim()) api.hud.rows(id.trim(), list);
		};
		each(data.element, rows);
		each(data.scoreElement, score);
		each(data.logElement, log);
	});

	// ---- the readable half: a number a core HUD Text / Compare can consume --------------------
	api.registerValueNode(
		'fbvalue',
		(data) => {
			const s = game.state;
			switch (data?.read) {
				case 'blue':
					return s.score.blue;
				case 'goals':
					return s.goals;
				case 'myteam':
					return teamOf(s.slots, game.me()) === 'red' ? 1 : teamOf(s.slots, game.me()) === 'blue' ? 2 : 0;
				case 'lastteam':
					return s.lastTouch?.team === 'red' ? 1 : s.lastTouch?.team === 'blue' ? 2 : 0;
				case 'started':
					return s.started ? 1 : 0;
				case 'left': {
					const left = game.secondsLeft();
					return left == null ? -1 : Math.ceil(left);
				}
				case 'players':
					return s.slots.red.length + s.slots.blue.length;
				case 'serves':
					return s.serves;
				case 'mygoals':
					return api.peerVars?.mine?.('goals', 0) ?? 0;
				case 'matches':
					// B5: how many matches the saved sheet holds (gameState.vars, in the .tpscene)
					return game.matchLog().length;
				default:
					return s.score.red;
			}
		},
		{ vtype: 'number' }
	);
	// the event half is pulsed by game.js through api.fireNodeTrigger
	api.registerValueNode('fbevent', () => 0, { vtype: 'event' });

	/** the click path: desktop click or VR trigger on a button object (play mode included)
	 * @param {any} mesh */
	function clickButton(mesh) {
		let cursor = mesh;
		while (cursor && !buttons.has(cursor.uuid)) cursor = cursor.parent;
		if (!cursor) return false;
		const entry = buttons.get(cursor.uuid);
		if (!entry || frame - entry.frame > EXPIRE_FRAMES) return false;
		game.act(entry.action);
		if (typeof api.haptic === 'function') api.haptic(0.6, 40);
		return true;
	}

	/** from the module frame task: expire what vanished */
	function tick() {
		frame++;
		if (rulesSeen >= 0 && frame - rulesSeen > EXPIRE_FRAMES) {
			rulesSeen = -1;
			game.config.rules = null;
		}
		for (const [uuid, at] of Object.entries(gateSeen)) {
			if (frame - at > EXPIRE_FRAMES) {
				delete gateSeen[uuid];
				delete game.config.gates[uuid];
			}
		}
		for (const [uuid, entry] of buttons) if (frame - entry.frame > EXPIRE_FRAMES) buttons.delete(uuid);
	}

	return { tick, clickButton, buttons: () => [...buttons.entries()].map(([uuid, e]) => ({ uuid, action: e.action })) };
}
