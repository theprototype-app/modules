// THE MENU'S MODULE DOM — two HUD element kinds (`api.registerHudElement`), because the core
// HUD cannot express either: a 30-cell grid whose cells lock, unlock and highlight from
// LOCAL progress (a button's `enabled`/label are authored, and no node carries per-player
// state into 30 of them), and a time readout formatted m:ss with an em dash for "no best".
// Everything else on the menu — the panel, the title, Start, Pause, the solved screen — is
// the def's ordinary HUD, so a peer without the module still sees the game's shell and the
// kinds simply do not render (core preserves-and-skips an unknown kind).
//
// Plain DOM, inline styles (a module ships no stylesheet), no THREE. `view()` is read on
// every render, so the element always shows the module's current state; index.js calls the
// returned `refreshAll()` when progress, the level or the mode change.

import { MAX_LEVEL, isUnlocked, isSolved, continueLevel, bestOf, formatTime } from './progress.js';

const AMBER = '#fbbf24';
const GREEN = '#3ee08f';
const LOCK_SVG =
	'<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M5 7V5a3 3 0 1 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-5A1.5 1.5 0 0 1 4.5 7H5zm1.5 0h3V5a1.5 1.5 0 1 0-3 0v2z"/></svg>';
const CHECK_SVG = '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M6.2 11.6 2.8 8.2l1.1-1.1 2.3 2.3 5.9-5.9 1.1 1.1z"/></svg>';

/** @param {HTMLElement} el @param {Record<string, string>} css */
const style = (el, css) => Object.assign(el.style, css);

/** the editor's artboard shows the kind as a PREVIEW: no presses (the runtime layer is #hud-layer) */
const inRuntimeLayer = (/** @type {HTMLElement} */ el) => !!el.closest?.('#hud-layer');

/**
 * @param {{
 *   view: () => {mode: string, modes: string[], level: number, progress: any, running: boolean},
 *   pickLevel: (level: number) => void,
 *   pickMode: (mode: string) => void,
 *   continueGame: () => void,
 *   resetProgress: () => void,
 *   time: () => {ms: number | null, best: number | null, newBest: boolean, solved: boolean}
 * }} ctx
 */
export function makeMenuKinds(ctx) {
	/** @type {Set<() => void>} */
	const renders = new Set();

	/** the LEVELS element: mode toggle, the 30-cell grid, Continue, Reset progress */
	function mountLevels(/** @type {HTMLElement} */ el) {
		const root = document.createElement('div');
		root.className = 'ut-levels';
		style(root, { display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', height: '100%', boxSizing: 'border-box', color: '#e5e9f0', font: 'inherit', userSelect: 'none' });
		el.appendChild(root);
		let confirming = false;

		const button = (label, css = {}) => {
			const b = document.createElement('button');
			b.type = 'button';
			b.innerHTML = label;
			style(b, { font: 'inherit', fontSize: '13px', fontWeight: '600', border: '1px solid rgba(148,163,184,0.25)', borderRadius: '8px', background: 'rgba(30,41,59,0.9)', color: '#e5e9f0', cursor: 'pointer', pointerEvents: 'auto', padding: '6px 10px', ...css });
			return b;
		};

		function render() {
			const live = inRuntimeLayer(el);
			const v = ctx.view();
			root.replaceChildren();
			style(root, { pointerEvents: live ? 'auto' : 'none' });

			// ---- mode ----
			if (v.modes.length > 1) {
				const modes = document.createElement('div');
				modes.className = 'ut-modes';
				style(modes, { display: 'flex', gap: '6px', justifyContent: 'center' });
				for (const m of v.modes) {
					const on = m === v.mode;
					const b = button(m === '2d' ? '2D board' : '3D globe', {
						flex: '1',
						background: on ? AMBER : 'rgba(30,41,59,0.9)',
						color: on ? '#1a1305' : '#e5e9f0',
						borderColor: on ? AMBER : 'rgba(148,163,184,0.25)'
					});
					b.dataset.mode = m;
					b.setAttribute('aria-pressed', String(on));
					b.onclick = () => live && !on && ctx.pickMode(m);
					modes.appendChild(b);
				}
				root.appendChild(modes);
			}

			// ---- the grid ----
			const grid = document.createElement('div');
			grid.className = 'ut-grid';
			style(grid, { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px', flex: '1' });
			const next = continueLevel(v.progress, v.mode);
			for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
				const open = isUnlocked(v.progress, v.mode, lvl);
				const solved = isSolved(v.progress, v.mode, lvl);
				const current = lvl === v.level;
				const isNext = open && lvl === next;
				const cell = document.createElement('button');
				cell.type = 'button';
				cell.className = 'ut-cell';
				cell.dataset.level = String(lvl);
				cell.dataset.state = !open ? 'locked' : solved ? 'solved' : isNext ? 'next' : 'open';
				if (current) cell.dataset.current = '1';
				const best = bestOf(v.progress, v.mode, lvl);
				cell.title = !open ? 'Level ' + lvl + ' — locked: solve level ' + (lvl - 1) + ' first' : 'Level ' + lvl + (best ? ' — best ' + formatTime(best) : '');
				cell.innerHTML = open ? '<span>' + lvl + '</span>' + (solved ? '<span style="position:absolute;top:2px;right:3px;color:' + GREEN + '">' + CHECK_SVG + '</span>' : '') : LOCK_SVG;
				style(cell, {
					position: 'relative',
					font: 'inherit',
					fontSize: '14px',
					fontWeight: '700',
					minHeight: '30px',
					borderRadius: '8px',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					pointerEvents: live && open ? 'auto' : 'none',
					cursor: open ? 'pointer' : 'default',
					border: '1px solid ' + (isNext ? AMBER : current ? 'rgba(251,191,36,0.55)' : 'rgba(148,163,184,0.2)'),
					boxShadow: isNext ? '0 0 0 2px rgba(251,191,36,0.35), 0 0 14px rgba(251,191,36,0.35)' : 'none',
					background: !open ? 'rgba(15,23,42,0.55)' : current ? 'rgba(251,191,36,0.22)' : solved ? 'rgba(62,224,143,0.12)' : 'rgba(30,41,59,0.9)',
					color: !open ? '#475569' : '#e5e9f0'
				});
				if (!open) {
					cell.disabled = true;
					cell.setAttribute('aria-disabled', 'true');
				} else cell.onclick = () => live && ctx.pickLevel(lvl);
				grid.appendChild(cell);
			}
			root.appendChild(grid);

			// ---- Continue / Reset ----
			const foot = document.createElement('div');
			style(foot, { display: 'flex', gap: '8px', alignItems: 'center' });
			if (!confirming) {
				const cont = button('Continue · Level ' + next, { flex: '1', background: 'rgba(217,119,6,0.95)', borderColor: 'rgba(251,191,36,0.6)', color: '#fff' });
				cont.className = 'ut-continue';
				cont.onclick = () => live && ctx.continueGame();
				const reset = button('Reset progress', { background: 'transparent', color: '#94a3b8' });
				reset.className = 'ut-reset';
				reset.onclick = () => {
					if (!live) return;
					confirming = true;
					render();
				};
				foot.append(cont, reset);
			} else {
				const q = document.createElement('span');
				q.textContent = 'Reset ALL progress in both modes?';
				style(q, { flex: '1', fontSize: '13px', color: '#fca5a5' });
				const yes = button('Reset', { background: '#b91c1c', borderColor: '#ef4444', color: '#fff' });
				yes.className = 'ut-reset-yes';
				yes.onclick = () => {
					confirming = false;
					ctx.resetProgress();
				};
				const no = button('Keep', {});
				no.className = 'ut-reset-no';
				no.onclick = () => {
					confirming = false;
					render();
				};
				foot.append(q, yes, no);
			}
			root.appendChild(foot);
		}
		render();
		renders.add(render);
		return {
			update: () => render(),
			destroy() {
				renders.delete(render);
				root.remove();
			}
		};
	}

	/** the TIME element: 'play' = the running clock + best, 'result' = this solve vs best */
	function mountStats(/** @type {HTMLElement} */ el, /** @type {any} */ element) {
		const root = document.createElement('div');
		root.className = 'ut-stats';
		style(root, { font: 'inherit', width: '100%', height: '100%', display: 'flex', alignItems: 'center', gap: '14px', color: '#cbd5e1', fontSize: '14px', fontVariantNumeric: 'tabular-nums', pointerEvents: 'none' });
		el.appendChild(root);
		let show = element?.show === 'result' ? 'result' : 'play';
		const render = () => {
			const t = ctx.time();
			if (show === 'result') {
				style(root, { justifyContent: 'center', fontSize: '16px' });
				root.innerHTML =
					'<span>Time <b style="color:#fff">' + formatTime(t.ms) + '</b></span>' +
					'<span>Best <b style="color:' + AMBER + '">' + formatTime(t.best) + '</b></span>' +
					(t.newBest ? '<span class="ut-newbest" style="color:' + GREEN + ';font-weight:700">NEW BEST</span>' : '');
			} else {
				style(root, { justifyContent: 'flex-start', fontSize: '14px' });
				root.innerHTML =
					'<span>⏱ <b class="ut-time" style="color:#fff">' + formatTime(t.ms) + '</b></span>' +
					'<span style="color:#94a3b8">best <b style="color:' + AMBER + '">' + formatTime(t.best) + '</b></span>';
			}
		};
		render();
		const timer = setInterval(render, 250);
		renders.add(render);
		return {
			update(/** @type {any} */ next) {
				show = next?.show === 'result' ? 'result' : 'play';
				render();
			},
			destroy() {
				clearInterval(timer);
				renders.delete(render);
				root.remove();
			}
		};
	}

	return {
		levels: {
			label: 'Untangle levels',
			summary: 'Mode, the 30-level grid with locks, Continue and Reset progress (per player).',
			icon: 'grid',
			defaultSize: { w: 480, h: 300 },
			interactive: true,
			mount: mountLevels
		},
		stats: {
			label: 'Untangle time',
			summary: 'The solve clock and your best for this level (m:ss).',
			icon: 'clock',
			defaultSize: { w: 240, h: 24 },
			defaults: { show: 'play' },
			fields: [{ key: 'show', kind: 'select', label: 'show', options: ['play', 'result'] }],
			mount: mountStats
		},
		refreshAll() {
			for (const r of renders) {
				try {
					r();
				} catch {}
			}
		}
	};
}
