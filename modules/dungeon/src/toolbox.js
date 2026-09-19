// THE TOOLBOX (21-C C6.2): seed + dice, rooms / loops / levels, Generate / Clear, a
// floor stepper and a stats footer — `api.registerToolbox` over core's shared
// ToolboxWindow, so the palette is draggable, resizable, themed and sits in the
// z-band it owns. This is the SDK's worked toolbox example (AUTHORING.md).
//
// FALLBACK: `#dungeon-panel`, the plain fixed DOM the module shipped before, kept
// behind `typeof api.registerToolbox === 'function'` (the AUTHORING.md feature-detect
// rule) so the Kit still installs on an older app. Both hosts mount the SAME `mount(el)`.
//
// Writes go where the rule lives: when a Dungeon node with `apply` is alive in a
// running graph, the toolbox edits THAT node (api.flow.setNodeData — the replicated
// graph; otherwise the node would put its own recipe back a frame later); with no
// node, the Kit's own replicated `generate` op.

import { NODE_TYPE } from './nodes.js';

const SELECT_CSS =
	'background:rgba(0,0,0,0.25);color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:4px;font-size:11px;padding:1px 4px;';

/** @param {any} api @param {ReturnType<import('./kit.js').createKit>} core */
export function registerToolbox(api, core) {
	const { kit } = core;

	/** @param {string} tag @param {Record<string, any>=} props @param {string=} css */
	function elem(tag, props, css) {
		const node = document.createElement(tag);
		Object.assign(node, props ?? {});
		if (css) node.setAttribute('style', css);
		return node;
	}

	/** the live Dungeon node that owns the recipe, if any */
	const recipeNode = () => {
		if (!api.flow?.nodes) return null;
		return api.flow.nodes(NODE_TYPE).find((n) => n.data?.apply) ?? null;
	};

	/** @param {number} seed @param {any} params */
	function applyRecipe(seed, params) {
		const node = recipeNode();
		if (node && api.flow.setNodeData(node.id, { seed, ...params })) {
			api.toast('Dungeon node updated — every peer regenerates from the graph');
			return;
		}
		kit.generate(seed, params);
	}

	/** @param {HTMLElement} el */
	function mount(el) {
		el.innerHTML = '';
		const current = kit.state();
		const values = {
			seed: current.seed ?? 1337,
			roomCount: current.params.roomCount ?? 0,
			loopChance: current.params.loopChance ?? 0.15,
			levelCount: current.params.levelCount ?? 5
		};

		/** @param {string} label @param {HTMLElement} control @param {HTMLElement=} out */
		const row = (label, control, out) => {
			const line = elem('div', { className: 'tbx-row' }, 'display:flex;align-items:center;gap:6px;margin:3px 0;');
			line.appendChild(elem('span', { className: 'tbx-label', textContent: label }, 'flex:1;font-size:11px;'));
			if (out) line.appendChild(out);
			line.appendChild(control);
			el.appendChild(line);
			return line;
		};

		// seed + dice: the seed CHOICE is local, the seed itself replicates
		const seedInput = /** @type {HTMLInputElement} */ (elem('input', { id: 'dk-seed', type: 'number', value: String(values.seed), min: '0', step: '1' }, SELECT_CSS + 'width:84px;'));
		seedInput.onchange = () => (values.seed = Math.max(0, Math.round(Number(seedInput.value) || 0)));
		const dice = elem('button', { id: 'dk-dice', className: 'tbx-btn', textContent: '\u{1F3B2}', title: 'Random seed' });
		dice.onclick = () => {
			values.seed = Math.floor(Math.random() * 1000000);
			seedInput.value = String(values.seed);
		};
		const seedLine = elem('div', {}, 'display:flex;align-items:center;gap:6px;margin:3px 0;');
		seedLine.appendChild(elem('span', { className: 'tbx-label', textContent: 'Seed' }, 'flex:1;font-size:11px;'));
		seedLine.appendChild(seedInput);
		seedLine.appendChild(dice);
		el.appendChild(seedLine);

		/** @param {keyof typeof values} key @param {number} min @param {number} max @param {number} step @param {(v: number) => string} fmt */
		const slider = (key, min, max, step, fmt) => {
			const out = elem('span', { textContent: fmt(values[key]) }, 'font-size:11px;opacity:0.8;min-width:34px;text-align:right;');
			const input = /** @type {HTMLInputElement} */ (elem('input', { id: 'dk-' + key, type: 'range', min: String(min), max: String(max), step: String(step), value: String(values[key]) }, 'width:96px;'));
			input.oninput = () => {
				values[key] = Number(input.value);
				out.textContent = fmt(values[key]);
			};
			return { input, out };
		};
		const rooms = slider('roomCount', 0, 60, 2, (v) => (v ? String(v) : 'auto'));
		row('Rooms', rooms.input, rooms.out);
		const loops = slider('loopChance', 0, 0.5, 0.05, (v) => v.toFixed(2));
		row('Extra loops', loops.input, loops.out);
		const levels = slider('levelCount', 1, 9, 1, (v) => String(v));
		row('Floors', levels.input, levels.out);

		const buttons = elem('div', {}, 'display:flex;flex-wrap:wrap;gap:4px;margin:6px 0;');
		const generate = elem('button', { id: 'dk-generate', className: 'tbx-btn tbx-primary', textContent: 'Generate' });
		generate.onclick = () => applyRecipe(values.seed, { roomCount: values.roomCount, loopChance: values.loopChance, levelCount: values.levelCount });
		const clear = elem('button', { id: 'dk-clear', className: 'tbx-btn', textContent: 'Clear' });
		clear.onclick = () => kit.clear();
		buttons.appendChild(generate);
		buttons.appendChild(clear);
		el.appendChild(buttons);

		// the floor stepper: replicated travel, the rule module's portals do the same
		const floorLine = elem('div', {}, 'display:flex;align-items:center;gap:6px;margin:3px 0;');
		const down = elem('button', { id: 'dk-floor-down', className: 'tbx-btn', textContent: '◂', title: 'Floor below' });
		const floorOut = elem('span', { id: 'dk-floor', textContent: '—' }, 'flex:1;text-align:center;font-size:11px;');
		const up = elem('button', { id: 'dk-floor-up', className: 'tbx-btn', textContent: '▸', title: 'Floor above' });
		down.onclick = () => kit.showFloor(kit.state().floorIndex - 1);
		up.onclick = () => kit.showFloor(kit.state().floorIndex + 1);
		floorLine.appendChild(down);
		floorLine.appendChild(floorOut);
		floorLine.appendChild(up);
		el.appendChild(floorLine);

		const status = elem('div', { id: 'dk-stats', className: 'tbx-label' }, 'white-space:pre-wrap;font-size:11px;opacity:0.8;margin-top:6px;');
		el.appendChild(status);
		el.appendChild(
			elem('div', { className: 'tbx-label', textContent: 'Peers regenerate from the seed — the same checksum means the exact same dungeon. Dungeon Realms plays it.' },
				'font-size:10px;opacity:0.6;margin-top:4px;')
		);

		const refresh = () => {
			const s = kit.stats();
			const st = kit.state();
			floorOut.textContent = s ? 'Floor ' + s.floorIndex + ' / ' + s.levelCount + ' · ' + s.name : 'no dungeon';
			down.disabled = !s || s.floorIndex <= 1;
			up.disabled = !s || s.floorIndex >= s.levelCount;
			status.textContent = s
				? s.rooms + ' rooms · ' + s.gems + ' gems · ' + s.loops + ' loops · ' + s.ms + ' ms\nchecksum ' + s.checksum + ' · campaign ' + s.campaignChecksum +
					(recipeNode() ? '\nrecipe owned by the Dungeon node' : '')
				: 'Generate a dungeon, then press the red Play button to walk it.';
			if (st.seed != null && Number(seedInput.value) !== st.seed && document.activeElement !== seedInput) {
				values.seed = st.seed;
				seedInput.value = String(st.seed);
			}
		};
		refresh();
		const off = kit.onChange(refresh);
		return () => off();
	}

	// ---- host: the shared ToolboxWindow, or the fixed panel on an older app ------
	if (typeof api.registerToolbox === 'function') {
		const id = api.registerToolbox({ id: 'kit', title: 'Dungeon Kit', width: 260, minW: 220, mount });
		api.registerMenu('Dungeon Kit', () => (typeof api.openToolbox === 'function' ? api.openToolbox(id) : null));
		return { id, mount, host: 'toolbox' };
	}

	/** @type {HTMLElement | null} */ let panel = null;
	/** @type {(() => void) | null} */ let cleanup = null;
	function openPanel() {
		if (panel || typeof document === 'undefined') return;
		panel = elem('div', { id: 'dungeon-panel' },
			'position:fixed;right:0.5rem;top:5rem;z-index:40;display:flex;width:18rem;flex-direction:column;gap:0.5rem;' +
			'border-radius:0.5rem;background:#1f2937;padding:0.75rem;font-size:0.875rem;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,0.4);');
		const head = elem('div', {}, 'display:flex;align-items:center;justify-content:space-between');
		head.appendChild(elem('span', { textContent: 'Dungeon Kit' }, 'font-weight:600'));
		const close = elem('button', { id: 'dungeon-close', textContent: '✕' }, 'border-radius:2px;background:#4b5563;padding:0 0.5rem');
		close.onclick = () => {
			cleanup?.();
			cleanup = null;
			panel?.remove();
			panel = null;
		};
		head.appendChild(close);
		panel.appendChild(head);
		const body = elem('div');
		panel.appendChild(body);
		document.body.appendChild(panel);
		cleanup = mount(body) ?? null;
	}
	api.registerMenu('Dungeon Kit', openPanel);
	return { id: null, mount, host: 'panel', openPanel };
}
