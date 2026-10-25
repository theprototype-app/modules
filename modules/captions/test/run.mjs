// captions — the pure part: the utterance splitter (pauses -> caption timing). node modules/captions/test/run.mjs
import assert from 'node:assert/strict';
const { splitUtterances } = await import('../module.js');

const RATE = 16000;
/** tone bursts at [start, end] seconds over `total` seconds of light noise */
function clip(bursts, total) {
	const pcm = new Float32Array(Math.round(total * RATE));
	let seed = 1;
	for (let i = 0; i < pcm.length; i++) {
		seed = (seed * 16807) % 2147483647;
		pcm[i] = ((seed / 2147483647) * 2 - 1) * 0.002;
	}
	for (const [a, b] of bursts) for (let i = Math.round(a * RATE); i < Math.round(b * RATE); i++) pcm[i] += 0.3 * Math.sin((i / RATE) * 2 * Math.PI * 180);
	return pcm;
}

let n = 0;
const t = (name, fn) => {
	fn();
	n++;
	console.log('ok', name);
};

t('three phrases split at their pauses', () => {
	const out = splitUtterances(clip([[0.5, 1.5], [2.2, 3.4], [4.5, 5.0]], 6));
	assert.equal(out.length, 3, JSON.stringify(out));
	assert.ok(Math.abs(out[0].start - 0.5) < 0.25 && Math.abs(out[0].end - 1.5) < 0.3, JSON.stringify(out[0]));
	assert.ok(Math.abs(out[2].start - 4.5) < 0.25, JSON.stringify(out[2]));
});
t('a short gap (< 0.35 s) does not split', () => {
	const out = splitUtterances(clip([[0.5, 1.2], [1.4, 2.0]], 3));
	assert.equal(out.length, 1, JSON.stringify(out));
});
t('a 20-s monologue is cut into pieces of at most ~8 s', () => {
	const out = splitUtterances(clip([[0.2, 20.2]], 21));
	assert.ok(out.length >= 3, JSON.stringify(out));
	assert.ok(out.every((p) => p.end - p.start <= 8.4), JSON.stringify(out));
	assert.ok(Math.abs(out[0].start - 0.2) < 0.25 && out[out.length - 1].end > 19.8, JSON.stringify(out));
});
t('silence gives nothing', () => {
	assert.deepEqual(splitUtterances(clip([], 4)), []);
});
console.log(`captions: ${n} passed`);
