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
import { createGesture } from './gesture.js';
import { makeAim } from './aim.js';
import { makeEdgeLayer, makeBackplate, makeHoverRing, makeBurst, makeGlobe, COLORS } from './look.js';
import { generate3, edgeCrossings3, solvedSphere, arcPoints, arcSegments, normalize } from './sphere.js';
import { MAX_LEVEL, PROGRESS_KEY, normalizeProgress, defaultProgress, recordSolve, continueLevel, isUnlocked, bestOf, makeStorage } from './progress.js';
import { makeMenuKinds } from './menu.js';
import { makeSfx } from './sfx.js';
import { createVRDrag, pickDot, followPoint, handRay, raySphere, tipOf, TIP_RADIUS } from './vrdrag.js';
import { makeVRBar, barCells, CELLS, BAR_H } from './vrbar.js';

const GROUP = 'untangle-module';
/** the modes this build plays: the flat board and (P3) the globe */
const MODES_PLAYED = ['2d', '3d'];
/** the globe's radius as a share of the board radius */
const GLOBE_R = 0.92;
const EXPIRE_FRAMES = 40; // a node gone from the graph -> the module's own defaults return

export default {
	id: 'untangle',
	name: 'Untangle',
	version: '2.2.0',
	description: 'Drag the dots until no edges cross — on a flat board or around a globe, 30 levels per mode that unlock as you solve them (progress stays on your device). In VR: grab dots with the trigger, hold/turn/scale the globe with one hand while the other moves dots, a level bar under the board. Replicated; board pose, level and readouts as flow nodes.',
	/** @param {any} api */
	register(api) {
		const THREE = api.THREE;

		// ---------- state ----------
		let level = 1;
		/** '2d' | '3d' — replicated with the level (the board is the same board for everyone) */
		let mode = '2d';
		/** @type {number[][]} board-unit coords per dot: [x, y] in [-1, 1] */
		let positions = [];
		/** @type {number[][]} dot index pairs */
		let edges = [];
		/** the board: pose + radius (node-owned while an utboard node is alive) */
		const board = { ...DEFAULT_BOARD };
		/** @type {any} */ let group = null;
		/** @type {any[]} */ let dots = [];
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
		/** @type {any} the window.__untangle hook — declared up here, assigned at the end */
		let hook = null;
		/** @type {any} the menu kinds (menu.js), made near the end of register */
		let menus = null;
		/** @type {any} the pointer gesture (gesture.js), created with the interaction block */
		let gesture = null;

		// ---------- P2: progress (LOCAL per device — progress.js) + the solve clock ----------
		const storage = makeStorage(api);
		let progress = normalizeProgress(storage.get(PROGRESS_KEY));
		/** did THIS peer make an authoritative move on the current board? (who banks a solve) */
		let participated = false;
		/** authoritative moves applied on the current board — every peer counts the same moves,
		 * so a state snapshot with a LOWER rev for the same board is stale (applyState) */
		let rev = 0;
		const syncs = { applied: 0, stale: 0 };
		/** the solve clock, local performance time: running from `start`, frozen at `ms` */
		const clock = { start: /** @type {number | null} */ (null), ms: /** @type {number | null} */ (null), newBest: false };
		let wasUnderway = false;
		const roundUnderway = () => !!api.game?.roundUnderway?.();
		/** no game shell in the scene (the fallback board): the clock runs from the level load */
		const shellUnused = () => (typeof api.game?.roundCutoff === 'function' ? api.game.roundCutoff() === null : true);
		function saveProgress() {
			storage.set(PROGRESS_KEY, progress);
			menus?.refreshAll();
		}
		function clockMs() {
			if (clock.ms !== null) return clock.ms;
			return clock.start === null ? null : performance.now() - clock.start;
		}

		// ---------- the board in the world ----------
		/** P3: the player's LOCAL view of the globe (never replicated — dot positions are) */
		const globeQuat = new THREE.Quaternion();
		const globeR = () => board.radius * GLOBE_R;
		/** board units -> the group's local frame (metres). 2D: [x, y] on the board plane;
		 * 3D: a unit vector in the GLOBE frame, turned by the local view onto the surface */
		const local = (p) =>
			mode === '3d'
				? new THREE.Vector3(p[0], p[1], p[2]).applyQuaternion(globeQuat).multiplyScalar(globeR())
				: new THREE.Vector3(p[0] * board.radius, p[1] * board.radius, 0);
		/** keep a position in its mode's space (the unit square, or the unit sphere) */
		const clampPos = (p) => (mode === '3d' ? normalize([+p[0] || 0, +p[1] || 0, +p[2] || 0]) : clampToBoard([p[0], p[1]]));
		/** does a replicated position have this mode's shape? (an older peer sends [x, y]) */
		const fits = (p) => Array.isArray(p) && p.length === (mode === '3d' ? 3 : 2) && p.every((v) => Number.isFinite(+v));
		/** 30b: the player's LOCAL hold of the globe (VR): where it was carried to (an offset in
		 * the board's parent frame) and how big it is; its turn goes into globeQuat. Never
		 * replicated — like the view rotation, the dots replicate as unit vectors. */
		const hold = { offset: new THREE.Vector3(), scale: 1 };
		function resetHold() {
			hold.offset.set(0, 0, 0);
			hold.scale = 1;
		}
		function placeGroup() {
			if (!group) return;
			group.position.set(board.x, board.boardY, board.z);
			if (mode === '3d') group.position.add(hold.offset);
			group.scale.setScalar(mode === '3d' ? hold.scale : 1);
			group.rotation.set(0, board.yaw, 0);
			group.updateMatrixWorld(true);
		}

		// ---------- render (P1: the look — look.js) ----------
		// Dots are 3x the old 5.5 cm at the small levels and shrink toward 2.1x as the count
		// climbs, so a 16-dot board is not a pile of marbles; the lift/hover/burst are LOCAL.
		/** the dot radius in the group frame (metres) */
		const dotR = () => board.radius * Math.max(0.105, 0.15 - Math.max(0, positions.length - 6) * 0.0045);
		/** @type {any} */ let edgeLayer = null;
		/** @type {any} */ let backplate = null;
		/** @type {any} */ let globe = null;
		/** @type {any} */ let hoverRing = null;
		/** @type {any} */ let burst = null;
		/** @type {any} 30b: the VR level bar (vrbar.js), rebuilt with the board */
		let vrBar = null;
		let barHover = -1;
		let hovered = -1;
		let lift = 0; // the carried dot's eased lift, 0..1
		/** free every geometry/material a previous build made (rebuilds are per level) */
		function disposeGroup(g) {
			g?.traverse((/** @type {any} */ o) => {
				o.geometry?.dispose?.();
				const m = o.material;
				if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
				else {
					m?.map?.dispose?.();
					m?.dispose?.();
				}
			});
		}
		/** is `o` in the scene graph under `scene`? */
		const attached = (o, scene) => {
			for (let p = o; p; p = p.parent) if (p === scene) return true;
			return false;
		};
		function build() {
			const scene = api.scene();
			if (!scene) return;
			// 30b: the board must follow the VR world (grab, spin, scale). A core may hang module
			// content under its world root (30b-vr-modes P5) — so a rebuild goes back where the
			// old board WAS (never the scene root by habit) and leaves no orphan behind there
			let parent = scene;
			if (group) {
				if (group.parent && attached(group, scene)) parent = group.parent;
				group.removeFromParent();
				disposeGroup(group);
			}
			group = new THREE.Group();
			group.name = GROUP;
			dots = [];
			sprite = null;
			hovered = -1;
			lift = 0;
			backplate = null;
			globe = null;
			if (mode === '3d') {
				globe = makeGlobe(THREE, globeR());
				group.add(globe.group);
			} else {
				backplate = makeBackplate(THREE, board.radius);
				group.add(backplate.group);
			}
			// 3D arcs are tessellated: up to ~27 straight pieces per edge (a half circle)
			edgeLayer = makeEdgeLayer(THREE, Math.max(1, edges.length * (mode === '3d' ? 28 : 1)));
			edgeLayer.setRadius(board.radius * (mode === '3d' ? 0.012 : 0.016));
			group.add(edgeLayer.glow, edgeLayer.core);
			const r = dotR() * (mode === '3d' ? 0.8 : 1);
			const dotGeo = new THREE.SphereGeometry(r, 32, 20);
			positions.forEach((p, i) => {
				const dot = new THREE.Mesh(
					dotGeo,
					new THREE.MeshStandardMaterial({ color: 0xe8eef7, emissive: 0x7d93b2, emissiveIntensity: 0.45, roughness: 0.3, metalness: 0.05 })
				);
				dot.name = 'untangle-dot-' + i;
				dot.position.copy(local(p));
				group.add(dot);
				dots.push(dot);
			});
			hoverRing = makeHoverRing(THREE);
			hoverRing.scale.setScalar(r * 1.45);
			group.add(hoverRing);
			burst = makeBurst(THREE);
			group.add(burst.points, burst.wave);
			// 30b: the level bar under the board / the globe, facing the player (VR only)
			vrBar = makeVRBar(THREE, board.radius);
			const below = mode === '3d' ? globeR() : board.radius;
			vrBar.mesh.position.set(0, -below - BAR_H * board.radius * 0.5 - 0.22, mode === '3d' ? globeR() * 0.35 : 0.03);
			vrBar.mesh.visible = false;
			group.add(vrBar.mesh);
			parent.add(group);
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

		/** where dot i is DRAWN: its board point, the carried one lifted toward the player */
		function drawn(i) {
			const v = local(positions[i]);
			if (i === carried) {
				if (mode === '3d') v.multiplyScalar(1 + (lift * dotR() * 0.8) / globeR());
				else v.z += lift * dotR() * 0.9;
			}
			return v;
		}
		/** the edge segments: one per 2D edge, a tessellated great-circle arc per 3D edge */
		function segmentsOf(counts) {
			if (mode !== '3d') return edges.map(([a, b], k) => ({ a: drawn(a), b: drawn(b), color: counts[k] > 0 ? COLORS.RED : COLORS.GREEN }));
			const out = [];
			const rr = globeR() * 1.004;
			edges.forEach(([a, b], k) => {
				const color = counts[k] > 0 ? COLORS.RED : COLORS.GREEN;
				const pts = arcPoints(positions[a], positions[b], arcSegments(positions[a], positions[b])).map((q) =>
					new THREE.Vector3(q[0], q[1], q[2]).applyQuaternion(globeQuat).multiplyScalar(rr)
				);
				// the ends follow the carried dot's lift so the arc stays attached to it
				if (a === carried) pts[0] = drawn(a);
				if (b === carried) pts[pts.length - 1] = drawn(b);
				for (let s = 0; s + 1 < pts.length; s++) out.push({ a: pts[s], b: pts[s + 1], color });
			});
			return out;
		}
		/** a dot's colour: amber while carried, brighter while hovered, else pale */
		function paintDot(i) {
			const m = dots[i]?.material;
			if (!m) return;
			if (i === carried) {
				m.color.setHex(COLORS.AMBER);
				m.emissive.setHex(COLORS.AMBER);
				m.emissiveIntensity = 0.9;
			} else {
				m.color.setHex(0xe8eef7);
				m.emissive.setHex(0x7d93b2);
				m.emissiveIntensity = i === hovered ? 0.9 : 0.45;
			}
		}
		/** the dots + the edge segments, coloured by the per-edge crossing counts */
		function redraw(counts) {
			positions.forEach((_, i) => {
				const dot = dots[i];
				if (!dot) return;
				dot.position.copy(drawn(i));
				dot.scale.setScalar(i === carried ? 1 + 0.18 * lift : 1);
			});
			if (edgeLayer) edgeLayer.set(segmentsOf(counts));
			backplate?.setWon(crossings === 0);
			globe?.setWon(crossings === 0);
			if (globe) globe.graticule.quaternion.copy(globeQuat);
		}
		let lastCounts = /** @type {number[]} */ ([]);

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
			lastCounts = mode === '3d' ? edgeCrossings3(positions, edges) : edgeCrossings(positions, edges);
			crossings = totalCrossings(lastCounts);
			redraw(lastCounts);
			ensureSprite();
			drawSprite('Level ' + level + '  ·  ' + (crossings === 0 ? 'solved!' : crossings + ' crossing' + (crossings === 1 ? '' : 's')), crossings === 0 ? '#4ade80' : '#e2e8f0');
			return crossings;
		}

		/** (re)generate level `lvl` and rebuild; `announce` pulses the level event */
		function setLevel(lvl, announce = false, md = mode) {
			level = Math.max(1, Math.round(Number(lvl) || 1));
			const nextMode = MODES_PLAYED.includes(md) ? md : '2d';
			if (nextMode !== mode) resetHold();
			mode = nextMode;
			const g = mode === '3d' ? generate3(level) : generate(level);
			edges = g.edges;
			positions = g.positions;
			won = false;
			carried = -1;
			participated = false;
			rev = 0;
			globeQuat.identity();
			clock.start = roundUnderway() || shellUnused() ? performance.now() : null;
			clock.ms = null;
			clock.newBest = false;
			gesture?.reset();
			build();
			menus?.refreshAll();
			if (announce) fire('level');
		}
		/** the SELECTOR's path: change the board for everyone (level + mode), like Restart */
		function selectLevel(lvl, md = mode) {
			touched = true;
			const l = Math.max(1, Math.min(MAX_LEVEL, Math.round(Number(lvl) || 1)));
			const m = MODES_PLAYED.includes(md) ? md : '2d';
			api.send({ op: 'restart', level: l, mode: m });
			setLevel(l, true, m);
		}

		// ---------- sound, music, haptics (sfx.js) ----------
		// 30b: ONE short sound per event and nothing per frame. The old generative pad (three
		// never-stopped oscillators whose filter was re-ramped by every refresh — i.e. every
		// frame of a drag) was the "weird sound while moving the dots"; it is gone.
		const sfx = makeSfx(api);
		/** a board point's WORLD position, for a spatial sound or an effect */
		const worldOf = (v) => (group ? group.localToWorld(v.clone()).toArray() : undefined);
		/** the solve: a chime, a sparkle, a banner (and on the unlock a level-up after it) */
		function celebrate(unlocked, fromMe) {
			const centre = worldOf(new THREE.Vector3(0, 0, 0));
			sfx.play('success', centre);
			if (centre && typeof api.effects?.burst === 'function' && api.effects.burst(centre, { kind: 'sparkle', color: '#3ee08f', count: 48 })) sfx.note('burst:sparkle');
			if (typeof api.announce === 'function') {
				api.announce('Level ' + level + ' solved', { sub: mode === '3d' ? 'Globe' : undefined, color: '#3ee08f' });
				sfx.note('announce:Level ' + level + ' solved');
			}
			if (fromMe && vrHandLast && api.isVR?.()) sfx.haptic('success', vrHandLast);
			if (unlocked) setTimeout(() => sfx.play('levelup', centre), 650);
		}

		// ---------- events out (fireNodeTrigger replicates: pulse where it HAPPENED) ----------
		/** @param {string} event */
		function fire(event) {
			if (typeof api.fireNodeTrigger === 'function') api.fireNodeTrigger('utevent', (data) => (data?.event ?? 'solved') === event);
		}

		// ---------- moves ----------
		/** apply a position; an authoritative move checks the win on EVERY peer */
		function applyMove(i, p, authoritative, fromMe = false) {
			if (!positions[i] || !fits(p)) return;
			if (authoritative) {
				touched = true;
				rev++;
			}
			positions[i] = clampPos(p);
			const total = refresh();
			if (authoritative && total === 0 && !won) {
				won = true;
				solvedCount++;
				if (clock.start !== null && clock.ms === null) clock.ms = performance.now() - clock.start;
				// fork 9: whoever solves banks it LOCALLY — every peer that moved a dot on this
				// board (the co-op partners too), never a spectator
				let unlocked = false;
				if (participated) {
					const r = recordSolve(progress, mode, level, clock.ms);
					progress = r.progress;
					clock.newBest = r.newBest;
					unlocked = r.unlockedNew;
					saveProgress();
				}
				celebrate(unlocked, fromMe);
				burst?.start(
					positions.map((q) => local(q)),
					(c) => (mode === '3d' ? c.clone().normalize() : new THREE.Vector3(0, 0, 1)),
					board.radius,
					mode !== '3d',
					performance.now() / 1000
				);
				if (fromMe) fire('solved');
				if (board.autoAdvance) {
					api.toast('Untangled! Level ' + (level + 1) + '…');
					setTimeout(() => {
						if (!won) return; // a restart got there first
						setLevel(level + 1, fromMe);
					}, 1200);
				} else if (typeof api.announce !== 'function') api.toast('Untangled!'); // the banner says it on a 30b core
			}
		}
		/** the authoritative drop of dot i at board point p (apply locally + send) */
		function dropAt(i, p) {
			if (!positions[i] || !fits(p)) return false;
			participated = true;
			positions[i] = clampPos(p);
			api.send({ op: 'move', i, p: positions[i] });
			applyMove(i, positions[i], true, true);
			return true;
		}
		/** debug/test: put every dot on the solution circle through authoritative drops */
		function solveNow() {
			const n = positions.length;
			if (mode === '3d') {
				// the gnomonic image of the ring layout, turned to where THIS player is looking
				const inv = globeQuat.clone().invert();
				solvedSphere(n).forEach((q, i) => {
					const v = new THREE.Vector3(q[0], q[1], q[2]).applyQuaternion(inv);
					dropAt(i, [v.x, v.y, v.z]);
				});
				return crossings === 0;
			}
			for (let i = 0; i < n; i++) {
				const angle = (i / n) * Math.PI * 2;
				dropAt(i, [Math.cos(angle) * 0.85, Math.sin(angle) * 0.85]);
			}
			return crossings === 0;
		}

		// ---------- interaction: press-drag-release AND click-click (gesture.js) ----------
		// P0 (roadmap 30): a real drag. gesture.js owns WHEN (window capture listeners — the
		// SDK has no pointerdown or click-miss seam), aim.js owns WHERE (the crosshair under a
		// lock, the cursor otherwise, the hand in VR), and this block owns the board: which
		// dot a ray picks, where a carried dot follows, and the drop. The throttled 'drag'
		// previews and the authoritative 'move' are unchanged — lockstep stays.
		const aim = makeAim(api, THREE);
		const dragPlane = new THREE.Plane();
		const planeNormal = new THREE.Vector3();
		const hitPoint = new THREE.Vector3();
		const localHit = new THREE.Vector3();
		const dotWorld = new THREE.Vector3();
		let lastDrop = 'none';

		/** the dot a ray points at (a generous radius: a dot is small and a hand shakes) */
		function dotUnder(ray) {
			if (!ray || !group || !dots.length) return -1;
			group.updateMatrixWorld();
			const scale = group.getWorldScale(localHit).x || 1;
			const reach = dotR() * 1.3 * scale;
			let best = -1;
			let bestMiss = reach * reach;
			// 3D: a dot on the far side of the globe is hidden — only the front face is reachable
			const front = mode === '3d' ? globeHit(ray, false) : null;
			const frontAlong = front ? front.distanceTo(ray.ray.origin) : Infinity;
			dots.forEach((dot, i) => {
				dot.getWorldPosition(dotWorld);
				const miss = ray.ray.distanceSqToPoint(dotWorld);
				const along = dotWorld.sub(ray.ray.origin).dot(ray.ray.direction);
				if (miss > bestMiss || along <= 0 || along > frontAlong + reach * 1.5) return;
				bestMiss = miss;
				best = i;
			});
			return best;
		}
		/** move the carried dot to where `ray` meets the board plane; true when it moved */
		const globeSphere = new THREE.Sphere();
		const globeCentre = new THREE.Vector3();
		/**
		 * Where a ray meets the globe (world space), or null. `clampToRim`: a ray that misses
		 * lands on the silhouette point nearest to it, so a drag past the edge keeps the dot on
		 * the visible rim instead of freezing it.
		 */
		function globeHit(ray, clampToRim) {
			if (!group || !ray) return null;
			group.updateMatrixWorld();
			group.getWorldPosition(globeCentre);
			globeSphere.set(globeCentre, globeR() * (group.getWorldScale(localHit).x || 1));
			const hit = ray.ray.intersectSphere(globeSphere, new THREE.Vector3());
			if (hit || !clampToRim) return hit;
			const nearest = ray.ray.closestPointToPoint(globeCentre, new THREE.Vector3());
			return nearest.sub(globeCentre).setLength(globeSphere.radius).add(globeCentre);
		}
		function follow(ray) {
			if (carried === -1 || !group || !ray) return false;
			if (mode === '3d') {
				const hit = globeHit(ray, true);
				if (!hit) return false;
				carryToWorld(hit.toArray());
				return true;
			}
			// the board plane in WORLD space (30b: the group's own pose is LOCAL to whatever it
			// hangs under — the VR world root turns, moves and scales it)
			const s = surface();
			dragPlane.setFromNormalAndCoplanarPoint(planeNormal.fromArray(s.normal), hitPoint.fromArray(s.point));
			if (!ray.ray.intersectPlane(dragPlane, hitPoint)) return false;
			carryToWorld(hitPoint.toArray());
			return true;
		}
		function pick(i, how) {
			if (!positions[i]) return;
			carried = i;
			carryHow = how;
			paintDot(i);
			sfx.play('pop', worldOf(local(positions[i])));
		}
		/** drop the carried dot where it is (after one last follow of the drop's own ray) */
		function drop(how, event) {
			if (carried === -1) return;
			if (event && how !== 'ui' && how !== 'cancel') follow(aim.fromClient(event.clientX, event.clientY, event.target));
			const i = carried;
			carried = -1;
			carryHow = 'none';
			paintDot(i);
			lastDrop = how;
			gesture.reset();
			sfx.play('click', worldOf(local(positions[i])));
			dropAt(i, positions[i]);
		}
		/** the renderer's canvas (or anything while a lock holds the pointer) — never a HUD box */
		function isViewport(event) {
			if (aim.locked()) return true;
			const t = event?.target;
			if (!t || t.tagName !== 'CANVAS' || t.closest?.('#hud-layer, [data-hud-module]')) return false;
			return t.clientWidth * t.clientHeight > 0.25 * window.innerWidth * window.innerHeight;
		}
		gesture =
			typeof window !== 'undefined'
				? createGesture({
						target: window,
						locked: aim.locked,
						isViewport,
						// a newer copy of this module (a dev reload) owns the window now; a torn-down
						// board (module disabled: its scene-root group was removed) is inert
						active: () => {
							if (window.__untangle !== hook) {
								gesture.detach();
								return false;
							}
							return !!group && !!group.parent && built && interactive();
						},
						carrying: () => carried !== -1,
						pickAt: (event) => dotUnder(aim.fromClient(event.clientX, event.clientY, event.target)),
						pick,
						drop,
						// P3: right-drag / two fingers ON the globe turn it (the local view only)
						rotateStart: (event) => mode === '3d' && !!globeHit(aim.fromClient(event.clientX, event.clientY, event.target), false),
						rotateBy
					})
				: { detach() {}, reset() {}, carryMode: () => 'none', rotating: () => false, lastUp: () => 'none' };
		let carryHow = 'none';
		const yawAxis = new THREE.Vector3(0, 1, 0);
		const pitchAxis = new THREE.Vector3(1, 0, 0);
		const turn = new THREE.Quaternion();
		let rotations = 0;
		/** turn the globe by a pointer delta (px): yaw about the board's up, pitch about its right.
		 * LOCAL: the orientation never replicates — the dots' unit vectors do. */
		function rotateBy(dx, dy) {
			if (mode !== '3d' || !group) return;
			turn.setFromAxisAngle(yawAxis, dx * 0.008);
			globeQuat.premultiply(turn);
			turn.setFromAxisAngle(pitchAxis, dy * 0.008);
			globeQuat.premultiply(turn).normalize();
			rotations++;
			redraw(lastCounts);
		}
		/** 30-core-modes: an EDIT-mode editor never lets the board react (fork 1). A 1.16 core
		 * has no editor mode, so everything the board is shown in reacts, as it always did. */
		function interactive() {
			const m = typeof api.editorMode === 'function' ? api.editorMode() : null;
			return m !== 'edit' || (typeof api.isPlaying === 'function' && api.isPlaying());
		}

		// ---------- VR: the controller drag (vrdrag.js) ----------
		// 30b: a trigger PRESS grabs (the tip touching a dot, else the laser near one), the dot
		// follows THAT hand while the trigger is held, the RELEASE drops. Poses come from
		// `api.vrHand(hand)` (world space) — or the flight's `vrSim` seam, headless.
		/** @type {Record<string, any> | null} the test seam: fake controller poses */
		let vrSim = null;
		/** the hand that last picked or dropped (the solve's haptic goes there) */
		let vrHandLast = /** @type {string | null} */ (null);
		const handPose = (hand) => (vrSim ? vrSim[hand] ?? null : api.vrHand?.(hand) ?? null);
		/** the controller drag runs in VR on a core that reports hand poses (1.17 does) */
		const vrDragOn = () => !!api.isVR?.() && (!!vrSim || typeof api.vrHand === 'function');
		const worldScale = () => (group ? group.getWorldScale(localHit).x || 1 : 1);
		/** the surface a carried dot lives on, in WORLD space: the board plane or the globe */
		const wq = new THREE.Quaternion();
		function surface() {
			group.updateMatrixWorld();
			const centre = group.getWorldPosition(new THREE.Vector3()).toArray();
			if (mode === '3d') return { kind: 'sphere', centre, r: globeR() * worldScale() };
			return { kind: 'plane', point: centre, normal: new THREE.Vector3(0, 0, 1).applyQuaternion(group.getWorldQuaternion(wq)).toArray() };
		}
		/** put the carried dot at a WORLD point on its surface */
		function carryToWorld(point) {
			localHit.fromArray(point);
			group.worldToLocal(localHit);
			if (mode === '3d') {
				localHit.applyQuaternion(globeQuat.clone().invert());
				positions[carried] = normalize([localHit.x, localHit.y, localHit.z]);
			} else positions[carried] = clampToBoard([localHit.x / board.radius, localHit.y / board.radius]);
		}
		let vrMoved = false;
		// ---------- VR: HOLD the globe (one hand's trigger; the other hand keeps the dots) ----------
		/** @type {any} the hold's start: the hand pose, the globe centre, the view, the frame */
		let holdStart = null;
		const HOLD_SCALE = [0.35, 4];
		/** does this hand's laser (or tip) touch the globe? */
		function globeUnder(pose) {
			if (mode !== '3d' || !group) return false;
			const s = surface();
			const r = handRay(pose);
			if (raySphere(r.origin, r.dir, s.centre, s.r * 1.06)) return true;
			const tip = tipOf(pose);
			return Math.hypot(tip[0] - s.centre[0], tip[1] - s.centre[1], tip[2] - s.centre[2]) <= s.r * 1.06 + TIP_RADIUS;
		}
		function startHold(pose, hand) {
			group.updateMatrixWorld();
			holdStart = {
				p0: new THREE.Vector3().fromArray(pose.position),
				q0inv: new THREE.Quaternion().fromArray(pose.quaternion).invert(),
				c0: group.getWorldPosition(new THREE.Vector3()),
				g0: globeQuat.clone(),
				// the group's world turn WITHOUT the view (the hold moves and scales, never turns, it)
				w: group.getWorldQuaternion(new THREE.Quaternion())
			};
			api.claimInput?.('locomotion'); // the holding hand's stick scales, it must not walk
			sfx.play('pop', holdStart.c0.toArray());
			sfx.haptic('tap', hand);
		}
		const dq = new THREE.Quaternion();
		const newC = new THREE.Vector3();
		const handP = new THREE.Vector3();
		/** the globe rides the hand rigidly (the edit-mode object grab): its centre keeps its
		 * offset from the controller, its turn follows the controller's; the stick scales it */
		function holdTo(pose, hand) {
			if (!holdStart || !group) return;
			const axes = api.input?.()?.axes;
			const y = (hand === 'left' ? axes?.ly : axes?.ry) ?? 0;
			// forward (y < 0 in xr-standard) grows, back shrinks — the Y axis, because the right
			// stick's X is core's snap turn and a module cannot pause it
			if (Math.abs(y) > 0.15) hold.scale = Math.min(HOLD_SCALE[1], Math.max(HOLD_SCALE[0], hold.scale * (1 - y * 0.025)));
			dq.fromArray(pose.quaternion).multiply(holdStart.q0inv);
			newC.copy(holdStart.c0).sub(holdStart.p0).applyQuaternion(dq).add(handP.fromArray(pose.position));
			// the view: W^-1 dq W G0 — the controller's world turn, expressed in the group frame
			globeQuat.copy(holdStart.w).invert().multiply(dq).multiply(holdStart.w).multiply(holdStart.g0).normalize();
			const at = group.parent ? group.parent.worldToLocal(newC.clone()) : newC.clone();
			hold.offset.set(at.x - board.x, at.y - board.boardY, at.z - board.z);
			placeGroup();
			redraw(lastCounts);
		}
		function endHold(hand) {
			holdStart = null;
			api.releaseInput?.('locomotion');
			sfx.play('click', group ? group.getWorldPosition(new THREE.Vector3()).toArray() : undefined);
			sfx.haptic('bump', hand);
		}
		const vrDrag = createVRDrag({
			canPick: () => built && !!group?.parent && interactive() && carried === -1,
			pickAt: (pose) => {
				group.updateMatrixWorld();
				const s = surface();
				// the globe hides its far side: a laser only reaches dots up to its front face
				let frontLimit = Infinity;
				if (s.kind === 'sphere') {
					const r = handRay(pose);
					const hit = raySphere(r.origin, r.dir, s.centre, s.r);
					if (hit) frontLimit = Math.hypot(hit[0] - r.origin[0], hit[1] - r.origin[1], hit[2] - r.origin[2]);
				}
				const world = dots.map((d) => d.getWorldPosition(dotWorld).toArray());
				return pickDot({ pose, dots: world, radius: dotR() * (mode === '3d' ? 0.8 : 1) * worldScale(), frontLimit });
			},
			pick: (i, hand, how) => {
				vrHandLast = hand;
				pick(i, 'vr-' + how);
				sfx.haptic('tap', hand);
			},
			follow: (pose, hand, how) => {
				const p = followPoint(how, pose, surface());
				if (!p) return;
				carryToWorld(p);
				vrMoved = true;
			},
			drop: (hand, why) => {
				vrHandLast = hand;
				drop('vr-' + why);
				sfx.haptic('bump', hand);
			},
			carrying: () => carried !== -1,
			onPress: (pose, hand) => {
				const k = barUnder(pose);
				if (k < 0) return false;
				barAct(CELLS[k], hand);
				return true;
			},
			grabAt: (pose, hand) => {
				if (!globeUnder(pose)) return false;
				startHold(pose, hand);
				return true;
			},
			hold: (pose, hand) => holdTo(pose, hand),
			release: (hand) => endHold(hand)
		});

		// ---------- VR: the level bar (vrbar.js) ----------
		/** a THREE ray from a hand pose */
		const poseRay = (pose) => {
			const r = handRay(pose);
			const ray = new THREE.Raycaster();
			ray.ray.origin.fromArray(r.origin);
			ray.ray.direction.fromArray(r.dir);
			return ray;
		};
		const barView = () => ({ level, mode, progress, running: roundUnderway(), shell: !shellUnused() });
		/** a press on a bar cell: the same replicated paths as the DOM menu */
		function barAct(id, hand) {
			const cell = barCells(barView()).find((c) => c.id === id);
			if (!cell?.enabled) return;
			if (id === 'prev') selectLevel(level - 1, mode);
			else if (id === 'next') selectLevel(level + 1, mode);
			else if (id === 'mode') {
				const other = mode === '3d' ? '2d' : '3d';
				selectLevel(continueLevel(progress, other), other);
			} else if (id === 'restart') restartLevel();
			else if (id === 'level') fire('start'); // the template: Untangle Event (start) -> playing
			lastBar = id;
			sfx.play('click', worldOf(new THREE.Vector3(0, 0, 0)));
			sfx.haptic('bump', hand);
		}
		let lastBar = 'none';
		/** the bar cell under a hand's laser, or -1 */
		const barUnder = (pose) => (vrBar?.mesh.visible && pose ? vrBar.hit(poseRay(pose)) : -1);

		// Core's click: on a desktop gesture.js OWNS every press (a press on a dot never reaches
		// core), so a module click core still dispatches there — play's crosshair TAP while the
		// real cursor is elsewhere, an unlocked play — is only CONSUMED (nothing selects a dot),
		// never acted on. In VR the controller drag above owns the trigger: core's trailing
		// `select` (it fires on RELEASE) is consumed on a dot, while carrying, and just after a
		// VR pick/drop — never acted on. Only a core without hand poses keeps the old VR route
		// (one trigger click picks, the next drops). The C3 sweep (a held trigger clicking
		// whatever the tip enters) is opted out: a sweep across the board would pick dots.
		api.registerClickHandler(
			(object) => {
				const isDot = !!object?.name?.startsWith('untangle-dot-');
				if (!api.isVR?.() && typeof window !== 'undefined') return carried !== -1 || isDot;
				if (vrDragOn()) return isDot || carried !== -1 || vrDrag.recent();
				if (carried !== -1) {
					drop('click');
					return true;
				}
				if (!isDot) return false;
				pick(+object.name.slice('untangle-dot-'.length), 'click');
				return true; // consume — never selects the dot
			},
			{ modes: ['interact', 'play'], sweep: false }
		);
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
			// P2: a round STARTING (menu/solved -> playing, replicated game state, so every peer
			// sees the same edge) starts the clock — and on a SOLVED board it is "Next": every
			// peer advances to the next level in lockstep, no message
			const underway = roundUnderway();
			if (underway && !wasUnderway && built) {
				if (won) setLevel(Math.min(level + 1, MAX_LEVEL), false);
				else if (clock.start === null) clock.start = performance.now();
			}
			wasUnderway = underway;
			// 30b: the quiet puzzle music while the board is PLAYED (Play, or Interact — VR's
			// play) and stands in the scene; sfx.music acts on the change only
			sfx.music(!!group?.parent && built && (!!api.isPlaying?.() || api.editorMode?.() === 'interact'));
			if (!group) return;
			const t = performance.now() / 1000;
			burst?.tick(t);
			const ray = aim.current();
			// P3: in VR the thumbstick turns the globe while the hand points at it
			if (mode === '3d' && api.isVR?.() && carried === -1 && !vrDrag.holder() && globeHit(ray, false)) {
				const axes = api.input?.()?.axes;
				const rx = axes?.rx ?? 0;
				const ry = axes?.ry ?? 0;
				if (Math.abs(rx) > 0.2 || Math.abs(ry) > 0.2) rotateBy(rx * 4, ry * 4);
			}
			// VR: the controllers drive the drag (a carry left over from VR drops on leaving it)
			vrMoved = false;
			const vr = vrDragOn();
			if (vr) vrDrag.update({ left: handPose('left'), right: handPose('right') });
			else if (vrDrag.carrier()) vrDrag.update({ left: null, right: null });
			// the level bar: shown in VR while the board reacts; the laser's hover lights a cell
			if (vrBar) {
				vrBar.mesh.visible = vr && interactive();
				barHover = -1;
				if (vrBar.mesh.visible && carried === -1) {
					for (const hand of ['right', 'left']) {
						barHover = barUnder(handPose(hand));
						if (barHover >= 0) break;
					}
				}
				if (vrBar.mesh.visible) vrBar.draw(barCells(barView()), barHover);
			}
			// hover: the dot under the pointer — in VR the one a trigger press would grab
			// (none while carrying, none when inert)
			const over = carried === -1 && interactive() ? (vr ? vrDrag.candidate()?.i ?? -1 : dotUnder(ray)) : -1;
			if (over !== hovered) {
				const was = hovered;
				hovered = over;
				if (was >= 0) paintDot(was);
				if (over >= 0) paintDot(over);
			}
			if (hoverRing) {
				hoverRing.visible = hovered >= 0;
				if (hovered >= 0) {
					const at = drawn(hovered);
					hoverRing.position.copy(at);
					// 3D: the ring lies on the globe (tangent), facing out of it
					if (mode === '3d') hoverRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), at.clone().normalize());
					else hoverRing.quaternion.identity();
				}
			}
			// the carried dot eases up toward the player and back down after the drop
			const wantLift = carried === -1 ? 0 : 1;
			if (lift !== wantLift) {
				lift = Math.abs(wantLift - lift) < 0.02 ? wantLift : lift + (wantLift - lift) * 0.25;
				if (carried === -1) redraw(lastCounts);
			}
			if (carried === -1) return;
			if (vrDrag.carrier() ? !vrMoved : !follow(ray)) {
				redraw(lastCounts);
				return;
			}
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
					params: [{ key: 'read', kind: 'select', options: ['level', 'crossings', 'solved', 'dots', 'edges', 'count', 'time', 'best', 'mode', 'unlocked'] }]
				},
				{
					type: 'utevent',
					label: 'Untangle Event',
					defaults: { event: 'solved' },
					params: [{ key: 'event', kind: 'select', options: ['solved', 'level', 'start'] }]
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
					case 'time': return Math.floor((clockMs() ?? 0) / 1000);
					case 'best': return Math.floor((bestOf(progress, mode, level) ?? 0) / 1000);
					case 'mode': return mode === '3d' ? 3 : 2;
					case 'unlocked': return progress[mode]?.unlocked ?? 1;
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
				setLevel(data.level ?? 1, false, data.mode ?? '2d');
			}
		});
		api.registerStateSync({
			getState: () => (touched ? { level, positions, mode, rev } : null),
			applyState: (state) => {
				if (!state) return;
				// the exchange runs on EVERY connection of a mesh, so a third peer's snapshot can
				// land AFTER a move we already applied on this same board: `rev` (authoritative
				// moves on the board) says which is newer — an older peer sends none, and gets
				// today's behaviour
				const sameBoard = built && state.level === level && (state.mode ?? '2d') === mode;
				if (sameBoard && typeof state.rev === 'number' && state.rev <= rev) {
					syncs.stale++;
					return;
				}
				syncs.applied++;
				remoteApplied = true;
				touched = true;
				if (!sameBoard) setLevel(state.level ?? 1, false, state.mode ?? '2d');
				if (Array.isArray(state.positions) && state.positions.length === positions.length && state.positions.every(fits)) {
					positions = state.positions.map(clampPos);
					if (typeof state.rev === 'number') rev = state.rev;
					refresh();
				}
			}
		});
		function restartLevel() {
			touched = true;
			api.send({ op: 'restart', level, mode });
			setLevel(level);
		}
		api.registerMenu('Restart level', restartLevel);
		// a scene clear (applySession runs `/clear all` FIRST) resets to level 1; when a
		// board node owns the level it applies on the next flowRuntime tick (nodeLevel is
		// forgotten so the node's value is applied again even when it did not change)
		api.onSceneClear?.(() => {
			sceneClears++;
			resetHold();
			level = 1;
			nodeLevel = null;
			remoteApplied = false;
			won = false;
			carried = -1;
			gesture?.reset();
			if (group) {
				group.removeFromParent();
				group = null;
			}
			built = false;
			touched = false;
			frame = 0; // the fallback window opens again
		});

		// ---------- P2: the menu's module DOM (menu.js) ----------
		/** @type {any} */
		menus = makeMenuKinds({
			view: () => ({ mode, modes: MODES_PLAYED, level, progress, running: roundUnderway() }),
			pickLevel: (l) => {
				if (isUnlocked(progress, mode, l)) selectLevel(l, mode);
			},
			pickMode: (m) => selectLevel(continueLevel(progress, m), m),
			continueGame: () => {
				selectLevel(continueLevel(progress, mode), mode);
				fire('start'); // the template wires Untangle Event (start) -> Set Game State (playing)
			},
			resetProgress: () => {
				progress = defaultProgress();
				saveProgress();
				api.toast('Untangle progress reset');
			},
			time: () => ({ ms: clockMs(), best: bestOf(progress, mode, level), newBest: clock.newBest, solved: won })
		});
		if (typeof api.registerHudElement === 'function') {
			api.registerHudElement('levels', menus.levels);
			api.registerHudElement('stats', menus.stats);
		}

		api.registerInteractiveGroup(GROUP);
		api.registerSystemGroup?.(GROUP);

		// test/debug hook (never serialized). It is also the gesture's ownership token: a
		// newer copy of the module replaces it, and the old window listeners detach.
		hook = {
			state: () => ({
				level, mode, positions, edges, board: { ...board }, won, crossings, solvedCount, built, touched,
				nodeOwned: nodeSeen >= 0, sceneClears, sprite: !!sprite,
				carried, carryMode: carried === -1 ? 'none' : gesture.carryMode() === 'none' ? carryHow : gesture.carryMode(),
				lastDrop, lastUp: gesture.lastUp(), rayMode: aim.mode(), rev, syncs: { ...syncs }
			}),
			move: (i, p) => dropAt(i, p),
			solve: () => solveNow(),
			setLevel: (lvl) => setLevel(lvl, true),
			/** P3: the local globe view (never replicated) */
			globeView: () => ({ quat: globeQuat.toArray(), rotations }),
			rotate: (dx, dy) => rotateBy(dx, dy),
			/** P2: the selector's replicated path */
			select: (lvl, md) => selectLevel(lvl, md ?? mode),
			progress: () => JSON.parse(JSON.stringify(progress)),
			storageKind: storage.kind,
			/** 30b: the VR drag's test seam — fake controller poses {left, right} ({position,
			 * quaternion, trigger}, world space), or null to go back to api.vrHand */
			vrSim: (hands) => {
				vrSim = hands ?? null;
			},
			vr: () => ({ carrier: vrDrag.carrier(), candidate: vrDrag.candidate(), holder: vrDrag.holder(), lastHand: vrHandLast, on: vrDragOn() }),
			/** 30b: the LOCAL globe hold — offset (parent frame), scale, and the view quaternion */
			globeHold: () => ({ offset: hold.offset.toArray(), scale: hold.scale, quat: globeQuat.toArray(), centre: group ? group.getWorldPosition(new THREE.Vector3()).toArray() : null }),
			/** 30b: the VR level bar — shown?, the hovered cell, the cells, the last action */
			vrBar: () => ({ visible: !!vrBar?.mesh.visible, hover: barHover, cells: barCells(barView()), last: lastBar }),
			/** world position of bar cell k (for the flights' aim) */
			vrBarCell: (k) => (vrBar ? vrBar.mesh.localToWorld(vrBar.cellLocal(k)).toArray() : null),
			/** 30b: every board sound / haptic asked for, the local voices still sounding, the music */
			sfx: () => sfx.stats(),
			/** 30b: which of the Quest round's core seams this core has (feature-detected) */
			caps: () => ({ sounds: typeof api.music?.play === 'function', announce: typeof api.announce === 'function', effects: typeof api.effects?.burst === 'function', hapticPattern: typeof api.hapticPattern === 'function', vrHand: typeof api.vrHand === 'function' }),
			clock: () => ({ ms: clockMs(), newBest: clock.newBest, participated }),
			/** P1: what the board is drawn with, as numbers a flight can assert */
			look: () => {
				const ws = group ? group.getWorldScale(new THREE.Vector3()).x : 1;
				const colors = [];
				const ic = edgeLayer?.core.instanceColor;
				for (let k = 0; k < (edgeLayer?.core.count ?? 0); k++) colors.push(ic ? new THREE.Color().fromArray(ic.array, k * 3).getHex() : null);
				return {
					dotRadius: dots[0] ? dots[0].geometry.parameters.radius * ws : 0,
					edgeRadius: (edgeLayer?.radius() ?? 0) * ws,
					edgeInstances: edgeLayer?.core.count ?? 0,
					edgeColors: colors,
					edgeCrossings: [...lastCounts],
					colors: { ...COLORS },
					hovered,
					hoverVisible: !!hoverRing?.visible,
					carriedZ: carried >= 0 && dots[carried] ? dots[carried].position.z : 0,
					carriedScale: carried >= 0 && dots[carried] ? dots[carried].scale.x : 1,
					burstActive: !!burst?.active(),
					burstFired: burst?.fired() ?? 0,
					rimWon: crossings === 0,
					plate: !!group?.getObjectByName('untangle-plate')
				};
			},
			/** world position of dot i (for pointer tests) */
			dotWorld: (i) => (dots[i] ? dots[i].getWorldPosition(new THREE.Vector3()).toArray() : null),
			/** world position of a BOARD point [x, y] */
			boardWorld: (p) => (group ? group.localToWorld(local(p)).toArray() : null)
		};
		if (typeof window !== 'undefined') /** @type {any} */ (window).__untangle = hook;
	}
};
