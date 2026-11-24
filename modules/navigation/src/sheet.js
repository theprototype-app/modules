// navigation — G10: "Make this an enemy". ONE recipe (`applyEnemy`) behind two doors: the sheet a
// person opens from the object menu, and the agent tools' game_setup {npc} (core calls the same
// `apply` through api.registerObjectAction) — so the sheet and the agent build the same guard.
//
// The recipe writes ONE `navnpc` node into the object's own graph (or updates the one already
// there): its Path, sight cone, hearing, chase range, attack range / rate, speeds, give-up time.
// "path: new" draws a square patrol loop around the object first (78's createPath).

import { NPC_DEFAULTS, normalizeNpc } from './brain.js';

/** spec (agent / sheet shape) -> navnpc data patch @param {any} spec */
export function specToData(spec) {
	/** @type {Record<string, any>} */
	const d = {};
	const num = (/** @type {any} */ v) => (v === undefined || v === null || v === '' ? undefined : Number(v));
	const put = (/** @type {string} */ k, /** @type {any} */ v) => {
		const n = num(v);
		if (n !== undefined && Number.isFinite(n)) d[k] = n;
	};
	put('sightAngle', spec?.sight?.angle);
	put('sightRange', spec?.sight?.range);
	put('hearing', spec?.hearing);
	put('chaseRange', spec?.chase);
	put('attackRange', spec?.attack?.range);
	put('attackEvery', spec?.attack?.every);
	put('speed', spec?.speed);
	put('run', spec?.run);
	put('giveUp', spec?.giveUp);
	put('alert', spec?.alert);
	// the brain's own clamps, so the node never stores a value the brain would not use
	const clamped = normalizeNpc({ ...NPC_DEFAULTS, ...d });
	/** @type {Record<string, any>} */
	const out = {};
	for (const k of Object.keys(d)) out[k] = /** @type {any} */ (clamped)[k];
	return out;
}

/** navnpc data -> the agent's spec shape (what a tool result reports) @param {any} d */
export function dataToSpec(d) {
	const p = normalizeNpc(d);
	return {
		path: typeof d?.path === 'string' && d.path ? d.path : 'none',
		sight: { angle: p.sightAngle, range: p.sightRange },
		hearing: p.hearing,
		chase: p.chaseRange,
		attack: { range: p.attackRange, every: p.attackEvery },
		speed: p.speed,
		run: p.run,
		giveUp: p.giveUp,
		alert: p.alert
	};
}

/**
 * THE recipe.
 * @param {any} api @param {string} uuid @param {any} spec
 * @returns {Promise<{npc: any, note: string, warnings?: string[]} | {error: string}>}
 */
export async function applyEnemy(api, uuid, spec = {}) {
	const object = api.objectsGroup()?.getObjectByProperty('uuid', uuid);
	if (!object) return { error: 'No object ' + String(uuid).slice(0, 40) + '.' };
	if (object.userData?.terrain) return { error: 'A terrain cannot walk — pick the object that should be the enemy.' };
	if (object.userData?.spline) return { error: 'A Path cannot be an enemy — pick the enemy, then choose this path as its patrol.' };
	const existing = api.flow.nodes('navnpc').filter((/** @type {any} */ n) => n.graphId === uuid);
	const name = object.name || 'Object';
	if (spec.remove) {
		if (!existing.length) return { npc: null, note: name + ' is not an enemy.' };
		const n = api.flow.removeNodes ? api.flow.removeNodes(existing.map((/** @type {any} */ e) => e.id), uuid) : 0;
		if (!n) return { error: 'This app build cannot remove nodes for a module (flow.removeNodes is missing).' };
		return { npc: null, note: name + ' is an ordinary object again.' };
	}
	/** @type {string[]} */
	const warnings = [];
	const patch = specToData(spec);
	if (spec.path !== undefined) {
		const p = String(spec.path ?? '');
		if (p === 'none' || p === '') patch.path = '';
		else if (p === 'new') {
			object.updateWorldMatrix(true, false);
			const at = new api.THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
			const r = 3;
			const pts = [
				[at.x - r, at.y, at.z - r],
				[at.x + r, at.y, at.z - r],
				[at.x + r, at.y, at.z + r],
				[at.x - r, at.y, at.z + r]
			];
			const made = api.paths?.create ? await api.paths.create({ points: pts, closed: true, name: name + ' patrol' }) : null;
			if (made) patch.path = made;
			else warnings.push('Could not draw a new patrol path; the enemy guards its spot.');
		} else if (api.paths?.of(p)) patch.path = p;
		else warnings.push('No Path object ' + p.slice(0, 40) + '; the enemy keeps its patrol.');
	}
	let nodeId;
	if (existing.length) {
		nodeId = existing[0].id;
		if (Object.keys(patch).length) api.flow.setNodeData(nodeId, patch);
	} else {
		const at = api.flow.freeRegion({ w: 220, h: 360, graphId: uuid });
		const ids = api.flow.addNodes({ graphId: uuid, nodes: [{ type: 'navnpc', x: at.x, y: at.y, data: { ...NPC_DEFAULTS, path: '', ...patch } }] });
		nodeId = ids[0];
		if (!nodeId) return { error: 'The node editor is not ready yet — try again in a moment.' };
	}
	const data = { ...NPC_DEFAULTS, path: '', ...(existing[0]?.data ?? {}), ...patch };
	const pathName = data.path ? api.paths?.list().find((/** @type {any} */ p) => p.uuid === data.path)?.name ?? 'a path' : '';
	return {
		npc: { uuid, node: nodeId, ...dataToSpec(data) },
		note:
			name +
			(existing.length ? ' updated' : ' is an enemy now') +
			(pathName ? ': it patrols ' + pathName : ': it guards its spot') +
			', sees ' + data.sightRange + ' m in a ' + data.sightAngle + '° cone, hears ' + data.hearing + ' m, attacks within ' + data.attackRange + ' m. ' +
			'Wire an On NPC Event (attack) to damage or a sound.',
		...(warnings.length ? { warnings } : {})
	};
}

const FIELDS = [
	{ key: 'sightAngle', label: 'Sight angle', unit: '°', min: 10, max: 360, step: 5 },
	{ key: 'sightRange', label: 'Sight range', unit: 'm', min: 1, max: 60, step: 0.5 },
	{ key: 'hearing', label: 'Hearing', unit: 'm', min: 0, max: 40, step: 0.5 },
	{ key: 'chaseRange', label: 'Chase range', unit: 'm', min: 2, max: 120, step: 1 },
	{ key: 'attackRange', label: 'Attack range', unit: 'm', min: 0.3, max: 10, step: 0.1 },
	{ key: 'attackEvery', label: 'Attack every', unit: 's', min: 0.2, max: 10, step: 0.1 },
	{ key: 'speed', label: 'Walk speed', unit: 'm/s', min: 0.2, max: 8, step: 0.1 },
	{ key: 'run', label: 'Chase speed', unit: 'm/s', min: 0.2, max: 12, step: 0.1 },
	{ key: 'giveUp', label: 'Give up after', unit: 's', min: 0.5, max: 30, step: 0.5 }
];

/**
 * The sheet: a toolbox over the target object. `open(uuid)` points it at an object and opens it.
 * @param {any} api @param {ReturnType<import('./runtime.js').createRuntime>} rt
 */
export function registerSheet(api, rt) {
	let target = '';
	/** @type {(() => void) | null} */
	let rerender = null;

	const id = api.registerToolbox({
		id: 'enemy',
		title: 'Make this an enemy',
		width: 300,
		sidebar: false,
		playMode: true,
		onOpen: () => rerender?.(),
		mount(/** @type {HTMLElement} */ el) {
			const render = () => {
				el.replaceChildren();
				const object = target ? api.objectsGroup()?.getObjectByProperty('uuid', target) : null;
				const head = document.createElement('div');
				head.className = 'tbx-label';
				head.id = 'nav-sheet-target';
				head.textContent = object ? 'Enemy: ' + (object.name || 'Object') : 'Right-click an object ▸ Physics & effects ▸ Make this an enemy';
				el.append(head);
				if (object) renderForm(el, object);
				renderView(el);
			};
			rerender = render;
			render();
			const off = rt.subscribe(() => statusLine && (statusLine.textContent = statusText()));
			return () => {
				off();
				rerender = null;
			};
		}
	});

	/** @type {HTMLElement | null} */
	let statusLine = null;
	const statusText = () => {
		const b = rt.bake;
		const base =
			b.status === 'ready'
				? 'Navmesh: ' + Math.round(b.area) + ' m² walkable, baked in ' + b.ms + ' ms' + (b.links ? ', ' + b.links + ' jump / climb links' : '') + (b.truncated ? ' (scene cut at the device cap)' : '')
				: b.status === 'baking'
					? 'Navmesh: baking…'
					: b.status === 'failed'
						? 'Navmesh: failed — ' + b.error
						: b.status === 'empty'
							? 'Navmesh: nothing to walk on'
							: 'Navmesh: bakes when you play';
		return base + ' · ' + rt.caps.kind + ' cap ' + rt.caps.npcs + ' enemies';
	};

	/** @param {HTMLElement} el @param {any} object */
	function renderForm(el, object) {
		const node = api.flow.nodes('navnpc').find((/** @type {any} */ n) => n.graphId === object.uuid);
		const data = { ...NPC_DEFAULTS, path: '', ...(node?.data ?? {}) };
		/** @type {Record<string, any>} */
		const values = {};

		// Path
		const pathRow = document.createElement('label');
		pathRow.className = 'tbx-row';
		const pathLabel = document.createElement('span');
		pathLabel.textContent = 'Patrol';
		const select = document.createElement('select');
		select.id = 'nav-sheet-path';
		// the toolbox kit styles no <select>: the app's own field look (a native one paints white on a dark panel)
		select.style.cssText =
			'flex:1 1 auto;min-width:0;padding:4px 6px;font-size:12px;border-radius:6px;border:1px solid var(--border);background:var(--surface-inset);color:var(--text-2);color-scheme:dark light';
		const opts = [
			['none', 'None (guard this spot)'],
			['new', 'New loop around it'],
			...api.paths.list().map((/** @type {any} */ p) => [p.uuid, p.name])
		];
		for (const [value, text] of opts) {
			const o = document.createElement('option');
			o.value = value;
			o.textContent = text;
			select.append(o);
		}
		select.value = data.path && opts.some((o) => o[0] === data.path) ? data.path : node ? 'none' : 'none';
		pathRow.append(pathLabel, select);
		el.append(pathRow);

		for (const f of FIELDS) {
			const row = document.createElement('label');
			row.className = 'tbx-row';
			const name = document.createElement('span');
			name.textContent = f.label;
			const input = document.createElement('input');
			input.type = 'range';
			input.min = String(f.min);
			input.max = String(f.max);
			input.step = String(f.step);
			input.value = String(data[f.key]);
			input.id = 'nav-sheet-' + f.key;
			const out = document.createElement('span');
			out.className = 'tbx-value';
			const show = () => (out.textContent = input.value + ' ' + f.unit);
			show();
			input.oninput = () => {
				values[f.key] = Number(input.value);
				show();
			};
			row.append(name, input, out);
			el.append(row);
		}

		const go = document.createElement('button');
		go.className = 'tbx-primary';
		go.id = 'nav-sheet-apply';
		go.textContent = node ? 'Update enemy' : 'Make enemy';
		go.style.minHeight = '40px'; // a finger-sized target on a phone
		go.onclick = async () => {
			go.disabled = true;
			const spec = {
				path: select.value,
				sight: { angle: values.sightAngle, range: values.sightRange },
				hearing: values.hearing,
				chase: values.chaseRange,
				attack: { range: values.attackRange, every: values.attackEvery },
				speed: values.speed,
				run: values.run,
				giveUp: values.giveUp
			};
			// unchanged sliders keep the node's own value (a new enemy takes the defaults)
			const r = await applyEnemy(api, object.uuid, spec);
			go.disabled = false;
			if ('error' in r) api.toast(r.error);
			else {
				api.toast(r.note);
				for (const w of r.warnings ?? []) api.toast(w);
				rerender?.();
			}
		};
		el.append(go);
		if (node) {
			const rm = document.createElement('button');
			rm.className = 'tbx-danger';
			rm.id = 'nav-sheet-remove';
			rm.textContent = 'Not an enemy';
			rm.style.minHeight = '40px';
			rm.onclick = async () => {
				const r = await applyEnemy(api, object.uuid, { remove: true });
				api.toast('error' in r ? r.error : r.note);
				rerender?.();
			};
			el.append(rm);
		}
	}

	/** @param {HTMLElement} el */
	function renderView(el) {
		const label = document.createElement('div');
		label.className = 'tbx-label';
		label.textContent = 'View (this device)';
		el.append(label);
		for (const [key, text, idAttr] of /** @type {const} */ ([
			['overlay', 'Navmesh overlay', 'nav-sheet-overlay'],
			['debug', 'NPC debug view (Play)', 'nav-sheet-debug']
		])) {
			// the kit's .tbx-check is the CHECKBOX itself; the row is a .tbx-row label (61-int docs shot: the class on
			// the label drew a 14 px white box with the words spilling over the status line)
			const row = document.createElement('label');
			row.className = 'tbx-row';
			row.style.cursor = 'pointer';
			row.style.fontSize = '12px';
			const box = document.createElement('input');
			box.type = 'checkbox';
			box.className = 'tbx-check';
			box.id = idAttr;
			box.checked = !!rt.want[key];
			box.onchange = () => setWant(key, box.checked);
			row.append(box, document.createTextNode(text));
			el.append(row);
		}
		statusLine = document.createElement('div');
		statusLine.className = 'tbx-row';
		statusLine.style.cssText = 'font-size:11px;color:var(--text-muted);line-height:1.35';
		statusLine.id = 'nav-sheet-status';
		statusLine.textContent = statusText();
		el.append(statusLine);
	}

	/** @param {'overlay' | 'debug'} key @param {boolean} on */
	function setWant(key, on) {
		rt.want[key] = on;
		try {
			api.storage?.set?.('view:' + key, on);
		} catch {
			/* storage full or off */
		}
		rerender?.();
	}
	for (const key of /** @type {const} */ (['overlay', 'debug'])) {
		try {
			rt.want[key] = !!api.storage?.get?.('view:' + key, false);
		} catch {
			/* no storage */
		}
	}
	api.registerViewToggle?.({ id: 'overlay', label: 'Navmesh overlay', tooltip: 'Show where enemies can walk (green) and moving obstacles (red). This device only.', get: () => rt.want.overlay, set: (/** @type {boolean} */ on) => setWant('overlay', on) });
	api.registerViewToggle?.({ id: 'debug', label: 'NPC debug view', tooltip: 'In Play: each enemy’s path and state. This device only; never in exported games.', get: () => rt.want.debug, set: (/** @type {boolean} */ on) => setWant('debug', on) });

	api.registerObjectAction?.({
		id: 'enemy',
		label: 'Make this an enemy…',
		icon: 'swords',
		tooltip: 'Patrol a Path, see and hear the player, chase, attack, give up and return.',
		when: (/** @type {string} */ uuid) => {
			const o = api.objectsGroup()?.getObjectByProperty('uuid', uuid);
			return !!o && !o.userData?.terrain && !o.userData?.spline;
		},
		open: (/** @type {string} */ uuid) => {
			target = uuid;
			rerender?.();
			api.openToolbox(id);
		},
		apply: (/** @type {string} */ uuid, /** @type {any} */ spec) => applyEnemy(api, uuid, spec)
	});
	api.registerMenu?.('Navigation view', () => {
		target = '';
		rerender?.();
		api.openToolbox(id);
	});

	return { id, open: (/** @type {string} */ uuid) => ((target = uuid), rerender?.(), api.openToolbox(id)) };
}
