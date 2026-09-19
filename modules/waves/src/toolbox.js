// waves — THE ARENA BUILDER (a toolbox): one form makes the selected objects the
// enemies — or adds N boxes — and authors, through api.flow.addNodes, every chain the
// run stands on: the health module's chain per enemy, a heal chain per enemy (the wave
// heals them back), a zone chain per enemy into the player's health (an enemy in reach
// hurts the player), the Waves node with its goal, the player's health, and the game
// shell wiring (`over` -> Set Game State). All of it is ordinary replicated graph.
// LOCAL always; nothing here goes on the wire except through those paths.

import { DEFAULTS } from './curve.js';

const SELECT_CSS =
	'background:rgba(0,0,0,0.25);color:inherit;border:1px solid rgba(255,255,255,0.15);' +
	'border-radius:4px;font-size:11px;padding:1px 3px;';
const INPUT_CSS = SELECT_CSS + 'width:100%;';
const COL = 220;
const ROW = 200;
const X0 = 60;
const Y0 = 40;

/** @param {string} tag @param {Record<string, any>=} props @param {string=} css */
function elem(tag, props, css) {
	const node = document.createElement(tag);
	Object.assign(node, props ?? {});
	if (css) node.setAttribute('style', css);
	return node;
}
/** @param {string[]} options @param {string} value */
function select(options, value) {
	const node = /** @type {HTMLSelectElement} */ (elem('select', {}, SELECT_CSS));
	for (const option of options) node.appendChild(elem('option', { value: option, textContent: option }));
	node.value = value;
	return node;
}

/**
 * THE ARENA, as addNodes specs. Pure: given the enemy uuids and the options it returns
 * the nodes and edges, row by row, so a node test can hold it to its shape.
 * @param {{enemies: string[], goal: string|null, options: any, row: number, playerHealthId: string|null}} spec
 */
export function arenaRecipe(spec) {
	const o = spec.options;
	const name = String(o.name ?? '').trim() || DEFAULTS.name;
	const playerName = String(o.playerName ?? '').trim() || 'me';
	/** @type {any[]} */
	const nodes = [];
	/** @type {any[]} */
	const edges = [];
	let row = spec.row;
	const y = () => Y0 + row * ROW;

	// the run itself, its goal, the shell wiring, and the player's health (once)
	const wavesIdx = nodes.push({ type: 'waves', x: X0, y: y(), data: { name, waves: o.waves, sizeStart: o.sizeStart, sizeStep: o.sizeStep, interval: o.interval, speed: o.speed, stagger: DEFAULTS.stagger, reach: o.reach, spawnPrefix: o.spawnPrefix } }) - 1;
	if (spec.goal) {
		const sel = nodes.push({ type: 'objectselector', x: X0 - 0, y: y() + 100, data: { selected: spec.goal } }) - 1;
		edges.push({ from: sel, to: wavesIdx, handle: 'goal' });
	}
	const over = nodes.push({ type: 'wavesevent', x: X0 + COL, y: y(), data: { name, event: 'over' } }) - 1;
	const setOver = nodes.push({ type: 'setgamestate', x: X0 + 2 * COL, y: y(), data: { state: 'over', outcome: 'won' } }) - 1;
	edges.push({ from: over, to: setOver, handle: 'trigger' });
	let playerRef = /** @type {number|string|null} */ (spec.playerHealthId);
	if (!playerRef) {
		const pd = nodes.push({ type: 'damage', x: X0 + 3 * COL, y: y(), data: { amount: 1, source: 'wired' } }) - 1;
		const pc = nodes.push({ type: 'counter', x: X0 + 4 * COL, y: y(), data: { op: 'up', step: 1 } }) - 1;
		const ph = nodes.push({ type: 'health', x: X0 + 5 * COL, y: y(), data: { name: playerName, scope: 'player', max: o.playerHp, regen: o.playerRegen, deathAction: 'respawn', respawnDelay: 3 } }) - 1;
		const pr = nodes.push({ type: 'healthreset', x: X0 + 3 * COL, y: y() + 100, data: { name: playerName } }) - 1;
		edges.push({ from: pd, to: pc, handle: 'pulse' }, { from: pc, to: ph, handle: 'damage' }, { from: pr, to: pc, handle: 'reset' });
		playerRef = ph;
	}
	row++;

	// per enemy: the health chain, the heal chain, the zone chain into the player
	for (const uuid of spec.enemies) {
		const d = nodes.push({ type: 'damage', x: X0, y: y(), data: { amount: 1, source: o.source, scale: o.source === 'hit' ? 'speed' : 'none', speedRef: 3 } }) - 1;
		const c = nodes.push({ type: 'counter', x: X0 + COL, y: y(), data: { op: 'up', step: 1 } }) - 1;
		const h = nodes.push({ type: 'health', x: X0 + 2 * COL, y: y(), data: { name, scope: 'object', max: o.hp, deathAction: 'hide', respawnDelay: 3 } }) - 1;
		const s = nodes.push({ type: 'objectselector', x: X0 + 3 * COL, y: y(), data: { selected: uuid } }) - 1;
		const r = nodes.push({ type: 'healthreset', x: X0, y: y() + 100, data: { name } }) - 1;
		const he = nodes.push({ type: 'heal', x: X0 + COL, y: y() + 100, data: { amount: 1 } }) - 1;
		const hc = nodes.push({ type: 'counter', x: X0 + 2 * COL, y: y() + 100, data: { op: 'up', step: 1 } }) - 1;
		const z = nodes.push({ type: 'damage', x: X0 + 4 * COL, y: y(), data: { amount: o.enemyDamage, source: 'zone', perSecond: o.enemyRate, radius: o.reach } }) - 1;
		const zs = nodes.push({ type: 'objectselector', x: X0 + 4 * COL, y: y() + 100, data: { selected: uuid } }) - 1;
		edges.push(
			{ from: d, to: c, handle: 'pulse' },
			{ from: c, to: h, handle: 'damage' },
			{ from: s, to: h, handle: 'target' },
			{ from: r, to: c, handle: 'reset' },
			{ from: r, to: hc, handle: 'reset' },
			{ from: he, to: hc, handle: 'pulse' },
			{ from: hc, to: h, handle: 'heal' },
			{ from: zs, to: z, handle: 'zone' },
			{ from: z, to: playerRef, handle: 'damage' }
		);
		row++;
	}
	return { nodes, edges, rows: row - spec.row };
}

/** @param {any} api @param {ReturnType<import('./engine.js').createWavesEngine>} engine */
export function registerToolbox(api, engine) {
	/** the player's existing health node for a name, if any @param {string} playerName */
	function playerHealthId(playerName) {
		for (const node of api.flow.nodes('health'))
			if (node.data?.scope === 'player' && (String(node.data?.name ?? '').trim() || 'hp') === playerName) return node.id;
		return null;
	}

	/** @param {any} options @param {string[]} enemies */
	function build(options, enemies) {
		if (!enemies.length) {
			api.toast('Select the enemy objects first (or add boxes)');
			return null;
		}
		const g = engine.graphView();
		const row = g.nodes.filter((n) => n.type === 'health' || n.type === 'waves').length;
		const goal = api.selectedUuids().find((u) => !enemies.includes(u)) ?? null;
		const spec = arenaRecipe({ enemies, goal: options.goal ?? goal, options, row, playerHealthId: playerHealthId(String(options.playerName ?? '').trim() || 'me') });
		const ids = api.flow.addNodes({ nodes: spec.nodes, edges: spec.edges });
		api.toast('Arena: ' + enemies.length + ' enemies over ' + options.waves + ' waves' + (spec.nodes.some((n) => n.type === 'objectselector' && n.data.selected === (options.goal ?? goal)) ? ', walking to the goal' : ' (no goal: they hold their spawn points)'));
		return ids;
	}

	/** @param {HTMLElement} el */
	function mount(el) {
		el.textContent = '';
		el.classList.add('waves-manager');
		el.appendChild(
			elem('style', {
				textContent:
					'.waves-manager{display:flex;flex-direction:column;gap:8px;min-width:240px;font-size:12px}' +
					'.wm-form{display:grid;grid-template-columns:auto 1fr;gap:4px 6px;align-items:center}' +
					'.wm-form label{opacity:0.75;font-size:11px}' +
					'.wm-buttons{display:flex;gap:6px;flex-wrap:wrap}' +
					'.wm-run{padding:4px 6px;border-radius:5px;background:rgba(255,255,255,0.05);margin-bottom:3px}' +
					'.wm-title{font-weight:600}' +
					'.wm-line{font-size:11px;opacity:0.8}' +
					'.wm-empty{opacity:0.6;font-size:11px}'
			})
		);
		el.appendChild(elem('div', { className: 'tbx-label', textContent: 'Build an arena' }));
		const form = elem('div', { className: 'wm-form' });
		const name = /** @type {HTMLInputElement} */ (elem('input', { type: 'text', value: DEFAULTS.name, maxLength: 40 }, INPUT_CSS));
		const waves = /** @type {HTMLInputElement} */ (elem('input', { type: 'number', min: '1', max: '50', step: '1', value: String(DEFAULTS.waves) }, INPUT_CSS));
		const sizeStart = /** @type {HTMLInputElement} */ (elem('input', { type: 'number', min: '1', max: '50', step: '1', value: String(DEFAULTS.sizeStart) }, INPUT_CSS));
		const sizeStep = /** @type {HTMLInputElement} */ (elem('input', { type: 'number', min: '0', max: '20', step: '1', value: String(DEFAULTS.sizeStep) }, INPUT_CSS));
		const interval = /** @type {HTMLInputElement} */ (elem('input', { type: 'number', min: '0', max: '60', step: '0.5', value: String(DEFAULTS.interval) }, INPUT_CSS));
		const hp = /** @type {HTMLInputElement} */ (elem('input', { type: 'number', min: '1', max: '20', step: '1', value: '3' }, INPUT_CSS));
		const source = select(['click', 'hit', 'touch'], 'click');
		const speed = /** @type {HTMLInputElement} */ (elem('input', { type: 'number', min: '0.1', max: '20', step: '0.1', value: String(DEFAULTS.speed) }, INPUT_CSS));
		const reach = /** @type {HTMLInputElement} */ (elem('input', { type: 'number', min: '0.5', max: '10', step: '0.5', value: String(DEFAULTS.reach) }, INPUT_CSS));
		const enemyDamage = /** @type {HTMLInputElement} */ (elem('input', { type: 'number', min: '1', max: '20', step: '1', value: '1' }, INPUT_CSS));
		const enemyRate = /** @type {HTMLInputElement} */ (elem('input', { type: 'number', min: '0.5', max: '10', step: '0.5', value: '1' }, INPUT_CSS));
		const playerName = /** @type {HTMLInputElement} */ (elem('input', { type: 'text', value: 'me', maxLength: 40 }, INPUT_CSS));
		const playerHp = /** @type {HTMLInputElement} */ (elem('input', { type: 'number', min: '1', max: '100', step: '1', value: '10' }, INPUT_CSS));
		const spawnPrefix = /** @type {HTMLInputElement} */ (elem('input', { type: 'text', value: 'Spawn', maxLength: 40 }, INPUT_CSS));
		const count = /** @type {HTMLInputElement} */ (elem('input', { type: 'number', min: '1', max: '20', step: '1', value: '4' }, INPUT_CSS));
		for (const [label, control] of [
			['Enemies named', name],
			['Waves', waves],
			['First wave', sizeStart],
			['+ per wave', sizeStep],
			['Between (s)', interval],
			['Enemy hp', hp],
			['Killed by', source],
			['Walk m/s', speed],
			['Reach', reach],
			['Enemy dmg', enemyDamage],
			['…per second', enemyRate],
			['Player health', playerName],
			['Player hp', playerHp],
			['Spawn prefix', spawnPrefix],
			['Boxes to add', count]
		]) {
			form.appendChild(elem('label', { textContent: label }));
			form.appendChild(/** @type {any} */ (control));
		}
		el.appendChild(form);
		const options = () => ({
			name: name.value.trim() || DEFAULTS.name,
			waves: Math.max(1, Math.min(50, Number(waves.value) || DEFAULTS.waves)),
			sizeStart: Math.max(1, Math.min(50, Number(sizeStart.value) || DEFAULTS.sizeStart)),
			sizeStep: Math.max(0, Math.min(20, Number(sizeStep.value) || 0)),
			interval: Math.max(0, Math.min(60, Number(interval.value) || 0)),
			hp: Math.max(1, Math.min(20, Number(hp.value) || 3)),
			source: source.value,
			speed: Math.max(0.1, Math.min(20, Number(speed.value) || DEFAULTS.speed)),
			reach: Math.max(0.5, Math.min(10, Number(reach.value) || DEFAULTS.reach)),
			enemyDamage: Math.max(1, Math.min(20, Number(enemyDamage.value) || 1)),
			enemyRate: Math.max(0.5, Math.min(10, Number(enemyRate.value) || 1)),
			playerName: playerName.value.trim() || 'me',
			playerHp: Math.max(1, Math.min(100, Number(playerHp.value) || 10)),
			playerRegen: 0,
			spawnPrefix: spawnPrefix.value.trim() || 'Spawn'
		});
		const buttons = elem('div', { className: 'wm-buttons' });
		const fromSelection = elem('button', { className: 'tbx-btn tbx-primary', textContent: 'Enemies from selection' });
		fromSelection.title = 'The selected objects become the enemies; select the goal object too and it becomes the goal';
		fromSelection.addEventListener('click', () => {
			const selected = api.selectedUuids();
			// the goal is the one selected object that is NOT an enemy: the last selected
			const enemies = selected.length > 1 ? selected.slice(0, -1) : selected;
			const goal = selected.length > 1 ? selected[selected.length - 1] : null;
			build({ ...options(), goal }, enemies);
			refresh();
		});
		const addBoxes = elem('button', { className: 'tbx-btn', textContent: 'Add boxes as enemies' });
		addBoxes.title = 'Creates N boxes (replicated), parks them in a row, and makes them the enemies';
		addBoxes.addEventListener('click', async () => {
			const n = Math.max(1, Math.min(20, Number(count.value) || 4));
			/** @type {string[]} */
			const made = [];
			for (let i = 0; i < n; i++) {
				const ids = await api.create('/create box', { at: [-6 + i * 1.5, 0.5, -8] });
				if (ids[0]) made.push(ids[0]);
			}
			const goal = api.selectedUuids()[0] ?? null;
			build({ ...options(), goal }, made);
			refresh();
		});
		buttons.appendChild(fromSelection);
		buttons.appendChild(addBoxes);
		el.appendChild(buttons);

		const list = elem('div', {});
		el.appendChild(list);
		function refresh() {
			list.textContent = '';
			const runs = engine.all();
			if (!runs.length) {
				list.appendChild(elem('div', { className: 'wm-empty', textContent: 'No arena yet. Select the enemies (and a goal), or add boxes.' }));
				return;
			}
			for (const s of runs) {
				const box = elem('div', { className: 'wm-run' });
				box.dataset.node = s.id;
				box.appendChild(elem('div', { className: 'wm-title', textContent: s.name + ' · wave ' + s.wave + ' of ' + s.curve.waves + (s.done ? ' · cleared' : s.running ? (s.started ? ' · ' + s.alive + ' left' : ' · next wave soon') : ' · idle') }));
				box.appendChild(elem('div', { className: 'wm-line', textContent: s.enemies.length + ' enemies · ' + (s.goal ? 'walking to the goal' : 'no goal') + ' · ' + s.spawns.length + ' spawn points · ' + engine.runLog(s.name).length + ' runs logged' }));
				list.appendChild(box);
			}
		}
		refresh();
		const timer = setInterval(refresh, 500);
		return () => clearInterval(timer);
	}

	const toolbox = api.registerToolbox({ id: 'arena', title: 'Waves', width: 280, minW: 250, sidebar: false, mount });
	api.registerMenu('Open Waves', () => api.openToolbox(toolbox));
	return { toolbox, build, arenaRecipe };
}
