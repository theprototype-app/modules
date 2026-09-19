// music-jam-room test-flight (#23 D3): the Jam Room template's whole path, on the modules
// that make it. The room is built exactly as scripts/author-templates.cjs builds it - the
// modules' own menus - exported through the REAL .tpscene path, then imported on a peer
// that HAS the modules (audible, cabled, the same room) and on one that does NOT (the
// prompt names them, because the requirement is derived from the device kinds alone: the
// room holds no flow node).
const h = require('./helpers.cjs');
const inPage = (page, body, arg) =>
	page.evaluate(([src, a]) => Object.getPrototypeOf(async function () {}).constructor('s', 'ad', 'ap', 'arg', src)(window.__stores, window.__stores.audioDevices, window.__stores.audioPatch, a), [body, arg ?? null]);
const SILENT = 0.001;
/** a SECOND module on a page the helper already used: the authoring script's own sequence -
 * open the manager, the User tab, the real zip, wait for the id, close */
const installZip = async (peer, id) => {
	const fs = require('fs');
	const path = require('path');
	const zip = path.join(__dirname, '..', id + '.zip');
	await peer.page.evaluate(() => window.__stores.modulesOpen.set(true));
	await peer.page.waitForTimeout(400);
	await peer.page.getByRole('tab', { name: /^User/ }).click();
	await peer.page.waitForTimeout(200);
	await peer.page.locator('#install-module-zip').setInputFiles({ name: id + '.zip', mimeType: 'application/zip', buffer: fs.readFileSync(zip) });
	await peer.page.waitForFunction((want) => window.__stores.moduleSDK.loadedModules.some((m) => m.id === want), id, { timeout: 20000 });
	await peer.page.evaluate(() => window.__stores.modulesOpen.set(false));
	await peer.page.waitForTimeout(300);
	h.check(true, id + ' installs from its real zip (second module on the page)');
};
const menu = (page, label, moduleId) =>
	inPage(page, "let items; s.moduleSDK.moduleMenuItems.subscribe((v) => (items = v))(); const hit = items.find((it) => it.label === arg.label && it.moduleId === arg.moduleId); if (!hit) return false; hit.action(); return true", { label, moduleId });
const roomOf = (page) => inPage(page, "let g; s.objectsGroup.subscribe((v) => (g = v))(); const kinds = {}; let n = 0; g.traverse((o) => { const k = o.userData?.device?.kind; if (k) { n++; kinds[k] = (kinds[k] || 0) + 1; } }); let p; ap.patch.subscribe((v) => (p = v))(); return { devices: n, kinds, cables: p.cables.length, built: ad.devicesDebug().built.filter((b) => b.builtAs !== '__placeholder').length, placeholders: ad.devicesDebug().built.filter((b) => b.builtAs === '__placeholder').length }");

h.run(async () => {
	const browser = await h.launch({ args: h.AUDIO_ARGS });
	const A = await h.setupPage(browser, 'A', { audio: true });
	await h.installModule(A, 'music-lab');
	await installZip(A, 'music-fx');
	const page = A.page;

	console.log('\n=== 1. the room, built the way the template is authored ===');
	const ran = [];
	for (const [label, id] of [['Music Lab: piano + speaker', 'music-lab'], ['Music Lab: beat lab', 'music-lab'], ['Music FX: demo chain', 'music-fx']]) {
		ran.push(await menu(page, label, id));
		await page.waitForTimeout(1500);
	}
	h.check(ran.every(Boolean), '1.1 the three module menus the authoring script runs all exist');
	const room = await roomOf(page);
	h.check(room.devices === 12 && Object.keys(room.kinds).length === 11 && room.cables === 10, '1.2 twelve devices of eleven kinds, ten cables (' + JSON.stringify({ devices: room.devices, cables: room.cables }) + ')');
	h.check(room.built === 12 && room.placeholders === 0, '1.3 every device is built real here (' + room.built + ' built, ' + room.placeholders + ' placeholders)');
	const payload = await inPage(page, "const p = s.sessions.buildSessionPayload('Jam Room'); return { modules: p.modules ?? null, graphs: Object.values(p.graphs ?? {}).reduce((n, g) => n + (g.nodes?.length ?? 0), 0), cables: p.patch?.cables?.length ?? null }");
	h.check(Array.isArray(payload.modules) && payload.modules.map((m) => m.id).sort().join(',') === 'music-fx,music-lab' && payload.graphs === 0, '1.4 the payload names BOTH modules with no flow node in the room - derived from the device kinds (' + JSON.stringify(payload.modules) + ')');
	const bytes = await inPage(page, "const p = s.sessions.buildSessionPayload('Jam Room'); const b = await s.sessions.exportSessionZip(p, { assets: false, packs: false, flow: true }); return Array.from(new Uint8Array(b instanceof Blob ? await b.arrayBuffer() : b))");
	h.check(bytes.length > 10000, '1.5 exported through the real .tpscene path (' + bytes.length + ' bytes)');

	console.log('\n=== 2. a peer WITH the modules loads it: the same room, cabled and audible ===');
	const B = await h.setupPage(browser, 'B', { audio: true });
	await h.installModule(B, 'music-lab');
	await installZip(B, 'music-fx');
	// the templates modal's own path: importSessionZip stores the payload as a session,
	// requestLoadSession loads it (the peer-consent flow, immediate with no peers)
	await B.page.evaluate((arr) => { window.__importResult = 'pending'; window.__stores.sessions.importSessionZip(new Uint8Array(arr).buffer).then(async (p) => { if (!p) return (window.__importResult = 'cancelled'); await window.__stores.sessions.requestLoadSession(p.id); window.__importResult = 'applied'; }).catch((e) => (window.__importResult = 'error ' + e)); }, bytes);
	// a format confirm may sit in front of the import: accept whatever dialog appears
	for (let i = 0; i < 20; i++) {
		const r = await B.page.evaluate(() => window.__importResult);
		if (r !== 'pending') break;
		const ok = B.page.locator('#confirm-dialog-ok, #confirm-dialog-confirm, #confirm-dialog-install');
		if ((await ok.count()) > 0) await ok.first().click().catch(() => {});
		await B.page.waitForTimeout(500);
	}
	const result = await B.page.evaluate(() => window.__importResult);
	h.check(result === 'applied', '2.1 the import applies with the modules present and the session loads (' + result + ')');
	await h.eventually(() => roomOf(B.page), (r) => r.devices === 12 && r.cables === 10, '2.2 B holds the same twelve devices and ten cables', 15000);
	await h.eventually(() => roomOf(B.page), (r) => r.built === 12 && r.placeholders === 0, '2.3 and built all of them real', 15000);
	const quiet = await h.audioMetrics(B, 400);
	const pressed = await inPage(B.page, "let g; s.objectsGroup.subscribe((v) => (g = v))(); let t = null; g.traverse((o) => { if (o.userData?.device?.kind === 'mod-music-lab-transport') t = o; }); const play = t?.getObjectByName('tp-play'); if (!play) return false; return s.moduleSDK.moduleClickHandlers.some((fn) => fn(play))");
	h.check(pressed === true, '2.3b the loaded transport face takes a Play press');
	await B.page.waitForTimeout(900);
	const loud = await h.audioMetrics(B, 1200);
	// the flight's room is the menus' raw drop (the template's layout turns the speakers to the
	// listener; here they face away, ~3 m off), so the floor is the harness silence x2, and
	// the claim is the ratio over the quiet read before Play
	h.check(loud.peak > Math.max(SILENT * 2, quiet.peak * 4), '2.4 Play on the loaded transport and the loaded beat is HEARD - drums cabled through to a speaker (peak ' + loud.peak.toFixed(4) + ' vs ' + quiet.peak.toFixed(4) + ' before)');
	await inPage(B.page, 's.musicClock.stopTransport(); return 1');

	console.log('\n=== 3. a peer WITHOUT the modules is asked for them by name ===');
	const C = await h.setupPage(browser, 'C', { audio: true });
	await C.page.evaluate((arr) => { window.__importResult = 'pending'; window.__stores.sessions.importSessionZip(new Uint8Array(arr).buffer).then((p) => (window.__importResult = p ? 'applied' : 'cancelled')); }, bytes);
	// the format confirm (if any) comes first; the module prompt has its own Install button
	for (let i = 0; i < 20; i++) {
		if ((await C.page.locator('#confirm-dialog-install').count()) > 0) break;
		const ok = C.page.locator('#confirm-dialog-ok, #confirm-dialog-confirm');
		if ((await ok.count()) > 0) await ok.first().click().catch(() => {});
		await C.page.waitForTimeout(400);
	}
	h.check((await C.page.locator('#confirm-dialog-install').count()) === 1, '3.1 the module prompt appears before anything is touched');
	const text = await C.page.evaluate(() => new Promise((r) => window.__stores.confirmDialog.confirmDialog.subscribe((d) => r(d?.message ?? ''))()));
	h.check(/music-lab/.test(text) && /music-fx/.test(text), '3.2 and names BOTH modules (' + JSON.stringify(text.slice(0, 100)) + ')');
	await C.page.locator('#confirm-dialog-cancel').click();
	await h.eventually(() => C.page.evaluate(() => window.__importResult), (v) => v === 'cancelled', '3.3 Cancel is a silent no-op');
	const untouched = await roomOf(C.page);
	h.check(untouched.devices === 0, '3.4 nothing was loaded on C (' + untouched.devices + ' devices)');

	await h.finish(browser);
});
