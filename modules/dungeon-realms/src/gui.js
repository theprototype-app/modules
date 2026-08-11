// The game GUI — a DOM overlay owned by the module (the SDK has no UI-panel
// surface for user modules yet; filed in DEVX-REQUESTS.md). Everything is
// inline-styled and self-contained. The start/win menus are keyboard-driven
// (Arrow keys + Enter) because play mode holds pointer lock on desktop —
// they are also mouse-clickable whenever the pointer is free (mobile, tests).

const Z = 900; // above viewport/HUD chrome, below the app's modal/toast tiers

const GEM_SVG =
	'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="vertical-align:-2px">' +
	'<path d="M6 3h12l4 6-10 12L2 9l4-6z" fill="#39e0c0" stroke="#bafff0" stroke-width="1.2"/>' +
	'<path d="M2 9h20M9 3l3 6 3-6M12 21 9 9M12 21l3-12" stroke="#0b6f5c" stroke-width="0.8"/></svg>';

/** @type {HTMLElement | null} */ let root = null;
/** @type {HTMLElement | null} */ let menuCard = null;
/** @type {HTMLElement | null} */ let hudBox = null;
let selectedIndex = 0;
/** @type {{id: string, label: string, disabled?: boolean}[]} */ let menuButtons = [];
/** @type {((id: string) => void) | null} */ let menuAction = null;
/** @type {((event: KeyboardEvent) => void) | null} */ let keyHandler = null;

function ensureRoot() {
	if (root && document.body.contains(root)) return root;
	document.getElementById('dr-gui')?.remove(); // zombie from a live module reload
	root = document.createElement('div');
	root.id = 'dr-gui';
	root.style.cssText =
		'position:fixed;inset:0;pointer-events:none;z-index:' + Z + ';' +
		"font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;";
	document.body.appendChild(root);
	return root;
}

export function destroyGui() {
	hideMenu();
	hideHud();
	root?.remove();
	root = null;
}

// ---- menu (start screen / win screen) ---------------------------------------

function renderMenuButtons() {
	if (!menuCard) return;
	const list = menuCard.querySelector('.dr-buttons');
	if (!list) return;
	list.innerHTML = '';
	menuButtons.forEach((button, index) => {
		const el = document.createElement('button');
		el.type = 'button';
		el.className = 'dr-btn';
		el.dataset.id = button.id;
		el.textContent = button.label;
		const selected = index === selectedIndex && !button.disabled;
		el.style.cssText =
			'display:block;width:100%;margin:6px 0;padding:10px 18px;border-radius:10px;' +
			'font-size:15px;text-align:center;cursor:pointer;transition:transform .06s;' +
			(button.disabled
				? 'background:rgba(255,255,255,.04);color:#6b7280;border:1px solid rgba(255,255,255,.06);cursor:default;'
				: selected
					? 'background:linear-gradient(180deg,#0ea5e9,#0369a1);color:#fff;border:1px solid #7dd3fc;transform:scale(1.03);'
					: 'background:rgba(255,255,255,.08);color:#e5e7eb;border:1px solid rgba(255,255,255,.14);');
		if (!button.disabled) {
			el.onmouseenter = () => {
				selectedIndex = index;
				renderMenuButtons();
			};
			el.onclick = () => menuAction?.(button.id);
		}
		list.appendChild(el);
	});
}

/**
 * Show (or refresh) the menu card. Refresh keeps the selection.
 * @param {{title: string, subtitle?: string, lines?: string[],
 *   buttons: {id: string, label: string, disabled?: boolean}[],
 *   hint?: string, onAction: (id: string) => void}} model
 */
export function showMenu(model) {
	ensureRoot();
	const fresh = !menuCard;
	if (fresh) {
		menuCard = document.createElement('div');
		menuCard.id = 'dr-menu';
		menuCard.style.cssText =
			'position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);min-width:320px;max-width:420px;' +
			'pointer-events:auto;background:rgba(13,18,28,.92);border:1px solid rgba(255,255,255,.14);' +
			'border-radius:16px;padding:22px 26px;color:#e5e7eb;backdrop-filter:blur(8px);' +
			'box-shadow:0 18px 60px rgba(0,0,0,.5);text-align:center;';
		root.appendChild(menuCard);
		selectedIndex = 0;
	}
	const lines = (model.lines ?? []).map((l) => '<div style="margin:2px 0">' + l + '</div>').join('');
	menuCard.innerHTML =
		'<div style="font-size:11px;letter-spacing:.2em;color:#67e8f9;text-transform:uppercase;margin-bottom:6px">Dungeon Realms</div>' +
		'<div class="dr-title" style="font-size:21px;font-weight:700;margin-bottom:4px">' + model.title + '</div>' +
		(model.subtitle ? '<div style="font-size:13px;color:#9ca3af;margin-bottom:8px">' + model.subtitle + '</div>' : '') +
		(lines ? '<div style="font-size:13px;color:#cbd5e1;margin-bottom:8px">' + lines + '</div>' : '') +
		'<div class="dr-buttons" style="margin-top:12px"></div>' +
		'<div style="font-size:11px;color:#64748b;margin-top:12px">' + (model.hint ?? '&#8593;&#8595; select &nbsp;&middot;&nbsp; Enter confirm') + '</div>';
	menuButtons = model.buttons;
	menuAction = model.onAction;
	if (selectedIndex >= menuButtons.length) selectedIndex = 0;
	renderMenuButtons();

	if (!keyHandler) {
		keyHandler = (event) => {
			if (!menuCard) return;
			if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
				const dir = event.code === 'ArrowUp' ? -1 : 1;
				let next = selectedIndex;
				for (let i = 0; i < menuButtons.length; i++) {
					next = (next + dir + menuButtons.length) % menuButtons.length;
					if (!menuButtons[next].disabled) break;
				}
				selectedIndex = next;
				renderMenuButtons();
			} else if (event.code === 'Enter' || event.code === 'NumpadEnter') {
				const button = menuButtons[selectedIndex];
				if (button && !button.disabled) menuAction?.(button.id);
			} else return;
			event.preventDefault();
			event.stopImmediatePropagation();
		};
		window.addEventListener('keydown', keyHandler, true);
	}
}

export function hideMenu() {
	menuCard?.remove();
	menuCard = null;
	menuButtons = [];
	menuAction = null;
	if (keyHandler) {
		window.removeEventListener('keydown', keyHandler, true);
		keyHandler = null;
	}
}

export function menuVisible() {
	return !!menuCard;
}

// ---- HUD ---------------------------------------------------------------------

const CORNERS = {
	'top-left': 'left:16px;top:64px;',
	'top-right': 'right:16px;top:64px;text-align:right;',
	'bottom-left': 'left:16px;bottom:70px;',
	'bottom-right': 'right:16px;bottom:70px;text-align:right;'
};

/**
 * Show/refresh the in-game HUD.
 * @param {{gems?: {have: number, need: number, total: number}, level?: {k: number, n: number, name: string},
 *   players?: {slot: string, name: string, me: boolean}[], objective?: string,
 *   extraProps?: {name: string, value: number}[], corner?: string,
 *   show?: {gems: boolean, level: boolean, players: boolean, objective: boolean}}} model
 */
export function showHud(model) {
	ensureRoot();
	if (!hudBox) {
		hudBox = document.createElement('div');
		hudBox.id = 'dr-hud';
		root.appendChild(hudBox);
	}
	const corner = CORNERS[model.corner ?? 'top-left'] ?? CORNERS['top-left'];
	hudBox.style.cssText =
		'position:absolute;' + corner + 'pointer-events:none;color:#e5e7eb;' +
		'text-shadow:0 1px 3px rgba(0,0,0,.9);font-size:14px;line-height:1.7;';
	const show = model.show ?? { gems: true, level: true, players: true, objective: true };
	let html = '';
	if (show.gems && model.gems)
		html +=
			'<div id="dr-hud-gems" style="font-size:19px;font-weight:700">' + GEM_SVG + ' ' +
			'<span id="dr-gem-count">' + model.gems.have + '</span>' +
			'<span style="color:#94a3b8;font-size:14px"> / ' + model.gems.need + ' needed &middot; ' + model.gems.total + ' hidden</span></div>';
	if (show.level && model.level)
		html +=
			'<div id="dr-hud-level" style="font-size:12px;letter-spacing:.12em;color:#a5b4fc;text-transform:uppercase">LEVEL ' +
			model.level.k + ' / ' + model.level.n + ' &nbsp;&middot;&nbsp; ' + model.level.name + '</div>';
	if (show.players && model.players?.length)
		html +=
			'<div id="dr-hud-players">' +
			model.players
				.map(
					(p) =>
						'<span style="display:inline-block;margin-right:6px;padding:1px 8px;border-radius:99px;font-size:11px;' +
						'background:' + (p.slot === 'p1' ? 'rgba(14,165,233,.25);border:1px solid #38bdf8' : 'rgba(249,115,22,.25);border:1px solid #fb923c') + '">' +
						p.slot.toUpperCase() + ' ' + p.name + (p.me ? ' (you)' : '') + '</span>'
				)
				.join('') +
			'</div>';
	(model.extraProps ?? []).forEach((prop) => {
		html += '<div style="font-size:13px;color:#cbd5e1">' + prop.name + ': <b>' + prop.value + '</b></div>';
	});
	if (show.objective && model.objective)
		html += '<div id="dr-hud-objective" style="font-size:12px;color:#86efac;max-width:280px">' + model.objective + '</div>';
	hudBox.innerHTML = html;
}

export function hideHud() {
	hudBox?.remove();
	hudBox = null;
}
