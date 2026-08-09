// Shared helpers for the module test-flights. Each test is a plain node script
// driving real Chromium contexts against a running app — same shape as the core
// repo's tests/e2e, so recipes port between them. See README.md.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'https://localhost:5188/';

// The app treats a host that is not *.app / *.io as LOCAL DEV and points PeerJS
// at a local :9001 signaling server that usually is not running — so two-peer
// tests against a lane on localhost must seed a real signaling server.
const PEER_CONFIG =
	process.env.PEER_CONFIG ||
	JSON.stringify({
		mode: 'custom',
		custom: { host: 'peerjs.theprototype.app', port: 443, path: '/peerjs', secure: true }
	});

const ZIP_DIR = path.join(__dirname, '..');

let failures = 0;

/** @param {boolean} ok @param {string} label */
function check(ok, label) {
	console.log((ok ? 'PASS ' : 'FAIL ') + label);
	if (!ok) failures++;
}

function launch(options = {}) {
	const noThrottle = [
		'--disable-background-timer-throttling',
		'--disable-renderer-backgrounding',
		'--disable-backgrounding-occluded-windows'
	];
	const { args = [], ...rest } = options;
	return chromium.launch({ headless: true, args: [...noThrottle, ...args], ...rest });
}

/** Fresh context + page with the debug hook on, waited through hydration. */
async function setupPage(browser, name, options = {}) {
	const ctx = await browser.newContext({ ignoreHTTPSErrors: true, ...(options.context ?? {}) });
	await ctx.addInitScript((peerConfig) => {
		localStorage.setItem('debugStores', 'true');
		localStorage.setItem('hasSeenDisclaimer', 'true');
		localStorage.setItem('hasSeenWelcome', 'true');
		if (peerConfig) localStorage.setItem('peerServerConfig', peerConfig);
	}, PEER_CONFIG);
	if (options.storage) {
		await ctx.addInitScript((extra) => {
			for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, String(v));
		}, options.storage);
	}
	const page = await ctx.newPage();
	page.on('pageerror', (err) => console.log(`[${name} pageerror] ` + err.stack));
	await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
	await page.waitForTimeout(4000);
	await page.waitForFunction(() => window.__stores && !!window.__stores.moduleSDK, { timeout: 30000 });
	const id = await page.evaluate(
		() => new Promise((r) => window.__stores.peers.subscribe((p) => r(p?.peer?.id))())
	);
	console.log(name + ' id: ' + id);
	return { ctx, page, id };
}

/**
 * Install `<id>.zip` through the REAL manager UI (Modules ▸ User ▸ file input)
 * — the whole point of a test-flight is that nothing about the install is
 * stubbed. Run `npm run pack -- <id>` first.
 */
async function installModule(peer, zipName, moduleId = zipName) {
	const id = moduleId;
	const zip = path.join(ZIP_DIR, zipName + '.zip');
	if (!fs.existsSync(zip))
		throw new Error('missing ' + path.basename(zip) + ' — run: npm run pack -- ' + zipName);
	await openModules(peer.page);
	await peer.page.locator('#install-module-zip').setInputFiles({
		name: zipName + '.module.zip',
		mimeType: 'application/zip',
		buffer: fs.readFileSync(zip)
	});
	await eventually(() => loadedIds(peer.page), (ids) => ids.includes(id), id + ' installs from its real zip', 20000);
	await peer.page.evaluate(() => window.__stores.modulesOpen.set(false));
	await peer.page.waitForTimeout(300);
}

/**
 * Open Modules ▸ User. The Core/User switches are `role="tab"`, NOT buttons —
 * core's own user-modules suite still asks for a button here and times out.
 */
async function openModules(page) {
	await page.evaluate(() => window.__stores.modulesOpen.set(true));
	await page.waitForTimeout(400);
	await page.getByRole('tab', { name: 'User', exact: true }).click();
	await page.waitForTimeout(200);
}

const loadedIds = (page) =>
	page.evaluate(() => window.__stores.moduleSDK.loadedModules.map((m) => m.id));

/** Connect `from` to `to` (approve on `to`), then let the mesh settle. */
async function connect(from, to, settleMs = 9000) {
	await from.page.locator('input[placeholder="Enter peer ID to connect"]').fill(to.id);
	await from.page.getByRole('button', { name: 'Connect', exact: true }).click();
	await to.page.getByRole('button', { name: 'Approve' }).click({ timeout: 30000 });
	await from.page.waitForTimeout(settleMs);
}

/** Run a scene command (`/create Box`) the way the app's own UI does. */
function sceneCommand(page, command) {
	return page.evaluate(
		(command) => window.__stores.commandsHandler.sceneCommand(command),
		command
	);
}

/** Names of everything directly under the replicated objects root. */
function objectNames(page) {
	return page.evaluate(
		() =>
			new Promise((r) =>
				window.__stores.objectsGroup.subscribe((g) => r((g?.children ?? []).map((c) => c.name)))()
			)
	);
}

/** The live toast texts. */
function toasts(page) {
	return page.evaluate(
		() => new Promise((r) => window.__stores.toastStore.subscribe((t) => r(JSON.stringify(t)))())
	);
}

/** Poll `fn` until `predicate` holds; records a PASS/FAIL check. */
async function eventually(fn, predicate, label, timeout = 10000) {
	const start = Date.now();
	let last;
	while (Date.now() - start < timeout) {
		last = await fn();
		if (predicate(last)) return check(true, label);
		await new Promise((r) => setTimeout(r, 400));
	}
	console.log('  last: ' + JSON.stringify(last));
	check(false, label);
}

/** Screen pixel of a world point on that page's camera (for real clicks). */
function projectPoint(page, world) {
	return page.evaluate(
		(world) =>
			new Promise((resolve) => {
				window.__stores.globalScene.subscribe((scene) => {
					window.__stores.globalCamera.subscribe((camera) => {
						const v = scene.position.clone().set(world[0], world[1], world[2]).project(camera);
						resolve({
							x: (v.x * 0.5 + 0.5) * window.innerWidth,
							y: (-v.y * 0.5 + 0.5) * window.innerHeight
						});
					})();
				})();
			}),
		world
	);
}

/** Close up and exit with the right code. */
async function finish(browser) {
	await browser.close();
	console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
	process.exit(failures === 0 ? 0 : 1);
}

/** Wrap a test body so crashes exit non-zero. */
function run(body) {
	body().catch((error) => {
		console.error('SCRIPT FAILED:', error.stack || error.message);
		process.exit(1);
	});
}

module.exports = {
	URL,
	openModules,
	check,
	launch,
	setupPage,
	installModule,
	loadedIds,
	connect,
	sceneCommand,
	objectNames,
	toasts,
	eventually,
	projectPoint,
	finish,
	run
};
