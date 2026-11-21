// navigation — the worker's main-thread half: start it from the zip's asset (a blob URL), load the
// wasm once, and turn its replies into promises. Started ONLY when a scene has navigation nodes,
// so a scene without NPCs never downloads or instantiates recast.

/**
 * @param {{assetUrl: (p: string) => string | null, onUnload: (fn: () => void) => void}} api
 */
export function makeWorkerClient(api) {
	/** @type {Worker | null} */
	let worker = null;
	/** @type {Promise<void> | null} */
	let starting = null;
	let seq = 0;
	/** @type {Map<number, {resolve: (v: any) => void, reject: (e: any) => void}>} */
	const pending = new Map();
	let dead = false;
	const stats = { started: 0, messages: 0, errors: 0, lastError: '' };

	async function start() {
		const scriptUrl = api.assetUrl('assets/nav-worker.js');
		const wasmUrl = api.assetUrl('assets/recast.wasm');
		if (!scriptUrl || !wasmUrl) throw new Error('navigation: the worker or wasm asset is missing from the module');
		// re-wrap as JavaScript: a zip asset's blob may carry no type, and a worker script must be JS
		const text = await (await fetch(scriptUrl)).text();
		const blob = new Blob([text], { type: 'text/javascript' });
		const url = URL.createObjectURL(blob);
		worker = new Worker(url, { name: 'navigation' });
		URL.revokeObjectURL(url);
		worker.onmessage = (event) => {
			const msg = event.data ?? {};
			const p = pending.get(msg.id);
			if (!p) return;
			pending.delete(msg.id);
			stats.messages++;
			if (msg.ok) p.resolve(msg);
			else {
				stats.errors++;
				stats.lastError = String(msg.error ?? '');
				p.reject(new Error(msg.error));
			}
		};
		worker.onerror = (event) => {
			stats.errors++;
			stats.lastError = String(event.message ?? 'worker error');
			for (const p of pending.values()) p.reject(new Error(stats.lastError));
			pending.clear();
		};
		stats.started++;
		await call('init', { wasmUrl });
	}

	/** @param {string} op @param {any} [body] @param {Transferable[]} [transfer] @returns {Promise<any>} */
	function call(op, body = {}, transfer = []) {
		if (!worker) return Promise.reject(new Error('navigation: worker not started'));
		const id = ++seq;
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			/** @type {Worker} */ (worker).postMessage({ id, op, ...body }, transfer);
		});
	}

	api.onUnload(() => {
		dead = true;
		worker?.terminate();
		worker = null;
		for (const p of pending.values()) p.reject(new Error('navigation unloaded'));
		pending.clear();
	});

	return {
		stats,
		/** started (and the wasm loaded)? */
		get running() {
			return !!worker && !starting;
		},
		get started() {
			return !!worker;
		},
		/** start once; later calls share the same promise */
		ensure() {
			if (dead) return Promise.reject(new Error('navigation unloaded'));
			if (!starting && !worker) {
				starting = start().then(
					() => {
						starting = null;
					},
					(error) => {
						starting = null;
						worker?.terminate();
						worker = null;
						throw error;
					}
				);
			}
			return starting ?? Promise.resolve();
		},
		call,
		stop() {
			worker?.terminate();
			worker = null;
			for (const p of pending.values()) p.reject(new Error('navigation stopped'));
			pending.clear();
		}
	};
}
