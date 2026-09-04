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
	// options.audio installs the destination TAP before any app code runs, so
	// everything the app plays can be measured (see audioMetrics).
	if (options.audio) await ctx.addInitScript(AUDIO_TAP_SOURCE);
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


// ---- audio ---------------------------------------------------------------------
//
// Copied from the core repo's tests/e2e/helpers.cjs (23-A2/A3), because a module
// that ships an AUDIO DEVICE has to be measured the same way core measures its own:
// a tap in front of ctx.destination, sampled repeatedly, asserted on the PEAK.

// Headless Chromium renders WebGL through SwiftShader by default, which makes the
// viewport the frame-rate bottleneck (measured: ~4.5 fps at 1280x720 with the AO
// pass on). These flags hand ANGLE the real GPU when there is one — ANGLE falls
// back to SwiftShader on its own where there isn't, so they are safe everywhere.
// Only worth passing when a test actually cares about frame rate (net-stress).
//
// THE ANGLE BACKEND IS PER PLATFORM. `d3d11` exists only on Windows; on Linux it
// silently falls back to SwiftShader, which is the starved-loop failure above in
// disguise. MEASURED 2026-09-03 on a Linux box with an AMD GPU, same page, same
// 660Hz voice: d3d11 -> SwiftShader, 2 audio samples per 600 ms, 6 rAF/s; vulkan ->
// the real GPU, 37 samples per 600 ms, 61 rAF/s. An 80 ms note is invisible to the
// first and obvious to the second.
const ANGLE_BACKEND = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'vulkan';
const GPU_ARGS = [
	'--use-gl=angle',
	'--use-angle=' + ANGLE_BACKEND,
	...(ANGLE_BACKEND === 'vulkan' ? ['--enable-features=Vulkan'] : []),
	'--enable-gpu',
	'--ignore-gpu-blocklist'
];

// Headless Chromium HAS no audio device, but WebAudio still runs against a null
// sink and an AnalyserNode still sees the samples — measured: a 0.5-amplitude
// 440Hz sine reads peak RMS 0.355 against a theoretical 0.5/sqrt(2) = 0.3536, and
// an OfflineAudioContext render of a unit sine reads 0.7071 against 1/sqrt(2).
// So audio IS measurable here; what is NOT is whether it sounds good.
//
// The autoplay flag is what keeps the context out of 'suspended' without a real
// gesture. Pass these for any suite that asserts on sound.
//
// GPU_ARGS IS PART OF IT, and not optionally. An AnalyserNode only reports the
// instant you read it, so the metrics loop has to sample often — and on a
// SwiftShader page the 3D render starves the main thread badly enough that the
// loop barely runs. MEASURED on the same ping chime: 2 samples per 500ms reading
// peak 0.0051 without the GPU args, 30 samples reading 0.1303 with them. The low
// number is not quieter audio, it is the loop missing the attack and catching only
// the decay tail — so a threshold tuned on one is meaningless on the other. Folded
// in here rather than documented, because this is exactly the mistake a caller
// makes silently. (Same family as the GPU_ARGS rate-assertion rule in the e2e skill.)
const AUDIO_ARGS = ['--autoplay-policy=no-user-gesture-required', ...GPU_ARGS];

// An init script given a STRING is evaluated as SOURCE, so a bare function
// expression is created and discarded — it has to be an IIFE to actually run.
const AUDIO_TAP_SOURCE =
	'(' +
	function () {
	const rawConnect = AudioNode.prototype.connect;
	const rawDisconnect = AudioNode.prototype.disconnect;
	/** @type {Map<any, any>} */
	const taps = new Map();
	function tapFor(context) {
		let tap = taps.get(context);
		if (!tap) {
			const analyser = context.createAnalyser();
			analyser.fftSize = 2048;
			analyser.smoothingTimeConstant = 0;
			const bus = context.createGain();
			rawConnect.call(bus, analyser);
			rawConnect.call(analyser, context.destination);
			tap = { analyser, bus, context };
			taps.set(context, tap);
		}
		return tap;
	}
	AudioNode.prototype.connect = function (target, ...rest) {
		// only DIVERT a connection whose target is the raw destination, and never
		// the tap's own two nodes (that would be a feedback loop)
		// NEVER tap an OfflineAudioContext. renderOffline makes one per call, and a
		// rendered analyser LINGERS holding its result — measured: after three offline
		// renders the live read returned 5 contexts and reported the 440Hz render at
		// peak 0.708 instead of the 880Hz tone actually playing. An offline render is
		// measured from its returned buffer; it has no business in the live tap.
		const offline = typeof OfflineAudioContext !== 'undefined' && target?.context instanceof OfflineAudioContext;
		if (target instanceof AudioDestinationNode && target.context && !offline) {
			const tap = tapFor(target.context);
			if (this !== tap.analyser && this !== tap.bus) return rawConnect.call(this, tap.bus, ...rest);
		}
		return rawConnect.call(this, target, ...rest);
	};
	AudioNode.prototype.disconnect = function (target, ...rest) {
		if (target instanceof AudioDestinationNode && target.context) {
			const tap = taps.get(target.context);
			if (tap && this !== tap.analyser && this !== tap.bus)
				return rawDisconnect.call(this, tap.bus, ...rest);
		}
		return rawDisconnect.apply(this, arguments.length ? [target, ...rest] : []);
	};
	window.__audioTap = {
		/** how many AudioContexts have been tapped — see the note on audioMetrics */
		contexts: () => taps.size,
		/** every tapped context's analyser, paired with its context */
		all: () => [...taps.values()].map((t) => ({ analyser: t.analyser, context: t.context })),
		analyser: () => [...taps.values()][0]?.analyser ?? null,
		context: () => [...taps.values()][0]?.context ?? null
	};
}.toString() +
	')();';

/**
 * Sample the destination tap for `ms` and report what was heard.
 *
 * An AnalyserNode reports only the instant you read it, so a one-shot read of a
 * decaying note is a lottery — this samples repeatedly and reports the PEAK as
 * well as the mean. Assert on `peak` for "did this make a sound", on `silent`
 * for "did it stop", and on `centroid` for "did the timbre move" (a filter sweep
 * or a distortion changes the centroid while the RMS may not move at all).
 *
 * `centroid` is the magnitude-weighted mean frequency in Hz, taken at the loudest
 * sample — reading it at a quiet moment measures the noise floor's shape (on this
 * box that reads ~11988Hz, which is the tell that nothing was playing).
 *
 * EVERY tapped AudioContext is sampled and the loudest wins, because a module is
 * free to make its OWN context and most of them do — untangle, sabers,
 * door-keypad, dungeon-realms and piano each call `new AudioContext()` rather than
 * going through the app's shared one. Reading only the first tapped context made a
 * module's audio measure as SILENCE, which is the worst possible failure: a suite
 * asserting "the game makes a sound" fails inexplicably, and one asserting "it is
 * quiet" passes while lying. `contexts` is reported so a suite can assert on how
 * many were in play.
 *
 * @param {any} peer @param {number} [ms] @param {number} [floor] RMS counted as silence
 * @returns {Promise<{peak:number,mean:number,centroid:number,samples:number,contexts:number,silent:boolean,error?:string}>}
 */
async function audioMetrics(peer, ms = 600, floor = 0.001) {
	return peer.page.evaluate(
		async ({ ms, floor }) => {
			const tap = window.__audioTap;
			if (!tap) return { error: 'no audio tap — pass {audio:true} to setupPage', peak: 0, mean: 0, centroid: 0, samples: 0, contexts: 0, silent: true };
			const tapped = tap.all();
			if (!tapped.length)
				return { error: 'nothing has connected to any destination yet', peak: 0, mean: 0, centroid: 0, samples: 0, contexts: 0, silent: true };
			const scratch = tapped.map((t) => ({
				analyser: t.analyser,
				context: t.context,
				time: new Float32Array(t.analyser.fftSize),
				freq: new Float32Array(t.analyser.frequencyBinCount)
			}));
			let peak = 0;
			let sum = 0;
			let count = 0;
			/** the frequency frame of whichever context was loudest, and its bin width */
			let loudest = null;
			let loudestBinHz = 0;
			const deadline = performance.now() + ms;
			while (performance.now() < deadline) {
				await new Promise((r) => setTimeout(r, 16));
				// the LOUDEST context this tick. A module playing into its OWN context must
				// not be averaged away by the app's silent one — and taking a max rather
				// than a sum keeps a single-context reading byte-identical to before.
				let tickPeak = 0;
				let tickWinner = null;
				for (const entry of scratch) {
					entry.analyser.getFloatTimeDomainData(entry.time);
					let square = 0;
					for (let i = 0; i < entry.time.length; i++) square += entry.time[i] * entry.time[i];
					const rms = Math.sqrt(square / entry.time.length);
					if (rms > tickPeak) {
						tickPeak = rms;
						tickWinner = entry;
					}
				}
				sum += tickPeak;
				count++;
				if (tickPeak > peak && tickWinner) {
					peak = tickPeak;
					tickWinner.analyser.getFloatFrequencyData(tickWinner.freq);
					loudest = tickWinner.freq.slice();
					loudestBinHz = tickWinner.context.sampleRate / tickWinner.analyser.fftSize;
				}
			}
			// magnitude-weighted mean frequency at the loudest moment. getFloatFrequencyData
			// is dB, so convert back to linear before weighting or quiet bins dominate.
			let weighted = 0;
			let total = 0;
			if (loudest) {
				for (let i = 0; i < loudest.length; i++) {
					const magnitude = Math.pow(10, loudest[i] / 20);
					weighted += magnitude * i * loudestBinHz;
					total += magnitude;
				}
			}
			return {
				peak,
				mean: count ? sum / count : 0,
				centroid: total ? weighted / total : 0,
				samples: count,
				contexts: tapped.length,
				// a read that sampled NOTHING is a broken harness, never silence — the
				// vacuous-premise trap, caught by this suite passing with no tap installed
				silent: count > 0 && peak < floor
			};
		},
		{ ms, floor }
	);
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
	GPU_ARGS,
	AUDIO_ARGS,
	audioMetrics,
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
