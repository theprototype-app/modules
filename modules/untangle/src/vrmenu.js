// THE VR LEVEL PICKER — roadmap 31 U3 + U5. The user on a Quest: "pick level does not show in
// vr, i cannot select/switch in menu between globe and 2d board", "I miss 3d globe option".
//
// The template's menu screen puts the mode toggle and the 30-level grid in the module's own DOM
// kind (menu.js, `mod-untangle-levels`). A headset sees no DOM, and core's VR game panel (30b
// C2) draws only core kinds — so in VR that part of the menu was a blank hole: title, Start,
// nothing to pick. This is the same content drawn with THREE on one canvas:
//
//        Board   [ 3D globe ]  [ 2D board ]
//        [1] [2] [3] [4] [5] [6]
//        ...                       (30 cells, 6 x 5: locked / open / next / solved / current)
//        [ Continue · Level N ]  [ Close ]
//
// Two placements (index.js decides): OVER core's VR panel exactly where the menu screen leaves
// the module element's hole (so the menu in the headset reads like the desktop menu), and ON
// the board, opened from the VR bar's "Levels" cell during a round. A trigger press on a cell
// acts through the same replicated paths as the DOM grid; the laser's hover lights the cell.
//
// The layout, the cell states and the panel-hole geometry are pure (test/vrmenu.test.mjs);
// makeVRMenu draws them.

import { MAX_LEVEL, isUnlocked, isSolvedAny, continueLevel } from './progress.js';

export const COLS = 6;
export const ROWS = Math.ceil(MAX_LEVEL / COLS);
/** the canvas, px (the aspect of the menu screen's module element: 480 x 330 stage px) */
export const PX_W = 960;
export const PX_H = 660;
const PAD = 24;
const HEAD_H = 92; // the mode row
const FOOT_H = 96; // Continue / Close
const GAP = 12;

/**
 * Every pressable rect of the picker, in canvas px: the two mode buttons, the 30 cells and the
 * footer. Pure. @param {{close?: boolean}} [opts] close: draw a Close button (the on-board placement)
 * @returns {{id: string, x: number, y: number, w: number, h: number}[]}
 */
export function pickerLayout(opts = {}) {
	/** @type {{id: string, x: number, y: number, w: number, h: number}[]} */
	const out = [];
	const labelW = 150;
	const modeW = (PX_W - PAD * 2 - labelW - GAP) / 2;
	out.push({ id: 'mode:3d', x: PAD + labelW, y: PAD, w: modeW - GAP / 2, h: HEAD_H - PAD });
	out.push({ id: 'mode:2d', x: PAD + labelW + modeW + GAP / 2, y: PAD, w: modeW - GAP / 2, h: HEAD_H - PAD });
	const gridTop = HEAD_H + GAP;
	const gridH = PX_H - gridTop - FOOT_H - GAP;
	const cw = (PX_W - PAD * 2 - GAP * (COLS - 1)) / COLS;
	const ch = (gridH - GAP * (ROWS - 1)) / ROWS;
	for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
		const c = (lvl - 1) % COLS;
		const r = Math.floor((lvl - 1) / COLS);
		out.push({ id: 'level:' + lvl, x: PAD + c * (cw + GAP), y: gridTop + r * (ch + GAP), w: cw, h: ch });
	}
	const fy = PX_H - FOOT_H + GAP / 2;
	const fh = FOOT_H - PAD;
	if (opts.close) {
		const closeW = 220;
		out.push({ id: 'continue', x: PAD, y: fy, w: PX_W - PAD * 2 - closeW - GAP, h: fh });
		out.push({ id: 'close', x: PX_W - PAD - closeW, y: fy, w: closeW, h: fh });
	} else out.push({ id: 'continue', x: PAD, y: fy, w: PX_W - PAD * 2, h: fh });
	return out;
}

/** the id at canvas px (x, y), or null @param {ReturnType<typeof pickerLayout>} layout */
export function pickerHit(layout, x, y) {
	for (const r of layout) if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.id;
	return null;
}

/**
 * What every rect says and whether it acts. Pure.
 * @param {{mode: string, level: number, progress: any}} v
 * @param {string[]} ids the layout's ids
 * @returns {Record<string, {label: string, enabled: boolean, state: string}>}
 */
export function pickerCells(v, ids) {
	const next = continueLevel(v.progress, v.mode);
	/** @type {Record<string, {label: string, enabled: boolean, state: string}>} */
	const out = {};
	for (const id of ids) {
		if (id === 'mode:3d' || id === 'mode:2d') {
			const m = id.slice(5);
			const on = m === v.mode;
			out[id] = { label: m === '3d' ? '3D globe' : '2D board', enabled: !on, state: on ? 'on' : 'off' };
		} else if (id.startsWith('level:')) {
			const lvl = Number(id.slice(6));
			const open = isUnlocked(v.progress, v.mode, lvl);
			const state = !open ? 'locked' : lvl === v.level ? 'current' : isSolvedAny(v.progress, lvl) ? 'solved' : lvl === next ? 'next' : 'open';
			out[id] = { label: String(lvl), enabled: open, state };
		} else if (id === 'continue') out[id] = { label: 'Continue · Level ' + next, enabled: true, state: 'go' };
		else if (id === 'close') out[id] = { label: 'Close', enabled: true, state: 'quiet' };
	}
	return out;
}

// ---- the hole in core's VR panel (the menu screen's module element) -------------------------
// Core's C2 panel draws a menu screen CROPPED to the union of its elements (+36 px, at least
// 720 px wide) over the 1280 x 720 stage, with a 96 px footer of its own under it
// (vrGamePanel.panelCrop / FOOTER_H). The same arithmetic over the template's own menu screen
// says where the module element sits on that panel — and the panel's world size says whether
// the panel is showing THAT screen at all (a solved card, a pause card or another screen crops
// to a different shape: then there is no hole to fill and the picker stays off).

const STAGE_W = 1280;
const STAGE_H = 720;
const CROP_PAD = 36;
const MIN_CROP_W = 720;
const PANEL_FOOTER = 96;

/** an element's rect on the 1280 x 720 stage (the HUD's 9-grid anchors) */
export function stageRect(el) {
	const w = Number(el.w) || 0;
	const h = Number(el.h) || 0;
	const x = Number(el.x) || 0;
	const y = Number(el.y) || 0;
	const a = String(el.anchor ?? 'top-left');
	const col = a.endsWith('left') ? 0 : a.endsWith('right') ? 2 : 1;
	const row = a.startsWith('top') ? 0 : a.startsWith('bottom') ? 2 : 1;
	const left = col === 0 ? x : col === 2 ? STAGE_W - w - x : STAGE_W / 2 + x - w / 2;
	const top = row === 0 ? y : row === 2 ? STAGE_H - h - y : STAGE_H / 2 + y - h / 2;
	return { left, top, w, h };
}

/** the crop core's panel draws for a screen (elements of core kinds only: the module kind has no VR form) */
export function menuCrop(screen) {
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const el of screen?.elements ?? []) {
		if (String(el.kind).startsWith('mod-')) continue;
		const r = stageRect(el);
		x0 = Math.min(x0, r.left);
		y0 = Math.min(y0, r.top);
		x1 = Math.max(x1, r.left + r.w);
		y1 = Math.max(y1, r.top + r.h);
	}
	if (!Number.isFinite(x0)) return { x: 0, y: 0, w: STAGE_W, h: STAGE_H };
	x0 = Math.max(0, x0 - CROP_PAD);
	y0 = Math.max(0, y0 - CROP_PAD);
	x1 = Math.min(STAGE_W, x1 + CROP_PAD);
	y1 = Math.min(STAGE_H, y1 + CROP_PAD);
	let w = x1 - x0;
	if (w < MIN_CROP_W) {
		const cx = (x0 + x1) / 2;
		w = MIN_CROP_W;
		x0 = Math.min(Math.max(0, cx - w / 2), STAGE_W - w);
	}
	return { x: x0, y: y0, w, h: Math.max(120, y1 - y0) };
}

/**
 * Where element `id` of `screen` sits on core's panel mesh (PlaneGeometry(meshW, meshH),
 * centred), in the mesh's local metres — or null when the mesh's shape is not this screen's
 * (it shows something else). Pure.
 * @param {any} screen @param {string} id @param {number} meshW @param {number} meshH
 * @returns {{x: number, y: number, w: number, h: number} | null}
 */
export function panelHole(screen, id, meshW, meshH) {
	const el = (screen?.elements ?? []).find((/** @type {any} */ e) => e.id === id);
	if (!el || !(meshW > 0) || !(meshH > 0)) return null;
	const crop = menuCrop(screen);
	const aspect = (crop.h + PANEL_FOOTER) / crop.w;
	if (Math.abs(meshH / meshW - aspect) > aspect * 0.01) return null;
	const k = meshW / crop.w; // metres per stage px on that panel
	const r = stageRect(el);
	const cx = r.left + r.w / 2 - crop.x;
	const cy = r.top + r.h / 2 - crop.y;
	return { x: cx * k - meshW / 2, y: meshH / 2 - cy * k, w: r.w * k, h: r.h * k };
}

// ---- the drawing ------------------------------------------------------------------------------

const AMBER = '#fbbf24';
const GREEN = '#3ee08f';

/** @param {any} THREE */
export function makeVRMenu(THREE) {
	/** @type {any} */ let canvas = null;
	/** @type {any} */ let texture = null;
	if (typeof document !== 'undefined') {
		canvas = document.createElement('canvas');
		canvas.width = PX_W;
		canvas.height = PX_H;
		texture = new THREE.CanvasTexture(canvas);
		texture.colorSpace = THREE.SRGBColorSpace ?? texture.colorSpace;
	}
	// unit plane, scaled to its placement; drawn over the scene AND over core's panel (1000)
	const mesh = new THREE.Mesh(
		new THREE.PlaneGeometry(1, 1),
		new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
	);
	mesh.name = 'untangle-vrmenu';
	mesh.renderOrder = 1001;
	mesh.frustumCulled = false;
	mesh.visible = false;
	mesh.userData.localOnly = true;
	let layout = pickerLayout();
	let closeable = false;
	let lastKey = '';

	/** @param {{mode: string, level: number, progress: any}} v @param {string | null} hover @param {boolean} close */
	function draw(v, hover, close) {
		if (close !== closeable) {
			closeable = close;
			layout = pickerLayout({ close });
		}
		const cells = pickerCells(v, layout.map((r) => r.id));
		const key = JSON.stringify([cells, hover, close]);
		if (!canvas || key === lastKey) return;
		lastKey = key;
		const g = canvas.getContext('2d');
		g.clearRect(0, 0, PX_W, PX_H);
		round(g, 0, 0, PX_W, PX_H, 28);
		g.fillStyle = 'rgba(13, 17, 28, 0.94)';
		g.fill();
		g.lineWidth = 3;
		g.strokeStyle = 'rgba(251, 191, 36, 0.45)';
		g.stroke();
		g.textAlign = 'left';
		g.textBaseline = 'middle';
		g.fillStyle = '#cbd5e1';
		g.font = '600 32px system-ui, sans-serif';
		g.fillText('Board', PAD + 8, PAD + (HEAD_H - PAD) / 2);
		for (const r of layout) {
			const c = cells[r.id];
			const hot = hover === r.id && c.enabled;
			const on = c.state === 'on';
			const bg = hot
				? 'rgba(251,191,36,0.95)'
				: on || c.state === 'go'
					? c.state === 'go' ? 'rgba(217,119,6,0.95)' : AMBER
					: c.state === 'locked'
						? 'rgba(15,23,42,0.6)'
						: c.state === 'current'
							? 'rgba(251,191,36,0.28)'
							: c.state === 'solved'
								? 'rgba(62,224,143,0.16)'
								: 'rgba(30,41,59,0.95)';
			round(g, r.x, r.y, r.w, r.h, 14);
			g.fillStyle = bg;
			g.fill();
			g.lineWidth = c.state === 'next' ? 4 : 2;
			g.strokeStyle = c.state === 'next' ? AMBER : 'rgba(148,163,184,0.3)';
			g.stroke();
			g.textAlign = 'center';
			g.fillStyle = hot || on ? '#1a1305' : c.state === 'locked' ? '#475569' : '#f1f5f9';
			g.font = (r.id.startsWith('level:') ? '700 34px' : '700 30px') + ' system-ui, sans-serif';
			g.fillText(c.label, r.x + r.w / 2, r.y + r.h / 2 + 2); // a locked level: its number, dimmed
			if (c.state === 'solved' && !hot) {
				g.fillStyle = GREEN;
				g.font = '700 22px system-ui, sans-serif';
				g.fillText('✓', r.x + r.w - 16, r.y + 16);
			}
		}
		texture.needsUpdate = true;
	}

	return {
		mesh,
		draw,
		/** the id a world ray (THREE.Raycaster) hits, or null */
		hit(raycaster) {
			if (!mesh.visible) return null;
			const uv = raycaster.intersectObject(mesh, false)[0]?.uv;
			return uv ? pickerHit(layout, uv.x * PX_W, (1 - uv.y) * PX_H) : null;
		},
		/** the WORLD point at the centre of rect `id` (the flights aim at it) */
		worldOf(id) {
			const r = layout.find((q) => q.id === id);
			if (!r) return null;
			mesh.updateMatrixWorld(true);
			return mesh.localToWorld(new THREE.Vector3((r.x + r.w / 2) / PX_W - 0.5, 0.5 - (r.y + r.h / 2) / PX_H, 0)).toArray();
		},
		ids: () => layout.map((r) => r.id),
		dispose() {
			mesh.geometry.dispose();
			mesh.material.dispose();
			texture?.dispose();
		}
	};
}

/** @param {CanvasRenderingContext2D} g */
function round(g, x, y, w, h, r) {
	g.beginPath();
	if (g.roundRect) g.roundRect(x, y, w, h, r);
	else g.rect(x, y, w, h);
}
