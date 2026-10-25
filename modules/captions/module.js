// captions — SPEECH TO CAPTIONS IN THE BROWSER (roadmap 77 C2). Moonshine (Useful Sensors, MIT —
// the ENGLISH models only; the non-English ones are under a non-commercial licence and are not
// used) runs through transformers.js 4 (Hugging Face, Apache-2.0) on WebAssembly, in a Worker,
// on this device: no audio leaves it. The app's Timeline ("Caption the speech in audio clips")
// and its live subtitles use it through `api.captions.registerEngine`; other languages go to the
// speech-to-text server presets in Settings ▸ AI.
//
// WHAT IS DOWNLOADED, WHEN, AND WHERE IT IS KEPT
//   · the RUNTIME (transformers.js + the ONNX Runtime Web glue and WebAssembly, ~7 MB over the wire)
//     from jsDelivr, at PINNED versions, each file checked against its SHA-384 before use, kept in
//     the Cache Storage bucket `tp-ml-runtime` under its URL. That bucket and those URLs are the
//     SHARED RUNTIME CONVENTION: any module of ours that runs transformers.js (the planned Kokoro
//     voice module, roadmap 62) uses the same pinned files, so a device keeps ONE copy.
//   · the MODEL (moonshine-tiny ~32 MB, or moonshine-base ~67 MB, 8-bit) from huggingface.co,
//     cached by transformers.js itself (Cache Storage `transformers-cache`).
//   Both are fetched right after install (a toast shows the progress) and never again.
//
// The app's CSP allows exactly this: `connect-src https:` for the downloads, and `script-src blob:`
// / `worker-src blob:` for the verified runtime, which is imported from a blob URL — never from the
// network directly. Nothing here replicates: captions are made on the device that asks.
//
// SELF-CONTAINED (no imports), per AUTHORING.md: everything comes from `api`.

const RUNTIME_CACHE = 'tp-ml-runtime';
const ORT = '1.31.0-dev.20260914-8d85527a0';
/** the pinned runtime: url + SHA-384 (base64) of the exact bytes */
const RUNTIME = {
	transformers: {
		url: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js',
		sha384: 'AFNtlNOt2vbygtlRCUX2TDgkE+EyonjbCLxAfqezYwJJDVlozUhg+yKs4cPwyjHR',
		type: 'text/javascript'
	},
	ortMjs: {
		url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT}/dist/ort-wasm-simd-threaded.jsep.mjs`,
		sha384: 'nvWLxdeiWbA+fFeE6qrofH8GNTzogS0wMzbtE+5FpSdY9eJVD9XAw02CuIR67LOV',
		type: 'text/javascript'
	},
	ortWasm: {
		url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT}/dist/ort-wasm-simd-threaded.jsep.wasm`,
		sha384: 'M3enaJRpYo4Wu07MxfAZnkbeFbm4uWtNn6W27Taw+akrBXSqWBJ45eyQ+zqre5tC',
		type: 'application/wasm'
	}
};
/** the English Moonshine models (MIT), 8-bit on WebAssembly */
const MODELS = {
	tiny: { repo: 'onnx-community/moonshine-tiny-ONNX', label: 'Moonshine tiny', mb: 32 },
	base: { repo: 'onnx-community/moonshine-base-ONNX', label: 'Moonshine base', mb: 67 }
};
const RATE = 16000;

// ---- the worker (runs transformers.js; its source travels as a blob) ----------------------------
const WORKER_SOURCE = `
let asr = null;
let loading = null;
self.onmessage = async (event) => {
	const msg = event.data || {};
	try {
		if (msg.type === 'init') {
			if (!loading) loading = (async () => {
				const tjs = await import(msg.runtime.transformers);
				const env = tjs.env;
				env.allowLocalModels = false;
				env.useBrowserCache = true;
				env.useWasmCache = false;
				const wasm = env.backends.onnx.wasm;
				wasm.wasmPaths = { mjs: msg.runtime.ortMjs, wasm: msg.runtime.ortWasm };
				wasm.wasmBinary = msg.wasmBinary;
				wasm.proxy = false;
				const progress = (p) => {
					if (p && p.status === 'progress' && p.total) self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
				};
				asr = await tjs.pipeline('automatic-speech-recognition', msg.model, { device: 'wasm', dtype: 'q8', progress_callback: progress });
			})();
			await loading;
			self.postMessage({ type: 'ready', id: msg.id });
			return;
		}
		if (msg.type === 'run') {
			if (!asr) throw new Error('model not loaded');
			const t0 = performance.now();
			const out = await asr(msg.audio);
			self.postMessage({ type: 'result', id: msg.id, text: String((out && out.text) || '').trim(), ms: performance.now() - t0 });
		}
	} catch (error) {
		loading = null;
		self.postMessage({ type: 'error', id: msg.id, error: String((error && error.message) || error) });
	}
};
`;

// ---- helpers --------------------------------------------------------------------------------

/** base64 of a digest @param {ArrayBuffer} buf */
function b64(buf) {
	let s = '';
	const bytes = new Uint8Array(buf);
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
	return btoa(s);
}

/** fetch with a byte-progress callback @param {string} url @param {(loaded: number, total: number) => void} onBytes */
async function fetchBytes(url, onBytes) {
	const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
	if (!res.ok) throw new Error(`download failed (${res.status}) for ${url}`);
	const total = Number(res.headers.get('content-length')) || 0;
	if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
	const reader = res.body.getReader();
	const parts = [];
	let loaded = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		parts.push(value);
		loaded += value.length;
		onBytes(loaded, total);
	}
	const out = new Uint8Array(loaded);
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

/**
 * Split 16 kHz PCM into utterances at pauses (an energy gate over 30 ms frames), each ≤ maxS
 * seconds — Moonshine is built for short utterances and has no timestamps of its own, so the
 * pieces ARE the caption timing. Returns [{start, end}] in seconds.
 * @param {Float32Array} pcm @param {{maxS?: number, minSilenceS?: number}} [opts]
 */
export function splitUtterances(pcm, opts = {}) {
	const frame = Math.round(RATE * 0.03);
	const n = Math.floor(pcm.length / frame);
	const energy = new Float32Array(n);
	for (let f = 0; f < n; f++) {
		let sum = 0;
		for (let i = f * frame; i < (f + 1) * frame; i++) sum += pcm[i] * pcm[i];
		energy[f] = Math.sqrt(sum / frame);
	}
	const sorted = Array.from(energy).sort((a, b) => a - b);
	const floor = sorted[Math.floor(sorted.length * 0.1)] || 0;
	const peak = sorted[Math.floor(sorted.length * 0.95)] || 0;
	// the quiet floor (10th percentile) sets the gate, capped below the loud level so steady speech still counts
	const gate = Math.max(0.006, Math.min(floor * 2.5, peak * 0.25), peak * 0.05);
	const maxF = Math.round((opts.maxS ?? 8) / 0.03);
	const gapF = Math.round((opts.minSilenceS ?? 0.35) / 0.03);
	/** @type {{start: number, end: number}[]} */
	const out = [];
	let s = -1;
	let quiet = 0;
	const close = (endF) => {
		if (s >= 0 && endF - s >= 8) out.push({ start: Math.max(0, (s - 5) * 0.03), end: Math.min(pcm.length / RATE, (endF + 5) * 0.03) });
		s = -1;
	};
	for (let f = 0; f < n; f++) {
		const loud = energy[f] > gate;
		if (loud) {
			if (s < 0) s = f;
			quiet = 0;
		} else if (s >= 0 && ++quiet >= gapF) close(f - quiet + 1);
		if (s >= 0 && f - s >= maxF) {
			// too long: cut at the quietest frame of its last third
			let cut = f;
			let min = Infinity;
			for (let k = s + Math.round(maxF * 0.66); k <= f; k++) if (energy[k] < min) (min = energy[k]), (cut = k);
			const from = s;
			close(cut);
			if (cut < f) s = cut;
			if (s === from) s = -1;
		}
	}
	close(n);
	return out;
}

export default {
	id: 'captions',
	name: 'Captions (in-browser)',
	version: '1.0.0',
	description: 'Speech to captions on this device: Moonshine (English) in the browser for Timeline auto-captions and live subtitles. Downloads ~40 MB once.',

	/** @param {any} api */
	register(api) {
		if (typeof api.captions?.registerEngine !== 'function') {
			api.toast('The Captions module needs a newer app (1.44 or later).');
			return;
		}
		const store = api.storage;
		const modelKey = () => (store.get('model', 'tiny') === 'base' ? 'base' : 'tiny');

		/** what is happening, and (for the diagnostics) what was downloaded and how fast it runs
		 * @type {{state: string, pct: number, error: string, rtf: number | null, runtimeBytes: number, runtimeCached: number, modelFiles: Record<string, number>, loadMs: number}} */
		const status = { state: 'idle', pct: 0, error: '', rtf: null, runtimeBytes: 0, runtimeCached: 0, modelFiles: {}, loadMs: 0 };
		/** @type {Worker | null} */
		let worker = null;
		/** @type {Promise<void> | null} */
		let ready = null;
		let seq = 0;
		/** @type {Map<number, {resolve: (v: any) => void, reject: (e: any) => void}>} */
		const pending = new Map();
		/** @type {string[]} blob urls to revoke at teardown */
		const urls = [];
		let lastToast = 0;

		const progressToast = (/** @type {string} */ text) => {
			const now = Date.now();
			if (now - lastToast < 2500) return;
			lastToast = now;
			api.toast(text);
		};

		/** the verified runtime: from the shared cache, else downloaded, checked and cached */
		async function runtime() {
			const cache = await caches.open(RUNTIME_CACHE);
			/** @type {Record<string, Uint8Array>} */
			const bytes = {};
			const entries = Object.entries(RUNTIME);
			let done = 0;
			for (const [key, file] of entries) {
				let buf = null;
				const hit = await cache.match(file.url);
				if (hit) buf = new Uint8Array(await hit.arrayBuffer());
				const fresh = !buf;
				if (!fresh) status.runtimeCached++;
				if (!buf)
					buf = await fetchBytes(file.url, (l, t) => {
						status.state = 'downloading';
						status.pct = Math.round(((done + l / t) / entries.length) * 30);
						progressToast(`Captions: downloading the speech runtime… ${status.pct}%`);
					});
				const digest = b64(await crypto.subtle.digest('SHA-384', buf));
				if (digest !== file.sha384) {
					await cache.delete(file.url);
					throw new Error(`the downloaded ${key} did not match its pinned checksum — not used`);
				}
				if (fresh) {
					status.runtimeBytes += buf.length;
					await cache.put(file.url, new Response(buf, { headers: { 'content-type': file.type } }));
				}
				bytes[key] = buf;
				done++;
			}
			const blobUrl = (/** @type {Uint8Array} */ b, /** @type {string} */ type) => {
				const u = URL.createObjectURL(new Blob([b], { type }));
				urls.push(u);
				return u;
			};
			return {
				urls: { transformers: blobUrl(bytes.transformers, 'text/javascript'), ortMjs: blobUrl(bytes.ortMjs, 'text/javascript'), ortWasm: blobUrl(bytes.ortWasm, 'application/wasm') },
				wasm: bytes.ortWasm.buffer.slice(0)
			};
		}

		function post(/** @type {any} */ msg, /** @type {Transferable[]} */ transfer = []) {
			const id = ++seq;
			return new Promise((resolve, reject) => {
				pending.set(id, { resolve, reject });
				worker?.postMessage({ ...msg, id }, transfer);
			});
		}

		/** start the worker and load the model (once; a failure lets the next call retry) */
		function ensureReady() {
			if (ready) return ready;
			ready = (async () => {
				status.state = 'downloading';
				status.error = '';
				status.runtimeBytes = 0;
				status.runtimeCached = 0;
				const t0 = performance.now();
				const rt = await runtime();
				const src = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
				urls.push(src);
				worker = new Worker(src, { type: 'module', name: 'captions-moonshine' });
				worker.onmessage = (event) => {
					const m = event.data || {};
					if (m.type === 'progress') {
						status.modelFiles[m.file] = m.total;
						status.pct = 30 + Math.round((m.loaded / m.total) * 70);
						progressToast(`Captions: downloading ${MODELS[modelKey()].label}… ${status.pct}%`);
						return;
					}
					const p = pending.get(m.id);
					if (!p) return;
					pending.delete(m.id);
					if (m.type === 'error') p.reject(new Error(m.error));
					else p.resolve(m);
				};
				worker.onerror = (e) => {
					for (const p of pending.values()) p.reject(new Error(e.message || 'the captions worker stopped'));
					pending.clear();
				};
				await post({ type: 'init', runtime: rt.urls, wasmBinary: rt.wasm, model: MODELS[modelKey()].repo }, [rt.wasm]);
				status.state = 'ready';
				status.pct = 100;
				status.loadMs = Math.round(performance.now() - t0);
				store.set('ready:' + modelKey(), true);
			})().catch((error) => {
				status.state = 'error';
				status.error = String(error?.message ?? error);
				ready = null;
				worker?.terminate();
				worker = null;
				throw error;
			});
			return ready;
		}

		/** @param {Float32Array} pcm */
		async function recognise(pcm) {
			const copy = new Float32Array(pcm);
			const out = await post({ type: 'run', audio: copy }, [copy.buffer]);
			if (pcm.length > RATE) status.rtf = out.ms / 1000 / (pcm.length / RATE);
			return { text: out.text, ms: out.ms };
		}

		const offEngine = api.captions.registerEngine({
			id: 'moonshine',
			label: `${MODELS[modelKey()].label} (in this browser)`,
			local: true,
			languages: ['en'],
			status: () => (status.state === 'ready' ? 'ready' : status.state === 'downloading' ? `downloading ${status.pct}%` : status.state === 'error' ? 'error: ' + status.error : 'downloads on first use'),
			/** @param {{audio: Float32Array, sampleRate: number, signal?: AbortSignal}} job */
			async transcribe(job) {
				if (job.sampleRate !== RATE) throw new Error('the captions engine wants 16 kHz audio');
				await ensureReady();
				const pieces = job.audio.length <= RATE * 8 ? [{ start: 0, end: job.audio.length / RATE }] : splitUtterances(job.audio);
				const segments = [];
				for (const piece of pieces) {
					if (job.signal?.aborted) throw new DOMException('aborted', 'AbortError');
					const slice = job.audio.subarray(Math.floor(piece.start * RATE), Math.ceil(piece.end * RATE));
					const { text } = await recognise(slice);
					if (text) segments.push({ start: piece.start, end: piece.end, text });
				}
				return { segments, text: segments.map((s) => s.text).join(' '), language: 'en' };
			}
		});

		// the menu on the module's card
		api.registerMenu('Download the speech model now', () => {
			ensureReady().then(
				() => api.toast(`Captions: ${MODELS[modelKey()].label} is ready on this device.`),
				(error) => api.toast('Captions could not load: ' + (error?.message ?? error))
			);
		});
		api.registerMenu('Switch model (tiny ⇄ base)', () => {
			const next = modelKey() === 'tiny' ? 'base' : 'tiny';
			store.set('model', next);
			worker?.terminate();
			worker = null;
			ready = null;
			api.toast(`Captions: ${MODELS[next].label} (~${MODELS[next].mb} MB) — downloading now.`);
			ensureReady().catch(() => {});
		});

		// right after install: fetch everything once (the model is cached by the browser afterwards)
		if (!store.get('ready:' + modelKey(), false))
			ensureReady().then(
				() => {
					api.toast(`Captions: ${MODELS[modelKey()].label} downloaded — captions now run on this device.`);
					// free the memory until a caption job needs it
					worker?.terminate();
					worker = null;
					ready = null;
					status.state = 'idle';
				},
				(error) => api.toast('Captions could not download: ' + (error?.message ?? error))
			);

		// suites + diagnostics (one global, removed at unload)
		globalThis.__captionsModule = { status, ensureReady, recognise, splitUtterances, model: modelKey, worker: () => !!worker };

		api.onUnload(() => {
			offEngine();
			worker?.terminate();
			worker = null;
			for (const p of pending.values()) p.reject(new Error('the Captions module was unloaded'));
			pending.clear();
			for (const u of urls) URL.revokeObjectURL(u);
			delete globalThis.__captionsModule;
		});
	}
};
