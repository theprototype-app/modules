// Untangle — the 190 test-flight game module. Drag the dots until no edges
// cross. Proves a self-contained module (NO imports, everything from `api`) can
// ship a real game: procedural guaranteed-solvable puzzles, desktop+VR drag via
// api.pointerRay(), replicated moves, deterministic win detection and
// generative WebAudio (ambient pad reacting to progress + SFX), all on the SDK.
//
// Replication model (golden rules):
// - the puzzle is a PURE function of the level number (seeded RNG) — every peer
//   generates the identical graph (determinism IS the netcode)
// - drags stream as throttled previews; the DROP is the authoritative 'move'
// - win = zero crossings, checked after every authoritative move on every peer
//   from the same positions — all peers advance to the next level in lockstep
//   without a "win" message
// - late joiners get {level, positions} via registerStateSync

export default {
	id: 'untangle',
	name: 'Untangle',
	version: '1.0.0',
	description: 'Drag the dots until no edges cross — procedural puzzle game (SDK test-flight).',
	/** @param {any} api */
	register(api) {
		const THREE = api.THREE;
		const GROUP = 'untangle-module';
		const BOARD_Y = 1.6; // board centre height (VR eye-ish); vertical x/y plane at z=0
		const RADIUS = 1.1;
		const DOT_R = 0.055;

		// ---------- state ----------
		let level = 1;
		/** @type {number[][]} 2D board coords per node: [x, y] */
		let positions = [];
		/** @type {number[][]} node index pairs */
		let edges = [];
		let group = null;
		/** @type {any[]} */ let dots = [];
		/** @type {any[]} */ let lineMeshes = [];
		let hud = null;
		let carried = -1;
		let won = false;
		let lastDragSent = 0;

		// ---------- deterministic RNG ----------
		function mulberry32(seed) {
			let t = seed >>> 0;
			return function () {
				t = (t + 0x6d2b79f5) >>> 0;
				let r = Math.imul(t ^ (t >>> 15), t | 1);
				r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
				return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
			};
		}

		// ---------- puzzle generation (guaranteed solvable) ----------
		// Solution layout: n nodes on a circle. Candidate edges are chords; two
		// chords of a circle cross iff exactly one endpoint of one lies between
		// the endpoints of the other (walking the circle). We keep the ring
		// (connectivity) + greedily add non-crossing chords — so the circle
		// layout IS a planar embedding and the puzzle is solvable by construction.
		// Then node positions are scrambled (seeded) so edges cross.
		function chordsCross(a, b, c, d, n) {
			const between = (x, lo, hi) => {
				// does x lie strictly between lo and hi walking the circle lo -> hi?
				const span = (hi - lo + n) % n;
				const off = (x - lo + n) % n;
				return off > 0 && off < span;
			};
			if (a === c || a === d || b === c || b === d) return false; // shared endpoint
			return between(c, a, b) !== between(d, a, b);
		}

		function generate(lvl) {
			const rand = mulberry32(0x9e3779b9 ^ (lvl * 2654435761));
			const n = Math.min(5 + lvl, 16); // difficulty scales, capped
			// ring edges first (connected planar base)
			edges = [];
			for (let i = 0; i < n; i++) edges.push([i, (i + 1) % n]);
			// candidate chords, deterministic shuffle, greedy non-crossing add
			const chords = [];
			for (let i = 0; i < n; i++)
				for (let j = i + 2; j < n; j++) if (!(i === 0 && j === n - 1)) chords.push([i, j]);
			for (let i = chords.length - 1; i > 0; i--) {
				const k = Math.floor(rand() * (i + 1));
				const swap = chords[i];
				chords[i] = chords[k];
				chords[k] = swap;
			}
			const wanted = Math.floor(n * 0.8);
			let added = 0;
			for (const [a, b] of chords) {
				if (added >= wanted) break;
				if (edges.some(([c, d]) => chordsCross(a, b, c, d, n))) continue;
				edges.push([a, b]);
				added++;
			}
			// scramble positions in the disc until at least one crossing exists
			positions = [];
			for (let i = 0; i < n; i++) {
				const angle = rand() * Math.PI * 2;
				const radius = Math.sqrt(rand()) * RADIUS * 0.9;
				positions.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
			}
			won = false;
		}

		// ---------- crossings on CURRENT positions ----------
		function segsCross(p1, p2, p3, p4) {
			const d = (a, b, c) => (c[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (c[1] - a[1]);
			const d1 = d(p3, p4, p1);
			const d2 = d(p3, p4, p2);
			const d3 = d(p1, p2, p3);
			const d4 = d(p1, p2, p4);
			return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
		}
		function edgeCrossings() {
			const counts = edges.map(() => 0);
			for (let i = 0; i < edges.length; i++) {
				for (let j = i + 1; j < edges.length; j++) {
					const [a, b] = edges[i];
					const [c, d] = edges[j];
					if (a === c || a === d || b === c || b === d) continue;
					if (segsCross(positions[a], positions[b], positions[c], positions[d])) {
						counts[i]++;
						counts[j]++;
					}
				}
			}
			return counts;
		}

		// ---------- render ----------
		function world(p) {
			return new THREE.Vector3(p[0], BOARD_Y + p[1], 0);
		}
		function build() {
			const scene = api.scene();
			if (!scene) return;
			if (group) scene.remove(group);
			group = new THREE.Group();
			group.name = GROUP;
			dots = [];
			lineMeshes = [];
			positions.forEach((p, i) => {
				const dot = new THREE.Mesh(
					new THREE.SphereGeometry(DOT_R, 20, 14),
					new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.4 })
				);
				dot.name = 'untangle-dot-' + i;
				dot.position.copy(world(p));
				group.add(dot);
				dots.push(dot);
			});
			edges.forEach(([a, b], i) => {
				const geometry = new THREE.BufferGeometry().setFromPoints([world(positions[a]), world(positions[b])]);
				const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xf87171 }));
				line.name = 'untangle-edge-' + i;
				group.add(line);
				lineMeshes.push(line);
			});
			hud = makeHud();
			group.add(hud);
			scene.add(group);
			refresh();
		}
		function makeHud() {
			const canvas = document.createElement('canvas');
			canvas.width = 512;
			canvas.height = 96;
			const sprite = new THREE.Sprite(
				new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true })
			);
			sprite.name = 'untangle-hud';
			sprite.scale.set(1.6, 0.3, 1);
			sprite.position.set(0, BOARD_Y + RADIUS + 0.45, 0);
			sprite.userData.canvas = canvas;
			return sprite;
		}
		function drawHud(text, color) {
			if (!hud) return;
			const canvas = hud.userData.canvas;
			const g = canvas.getContext('2d');
			g.clearRect(0, 0, canvas.width, canvas.height);
			g.font = 'bold 44px monospace';
			g.textAlign = 'center';
			g.fillStyle = color;
			g.fillText(text, canvas.width / 2, 62);
			hud.material.map.needsUpdate = true;
		}
		function refresh() {
			if (!group) return;
			positions.forEach((p, i) => dots[i]?.position.copy(world(p)));
			const counts = edgeCrossings();
			let total = 0;
			edges.forEach(([a, b], i) => {
				const line = lineMeshes[i];
				if (!line) return;
				line.geometry.setFromPoints([world(positions[a]), world(positions[b])]);
				line.material.color.set(counts[i] > 0 ? 0xf87171 : 0x4ade80); // tangled warm, clear cool
				total += counts[i];
			});
			total = total / 2;
			drawHud('Level ' + level + '  ·  ' + (total === 0 ? 'solved!' : total + ' crossing' + (total === 1 ? '' : 's')), total === 0 ? '#4ade80' : '#e2e8f0');
			ambientSetTension(total);
			return total;
		}

		// ---------- generative audio (lazy — browsers gate audio on a gesture) ----------
		let ac = null;
		let padGain = null;
		let padFilter = null;
		function audio() {
			if (ac) return ac;
			ac = new (window.AudioContext || window.webkitAudioContext)();
			// ambient "thinking" pad: two detuned triangles through a lowpass, slow LFO
			padGain = ac.createGain();
			padGain.gain.value = 0.03;
			padFilter = ac.createBiquadFilter();
			padFilter.type = 'lowpass';
			padFilter.frequency.value = 400;
			const lfo = ac.createOscillator();
			const lfoGain = ac.createGain();
			lfo.frequency.value = 0.13;
			lfoGain.gain.value = 0.012;
			lfo.connect(lfoGain).connect(padGain.gain);
			for (const [type, freq] of [['triangle', 110], ['triangle', 110.7], ['sine', 220.3]]) {
				const osc = ac.createOscillator();
				osc.type = type;
				osc.frequency.value = freq;
				osc.connect(padFilter);
				osc.start();
			}
			padFilter.connect(padGain).connect(ac.destination);
			lfo.start();
			return ac;
		}
		function ambientSetTension(crossings) {
			if (!ac) return; // starts on the first interaction
			// more tangles = darker/closer pad; solving opens the filter up
			padFilter.frequency.linearRampToValueAtTime(
				320 + Math.max(0, 24 - crossings) * 60,
				ac.currentTime + 0.6
			);
		}
		function blip(freq, duration = 0.07, gain = 0.12) {
			const ctx = audio();
			const osc = ctx.createOscillator();
			const g = ctx.createGain();
			osc.frequency.value = freq;
			g.gain.setValueAtTime(gain, ctx.currentTime);
			g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
			osc.connect(g).connect(ctx.destination);
			osc.start();
			osc.stop(ctx.currentTime + duration);
		}
		function winSting() {
			[523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
				setTimeout(() => blip(f, 0.22, 0.14), i * 110)
			);
		}

		// ---------- interaction: click to pick, pointerRay to carry, click to drop ----
		const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // the board plane z=0
		const hitPoint = new THREE.Vector3();
		function applyMove(i, p, authoritative) {
			if (!positions[i]) return;
			positions[i] = [p[0], p[1]];
			const total = refresh();
			if (authoritative && total === 0 && !won) {
				won = true;
				winSting();
				api.toast('Untangled! Level ' + (level + 1) + '…');
				setTimeout(() => {
					level += 1;
					generate(level);
					build();
				}, 1200);
			}
		}
		api.registerClickHandler((object) => {
			// while carrying, ANY click drops the dot where it is (clicking the tiny
			// dot exactly is fiddly, especially at the board-edge clamp)
			if (carried !== -1) {
				const i = carried;
				dots[i].material.color.set(0xf1f5f9);
				carried = -1;
				blip(440);
				api.send({ op: 'move', i, p: positions[i] });
				applyMove(i, positions[i], true);
				return true;
			}
			if (!object?.name?.startsWith('untangle-dot-')) return false;
			carried = +object.name.slice('untangle-dot-'.length);
			dots[carried].material.color.set(0xfbbf24);
			blip(660);
			return true; // consume — never selects the dot
		});
		api.registerFrameTask(() => {
			if (carried === -1 || !group) return;
			const ray = api.pointerRay();
			if (!ray) return;
			if (!ray.ray.intersectPlane(dragPlane, hitPoint)) return;
			const x = Math.max(-RADIUS, Math.min(RADIUS, hitPoint.x));
			const y = Math.max(-RADIUS, Math.min(RADIUS, hitPoint.y - BOARD_Y));
			positions[carried] = [x, y];
			refresh();
			const now = performance.now();
			if (now - lastDragSent > 100) {
				lastDragSent = now;
				api.send({ op: 'drag', i: carried, p: positions[carried] });
			}
		});

		// ---------- replication ----------
		api.onMessage((data) => {
			if (data.op === 'drag') applyMove(data.i, data.p, false);
			else if (data.op === 'move') applyMove(data.i, data.p, true);
			else if (data.op === 'restart') {
				level = data.level ?? 1;
				generate(level);
				build();
			}
		});
		api.registerStateSync({
			getState: () => ({ level, positions }),
			applyState: (state) => {
				if (!state) return;
				level = state.level ?? 1;
				generate(level); // identical graph from the seed
				if (Array.isArray(state.positions) && state.positions.length === positions.length)
					positions = state.positions.map((p) => [p[0], p[1]]);
				build();
			}
		});
		api.registerMenu('Restart level', () => {
			api.send({ op: 'restart', level });
			generate(level);
			build();
		});
		api.onSceneClear?.(() => {
			level = 1;
			generate(level);
			build();
		});

		// ---------- go ----------
		generate(level);
		build();
		api.registerInteractiveGroup(GROUP);
	}
};
