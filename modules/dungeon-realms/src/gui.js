// The MENU — start / victory, a modal, keyboard-driven, focus-owning dialog
// inside a pointer-locked viewport (Arrow keys + Enter, because play mode holds
// pointer lock on desktop; also mouse-clickable whenever the pointer is free).
//
// 21-C C6.2: this is deliberately NOT a HUD and NOT a toolbox. The in-game HUD
// (gems, level, players, objective) moved to core HUD elements the template
// authors, driven by this module's value/rows nodes bound by element id; the old
// `#dr-hud` DOM and the `drhud` node are gone. The menu stays module DOM until
// core grows a play-mode menu surface ("play-mode menus", filed in
// DEVX-REQUESTS.md), restyled onto the app's card conventions.

const Z = 900; // above viewport/HUD chrome, below the app's modal/toast tiers

/** @type {HTMLElement | null} */ let root = null;
/** @type {HTMLElement | null} */ let menuCard = null;
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
