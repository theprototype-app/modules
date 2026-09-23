// THE LOOK — every mesh the board is drawn with, built from `api.THREE` (never an import:
// a bundled three would be a second copy and fail every instanceof in the app).
//
// EDGES ARE INSTANCED TUBES, not THREE.Line (1 px on every GPU — WebGL ignores linewidth)
// and not Line2/LineMaterial (three/examples: it cannot be imported by a blob-URL module,
// and porting its shader means carrying ~500 lines of three internals). MEASURED (AMD 890M,
// ANGLE Vulkan, 1280x720, 16 dots / 26 edges with one dot moving every frame, core + glow
// layer each): Line2 0.402 ms/frame, instanced tubes 0.408 ms — a tie on the GPU, the same
// 18 draw calls — and the tubes' CPU update+render is cheaper (0.032 vs 0.044 ms: Line2's
// setPositions reallocates its buffers every move); per-edge meshes 0.502 ms / 68 calls. So:
// one InstancedMesh of open cylinders + one additive glow twin, lit/bloomed like any mesh,
// world-unit thick in VR, and the SAME layer draws the globe's tessellated arcs (a segment
// list), so 2D and 3D share one path.

const RED = 0xff4d5e; // an edge that still crosses
const GREEN = 0x3ee08f; // a clear edge
const AMBER = 0xfbbf24; // carried / hover / the rim

export const COLORS = { RED, GREEN, AMBER };

/**
 * One instanced layer of cylinder segments (+ a soft additive glow twin).
 * @param {any} THREE @param {number} capacity max segments
 */
export function makeEdgeLayer(THREE, capacity) {
	const geometry = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
	const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
	const glowMat = new THREE.MeshBasicMaterial({
		color: 0xffffff,
		transparent: true,
		opacity: 0.16,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		toneMapped: false
	});
	const core = new THREE.InstancedMesh(geometry, coreMat, capacity);
	const glow = new THREE.InstancedMesh(geometry, glowMat, capacity);
	core.name = 'untangle-edges';
	glow.name = 'untangle-edges-glow';
	for (const mesh of [core, glow]) {
		mesh.frustumCulled = false; // instances move; the geometry's own bounds are meaningless
		mesh.count = 0;
		mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	}
	glow.renderOrder = 1;
	const up = new THREE.Vector3(0, 1, 0);
	const dir = new THREE.Vector3();
	const mid = new THREE.Vector3();
	const quat = new THREE.Quaternion();
	const scale = new THREE.Vector3();
	const matrix = new THREE.Matrix4();
	const color = new THREE.Color();
	let radius = 0.02;

	return {
		core,
		glow,
		/** @param {number} r tube radius (world units in the group frame) */
		setRadius(r) {
			radius = r;
		},
		radius: () => radius,
		/**
		 * @param {{a: any, b: any, color: number}[]} segments endpoints as THREE.Vector3
		 */
		set(segments) {
			const n = Math.min(segments.length, capacity);
			for (let i = 0; i < n; i++) {
				const s = segments[i];
				dir.subVectors(s.b, s.a);
				const len = dir.length() || 1e-6;
				mid.addVectors(s.a, s.b).multiplyScalar(0.5);
				quat.setFromUnitVectors(up, dir.divideScalar(len));
				color.setHex(s.color);
				// each piece runs one radius past both ends: the open tubes of a tessellated arc
				// overlap instead of showing a dark seam at every joint
				const reach = len + radius * 2;
				matrix.compose(mid, quat, scale.set(radius, reach, radius));
				core.setMatrixAt(i, matrix);
				core.setColorAt(i, color);
				matrix.compose(mid, quat, scale.set(radius * 3.2, len, radius * 3.2));
				glow.setMatrixAt(i, matrix);
				glow.setColorAt(i, color);
			}
			core.count = n;
			glow.count = n;
			core.instanceMatrix.needsUpdate = true;
			glow.instanceMatrix.needsUpdate = true;
			if (core.instanceColor) core.instanceColor.needsUpdate = true;
			if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
		},
		dispose() {
			geometry.dispose();
			coreMat.dispose();
			glowMat.dispose();
		}
	};
}

/** a rounded-rectangle path, half-extent `h`, corner radius `r` @param {any} THREE */
function roundedRect(THREE, h, r) {
	const shape = new THREE.Shape();
	shape.moveTo(-h + r, -h);
	shape.lineTo(h - r, -h);
	shape.quadraticCurveTo(h, -h, h, -h + r);
	shape.lineTo(h, h - r);
	shape.quadraticCurveTo(h, h, h - r, h);
	shape.lineTo(-h + r, h);
	shape.quadraticCurveTo(-h, h, -h, h - r);
	shape.lineTo(-h, -h + r);
	shape.quadraticCurveTo(-h, -h, -h + r, -h);
	return shape;
}

/**
 * The 2D board's backplate: a dark rounded plate behind the dots (so the board reads on
 * any sky) and a glowing rim. `setWon` turns the rim green.
 * @param {any} THREE @param {number} R board radius (the dots live in [-R, R]²)
 */
export function makeBackplate(THREE, R) {
	const group = new THREE.Group();
	group.name = 'untangle-backplate';
	const h = R * 1.24;
	const plate = new THREE.Mesh(
		new THREE.ShapeGeometry(roundedRect(THREE, h, R * 0.16), 6),
		new THREE.MeshStandardMaterial({ color: 0x0f1726, roughness: 0.85, metalness: 0, transparent: true, opacity: 0.93 })
	);
	plate.name = 'untangle-plate';
	plate.position.z = -R * 0.06;
	plate.receiveShadow = false;
	plate.castShadow = false;
	group.add(plate);
	// a faint inner grid: the eye reads distances on it
	const lines = [];
	for (let k = -4; k <= 4; k++) {
		const v = (k / 4) * R;
		lines.push(-R, v, 0, R, v, 0, v, -R, 0, v, R, 0);
	}
	const gridGeo = new THREE.BufferGeometry();
	gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
	const grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0x1e2a3d, transparent: true, opacity: 0.8 }));
	grid.name = 'untangle-grid';
	grid.position.z = -R * 0.055;
	group.add(grid);
	// TubeGeometry needs a 3D curve: handed the 2D Shape it builds its frames from Vector2
	// tangents and every vertex comes out NaN (the rim never drew, and the board's bounds
	// were NaN, which framed the camera into NaN). A closed 3D curve through the outline.
	const outline = roundedRect(THREE, h, R * 0.16).getSpacedPoints(200);
	outline.pop(); // the closing point repeats the first
	const path = new THREE.CatmullRomCurve3(outline.map((p) => new THREE.Vector3(p.x, p.y, 0)), true);
	const rimMat = new THREE.MeshBasicMaterial({ color: AMBER, toneMapped: false });
	const rim = new THREE.Mesh(new THREE.TubeGeometry(path, 200, R * 0.014, 8, true), rimMat);
	rim.name = 'untangle-rim';
	rim.position.z = -R * 0.05;
	group.add(rim);
	return {
		group,
		/** @param {boolean} won */
		setWon(won) {
			rimMat.color.setHex(won ? GREEN : AMBER);
		}
	};
}

/** the hover ring around the dot under the pointer @param {any} THREE */
export function makeHoverRing(THREE) {
	const ring = new THREE.Mesh(
		new THREE.TorusGeometry(1, 0.1, 10, 48),
		new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false })
	);
	ring.name = 'untangle-hover';
	ring.visible = false;
	ring.renderOrder = 2;
	return ring;
}

/**
 * The solve BURST: sparks thrown out from every dot plus an expanding ring, ~1.4 s.
 * Deterministic per burst (a fixed angle pattern), local only (nothing replicates).
 * @param {any} THREE
 */
export function makeBurst(THREE) {
	const MAX = 256;
	const positions = new Float32Array(MAX * 3);
	const origin = new Float32Array(MAX * 3);
	const velocity = new Float32Array(MAX * 3);
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	// a soft round spark (PointsMaterial draws squares without a map)
	let map = null;
	if (typeof document !== 'undefined') {
		const c = document.createElement('canvas');
		c.width = c.height = 64;
		const g = c.getContext('2d');
		const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
		grad.addColorStop(0, 'rgba(255,255,255,1)');
		grad.addColorStop(0.35, 'rgba(255,255,255,0.7)');
		grad.addColorStop(1, 'rgba(255,255,255,0)');
		g.fillStyle = grad;
		g.fillRect(0, 0, 64, 64);
		map = new THREE.CanvasTexture(c);
	}
	const material = new THREE.PointsMaterial({
		map,
		color: GREEN,
		size: 0.05,
		transparent: true,
		opacity: 1,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		toneMapped: false
	});
	const points = new THREE.Points(geometry, material);
	points.name = 'untangle-burst';
	points.visible = false;
	points.frustumCulled = false;
	const wave = new THREE.Mesh(
		new THREE.TorusGeometry(1, 0.012, 8, 96),
		new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false })
	);
	wave.name = 'untangle-wave';
	wave.visible = false;
	const DURATION = 1.4;
	let startedAt = -1;
	let count = 0;
	let fired = 0;
	return {
		points,
		wave,
		DURATION,
		fired: () => fired,
		active: () => startedAt >= 0,
		/**
		 * @param {any[]} centres THREE.Vector3 per dot (group frame)
		 * @param {(c: any) => any} outward the direction sparks fly from a centre (unit)
		 * @param {number} scale board radius
		 * @param {boolean} flat 2D: the wave lies in the board plane; 3D: no wave
		 */
		start(centres, outward, scale, flat, now) {
			count = 0;
			const per = Math.max(6, Math.floor(MAX / Math.max(1, centres.length)));
			centres.forEach((c, k) => {
				const out = outward(c);
				for (let j = 0; j < per && count < MAX; j++, count++) {
					const angle = (j / per) * Math.PI * 2 + k * 0.7;
					// a fan around `out`: sideways components on two perpendicular axes
					const sx = Math.cos(angle);
					const sy = Math.sin(angle);
					const px = Math.abs(out.z) > 0.9 ? 1 : 0;
					const side1 = new THREE.Vector3(px, 1 - px, 0).cross(out).normalize();
					const side2 = out.clone().cross(side1).normalize();
					const v = out
						.clone()
						.multiplyScalar(flat ? 0.15 : 0.6)
						.addScaledVector(side1, sx)
						.addScaledVector(side2, sy)
						.normalize()
						.multiplyScalar(scale * (0.35 + 0.25 * ((j * 7) % 5) / 5));
					origin.set([c.x, c.y, c.z], count * 3);
					velocity.set([v.x, v.y, v.z], count * 3);
				}
			});
			geometry.setDrawRange(0, count);
			material.size = scale * 0.09;
			points.visible = true;
			wave.visible = flat;
			wave.scale.setScalar(0.01);
			startedAt = now;
			fired++;
		},
		/** @param {number} now seconds (performance clock) */
		tick(now) {
			if (startedAt < 0) return;
			const t = (now - startedAt) / DURATION;
			if (t >= 1) {
				startedAt = -1;
				points.visible = false;
				wave.visible = false;
				return;
			}
			const ease = 1 - Math.pow(1 - t, 3);
			for (let i = 0; i < count * 3; i++) positions[i] = origin[i] + velocity[i] * ease;
			geometry.attributes.position.needsUpdate = true;
			material.opacity = 1 - t;
			wave.scale.setScalar(0.05 + ease * 1.6);
			wave.material.opacity = 0.8 * (1 - t);
		},
		stop() {
			startedAt = -1;
			points.visible = false;
			wave.visible = false;
		}
	};
}

/**
 * P3 — the GLOBE the 3D mode plays on: a dark glassy sphere, a faint graticule that turns
 * with the player's local view (so a rotation reads), and a thin atmosphere rim. The dots and
 * arcs sit on its surface (index.js); `setWon` tints it green.
 * @param {any} THREE @param {number} R globe radius
 */
export function makeGlobe(THREE, R) {
	const group = new THREE.Group();
	group.name = 'untangle-globe';
	const bodyMat = new THREE.MeshStandardMaterial({
		color: 0x0c1526,
		roughness: 0.62, // a glossier globe threw two blurry lamp highlights across the arcs
		metalness: 0.12,
		emissive: 0x0a1a33,
		emissiveIntensity: 0.6,
		transparent: true,
		opacity: 0.94
	});
	const body = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 40), bodyMat);
	body.name = 'untangle-globe-body';
	group.add(body);
	// the graticule: 12 meridians + 5 parallels, a hair off the surface, in the GLOBE frame
	const pts = [];
	const r = R * 1.001;
	for (let m = 0; m < 12; m++) {
		const lon = (m / 12) * Math.PI * 2;
		for (let k = 0; k < 48; k++) {
			const a = (k / 48) * Math.PI - Math.PI / 2;
			const b = ((k + 1) / 48) * Math.PI - Math.PI / 2;
			pts.push(Math.cos(a) * Math.cos(lon) * r, Math.sin(a) * r, Math.cos(a) * Math.sin(lon) * r);
			pts.push(Math.cos(b) * Math.cos(lon) * r, Math.sin(b) * r, Math.cos(b) * Math.sin(lon) * r);
		}
	}
	for (const lat of [-60, -30, 0, 30, 60]) {
		const a = (lat * Math.PI) / 180;
		for (let k = 0; k < 72; k++) {
			const l0 = (k / 72) * Math.PI * 2;
			const l1 = ((k + 1) / 72) * Math.PI * 2;
			pts.push(Math.cos(a) * Math.cos(l0) * r, Math.sin(a) * r, Math.cos(a) * Math.sin(l0) * r);
			pts.push(Math.cos(a) * Math.cos(l1) * r, Math.sin(a) * r, Math.cos(a) * Math.sin(l1) * r);
		}
	}
	const gratGeo = new THREE.BufferGeometry();
	gratGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
	const graticule = new THREE.LineSegments(gratGeo, new THREE.LineBasicMaterial({ color: 0x2b4166, transparent: true, opacity: 0.55 }));
	graticule.name = 'untangle-graticule';
	group.add(graticule);
	const rimMat = new THREE.MeshBasicMaterial({
		color: 0x3b82f6,
		transparent: true,
		opacity: 0.16,
		side: THREE.BackSide,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		toneMapped: false
	});
	const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(R * 1.06, 48, 32), rimMat);
	atmosphere.name = 'untangle-atmosphere';
	group.add(atmosphere);
	return {
		group,
		body,
		graticule,
		/** @param {boolean} won */
		setWon(won) {
			bodyMat.emissive.setHex(won ? 0x0b3a26 : 0x0a1a33);
			rimMat.color.setHex(won ? GREEN : 0x3b82f6);
		}
	};
}
