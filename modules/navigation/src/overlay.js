// navigation — WHAT YOU SEE: the navmesh overlay (G1) and the NPC debug view (G7).
//
//   Navmesh overlay   the walkable area as a green film over the floor, moving obstacles as red
//                     boxes. Any mode (it is how you check a level before playing).
//   NPC debug view    per enemy: its path line and a state label over its head ("chase: target
//                     lost 2 s", "patrol (can't reach: blocked)"). Play and Interact only.
//
// Both are LOCAL (a View-menu toggle per device), live at the scene root outside the saved
// objects, and NEVER draw in an exported game.

const STATE_COLORS = { idle: '#9aa4b2', patrol: '#4fb3ff', alert: '#ffc94d', chase: '#ff8a3d', attack: '#ff4d4d', return: '#b38cff' };

/** @param {any} api @param {ReturnType<import('./runtime.js').createRuntime>} rt */
export function createOverlay(api, rt) {
	const THREE = api.THREE;
	const group = new THREE.Group();
	group.name = 'navigation-debug';
	group.userData.navIgnore = true;
	let attached = false;

	const meshMat = new THREE.MeshBasicMaterial({ color: 0x35d07f, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
	const edgeMat = new THREE.LineBasicMaterial({ color: 0x1c8a4f, transparent: true, opacity: 0.6, depthWrite: false });
	const obstacleMat = new THREE.LineBasicMaterial({ color: 0xff4d4d, depthWrite: false });
	const pathMat = new THREE.LineBasicMaterial({ color: 0xffe14d, depthTest: false, transparent: true });
	/** @type {any} */
	let navMesh = null;
	/** @type {any} */
	let navEdges = null;
	let navVersion = -1;
	/** @type {Map<string, any>} */
	const obstacleBoxes = new Map();
	/** uuid -> {line, sprite, canvas, ctx, tex, text} @type {Map<string, any>} */
	const npcViews = new Map();

	function attach() {
		if (attached) return;
		api.scene()?.add(group);
		attached = true;
	}
	function detach() {
		if (!attached) return;
		group.parent?.remove(group);
		attached = false;
	}

	function rebuildNavMesh() {
		navVersion = rt.bake.version;
		if (navMesh) {
			group.remove(navMesh);
			navMesh.geometry.dispose();
			navMesh = null;
		}
		if (navEdges) {
			group.remove(navEdges);
			navEdges.geometry.dispose();
			navEdges = null;
		}
		const dbg = rt.bake.debug;
		if (!dbg || !dbg.indices?.length) return;
		const g = new THREE.BufferGeometry();
		const pos = new Float32Array(dbg.positions);
		for (let i = 1; i < pos.length; i += 3) pos[i] += 0.04; // a film just above the floor
		g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		g.setIndex(new THREE.BufferAttribute(new Uint32Array(dbg.indices), 1));
		navMesh = new THREE.Mesh(g, meshMat);
		navMesh.name = 'navmesh-overlay';
		navMesh.renderOrder = 2;
		navMesh.raycast = () => {};
		navEdges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 1), edgeMat);
		navEdges.raycast = () => {};
		group.add(navMesh, navEdges);
	}

	function syncObstacles() {
		const want = new Map(rt.obstacles.map((o) => [o.key, o]));
		for (const [key, line] of obstacleBoxes) {
			if (want.has(key)) continue;
			group.remove(line);
			line.geometry.dispose();
			obstacleBoxes.delete(key);
		}
		for (const [key, o] of want) {
			let line = obstacleBoxes.get(key);
			const box = new THREE.Box3(new THREE.Vector3(...o.min), new THREE.Vector3(...o.max));
			if (!line) {
				line = new THREE.Box3Helper(box, 0xff4d4d);
				line.material = obstacleMat;
				line.raycast = () => {};
				obstacleBoxes.set(key, line);
				group.add(line);
			} else line.box.copy(box);
		}
	}

	function clearObstacles() {
		for (const line of obstacleBoxes.values()) {
			group.remove(line);
			line.geometry.dispose();
		}
		obstacleBoxes.clear();
	}

	/** a label sprite (canvas texture, redrawn only when its text changes) */
	function makeView() {
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 96;
		const ctx = canvas.getContext('2d');
		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
		sprite.scale.set(2.4, 0.45, 1);
		sprite.renderOrder = 10;
		sprite.raycast = () => {};
		const line = new THREE.Line(new THREE.BufferGeometry(), pathMat);
		line.renderOrder = 9;
		line.frustumCulled = false;
		line.raycast = () => {};
		group.add(sprite, line);
		return { sprite, line, canvas, ctx, tex, text: '' };
	}

	/** @param {any} v @param {string} text @param {string} color */
	function drawLabel(v, text, color) {
		if (v.text === text) return;
		v.text = text;
		const { ctx, canvas } = v;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.font = '600 34px system-ui, sans-serif';
		const w = Math.min(canvas.width - 8, ctx.measureText(text).width + 36);
		const x = (canvas.width - w) / 2;
		ctx.fillStyle = 'rgba(14,16,20,0.82)';
		ctx.beginPath();
		ctx.roundRect?.(x, 14, w, 64, 14);
		if (!ctx.roundRect) ctx.rect(x, 14, w, 64);
		ctx.fill();
		ctx.fillStyle = color;
		ctx.fillRect(x + 12, 38, 12, 16);
		ctx.fillStyle = '#f2f4f8';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, x + 30, 47, w - 40);
		v.tex.needsUpdate = true;
	}

	function syncNpcs() {
		const live = new Set();
		for (const [uuid, s] of rt.shown) {
			if (!s.disp) continue;
			live.add(uuid);
			let v = npcViews.get(uuid);
			if (!v) {
				v = makeView();
				npcViews.set(uuid, v);
			}
			const color = STATE_COLORS[/** @type {keyof typeof STATE_COLORS} */ (s.state)] ?? '#9aa4b2';
			drawLabel(v, s.label || s.state || 'idle', color);
			v.sprite.position.set(s.disp[0], s.disp[1] + 2.1, s.disp[2]);
			const pts = [new THREE.Vector3(s.disp[0], s.disp[1] + 0.1, s.disp[2])];
			for (const c of s.corners ?? []) pts.push(new THREE.Vector3(c[0], c[1] + 0.1, c[2]));
			v.line.geometry.setFromPoints(pts);
			v.line.visible = pts.length > 1;
		}
		for (const [uuid, v] of npcViews) {
			if (live.has(uuid)) continue;
			disposeView(v);
			npcViews.delete(uuid);
		}
	}

	/** @param {any} v */
	function disposeView(v) {
		group.remove(v.sprite, v.line);
		v.tex.dispose();
		v.sprite.material.dispose();
		v.line.geometry.dispose();
	}

	function clearNpcs() {
		for (const v of npcViews.values()) disposeView(v);
		npcViews.clear();
	}

	/** every frame */
	function update() {
		const exported = !!api.isExport?.();
		const showMesh = rt.want.overlay && !exported;
		const showNpcs = rt.want.debug && !exported && rt.active();
		if (!showMesh && !showNpcs) {
			if (attached) {
				clearNpcs();
				clearObstacles();
				detach();
			}
			return;
		}
		attach();
		if (showMesh) {
			if (navVersion !== rt.bake.version) rebuildNavMesh();
			syncObstacles();
		} else {
			if (navMesh || navEdges) {
				navVersion = -1;
				rebuildNavMeshClear();
			}
			clearObstacles();
		}
		if (showNpcs) syncNpcs();
		else clearNpcs();
	}

	function rebuildNavMeshClear() {
		for (const m of [navMesh, navEdges]) {
			if (!m) continue;
			group.remove(m);
			m.geometry.dispose();
		}
		navMesh = null;
		navEdges = null;
	}

	api.onUnload(() => {
		clearNpcs();
		clearObstacles();
		rebuildNavMeshClear();
		detach();
		meshMat.dispose();
		edgeMat.dispose();
		obstacleMat.dispose();
		pathMat.dispose();
	});

	return {
		update,
		group,
		/** what is drawn right now (a test reads it) */
		info: () => ({ attached, navTriangles: navMesh ? navMesh.geometry.index.count / 3 : 0, obstacles: obstacleBoxes.size, npcLabels: [...npcViews.values()].map((v) => v.text) })
	};
}
