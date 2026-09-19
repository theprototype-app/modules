// health — THE MANAGER TOOLBOX (the collectible precedent): LOCAL always; what it CHANGES
// goes through the replicated paths (api.flow.addNodes for the recipe, setNodeData for an
// edit). One form builds a chain per selected object — or one for the local player —
// and a live list shows every health in the scene with its number and state.

import { DEFAULTS, SCOPES, DEATH_ACTIONS, DAMAGE_SOURCES, MAX_PULSES } from './ledger.js';
import { recipe, targetsOf } from './graph.js';

const SELECT_CSS =
	'background:rgba(0,0,0,0.25);color:inherit;border:1px solid rgba(255,255,255,0.15);' +
	'border-radius:4px;font-size:11px;padding:1px 3px;';
const INPUT_CSS = SELECT_CSS + 'width:100%;';

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

/** @param {any} api @param {ReturnType<import('./engine.js').createEngine>} engine */
export function registerToolbox(api, engine) {
	/**
	 * THE RECIPE. One chain per selected object (skipping objects that already have a
	 * health), each through api.flow.addNodes — replicated node by node, ONE undo entry
	 * per object, an ordinary graph afterwards.
	 * @param {{health: Record<string, any>, damage: Record<string, any>}} options
	 */
	function makeDamageable(options) {
		const uuids = api.selectedUuids();
		if (!uuids.length) {
			api.toast('Select an object first, then make it damageable');
			return { built: 0, skipped: 0 };
		}
		const g = engine.graphView();
		const taken = new Set();
		let row = 0;
		for (const node of g.nodes) {
			if (node.type !== 'health') continue;
			row++;
			for (const uuid of targetsOf(node, g)) taken.add(uuid);
		}
		let built = 0;
		let skipped = 0;
		for (const uuid of uuids) {
			if (taken.has(uuid)) {
				skipped++;
				continue;
			}
			api.flow.addNodes(recipe({ uuid, row, health: options.health, damage: options.damage }));
			taken.add(uuid);
			row++;
			built++;
		}
		api.toast(
			built
				? built + ' object' + (built === 1 ? '' : 's') + ' now damageable as "' + options.health.name + '"' +
						(skipped ? ' (' + skipped + ' already had health)' : '')
				: 'Already damageable — nothing to add'
		);
		return { built, skipped };
	}

	/** ONE player health per name — the local player's own row
	 * @param {{health: Record<string, any>, damage: Record<string, any>}} options */
	function makePlayerHealth(options) {
		const g = engine.graphView();
		const name = String(options.health.name ?? '').trim() || DEFAULTS.name;
		let row = 0;
		for (const node of g.nodes) {
			if (node.type !== 'health') continue;
			row++;
			if (node.data?.scope === 'player' && (String(node.data?.name ?? '').trim() || DEFAULTS.name) === name) {
				api.toast('Player health "' + name + '" already exists');
				return { built: 0, skipped: 1 };
			}
		}
		api.flow.addNodes(recipe({ uuid: null, row, health: options.health, damage: options.damage }));
		api.toast('Player health "' + name + '" added');
		return { built: 1, skipped: 0 };
	}

	/** @param {HTMLElement} el */
	function mount(el) {
		el.textContent = '';
		el.classList.add('health-manager');
		el.appendChild(
			elem('style', {
				textContent:
					'.health-manager{display:flex;flex-direction:column;gap:8px;min-width:230px;font-size:12px}' +
					'.hm-form{display:grid;grid-template-columns:auto 1fr;gap:4px 6px;align-items:center}' +
					'.hm-form label{opacity:0.75;font-size:11px}' +
					'.hm-buttons{display:flex;gap:6px}' +
					'.hm-row{display:flex;align-items:center;gap:6px;padding:3px 5px;border-radius:5px;' +
					'background:rgba(255,255,255,0.04);cursor:pointer;margin-bottom:2px}' +
					'.hm-row:hover{background:rgba(255,255,255,0.09)}' +
					'.hm-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
					'.hm-hp{flex:0 0 auto;font-variant-numeric:tabular-nums}' +
					'.hm-status{flex:0 0 auto;font-size:10px;opacity:0.7;white-space:nowrap}' +
					'.hm-bar{flex:0 0 46px;height:6px;border-radius:3px;background:rgba(255,255,255,0.12);overflow:hidden}' +
					'.hm-bar i{display:block;height:100%;background:#6fcf7a}' +
					'.hm-empty{opacity:0.6;font-size:11px}'
			})
		);

		el.appendChild(elem('div', { className: 'tbx-label', textContent: 'Give the selection health' }));
		const form = elem('div', { className: 'hm-form' });
		const name = /** @type {HTMLInputElement} */ (elem('input', { type: 'text', value: DEFAULTS.name, maxLength: 40 }, INPUT_CSS));
		const max = /** @type {HTMLInputElement} */ (elem('input', { type: 'number', min: '1', max: '100', step: '1', value: String(DEFAULTS.max) }, INPUT_CSS));
		const regen = /** @type {HTMLInputElement} */ (elem('input', { type: 'number', min: '0', max: '10', step: '0.5', value: '0' }, INPUT_CSS));
		const deathAction = select(DEATH_ACTIONS, DEFAULTS.deathAction);
		const respawnDelay = /** @type {HTMLInputElement} */ (elem('input', { type: 'number', min: '0', max: '30', step: '1', value: String(DEFAULTS.respawnDelay) }, INPUT_CSS));
		const source = select(DAMAGE_SOURCES, 'click');
		const amount = /** @type {HTMLInputElement} */ (elem('input', { type: 'number', min: '1', max: String(MAX_PULSES), step: '1', value: '1' }, INPUT_CSS));
		const radius = /** @type {HTMLInputElement} */ (elem('input', { type: 'number', min: '0.5', max: '10', step: '0.5', value: '1.5' }, INPUT_CSS));
		radius.title = 'For touch and zone: how close the player has to be';
		for (const [label, control] of [
			['Name', name],
			['Max hp', max],
			['Regen /s', regen],
			['On death', deathAction],
			['Respawn (s)', respawnDelay],
			['Damage from', source],
			['Damage', amount],
			['Radius', radius]
		]) {
			form.appendChild(elem('label', { textContent: label }));
			form.appendChild(/** @type {any} */ (control));
		}
		el.appendChild(form);
		const options = () => ({
			health: {
				name: name.value.trim() || DEFAULTS.name,
				max: Math.max(1, Math.min(100, Number(max.value) || DEFAULTS.max)),
				regen: Math.max(0, Math.min(10, Number(regen.value) || 0)),
				deathAction: deathAction.value,
				respawnDelay: Math.max(0, Math.min(30, Number(respawnDelay.value) || 0))
			},
			damage: {
				amount: Math.max(1, Math.min(MAX_PULSES, Number(amount.value) || 1)),
				source: source.value,
				radius: Math.max(0.5, Math.min(10, Number(radius.value) || 1.5))
			}
		});
		const buttons = elem('div', { className: 'hm-buttons' });
		const buildObjects = elem('button', { className: 'tbx-btn tbx-primary', textContent: 'Make damageable' });
		buildObjects.addEventListener('click', () => {
			makeDamageable(options());
			refresh(true);
		});
		const buildPlayer = elem('button', { className: 'tbx-btn', textContent: 'Player health' });
		buildPlayer.title = 'One health for the local player, on their own peer row';
		buildPlayer.addEventListener('click', () => {
			makePlayerHealth(options());
			refresh(true);
		});
		buttons.appendChild(buildObjects);
		buttons.appendChild(buildPlayer);
		el.appendChild(buttons);

		const list = elem('div', {});
		el.appendChild(list);
		let signature = '';
		/** @type {Map<string, {hp: HTMLElement, status: HTMLElement, bar: HTMLElement}>} */
		const rows = new Map();

		/** @param {any} s */
		function statusText(s) {
			if (s.scope === 'object' && s.uuid && !api.objectsGroup()?.getObjectByProperty('uuid', s.uuid)) return 'missing';
			if (!s.dead) return s.hp >= s.max ? 'full' : 'hurt';
			if (s.deathAction === 'respawn' && typeof s.deadAt === 'number') {
				const left = Math.max(0, s.respawnDelay - (api.now() - s.deadAt));
				return 'back in ' + Math.max(1, Math.ceil(left)) + 's';
			}
			return 'dead';
		}

		/** @param {any[]} model */
		function rebuild(model) {
			list.textContent = '';
			rows.clear();
			if (!model.length) {
				list.appendChild(elem('div', { className: 'hm-empty', textContent: 'No health yet. Select an object and press the button.' }));
				return;
			}
			for (const s of model) {
				const row = elem('div', { className: 'hm-row' });
				row.dataset.node = s.id;
				row.addEventListener('click', () => {
					if (s.uuid) api.selectObject(s.uuid);
				});
				row.appendChild(elem('div', { className: 'hm-name', textContent: s.label + ' · ' + s.name }));
				const bar = elem('div', { className: 'hm-bar' });
				const fill = elem('i', {});
				bar.appendChild(fill);
				row.appendChild(bar);
				const hp = elem('div', { className: 'hm-hp', textContent: '' });
				const status = elem('div', { className: 'hm-status', textContent: '' });
				row.appendChild(hp);
				row.appendChild(status);
				rows.set(s.id, { hp, status, bar: fill });
				list.appendChild(row);
			}
		}

		/** @param {boolean=} force */
		function refresh(force) {
			const model = engine.all();
			const next = JSON.stringify(model.map((s) => [s.id, s.label, s.name, s.scope, s.deathAction]));
			if (force || next !== signature) {
				signature = next;
				rebuild(model);
			}
			for (const s of model) {
				const r = rows.get(s.id);
				if (!r) continue;
				r.hp.textContent = Math.round(s.hp * 10) / 10 + ' / ' + s.max;
				r.status.textContent = statusText(s);
				r.bar.style.width = Math.round((s.max ? s.hp / s.max : 0) * 100) + '%';
				r.bar.style.background = s.dead ? '#c94a4a' : s.hp / s.max < 0.35 ? '#e0a23b' : '#6fcf7a';
			}
		}

		refresh(true);
		const timer = setInterval(refresh, 500);
		return () => clearInterval(timer);
	}

	const toolbox = api.registerToolbox({
		id: 'manager',
		title: 'Health',
		width: 270,
		minW: 240,
		sidebar: false,
		mount
	});
	api.registerMenu('Open Health', () => api.openToolbox(toolbox));
	return { toolbox, makeDamageable, makePlayerHealth };
}
