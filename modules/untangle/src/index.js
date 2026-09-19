// Untangle — drag the dots until no edges cross. Bundled to one self-contained module.js
// by esbuild (npm run build:untangle); everything outside comes through `api`.
//
// 21-C C7 made it a TEMPLATE game: the board's POSE and the starting LEVEL are node
// data (`utboard`, replicated with the graph), the desktop HUD is core HUD elements the
// template authors (fed by `utvalue` / `utevent`), and the canvas SPRITE HUD stays as
// the VR-only path (DOM is invisible in a headset). The RNG, the generator, the
// crossing test, the drag and the audio stay imperative — there are no arrays in the
// socket type system and no pointer-ray node, so they cannot be nodes. Do not try.
//
// Replication model (golden rules):
// - the puzzle is a PURE function of the level number — every peer generates the
//   identical graph (determinism IS the netcode); a saved scene carries the level
//   (seed INPUT), never the positions (derived state)
// - drags stream as throttled previews; the DROP is the authoritative 'move'
// - win = zero crossings, checked after every authoritative move on every peer from the
//   same positions — all peers advance in lockstep without a "win" message
// - late joiners get {level, positions} via registerStateSync

import { generate, edgeCrossings, totalCrossings, clampToBoard, DEFAULT_BOARD } from './puzzle.js';

const GROUP = 'untangle-module';
const DOT_R = 0.055;
const EXPIRE_FRAMES = 40; // a node gone from the graph -> the module's own defaults return

export default {
	id: 'untangle',
	name: 'Untangle',
	version: '2.0.0',
	description: 'Drag the dots until no edges cross — procedural puzzle game; board pose, level and readouts as flow nodes.',
	/** @param {any} api */
	register(api) {
		const THREE = api.THREE;

		// ---------- state ----------
		let level = 1;
		/** @type {number[][]} board-unit coords per dot: [x, y] in [-1, 1] */
		let positions = [];
		/** @type {number[][]} dot index pairs */
		let edges = [];
		/** the board: pose + radius (node-owned while an utboard node is alive) */
		const board = { ...DEFAULT_BOARD };
		/** @type {any} */ let group = null;
		/** @type {any[]} */ let dots = [];
		/** @type {any[]} */ let lineMeshes = [];
		/** @type {any} */ let sprite = null; // the VR-only canvas HUD
		let carried = -1;
		let won = false;
		let solvedCount = 0;
		let lastDragSent = 0;
		let crossings = 0;
		let built = false;
		let frame = 0;
		let nodeSeen = -1; // last frame an utboard node ran
		let nodeLevel = /** @type {number | null} */ (null); // the node's level as last applied
		let remoteApplied = false; // a state sync landed — the node's first sight must not undo it
		let sceneClears = 0;
		// golden rule 7: the module-state exchange on connect is SYMMETRIC (both ends ask
		// getmodulestate), so a joiner whose fallback board nobody touched must answer
		// with NOTHING, or its fresh level-1 scramble overwrites the room's game
		let touched = false;

		// ---------- the board in the world ----------
		/** board units -> the group's local frame (metres) */
		const local = (p) => new THREE.Vector3(p[0] * board.radius, p[1] * board.radius, 0);
		function placeGroup() {
			if (!group) return;
			group.position.set(board.x, board.boardY, board.z);
			group.rotation.set(0, board.yaw, 0);
			group.updateMatrixWorld(true);
		}

		// ---------- render ----------
		function build() {
			const scene = api.scene();
			if (!scene) return;
			if (group) scene.remove(group);
			group = new THREE.Group();
			group.name = GROUP;
			dots = [];
			lineMeshes = [];
			sprite = null;
			positions.forEach((p, i) => {
				const dot = new THREE.Mesh(
					new THREE.SphereGeometry(DOT_R, 20, 14),
					new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.4 })
				);
				dot.name = 'untangle-dot-' + i;
				dot.position.copy(local(p));
				group.add(dot);
				dots.push(dot);
			});
			edges.forEach(([a, b], i) => {
				const geometry = new THREE.BufferGeometry().setFromPoints([local(positions[a]), local(positions[b])]);
				const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xf87171 }));
				line.name = 'untangle-edge-' + i;
				group.add(line);
				lineMeshes.push(line);
			});
			scene.add(group);
			placeGroup();
			// the test/debug hook (scene-root local, never serialized)
			group.userData._ut = {
				state: () => ({ level, positions, edges, board: { ...board }, won, crossings, solvedCount, carried, sprite: !!sprite }),
				move: (i, p) => dropAt(i, p),
				solve: () => solveNow(),
				setLevel: (lvl) => setLevel(lvl, true)
			};
			built = true;
			refresh();
		}

		// ---------- the VR sprite HUD (DOM is invisible in a headset) ----------
		function ensureSprite() {
			const wantVR = typeof api.isVR === 'function' && api.isVR();
			if (!wantVR) {
				if (sprite) {
					group?.remove(sprite);
					sprite.material.map?.dispose?.();
					sprite.material.dispose?.();
					sprite = null;
				}
				return;
			}
			if (sprite || !group || typeof document === 'undefined') return;
			const canvas = document.createElement('canvas');
			canvas.width = 512;
			canvas.height = 96;
			sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }));
			sprite.name = 'untangle-hud';
			sprite.scale.set(1.6, 0.3, 1);
			sprite.position.set(0, board.radius + 0.45, 0);
			sprite.userData.canvas = canvas;
			group.add(sprite);
		}
		function drawSprite(text, color) {
			if (!sprite) return;
			const canvas = sprite.userData.canvas;
			const g = canvas.getContext('2d');
			g.clearRect(0, 0, canvas.width, canvas.height);
			g.font = 'bold 44px monospace';
			g.textAlign = 'center';
			g.fillStyle = color;
			g.fillText(text, canvas.width / 2, 62);
			sprite.material.map.needsUpdate = true;
		}

		function refresh() {
			if (!group) return 0;
			positions.forEach((p, i) => dots[i]?.position.copy(local(p)));
			const counts = edgeCrossings(positions, edges);
			edges.forEach(([a, b], i) => {
				const line = lineMeshes[i];
				if (!line) return;
				line.geometry.setFromPoints([local(positions[a]), local(positions[b])]);
				line.material.color.set(counts[i] > 0 ? 0xf87171 : 0x4ade80); // tangled warm, clear cool
			});
			crossings = totalCrossings(counts);
			ensureSprite();
			drawSprite('Level ' + level + '  ·  ' + (crossings === 0 ? 'solved!' : crossings + ' crossing' + (crossings === 1 ? '' : 's')), crossings === 0 ? '#4ade80' : '#e2e8f0');
			ambientSetTension(crossings);
			return crossings;
		}

		/** (re)generate level `lvl` and rebuild; `announce` pulses the level event */
		function setLevel(lvl, announce = false) {
			level = Math.max(1, Math.round(Number(lvl) || 1));
			const g = generate(level);
			edges = g.edges;
			positions = g.positions;
			won = false;
			carried = -1;
			build();
			if (announce) fire('level');
		}

		// ---------- generative audio (lazy — browsers gate audio on a gesture) ----------
		let ac = null;
		let padGain = null;
		let padFilter = null;
		function audio() {
			if (ac) return ac;
			ac = new (window.AudioContext || window.webkitAudioContext)();
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
		function ambientSetTension(count) {
			if (!ac) return; // starts on the first interaction
			padFilter.frequency.linearRampToValueAtTime(320 + Math.max(0, 24 - count) * 60, ac.currentTime + 0.6);
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
			[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() => blip(f, 0.22, 0.14), i * 110));
		}

		// ---------- events out (fireNodeTrigger replicates: pulse where it HAPPENED) ----------
		/** @param {string} event */
		function fire(event) {
			if (typeof api.fireNodeTrigger === 'function') api.fireNodeTrigger('utevent', (data) => (data?.event ?? 'solved') === event);
		}

		// ---------- moves ----------
		/** apply a position; an authoritative move checks the win on EVERY peer */
		function applyMove(i, p, authoritative, fromMe = false) {
			if (!positions[i]) return;
			if (authoritative) touched = true;
			positions[i] = clampToBoard([p[0], p[1]]);
			const total = refresh();
			if (authoritative && total === 0 && !won) {
				won = true;
				solvedCount++;
				winSting();
				if (fromMe) fire('solved');
				if (board.autoAdvance) {
					api.toast('Untangled! Level ' + (level + 1) + '…');
					setTimeout(() => {
						if (!won) return; // a restart got there first
						setLevel(level + 1, fromMe);
					}, 1200);
				} else api.toast('Untangled!');
			}
		}
		/** the authoritative drop of dot i at board point p (apply locally + send) */
		function dropAt(i, p) {
			if (!positions[i]) return false;
			positions[i] = clampToBoard([p[0], p[1]]);
			api.send({ op: 'move', i, p: positions[i] });
			applyMove(i, positions[i], true, true);
			return true;
		}
		/** debug/test: put every dot on the solution circle through authoritative drops */
		function solveNow() {
			const n = positions.length;
			for (let i = 0; i < n; i++) {
				const angle = (i / n) * Math.PI * 2;
				dropAt(i, [Math.cos(angle) * 0.85, Math.sin(angle) * 0.85]);
			}
			return crossings === 0;
		}

		// ---------- interaction: click to pick, pointerRay to carry, click to drop ----------
		const dragPlane = new THREE.Plane();
		const planeNormal = new THREE.Vector3();
		const hitPoint = new THREE.Vector3();
		const localHit = new THREE.Vector3();
		api.registerClickHandler((object) => {
			// while carrying, ANY click drops the dot where it is (clicking the tiny dot
			// exactly is fiddly, especially at the board-edge clamp)
			if (carried !== -1) {
				const i = carried;
				dots[i]?.material.color.set(0xf1f5f9);
				carried = -1;
				blip(440);
				dropAt(i, positions[i]);
				return true;
			}
			if (!object?.name?.startsWith('untangle-dot-')) return false;
			carried = +object.name.slice('untangle-dot-'.length);
			dots[carried]?.material.color.set(0xfbbf24);
			blip(660);
			return true; // consume — never selects the dot
		});
		api.registerFrameTask(() => {
			frame++;
			// the node-or-fallback gate: no utboard node within EXPIRE_FRAMES of load (or of a
			// scene clear) -> today's behaviour, a level-1 puzzle appears on its own
			if (!built && nodeSeen < 0 && frame > EXPIRE_FRAMES) setLevel(level);
			if (nodeSeen >= 0 && frame - nodeSeen > EXPIRE_FRAMES) {
				nodeSeen = -1;
				nodeLevel = null;
				Object.assign(board, { radius: DEFAULT_BOARD.radius, boardY: DEFAULT_BOARD.boardY, x: DEFAULT_BOARD.x, z: DEFAULT_BOARD.z, yaw: DEFAULT_BOARD.yaw, autoAdvance: DEFAULT_BOARD.autoAdvance });
				placeGroup();
				refresh();
			}
			if (carried === -1 || !group) return;
			const ray = api.pointerRay();
			if (!ray) return;
			// the board plane in WORLD space: the group's +Z through its origin
			planeNormal.set(0, 0, 1).applyQuaternion(group.quaternion);
			dragPlane.setFromNormalAndCoplanarPoint(planeNormal, group.position);
			if (!ray.ray.intersectPlane(dragPlane, hitPoint)) return;
			localHit.copy(hitPoint);
			group.worldToLocal(localHit);
			positions[carried] = clampToBoard([localHit.x / board.radius, localHit.y / board.radius]);
			refresh();
			const now = performance.now();
			if (now - lastDragSent > 100) {
				lastDragSent = now;
				api.send({ op: 'drag', i: carried, p: positions[carried] });
			}
		});

		// ---------- the node family (group "Untangle") ----------
		api.registerNodeGroup({
			group: 'Untangle',
			items: [
				{
					type: 'utboard',
					label: 'Untangle Board',
					defaults: { ...DEFAULT_BOARD, apply: true },
					params: [
						{ key: 'level', kind: 'range', min: 1, max: 40, step: 1 },
						{ key: 'radius', kind: 'range', min: 0.4, max: 3, step: 0.05 },
						{ key: 'boardY', kind: 'range', min: 0.3, max: 3, step: 0.05 },
						{ key: 'x', kind: 'range', min: -20, max: 20, step: 0.1 },
						{ key: 'z', kind: 'range', min: -20, max: 20, step: 0.1 },
						{ key: 'yaw', kind: 'range', min: -3.15, max: 3.15, step: 0.05 },
						{ key: 'autoAdvance', kind: 'toggle' },
						{ key: 'apply', kind: 'toggle' }
					]
				},
				{
					type: 'utvalue',
					label: 'Untangle Value',
					defaults: { read: 'level' },
					params: [{ key: 'read', kind: 'select', options: ['level', 'crossings', 'solved', 'dots', 'edges', 'count'] }]
				},
				{
					type: 'utevent',
					label: 'Untangle Event',
					defaults: { event: 'solved' },
					params: [{ key: 'event', kind: 'select', options: ['solved', 'level'] }]
				}
			]
		});
		// the board node OWNS pose + radius + autoAdvance while alive; its `level` is the
		// STARTING level — applied when the node's value changes (not every frame), so
		// autoAdvance can move on, and never on first sight over a landed state sync
		api.registerEffect('utboard', (object, base, data) => {
			if (data.apply === false) return;
			nodeSeen = frame;
			const next = {
				radius: Math.max(0.2, Number(data.radius ?? DEFAULT_BOARD.radius)),
				boardY: Number(data.boardY ?? DEFAULT_BOARD.boardY),
				x: Number(data.x ?? 0),
				z: Number(data.z ?? 0),
				yaw: Number(data.yaw ?? 0),
				autoAdvance: !!(data.autoAdvance ?? true)
			};
			let poseChanged = false;
			for (const key of Object.keys(next)) {
				if (board[key] !== next[key]) {
					board[key] = next[key];
					poseChanged = true;
				}
			}
			const wanted = Math.max(1, Math.round(Number(data.level) || 1));
			if (nodeLevel !== wanted) {
				const first = nodeLevel === null;
				nodeLevel = wanted;
				if (!(first && remoteApplied) && (wanted !== level || !built)) setLevel(wanted);
				else if (!built) setLevel(level);
				touched = true;
			}
			if (poseChanged && built) {
				placeGroup();
				refresh();
			}
		});
		api.registerValueNode(
			'utvalue',
			(data) => {
				switch (data?.read) {
					case 'crossings': return crossings;
					case 'solved': return won ? 1 : 0;
					case 'dots': return positions.length;
					case 'edges': return edges.length;
					case 'count': return solvedCount;
					default: return level;
				}
			},
			{ vtype: 'number' }
		);
		api.registerValueNode('utevent', () => 0, { vtype: 'event' });

		// ---------- replication ----------
		api.onMessage((data) => {
			if (data.op === 'drag') applyMove(data.i, data.p, false);
			else if (data.op === 'move') applyMove(data.i, data.p, true);
			else if (data.op === 'restart') {
				touched = true;
				setLevel(data.level ?? 1);
			}
		});
		api.registerStateSync({
			getState: () => (touched ? { level, positions } : null),
			applyState: (state) => {
				if (!state) return;
				remoteApplied = true;
				touched = true;
				setLevel(state.level ?? 1);
				if (Array.isArray(state.positions) && state.positions.length === positions.length) {
					positions = state.positions.map((p) => clampToBoard([p[0], p[1]]));
					refresh();
				}
			}
		});
		api.registerMenu('Restart level', () => {
			touched = true;
			api.send({ op: 'restart', level });
			setLevel(level);
		});
		// a scene clear (applySession runs `/clear all` FIRST) resets to level 1; when a
		// board node owns the level it applies on the next flowRuntime tick (nodeLevel is
		// forgotten so the node's value is applied again even when it did not change)
		api.onSceneClear?.(() => {
			sceneClears++;
			level = 1;
			nodeLevel = null;
			remoteApplied = false;
			won = false;
			carried = -1;
			if (group) {
				api.scene()?.remove(group);
				group = null;
			}
			built = false;
			touched = false;
			frame = 0; // the fallback window opens again
		});

		api.registerInteractiveGroup(GROUP);
		api.registerSystemGroup?.(GROUP);

		// test/debug hook (never serialized)
		if (typeof window !== 'undefined') {
			/** @type {any} */ (window).__untangle = {
				state: () => ({ level, positions, edges, board: { ...board }, won, crossings, solvedCount, built, touched, nodeOwned: nodeSeen >= 0, sceneClears, sprite: !!sprite }),
				move: (i, p) => dropAt(i, p),
				solve: () => solveNow(),
				setLevel: (lvl) => setLevel(lvl, true)
			};
		}
	}
};
