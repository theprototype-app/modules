// THE VR LEVEL BAR — the level selector a player can reach with a controller laser.
//
// In a headset the DOM menu is invisible. A 30b core draws the template's HUD screens
// (menu, pause, the solved screen and their Start / Next / Menu buttons) on its VR game
// panel (C2), but the level GRID is this module's own DOM kind (menu.js) and whether a core
// panel can draw a module's DOM is not something the module can count on. So in VR the
// board carries its own strip, under the board, facing the player:
//
//   [ ◀ ]  [ Level 7 · Start ]  [ ▶ ]  [ Globe ]  [ ↺ ]
//
// ◀ / ▶ step to the previous / next UNLOCKED level (the same replicated path as the grid),
// the middle cell starts the round when the template's menu or solved screen is up (the
// grid's Continue does the same: the `start` event), the mode cell flips flat <-> globe at
// that mode's continue level, ↺ restarts the level. A trigger PRESS on a cell acts (vrdrag's
// onPress); the laser's hover lights the cell. Hidden outside VR (the desktop has the DOM).
//
// The layout and labels are pure (tested); makeVRBar draws them with THREE on one canvas.

import { MAX_LEVEL, isUnlocked } from './progress.js';

export const CELLS = /** @type {const} */ (['prev', 'level', 'next', 'mode', 'restart']);
/** each cell's share of the bar's width, left to right */
export const WIDTHS = [0.14, 0.38, 0.14, 0.18, 0.16];
/** the bar in metres, relative to the board radius */
export const BAR_W = 1.8;
export const BAR_H = 0.24;

/** which cell a horizontal position u in [0, 1] falls in (-1 outside) */
export function cellAt(u) {
	if (!(u >= 0 && u <= 1)) return -1;
	let edge = 0;
	for (let k = 0; k < WIDTHS.length; k++) {
		edge += WIDTHS[k];
		if (u <= edge + 1e-9) return k;
	}
	return -1;
}
/** a cell's centre u */
export function cellCentre(k) {
	let edge = 0;
	for (let j = 0; j < k; j++) edge += WIDTHS[j];
	return edge + WIDTHS[k] / 2;
}

/**
 * What each cell says and whether it acts.
 * @param {{level: number, mode: string, progress: any, running: boolean, shell: boolean}} v
 * @returns {{id: string, label: string, enabled: boolean}[]}
 */
export function barCells(v) {
	const next = v.level < MAX_LEVEL && isUnlocked(v.progress, v.mode, v.level + 1);
	const startable = v.shell && !v.running;
	return [
		{ id: 'prev', label: '◀', enabled: v.level > 1 },
		{ id: 'level', label: 'Level ' + v.level + (startable ? '  ·  Start' : ''), enabled: startable },
		{ id: 'next', label: '▶', enabled: next },
		{ id: 'mode', label: v.mode === '3d' ? 'Flat' : 'Globe', enabled: true },
		{ id: 'restart', label: '↺', enabled: true }
	];
}

/** @param {any} THREE @param {number} radius the board radius (the bar scales with it) */
export function makeVRBar(THREE, radius) {
	const w = BAR_W * radius;
	const h = BAR_H * radius;
	/** @type {any} */ let canvas = null;
	/** @type {any} */ let texture = null;
	if (typeof document !== 'undefined') {
		canvas = document.createElement('canvas');
		canvas.width = 1024;
		canvas.height = Math.round((1024 * BAR_H) / BAR_W);
		texture = new THREE.CanvasTexture(canvas);
		texture.colorSpace = THREE.SRGBColorSpace ?? texture.colorSpace;
	}
	const mesh = new THREE.Mesh(
		new THREE.PlaneGeometry(w, h),
		new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false })
	);
	mesh.name = 'untangle-vrbar';
	mesh.renderOrder = 2;
	let lastKey = '';

	/** @param {{id: string, label: string, enabled: boolean}[]} cells @param {number} hover */
	function draw(cells, hover) {
		const key = JSON.stringify(cells) + hover;
		if (!canvas || key === lastKey) return;
		lastKey = key;
		const g = canvas.getContext('2d');
		const W = canvas.width;
		const H = canvas.height;
		g.clearRect(0, 0, W, H);
		let x = 0;
		cells.forEach((c, k) => {
			const cw = WIDTHS[k] * W;
			const pad = 6;
			g.fillStyle = k === hover && c.enabled ? 'rgba(251,191,36,0.92)' : c.enabled ? 'rgba(30,41,59,0.9)' : 'rgba(30,41,59,0.45)';
			g.beginPath();
			g.roundRect?.(x + pad, pad, cw - 2 * pad, H - 2 * pad, 18);
			if (!g.roundRect) g.rect(x + pad, pad, cw - 2 * pad, H - 2 * pad);
			g.fill();
			g.fillStyle = k === hover && c.enabled ? '#0f172a' : c.enabled ? '#e5e9f0' : 'rgba(229,233,240,0.35)';
			g.font = 'bold ' + (c.id === 'level' ? 44 : 52) + 'px system-ui, sans-serif';
			g.textAlign = 'center';
			g.textBaseline = 'middle';
			g.fillText(c.label, x + cw / 2, H / 2 + 2);
			x += cw;
		});
		texture.needsUpdate = true;
	}

	return {
		mesh,
		draw,
		/** the cell a world ray (THREE.Raycaster) hits, or -1 */
		hit(raycaster) {
			if (!mesh.visible) return -1;
			const hits = raycaster.intersectObject(mesh, false);
			const uv = hits[0]?.uv;
			return uv ? cellAt(uv.x) : -1;
		},
		/** a cell's centre in the mesh's local frame (the flights aim at it) */
		cellLocal: (k) => new THREE.Vector3((cellCentre(k) - 0.5) * w, 0, 0),
		dispose() {
			mesh.geometry.dispose();
			mesh.material.dispose();
			texture?.dispose();
		}
	};
}
