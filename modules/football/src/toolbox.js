// football — THE TOOLBOX: host settings, never gameplay (registerToolbox's contract: this
// window is this viewer's; what it changes goes through the replicated paths). Mode,
// goals to win, match length, serve, swap sides, the status line, and the recipes that
// build a pitch in an empty scene and (B3) fit it to the room.
//
// Rules edits go to the Match Rules NODE when one is alive (api.flow.setNodeData, the
// replicated graph) and to the module's own replicated `rules` op when there is none —
// so the toolbox never fights the node that owns the rule.

import { MODES, WIN_BY, SERVE, OWN_GOALS } from './rules.js';
import { pitchObjects, pitchGraph, createCommand, PITCH_PHYSICS, DEFAULT_DIMS, normalizeDims, NAMES } from './pitch.js';
import { ARENA } from './arena.js';

/** @param {any} api @param {ReturnType<import('./game.js').createGame>} game @param {{hitSource: () => string}} info */
export function registerToolbox(api, game, info) {
	/** @param {string} tag @param {Record<string, any>=} props @param {string=} css */
	function elem(tag, props, css) {
		const node = document.createElement(tag);
		Object.assign(node, props ?? {});
		if (css) node.setAttribute('style', css);
		return node;
	}
	const SELECT_CSS = 'background:rgba(0,0,0,0.25);color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:4px;font-size:11px;padding:1px 3px;';

	/** the live Match Rules node, if any */
	const rulesNode = () => (api.flow?.nodes ? api.flow.nodes('fbrules')[0] ?? null : null);
	/** @param {any} patch */
	function writeRules(patch) {
		const node = rulesNode();
		if (node && api.flow.setNodeData(node.id, patch)) return;
		game.setRules(patch);
	}

	// ---- the pitch recipe --------------------------------------------------------------
	/** @type {Record<string, string>} name -> uuid of the last pitch this peer built */
	let built = {};

	/**
	 * Build a pitch in the shared scene: objects through api.create (replicated like a
	 * typed /create), physics through api.physics.set (replicated objectParameters), the
	 * graph through api.flow.addNodes (replicated, one undo entry). Names and colours are
	 * set on this peer's copy only (the api has no rename/colour write) — the graph binds
	 * by uuid, so peers play the same pitch; a late joiner receives names with the scene.
	 * @param {any} [dims]
	 */
	async function buildPitch(dims) {
		if (!api.create || !api.flow?.addNodes || !api.physics?.set) {
			api.toast('Football: this app cannot build a pitch (needs api.create / flow.addNodes)');
			return null;
		}
		const objects = pitchObjects(dims);
		/** @type {Record<string, string>} */
		const names = {};
		for (const o of objects) {
			const [uuid] = await api.create(createCommand(o), { at: o.pos });
			if (!uuid) continue;
			names[o.name] = uuid;
			const object = api.objectsGroup()?.getObjectByProperty('uuid', uuid);
			if (object) {
				object.name = o.name;
				const m = object.material;
				if (m && !Array.isArray(m)) {
					if (o.color != null) m.color.setHex(o.color);
					if (o.emissive != null && m.emissive) {
						m.emissive.setHex(o.emissive);
						m.emissiveIntensity = o.emissiveIntensity ?? 1;
					}
					if (o.roughness != null) m.roughness = o.roughness;
					if (o.opacity != null && o.opacity < 1) {
						m.transparent = true;
						m.opacity = o.opacity;
					}
				}
			}
			if (o.physics) api.physics.set(uuid, o.physics);
		}
		// the same graph the def carries: the HUD rows are harmless without a HUD document
		// (a HUD Button node whose element does not exist simply never pulses) and a scene
		// that later gains one is wired already
		const graph = pitchGraph(names, { hudButtons: true });
		const index = new Map(graph.nodes.map((n, i) => [n.id, i]));
		api.flow.addNodes({
			nodes: graph.nodes.map((n) => ({ type: n.type, x: n.position.x, y: n.position.y, data: n.data })),
			edges: graph.edges.map((e) => ({ from: index.get(e.source), to: index.get(e.target), ...(e.targetHandle ? { handle: e.targetHandle } : {}) }))
		});
		// the zero-g block is scene physics, which the api cannot write (DEVX #20): say so
		if (typeof api.physics.setScene === 'function') api.physics.setScene(PITCH_PHYSICS);
		else api.toast('Pitch built — set Inspector ▸ Physics: gravity 0, ground off, Knock on');
		built = names;
		return names;
	}

	// ---- B3: fit the pitch to the room -------------------------------------------------------
	/**
	 * Resize/re-centre the pitch objects this peer built (or the def's, found by name) by
	 * moving them with api.moveObject — ordinary replicated `move`s, so a colocated pair
	 * sees one pitch. Objects are re-laid from `pitchObjects(dims)` by NAME.
	 * @param {any} dims @param {number[]} [centre]
	 */
	function fitPitch(dims, centre = [0, 0, 0]) {
		const group = api.objectsGroup();
		if (!group || !api.moveObject) return 0;
		let moved = 0;
		for (const o of pitchObjects(dims)) {
			// the ball is a live body: a `move` on it would engage the external hold
			if (o.physics?.mode === 'dynamic') continue;
			const uuid = built[o.name] ?? group.getObjectByName(o.name)?.uuid;
			const object = uuid ? group.getObjectByProperty('uuid', uuid) : null;
			if (!object) continue;
			const pos = [o.pos[0] + centre[0], o.pos[1] + centre[1], o.pos[2] + centre[2]];
			// boxes are re-sized through scale against the unit they were created with
			const scale = o.type === 'box' ? o.size.map((v, i) => v / (object.userData.fbSize?.[i] ?? object.geometry?.parameters?.[['width', 'height', 'depth'][i]] ?? v)) : undefined;
			api.moveObject(uuid, { pos, ...(scale ? { scale } : {}) });
			moved++;
		}
		// 30: the template's look (turf, markings, floodlights, boards) is ONE group laid out
		// for the default pitch — stretch it with the pitch so the markings stay on the lines
		const arena = group.getObjectByName(ARENA);
		if (arena && arena.parent === group) {
			const d = normalizeDims(dims);
			const span = (/** @type {any} */ x) => x.length / 2 - 0.3 + x.sensorDepth + 0.05;
			api.moveObject(arena.uuid, { pos: [...centre], scale: [d.width / DEFAULT_DIMS.width, 1, span(d) / span(DEFAULT_DIMS)] });
			moved++;
		}
		return moved;
	}

	/** the room's bounds from the XR session when the app exposes it (DEVX #21), else null */
	function roomBounds() {
		const session = api.xrSession?.() ?? null;
		const space = api.xrReferenceSpace?.() ?? null;
		const geometry = space?.boundsGeometry;
		if (!session || !geometry || geometry.length < 3) return null;
		let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
		for (const p of geometry) {
			minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
			minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
		}
		return { width: maxX - minX, length: maxZ - minZ, centre: [(minX + maxX) / 2, 0, (minZ + maxZ) / 2] };
	}

	/** the colocation room anchor, when the app exposes it (DEVX #21) */
	function roomAnchor() {
		const a = api.colocation?.roomAnchor?.() ?? api.roomAnchor?.() ?? null;
		return a && Array.isArray(a.position) ? a : null;
	}

	// ---- the window -------------------------------------------------------------------------------
	/** @param {HTMLElement} el */
	function mount(el) {
		el.innerHTML = '';
		const r = game.rules();
		const dims = { ...DEFAULT_DIMS };

		const status = elem('div', { className: 'tbx-label' }, 'white-space:pre-wrap;font-size:11px;opacity:0.85;margin-bottom:6px;');
		el.appendChild(status);

		/** @param {string} label @param {HTMLElement} control */
		const row = (label, control) => {
			const line = elem('div', { className: 'tbx-row' }, 'display:flex;align-items:center;gap:6px;margin:3px 0;');
			line.appendChild(elem('span', { className: 'tbx-label', textContent: label }, 'flex:1;font-size:11px;'));
			line.appendChild(control);
			el.appendChild(line);
			return line;
		};
		/** @param {string} key @param {string[]} options @param {string} value */
		const select = (key, options, value) => {
			const node = /** @type {HTMLSelectElement} */ (elem('select', {}, SELECT_CSS));
			for (const o of options) node.appendChild(elem('option', { value: o, textContent: o }));
			node.value = value;
			node.onchange = () => writeRules({ [key]: node.value });
			return node;
		};
		/** @param {string} key @param {number} value @param {number} min @param {number} max @param {number} step */
		const number = (key, value, min, max, step) => {
			const node = /** @type {HTMLInputElement} */ (elem('input', { type: 'number', value: String(value), min: String(min), max: String(max), step: String(step) }, SELECT_CSS + 'width:64px;'));
			node.onchange = () => writeRules({ [key]: Number(node.value) });
			return node;
		};
		row('Mode', select('mode', MODES, r.mode));
		row('Win by', select('winBy', WIN_BY, r.winBy));
		row('Goals to win', number('goalsToWin', r.goalsToWin, 1, 20, 1));
		row('Match seconds', number('matchSeconds', r.matchSeconds, 30, 1800, 10));
		row('Serve', select('serve', SERVE, r.serve));
		row('Own goals', select('ownGoals', OWN_GOALS, r.ownGoals));

		const buttons = elem('div', {}, 'display:flex;flex-wrap:wrap;gap:4px;margin:6px 0;');
		/** @param {string} label @param {() => void} fn @param {boolean=} primary */
		const button = (label, fn, primary) => {
			const b = elem('button', { className: 'tbx-btn' + (primary ? ' tbx-primary' : ''), textContent: label });
			b.onclick = fn;
			buttons.appendChild(b);
			return b;
		};
		button('Start', () => game.act('start'), true);
		button('New match', () => game.act('new-match'));
		button('Serve', () => game.act('serve'));
		button('Swap sides', () => game.act('swap-sides'));
		button('Join red', () => game.act('join-red'));
		button('Join blue', () => game.act('join-blue'));
		button('Spectate', () => game.act('spectate'));
		el.appendChild(buttons);

		// ---- the pitch: build, fit, centre ----------------------------------------------
		el.appendChild(elem('div', { className: 'tbx-label', textContent: 'Pitch (metres)' }, 'margin-top:8px;font-size:11px;opacity:0.7;'));
		/** @param {'length'|'width'|'mouthY'} key @param {number} min @param {number} max */
		const dim = (key, min, max) => {
			const node = /** @type {HTMLInputElement} */ (elem('input', { type: 'number', value: String(dims[key]), min: String(min), max: String(max), step: '0.1' }, SELECT_CSS + 'width:64px;'));
			node.onchange = () => (dims[key] = Number(node.value));
			return node;
		};
		const lengthInput = dim('length', 2, 30);
		const widthInput = dim('width', 1.5, 20);
		row('Length', lengthInput);
		row('Width', widthInput);
		row('Gate height', dim('mouthY', 0.5, 2.2));
		const pitchButtons = elem('div', {}, 'display:flex;flex-wrap:wrap;gap:4px;margin:6px 0;');
		el.appendChild(pitchButtons);
		/** @param {string} label @param {() => void} fn */
		const pbutton = (label, fn) => {
			const b = elem('button', { className: 'tbx-btn', textContent: label });
			b.onclick = fn;
			pitchButtons.appendChild(b);
			return b;
		};
		pbutton('Build pitch', () => {
			buildPitch(dims).then((names) => names && api.toast('Football pitch built (' + Object.keys(names).length + ' objects) — press Play'));
		});
		pbutton('Fit pitch', () => {
			const moved = fitPitch(normalizeDims(dims));
			api.toast(moved ? 'Pitch fitted (' + moved + ' objects moved)' : 'No pitch to fit — build one first');
		});
		pbutton('Fit to room', () => {
			const bounds = roomBounds();
			if (!bounds) {
				api.toast('No room bounds from the headset — use the Length / Width sliders');
				return;
			}
			dims.length = Math.max(2, bounds.length - 0.4);
			dims.width = Math.max(1.5, bounds.width - 0.4);
			lengthInput.value = dims.length.toFixed(1);
			widthInput.value = dims.width.toFixed(1);
			fitPitch(normalizeDims(dims), bounds.centre);
			api.toast('Pitch fitted to the room bounds');
		});
		pbutton('Centre on room', () => {
			const anchor = roomAnchor();
			if (!anchor) {
				api.toast('Not colocated — no room anchor to centre on');
				return;
			}
			fitPitch(normalizeDims(dims), [anchor.position[0], 0, anchor.position[2]]);
			api.toast('Pitch centred on the room anchor');
		});

		const timer = setInterval(() => {
			const s = game.state;
			const left = game.secondsLeft();
			status.textContent =
				game.scoreLine() +
				(s.started ? '  ·  playing' : s.outcome ? '  ·  ' + game.outcomeText() : '  ·  menu') +
				(left == null ? '' : '  ·  ' + Math.ceil(left) + 's') +
				'\nred: ' + (s.slots.red.map(game.nameOf).join(', ') || '—') +
				'  ·  blue: ' + (s.slots.blue.map(game.nameOf).join(', ') || '—') +
				'\nlast touch: ' + (s.lastTouch ? game.nameOf(s.lastTouch.by) : '—') +
				'  ·  ' + (game.isAuthority() ? 'authority: me' : 'authority: peer') +
				'  ·  hits: ' + info.hitSource();
		}, 500);
		return () => clearInterval(timer);
	}

	const id = api.registerToolbox({ id: 'match', title: 'Football', width: 280, minW: 240, playMode: true, mount });
	api.registerMenu('Open Football', () => api.openToolbox(id));

	return { buildPitch, fitPitch, roomBounds, roomAnchor, builtNames: () => built, NAMES };
}
