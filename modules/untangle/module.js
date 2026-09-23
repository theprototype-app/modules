// modules/untangle/src/puzzle.js
function mulberry32(seed) {
  let t = seed >>> 0;
  return function() {
    t = t + 1831565813 >>> 0;
    let r = Math.imul(t ^ t >>> 15, t | 1);
    r ^= r + Math.imul(r ^ r >>> 7, r | 61);
    return ((r ^ r >>> 14) >>> 0) / 4294967296;
  };
}
function chordsCross(a, b, c, d, n) {
  const between = (x, lo, hi) => {
    const span = (hi - lo + n) % n;
    const off = (x - lo + n) % n;
    return off > 0 && off < span;
  };
  if (a === c || a === d || b === c || b === d) return false;
  return between(c, a, b) !== between(d, a, b);
}
var CURVE_LEVELS = 30;
var curveLevel = (lvl) => Math.min(Math.max(1, Math.round(Number(lvl) || 1)), CURVE_LEVELS);
function dotsFor(lvl) {
  return 5 + Math.round((curveLevel(lvl) - 1) * 11 / (CURVE_LEVELS - 1));
}
function chordsFor(lvl, n = dotsFor(lvl)) {
  const t = (curveLevel(lvl) - 1) / (CURVE_LEVELS - 1);
  return Math.max(1, Math.min(n - 3, Math.round((n - 3) * (0.35 + 0.45 * t))));
}
function minStartCrossings(lvl) {
  const l = curveLevel(lvl);
  return l <= 2 ? 1 : l <= 8 ? 2 : 3;
}
function generate(lvl) {
  const rand = mulberry32(2654435769 ^ lvl * 2654435761);
  const n = dotsFor(lvl);
  const edges = [];
  for (let i = 0; i < n; i++) edges.push([i, (i + 1) % n]);
  const chords = [];
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) if (!(i === 0 && j === n - 1)) chords.push([i, j]);
  for (let i = chords.length - 1; i > 0; i--) {
    const k = Math.floor(rand() * (i + 1));
    const swap = chords[i];
    chords[i] = chords[k];
    chords[k] = swap;
  }
  const wanted = chordsFor(lvl, n);
  let added = 0;
  for (const [a, b] of chords) {
    if (added >= wanted) break;
    if (edges.some(([c, d]) => chordsCross(a, b, c, d, n))) continue;
    edges.push([a, b]);
    added++;
  }
  return { n, edges, positions: scramble(rand, n, edges, minStartCrossings(lvl)) };
}
function minSeparation(n) {
  return Math.max(0.2, 0.42 - n * 0.014);
}
function scramble(rand, n, edges, need) {
  const sep = minSeparation(n);
  let best = null;
  let bestCount = -1;
  for (let attempt = 0; attempt < 24; attempt++) {
    const positions = [];
    for (let i = 0; i < n; i++) {
      let p = null;
      for (let tries = 0; tries < 60; tries++) {
        const angle = rand() * Math.PI * 2;
        const radius = Math.sqrt(rand()) * 0.9;
        p = [Math.cos(angle) * radius, Math.sin(angle) * radius];
        const q = p;
        if (positions.every((o) => Math.hypot(o[0] - q[0], o[1] - q[1]) >= sep)) break;
      }
      positions.push(
        /** @type {number[]} */
        p
      );
    }
    const count = totalCrossings(edgeCrossings(positions, edges));
    if (count >= need) return positions;
    if (count > bestCount) {
      bestCount = count;
      best = positions;
    }
  }
  return (
    /** @type {number[][]} */
    best
  );
}
function segsCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (c[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (c[1] - a[1]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return (d1 > 0 && d2 < 0 || d1 < 0 && d2 > 0) && (d3 > 0 && d4 < 0 || d3 < 0 && d4 > 0);
}
function edgeCrossings(positions, edges) {
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
function totalCrossings(counts) {
  return counts.reduce((sum, c) => sum + c, 0) / 2;
}
function solvedPositions(n, scale = 0.85) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const angle = i / n * Math.PI * 2;
    out.push([Math.cos(angle) * scale, Math.sin(angle) * scale]);
  }
  return out;
}
function clampToBoard(p) {
  return [Math.max(-1, Math.min(1, p[0])), Math.max(-1, Math.min(1, p[1]))];
}
var DEFAULT_BOARD = { level: 1, radius: 1.1, boardY: 1.6, x: 0, z: 0, yaw: 0, autoAdvance: true };

// modules/untangle/src/gesture.js
var TAP_PX = 6;
var HOLD_MS = 500;
function createGesture(hooks) {
  const now = hooks.now ?? (() => performance.now());
  let press = null;
  let clickCarry = false;
  let swallowUp = null;
  let rotate = null;
  let menuSuppressUntil = 0;
  const touches = /* @__PURE__ */ new Map();
  let lastUp = "none";
  const mid = () => {
    let x = 0;
    let y = 0;
    for (const t of touches.values()) {
      x += t.x;
      y += t.y;
    }
    return { x: x / Math.max(1, touches.size), y: y / Math.max(1, touches.size) };
  };
  function down(e) {
    if (!hooks.active()) return;
    if (e.pointerType === "touch") touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2 && hooks.rotateStart && !hooks.carrying() && hooks.isViewport(e) && hooks.rotateStart(e)) {
      const m = mid();
      rotate = { id: -1, x: m.x, y: m.y, touch: true };
      press = null;
      e.stopPropagation();
      return;
    }
    if (e.button === 2) {
      if (hooks.rotateStart && !hooks.carrying() && hooks.isViewport(e) && hooks.rotateStart(e)) {
        rotate = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: false };
        menuSuppressUntil = now() + 6e4;
        e.stopPropagation();
      }
      return;
    }
    if (e.button !== 0) return;
    if (hooks.carrying()) {
      const viewport = hooks.isViewport(e);
      press = null;
      clickCarry = false;
      hooks.drop(viewport ? "click" : "ui", e);
      if (viewport) {
        swallowUp = e.pointerId;
        e.stopPropagation();
      }
      return;
    }
    if (!hooks.isViewport(e)) return;
    const i = hooks.pickAt(e);
    if (i < 0) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now(), travel: 0 };
    clickCarry = false;
    hooks.pick(i, "press");
    e.stopPropagation();
  }
  function move(e) {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (rotate) {
      if (rotate.touch && touches.size >= 2) {
        const m = mid();
        hooks.rotateBy?.(m.x - rotate.x, m.y - rotate.y);
        rotate.x = m.x;
        rotate.y = m.y;
      } else if (!rotate.touch && e.pointerId === rotate.id) {
        const dx = hooks.locked() ? e.movementX ?? 0 : e.clientX - rotate.x;
        const dy = hooks.locked() ? e.movementY ?? 0 : e.clientY - rotate.y;
        hooks.rotateBy?.(dx, dy);
        rotate.x = e.clientX;
        rotate.y = e.clientY;
      }
      return;
    }
    if (press && e.pointerId === press.id) {
      if (hooks.locked()) press.travel += Math.abs(e.movementX ?? 0) + Math.abs(e.movementY ?? 0);
      else press.travel = Math.max(press.travel, Math.hypot(e.clientX - press.x, e.clientY - press.y));
    }
  }
  function up(e) {
    touches.delete(e.pointerId);
    if (swallowUp === e.pointerId) {
      swallowUp = null;
      lastUp = "swallowed";
      e.stopPropagation();
      return;
    }
    if (rotate && (rotate.touch ? touches.size < 2 : e.pointerId === rotate.id)) {
      rotate = null;
      menuSuppressUntil = now() + 400;
      lastUp = "rotate";
      e.stopPropagation();
      return;
    }
    if (!press || e.pointerId !== press.id) return;
    const held = now() - press.t;
    const moved = press.travel > TAP_PX;
    press = null;
    e.stopPropagation();
    if (!hooks.carrying()) return;
    if (moved || held > HOLD_MS) {
      lastUp = "release";
      hooks.drop("release", e);
    } else {
      lastUp = "tap";
      clickCarry = true;
    }
  }
  function cancel(e) {
    touches.delete(e.pointerId);
    if (rotate && !rotate.touch && e.pointerId === rotate.id) rotate = null;
    if (press && e.pointerId === press.id) {
      press = null;
      if (hooks.carrying()) hooks.drop("cancel", e);
    }
  }
  function menu(e) {
    if (rotate || now() < menuSuppressUntil) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
  const target = hooks.target;
  target.addEventListener("pointerdown", down, true);
  target.addEventListener("pointermove", move, true);
  target.addEventListener("pointerup", up, true);
  target.addEventListener("pointercancel", cancel, true);
  target.addEventListener("contextmenu", menu, true);
  return {
    detach() {
      target.removeEventListener("pointerdown", down, true);
      target.removeEventListener("pointermove", move, true);
      target.removeEventListener("pointerup", up, true);
      target.removeEventListener("pointercancel", cancel, true);
      target.removeEventListener("contextmenu", menu, true);
      press = null;
      rotate = null;
    },
    /** a carry that ended elsewhere (a scene clear, a level change, the VR path) */
    reset() {
      press = null;
      clickCarry = false;
    },
    /** 'press' while held, 'click' while a tap carries, 'none' otherwise */
    carryMode: () => press ? "press" : clickCarry ? "click" : "none",
    rotating: () => !!rotate,
    lastUp: () => lastUp
  };
}

// modules/untangle/src/aim.js
function makeAim(api, THREE) {
  const ndc = new THREE.Vector2();
  const forward = new THREE.Vector3();
  const at = new THREE.Vector3();
  const want = new THREE.Vector3();
  let lastMode = "none";
  const locked = () => typeof document !== "undefined" && !!document.pointerLockElement;
  function sceneCamera() {
    const scene = api.scene?.();
    if (!scene) return null;
    const pos = api.playerPosition?.();
    if (pos) want.set(pos[0], pos[1], pos[2]);
    let best = null;
    let bestD = Infinity;
    scene.traverse((o) => {
      if (!o.isCamera) return;
      const d = pos ? o.getWorldPosition(at).distanceToSquared(want) : 0;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    });
    return best;
  }
  function camera() {
    const r = api.pointerRay?.();
    return r?.camera ?? sceneCamera();
  }
  function fromClient(x, y, canvas) {
    if (locked()) return crosshair();
    const cam = camera();
    if (!cam || !canvas?.getBoundingClientRect) return null;
    const rect = canvas.getBoundingClientRect();
    ndc.set((x - rect.left) / rect.width * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, cam);
    lastMode = "cursor";
    return ray;
  }
  function crosshair() {
    const r = api.pointerRay?.();
    const cam = r?.camera ?? sceneCamera();
    if (!cam) return r ?? null;
    cam.updateMatrixWorld?.();
    cam.getWorldDirection(forward);
    if (r && r.ray.direction.angleTo(forward) < 2e-3) {
      lastMode = "api";
      return r;
    }
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc.set(0, 0), cam);
    lastMode = "crosshair";
    return ray;
  }
  function current() {
    if (api.isVR?.()) {
      lastMode = "vr";
      return api.pointerRay?.() ?? null;
    }
    if (locked()) return crosshair();
    lastMode = "cursor";
    return api.pointerRay?.() ?? null;
  }
  return { current, fromClient, crosshair, camera, locked, mode: () => lastMode };
}

// modules/untangle/src/look.js
var RED = 16731486;
var GREEN = 4120719;
var AMBER = 16498468;
var COLORS = { RED, GREEN, AMBER };
function makeEdgeLayer(THREE, capacity) {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  const coreMat = new THREE.MeshBasicMaterial({ color: 16777215, toneMapped: false });
  const glowMat = new THREE.MeshBasicMaterial({
    color: 16777215,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  });
  const core = new THREE.InstancedMesh(geometry, coreMat, capacity);
  const glow = new THREE.InstancedMesh(geometry, glowMat, capacity);
  core.name = "untangle-edges";
  glow.name = "untangle-edges-glow";
  for (const mesh of [core, glow]) {
    mesh.frustumCulled = false;
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
        const len2 = dir.length() || 1e-6;
        mid.addVectors(s.a, s.b).multiplyScalar(0.5);
        quat.setFromUnitVectors(up, dir.divideScalar(len2));
        color.setHex(s.color);
        const reach = len2 + radius * 2;
        matrix.compose(mid, quat, scale.set(radius, reach, radius));
        core.setMatrixAt(i, matrix);
        core.setColorAt(i, color);
        matrix.compose(mid, quat, scale.set(radius * 3.2, len2, radius * 3.2));
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
function makeBackplate(THREE, R) {
  const group = new THREE.Group();
  group.name = "untangle-backplate";
  const h = R * 1.24;
  const plate = new THREE.Mesh(
    new THREE.ShapeGeometry(roundedRect(THREE, h, R * 0.16), 6),
    new THREE.MeshStandardMaterial({ color: 988966, roughness: 0.85, metalness: 0, transparent: true, opacity: 0.93 })
  );
  plate.name = "untangle-plate";
  plate.position.z = -R * 0.06;
  plate.receiveShadow = false;
  plate.castShadow = false;
  group.add(plate);
  const lines = [];
  for (let k = -4; k <= 4; k++) {
    const v = k / 4 * R;
    lines.push(-R, v, 0, R, v, 0, v, -R, 0, v, R, 0);
  }
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
  const grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 1976893, transparent: true, opacity: 0.8 }));
  grid.name = "untangle-grid";
  grid.raycast = () => {
  };
  grid.position.z = -R * 0.055;
  group.add(grid);
  const outline = roundedRect(THREE, h, R * 0.16).getSpacedPoints(200);
  outline.pop();
  const path = new THREE.CatmullRomCurve3(outline.map((p) => new THREE.Vector3(p.x, p.y, 0)), true);
  const rimMat = new THREE.MeshBasicMaterial({ color: AMBER, toneMapped: false });
  const rim = new THREE.Mesh(new THREE.TubeGeometry(path, 200, R * 0.014, 8, true), rimMat);
  rim.name = "untangle-rim";
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
function makeHoverRing(THREE) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.1, 10, 48),
    new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false })
  );
  ring.name = "untangle-hover";
  ring.visible = false;
  ring.renderOrder = 2;
  return ring;
}
function makeBurst(THREE) {
  const MAX = 256;
  const positions = new Float32Array(MAX * 3);
  const origin = new Float32Array(MAX * 3);
  const velocity = new Float32Array(MAX * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  let map = null;
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.7)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
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
  points.name = "untangle-burst";
  points.visible = false;
  points.frustumCulled = false;
  const wave = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.012, 8, 96),
    new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false })
  );
  wave.name = "untangle-wave";
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
          const angle = j / per * Math.PI * 2 + k * 0.7;
          const sx = Math.cos(angle);
          const sy = Math.sin(angle);
          const px = Math.abs(out.z) > 0.9 ? 1 : 0;
          const side1 = new THREE.Vector3(px, 1 - px, 0).cross(out).normalize();
          const side2 = out.clone().cross(side1).normalize();
          const v = out.clone().multiplyScalar(flat ? 0.15 : 0.6).addScaledVector(side1, sx).addScaledVector(side2, sy).normalize().multiplyScalar(scale * (0.35 + 0.25 * (j * 7 % 5) / 5));
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
function makeGlobe(THREE, R) {
  const group = new THREE.Group();
  group.name = "untangle-globe";
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 791846,
    roughness: 0.62,
    // a glossier globe threw two blurry lamp highlights across the arcs
    metalness: 0.12,
    emissive: 662067,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.94
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 40), bodyMat);
  body.name = "untangle-globe-body";
  group.add(body);
  const pts = [];
  const r = R * 1.001;
  for (let m = 0; m < 12; m++) {
    const lon = m / 12 * Math.PI * 2;
    for (let k = 0; k < 48; k++) {
      const a = k / 48 * Math.PI - Math.PI / 2;
      const b = (k + 1) / 48 * Math.PI - Math.PI / 2;
      pts.push(Math.cos(a) * Math.cos(lon) * r, Math.sin(a) * r, Math.cos(a) * Math.sin(lon) * r);
      pts.push(Math.cos(b) * Math.cos(lon) * r, Math.sin(b) * r, Math.cos(b) * Math.sin(lon) * r);
    }
  }
  for (const lat of [-60, -30, 0, 30, 60]) {
    const a = lat * Math.PI / 180;
    for (let k = 0; k < 72; k++) {
      const l0 = k / 72 * Math.PI * 2;
      const l1 = (k + 1) / 72 * Math.PI * 2;
      pts.push(Math.cos(a) * Math.cos(l0) * r, Math.sin(a) * r, Math.cos(a) * Math.sin(l0) * r);
      pts.push(Math.cos(a) * Math.cos(l1) * r, Math.sin(a) * r, Math.cos(a) * Math.sin(l1) * r);
    }
  }
  const gratGeo = new THREE.BufferGeometry();
  gratGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const graticule = new THREE.LineSegments(gratGeo, new THREE.LineBasicMaterial({ color: 2834790, transparent: true, opacity: 0.55 }));
  graticule.name = "untangle-graticule";
  group.add(graticule);
  const rimMat = new THREE.MeshBasicMaterial({
    color: 3900150,
    transparent: true,
    opacity: 0.16,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  });
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(R * 1.06, 48, 32), rimMat);
  atmosphere.name = "untangle-atmosphere";
  group.add(atmosphere);
  return {
    group,
    body,
    graticule,
    /** @param {boolean} won */
    setWon(won) {
      bodyMat.emissive.setHex(won ? 735782 : 662067);
      rimMat.color.setHex(won ? GREEN : 3900150);
    }
  };
}

// modules/untangle/src/sphere.js
var dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
var cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
var len = (a) => Math.hypot(a[0], a[1], a[2]);
function normalize(a) {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
}
var ANTIPODAL_GEN = -0.978;
var ANTIPODAL_PLAY = -0.998;
function fromDisc(p, k = 1.15) {
  return normalize([p[0] * k, p[1] * k, 1]);
}
function solvedSphere(n) {
  return solvedPositions(n).map((p) => fromDisc(p));
}
function arcPoints(a, b, segments) {
  const out = [];
  const cosT = Math.max(-1, Math.min(1, dot(a, b)));
  const theta = Math.acos(cosT);
  const s = Math.sin(theta);
  for (let k = 0; k <= segments; k++) {
    const t = k / segments;
    if (s < 1e-6) {
      out.push(normalize([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]));
      continue;
    }
    const wa = Math.sin((1 - t) * theta) / s;
    const wb = Math.sin(t * theta) / s;
    out.push([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb]);
  }
  return out;
}
function arcSegments(a, b) {
  return Math.max(2, Math.ceil(Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / 0.12));
}
function strictlyOn(q, a, b, n) {
  const eps = 1e-12 * dot(n, n);
  return dot(cross(a, q), n) > eps && dot(cross(q, b), n) > eps;
}
function arcIntersections(a, b, c, d) {
  const n1 = cross(a, b);
  const n2 = cross(c, d);
  const l1 = len(n1);
  const l2 = len(n2);
  if (l1 < 1e-12 || l2 < 1e-12) return [];
  const L = cross(n1, n2);
  const ll = len(L);
  if (ll < 1e-9 * l1 * l2) return sameCircleOverlap(a, b, c, d, n1) ? "overlap" : [];
  const p = [L[0] / ll, L[1] / ll, L[2] / ll];
  const out = [];
  for (const q of [p, [-p[0], -p[1], -p[2]]]) if (strictlyOn(q, a, b, n1) && strictlyOn(q, c, d, n2)) out.push(q);
  return out;
}
function sameCircleOverlap(a, b, c, d, n1) {
  const u = a;
  const w = normalize(cross(normalize(n1), a));
  const angle = (x) => Math.atan2(dot(x, w), dot(x, u));
  const tb = angle(b);
  const tc = angle(c);
  let delta = angle(d) - tc;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  const lo = Math.min(tc, tc + delta);
  const hi = Math.max(tc, tc + delta);
  for (const k of [-2 * Math.PI, 0, 2 * Math.PI]) {
    if (Math.min(hi + k, tb) - Math.max(lo + k, 0) > 1e-9) return true;
  }
  return false;
}
function arcsCross(a, b, c, d) {
  const hit = arcIntersections(a, b, c, d);
  return hit === "overlap" || hit.length > 0;
}
function edgeCrossings3(positions, edges) {
  const counts = edges.map(() => 0);
  const degenerate = edges.map(([a, b]) => dot(positions[a], positions[b]) < ANTIPODAL_PLAY);
  degenerate.forEach((bad, i) => {
    if (bad) counts[i] += 2;
  });
  for (let i = 0; i < edges.length; i++) {
    if (degenerate[i]) continue;
    for (let j = i + 1; j < edges.length; j++) {
      if (degenerate[j]) continue;
      const [a, b] = edges[i];
      const [c, d] = edges[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (arcsCross(positions[a], positions[b], positions[c], positions[d])) {
        counts[i]++;
        counts[j]++;
      }
    }
  }
  return counts;
}
var MIN_ANGLE = 0.36;
function generate3(lvl) {
  const g = generate(lvl);
  const rand = mulberry32((1374496523 ^ lvl * 2246822519) >>> 0);
  const need = minStartCrossings(lvl);
  const minCos = Math.cos(MIN_ANGLE);
  let best = null;
  let bestCount = -1;
  for (let attempt = 0; attempt < 40; attempt++) {
    const positions = [];
    for (let i = 0; i < g.n; i++) {
      let p = null;
      for (let tries = 0; tries < 80; tries++) {
        const z = rand() * 2 - 1;
        const phi = rand() * Math.PI * 2;
        const r = Math.sqrt(Math.max(0, 1 - z * z));
        p = [Math.cos(phi) * r, Math.sin(phi) * r, z];
        const q = p;
        if (positions.every((o) => dot(o, q) <= minCos)) break;
      }
      positions.push(
        /** @type {number[]} */
        p
      );
    }
    if (g.edges.some(([a, b]) => dot(positions[a], positions[b]) < ANTIPODAL_GEN)) continue;
    const count = edgeCrossings3(positions, g.edges).reduce((s, c) => s + c, 0) / 2;
    if (count >= need) return { n: g.n, edges: g.edges, positions };
    if (count > bestCount) {
      bestCount = count;
      best = positions;
    }
  }
  return { n: g.n, edges: g.edges, positions: (
    /** @type {number[][]} */
    best ?? solvedSphere(g.n)
  ) };
}

// modules/untangle/src/progress.js
var MAX_LEVEL = 30;
var MODES = ["2d", "3d"];
var PROGRESS_KEY = "progress";
var STORAGE_PREFIX = "tp:mod:untangle:";
function freshMode() {
  return { unlocked: 1, solved: [], best: {} };
}
function defaultProgress() {
  const out = {};
  for (const m of MODES) out[m] = freshMode();
  return out;
}
var isLevel = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_LEVEL;
function normalizeProgress(raw) {
  const out = defaultProgress();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const m of MODES) {
    const src = raw[m];
    if (!src || typeof src !== "object" || Array.isArray(src)) continue;
    const solved = Array.isArray(src.solved) ? [...new Set(src.solved.filter(isLevel))].sort((a, b) => a - b) : [];
    const fromSolved = solved.length ? Math.min(MAX_LEVEL, Math.max(...solved) + 1) : 1;
    const unlocked = isLevel(src.unlocked) ? src.unlocked : 1;
    const best = {};
    if (src.best && typeof src.best === "object" && !Array.isArray(src.best)) {
      for (const [k, v] of Object.entries(src.best)) {
        const lvl = Number(k);
        if (isLevel(lvl) && typeof v === "number" && Number.isFinite(v) && v > 0) best[String(lvl)] = Math.round(v);
      }
    }
    out[m] = { unlocked: Math.max(unlocked, fromSolved), solved, best };
  }
  return out;
}
function isUnlocked(progress, mode, level) {
  const p = progress?.[mode];
  return isLevel(level) && !!p && level <= p.unlocked;
}
function isSolved(progress, mode, level) {
  return !!progress?.[mode]?.solved?.includes(level);
}
function continueLevel(progress, mode) {
  const p = progress?.[mode] ?? freshMode();
  for (let l = 1; l <= p.unlocked; l++) if (!p.solved.includes(l)) return l;
  return Math.min(MAX_LEVEL, p.unlocked);
}
function recordSolve(progress, mode, level, ms) {
  const next = normalizeProgress(progress);
  const p = next[mode];
  if (!p || !Number.isInteger(level) || level < 1) return { progress: next, unlockedNew: false, newBest: false };
  const lvl = Math.min(level, MAX_LEVEL);
  if (!p.solved.includes(lvl)) p.solved = [...p.solved, lvl].sort((a, b) => a - b);
  const opened = Math.min(MAX_LEVEL, lvl + 1);
  const unlockedNew = opened > p.unlocked;
  if (unlockedNew) p.unlocked = opened;
  let newBest = false;
  if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) {
    const prior = p.best[String(lvl)];
    if (!(prior > 0) || ms < prior) {
      p.best[String(lvl)] = Math.round(ms);
      newBest = true;
    }
  }
  return { progress: next, unlockedNew, newBest };
}
function bestOf(progress, mode, level) {
  const v = progress?.[mode]?.best?.[String(level)];
  return typeof v === "number" && v > 0 ? v : null;
}
function formatTime(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "\u2014";
  const s = Math.floor(ms / 1e3);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
function makeStorage(api, backing = defaultBacking) {
  const s = api?.storage;
  if (s && typeof s.get === "function" && typeof s.set === "function") {
    return {
      kind: "api",
      get: (key) => {
        try {
          return s.get(key) ?? null;
        } catch {
          return null;
        }
      },
      set: (key, value) => {
        try {
          return s.set(key, value) !== false;
        } catch {
          return false;
        }
      },
      remove: (key) => {
        try {
          s.remove?.(key);
        } catch {
        }
      }
    };
  }
  const memory = /* @__PURE__ */ new Map();
  const store = () => {
    try {
      return backing() ?? null;
    } catch {
      return null;
    }
  };
  return {
    kind: "local",
    get(key) {
      const full = STORAGE_PREFIX + key;
      let raw = memory.get(full) ?? null;
      if (raw === null) {
        try {
          raw = store()?.getItem(full) ?? null;
        } catch {
          raw = null;
        }
      }
      if (raw === null) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    set(key, value) {
      const full = STORAGE_PREFIX + key;
      const text = JSON.stringify(value);
      const b = store();
      try {
        if (!b) throw new Error("no storage");
        b.setItem(full, text);
        memory.delete(full);
        return true;
      } catch {
        memory.set(full, text);
        return false;
      }
    },
    remove(key) {
      const full = STORAGE_PREFIX + key;
      memory.delete(full);
      try {
        store()?.removeItem(full);
      } catch {
      }
    }
  };
}
function defaultBacking() {
  return typeof localStorage === "undefined" ? null : localStorage;
}

// modules/untangle/src/menu.js
var AMBER2 = "#fbbf24";
var GREEN2 = "#3ee08f";
var LOCK_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M5 7V5a3 3 0 1 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-5A1.5 1.5 0 0 1 4.5 7H5zm1.5 0h3V5a1.5 1.5 0 1 0-3 0v2z"/></svg>';
var CHECK_SVG = '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M6.2 11.6 2.8 8.2l1.1-1.1 2.3 2.3 5.9-5.9 1.1 1.1z"/></svg>';
var style = (el, css) => Object.assign(el.style, css);
var inRuntimeLayer = (el) => !!el.closest?.("#hud-layer");
function makeMenuKinds(ctx) {
  const renders = /* @__PURE__ */ new Set();
  function mountLevels(el) {
    const root = document.createElement("div");
    root.className = "ut-levels";
    style(root, { display: "flex", flexDirection: "column", gap: "10px", width: "100%", height: "100%", boxSizing: "border-box", color: "#e5e9f0", font: "inherit", userSelect: "none" });
    el.appendChild(root);
    let confirming = false;
    const button = (label, css = {}) => {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = label;
      style(b, { font: "inherit", fontSize: "13px", fontWeight: "600", border: "1px solid rgba(148,163,184,0.25)", borderRadius: "8px", background: "rgba(30,41,59,0.9)", color: "#e5e9f0", cursor: "pointer", pointerEvents: "auto", padding: "6px 10px", ...css });
      return b;
    };
    function render() {
      const live = inRuntimeLayer(el);
      const v = ctx.view();
      root.replaceChildren();
      style(root, { pointerEvents: live ? "auto" : "none" });
      if (v.modes.length > 1) {
        const modes = document.createElement("div");
        modes.className = "ut-modes";
        style(modes, { display: "flex", gap: "6px", justifyContent: "center" });
        for (const m of v.modes) {
          const on = m === v.mode;
          const b = button(m === "2d" ? "2D board" : "3D globe", {
            flex: "1",
            background: on ? AMBER2 : "rgba(30,41,59,0.9)",
            color: on ? "#1a1305" : "#e5e9f0",
            borderColor: on ? AMBER2 : "rgba(148,163,184,0.25)"
          });
          b.dataset.mode = m;
          b.setAttribute("aria-pressed", String(on));
          b.onclick = () => live && !on && ctx.pickMode(m);
          modes.appendChild(b);
        }
        root.appendChild(modes);
      }
      const grid = document.createElement("div");
      grid.className = "ut-grid";
      style(grid, { display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "6px", flex: "1" });
      const next = continueLevel(v.progress, v.mode);
      for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
        const open = isUnlocked(v.progress, v.mode, lvl);
        const solved = isSolved(v.progress, v.mode, lvl);
        const current = lvl === v.level;
        const isNext = open && lvl === next;
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "ut-cell";
        cell.dataset.level = String(lvl);
        cell.dataset.state = !open ? "locked" : solved ? "solved" : isNext ? "next" : "open";
        if (current) cell.dataset.current = "1";
        const best = bestOf(v.progress, v.mode, lvl);
        cell.title = !open ? "Level " + lvl + " \u2014 locked: solve level " + (lvl - 1) + " first" : "Level " + lvl + (best ? " \u2014 best " + formatTime(best) : "");
        cell.innerHTML = open ? "<span>" + lvl + "</span>" + (solved ? '<span style="position:absolute;top:2px;right:3px;color:' + GREEN2 + '">' + CHECK_SVG + "</span>" : "") : LOCK_SVG;
        style(cell, {
          position: "relative",
          font: "inherit",
          fontSize: "14px",
          fontWeight: "700",
          minHeight: "30px",
          borderRadius: "8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: live && open ? "auto" : "none",
          cursor: open ? "pointer" : "default",
          border: "1px solid " + (isNext ? AMBER2 : current ? "rgba(251,191,36,0.55)" : "rgba(148,163,184,0.2)"),
          boxShadow: isNext ? "0 0 0 2px rgba(251,191,36,0.35), 0 0 14px rgba(251,191,36,0.35)" : "none",
          background: !open ? "rgba(15,23,42,0.55)" : current ? "rgba(251,191,36,0.22)" : solved ? "rgba(62,224,143,0.12)" : "rgba(30,41,59,0.9)",
          color: !open ? "#475569" : "#e5e9f0"
        });
        if (!open) {
          cell.disabled = true;
          cell.setAttribute("aria-disabled", "true");
        } else cell.onclick = () => live && ctx.pickLevel(lvl);
        grid.appendChild(cell);
      }
      root.appendChild(grid);
      const foot = document.createElement("div");
      style(foot, { display: "flex", gap: "8px", alignItems: "center" });
      if (!confirming) {
        const cont = button("Continue \xB7 Level " + next, { flex: "1", background: "rgba(217,119,6,0.95)", borderColor: "rgba(251,191,36,0.6)", color: "#fff" });
        cont.className = "ut-continue";
        cont.onclick = () => live && ctx.continueGame();
        const reset = button("Reset progress", { background: "transparent", color: "#94a3b8" });
        reset.className = "ut-reset";
        reset.onclick = () => {
          if (!live) return;
          confirming = true;
          render();
        };
        foot.append(cont, reset);
      } else {
        const q = document.createElement("span");
        q.textContent = "Reset ALL progress in both modes?";
        style(q, { flex: "1", fontSize: "13px", color: "#fca5a5" });
        const yes = button("Reset", { background: "#b91c1c", borderColor: "#ef4444", color: "#fff" });
        yes.className = "ut-reset-yes";
        yes.onclick = () => {
          confirming = false;
          ctx.resetProgress();
        };
        const no = button("Keep", {});
        no.className = "ut-reset-no";
        no.onclick = () => {
          confirming = false;
          render();
        };
        foot.append(q, yes, no);
      }
      root.appendChild(foot);
    }
    render();
    renders.add(render);
    return {
      update: () => render(),
      destroy() {
        renders.delete(render);
        root.remove();
      }
    };
  }
  function mountStats(el, element) {
    const root = document.createElement("div");
    root.className = "ut-stats";
    style(root, { font: "inherit", width: "100%", height: "100%", display: "flex", alignItems: "center", gap: "14px", color: "#cbd5e1", fontSize: "14px", fontVariantNumeric: "tabular-nums", pointerEvents: "none" });
    el.appendChild(root);
    let show = element?.show === "result" ? "result" : "play";
    const render = () => {
      const t = ctx.time();
      if (show === "result") {
        style(root, { justifyContent: "center", fontSize: "16px" });
        root.innerHTML = '<span>Time <b style="color:#fff">' + formatTime(t.ms) + '</b></span><span>Best <b style="color:' + AMBER2 + '">' + formatTime(t.best) + "</b></span>" + (t.newBest ? '<span class="ut-newbest" style="color:' + GREEN2 + ';font-weight:700">NEW BEST</span>' : "");
      } else {
        style(root, { justifyContent: "flex-start", fontSize: "14px" });
        root.innerHTML = '<span>\u23F1 <b class="ut-time" style="color:#fff">' + formatTime(t.ms) + '</b></span><span style="color:#94a3b8">best <b style="color:' + AMBER2 + '">' + formatTime(t.best) + "</b></span>";
      }
    };
    render();
    const timer = setInterval(render, 250);
    renders.add(render);
    return {
      update(next) {
        show = next?.show === "result" ? "result" : "play";
        render();
      },
      destroy() {
        clearInterval(timer);
        renders.delete(render);
        root.remove();
      }
    };
  }
  return {
    levels: {
      label: "Untangle levels",
      summary: "Mode, the 30-level grid with locks, Continue and Reset progress (per player).",
      icon: "grid",
      defaultSize: { w: 480, h: 300 },
      interactive: true,
      mount: mountLevels
    },
    stats: {
      label: "Untangle time",
      summary: "The solve clock and your best for this level (m:ss).",
      icon: "clock",
      defaultSize: { w: 240, h: 24 },
      defaults: { show: "play" },
      fields: [{ key: "show", kind: "select", label: "show", options: ["play", "result"] }],
      mount: mountStats
    },
    refreshAll() {
      for (const r of renders) {
        try {
          r();
        } catch {
        }
      }
    }
  };
}

// modules/untangle/src/sfx.js
var FALLBACK = {
  pop: [[720, 1100, 0.07, 0.07, "sine"]],
  click: [[1500, 1400, 0.03, 0.035, "triangle"]],
  success: [
    [523.25, 523.25, 0.18, 0.06, "triangle", 0],
    [659.25, 659.25, 0.18, 0.06, "triangle", 0.09],
    [783.99, 783.99, 0.26, 0.06, "triangle", 0.18],
    [1046.5, 1046.5, 0.4, 0.05, "sine", 0.27]
  ],
  levelup: [
    [587.33, 587.33, 0.12, 0.05, "sine", 0],
    [880, 880, 0.24, 0.05, "sine", 0.1]
  ]
};
var HAPTIC_FALLBACK = {
  tap: [[0.25, 15]],
  bump: [[0.5, 35]],
  success: [[0.4, 40], [0.6, 40], [0.9, 80]]
};
var MUSIC_VOLUME = 0.35;
var hasCoreSfx = (api) => typeof api?.music?.play === "function";
function makeSfx(api, env = {}) {
  const log = [];
  let ac = null;
  let live = 0;
  let musicOn = false;
  const later = env.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  function context() {
    if (ac) return ac;
    const make = env.audioContext ?? (() => {
      const AC = typeof window !== "undefined" ? window.AudioContext || /** @type {any} */
      window.webkitAudioContext : null;
      return AC ? new AC() : null;
    });
    ac = make();
    return ac;
  }
  function fallback(name) {
    const voices = FALLBACK[name];
    if (!voices) return;
    let ctx;
    try {
      ctx = context();
    } catch {
      return;
    }
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume?.().catch?.(() => {
    });
    for (const [f0, f1, dur, gain, type, delay = 0] of voices) {
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(1e-4, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 8e-3);
      g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
      osc.connect(g).connect(ctx.destination);
      live++;
      osc.onended = () => {
        live--;
        osc.disconnect();
        g.disconnect();
      };
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
  }
  return {
    /** one board sound (LOCAL, like every playSound) @param {string} name @param {number[]} [position] */
    play(name, position) {
      log.push(name);
      if (hasCoreSfx(api)) api.playSound?.(name, position);
      else fallback(name);
    },
    /** a haptic preset on one hand (or both) @param {'tap'|'bump'|'success'} name @param {'left'|'right'} [hand] */
    haptic(name, hand) {
      log.push("haptic:" + name + (hand ? ":" + hand : ""));
      if (typeof api.hapticPattern === "function") {
        api.hapticPattern(name, hand);
        return;
      }
      if (typeof api.haptic !== "function") return;
      let at = 0;
      for (const [intensity, ms] of HAPTIC_FALLBACK[name] ?? []) {
        if (at === 0) api.haptic(intensity, ms, hand);
        else later(() => api.haptic(intensity, ms, hand), at);
        at += ms + 60;
      }
    },
    /** the puzzle music follows `on` — called every frame, acts only on a change @param {boolean} on */
    music(on) {
      if (on === musicOn) return;
      musicOn = on;
      if (typeof api.music?.play !== "function") return;
      log.push(on ? "music:puzzle" : "music:stop");
      if (on) api.music.play("puzzle", { volume: MUSIC_VOLUME });
      else api.music.stop?.();
    },
    /** what the flights read: the log, the fallback voices sounding, whether music is on */
    stats: () => ({ log: [...log], live, contexts: ac ? 1 : 0, music: musicOn, core: hasCoreSfx(api) })
  };
}

// modules/untangle/src/index.js
var GROUP = "untangle-module";
var MODES_PLAYED = ["2d", "3d"];
var GLOBE_R = 0.92;
var EXPIRE_FRAMES = 40;
var index_default = {
  id: "untangle",
  name: "Untangle",
  version: "2.1.0",
  description: "Drag the dots until no edges cross \u2014 on a flat board or around a globe, 30 levels per mode that unlock as you solve them (progress stays on your device); replicated, board pose, level and readouts as flow nodes.",
  /** @param {any} api */
  register(api) {
    const THREE = api.THREE;
    let level = 1;
    let mode = "2d";
    let positions = [];
    let edges = [];
    const board = { ...DEFAULT_BOARD };
    let group = null;
    let dots = [];
    let sprite = null;
    let carried = -1;
    let won = false;
    let solvedCount = 0;
    let lastDragSent = 0;
    let crossings = 0;
    let built = false;
    let frame = 0;
    let nodeSeen = -1;
    let nodeLevel = (
      /** @type {number | null} */
      null
    );
    let remoteApplied = false;
    let sceneClears = 0;
    let touched = false;
    let hook = null;
    let menus = null;
    let gesture = null;
    const storage = makeStorage(api);
    let progress = normalizeProgress(storage.get(PROGRESS_KEY));
    let participated = false;
    let rev = 0;
    const syncs = { applied: 0, stale: 0 };
    const clock = { start: (
      /** @type {number | null} */
      null
    ), ms: (
      /** @type {number | null} */
      null
    ), newBest: false };
    let wasUnderway = false;
    const roundUnderway = () => !!api.game?.roundUnderway?.();
    const shellUnused = () => typeof api.game?.roundCutoff === "function" ? api.game.roundCutoff() === null : true;
    function saveProgress() {
      storage.set(PROGRESS_KEY, progress);
      menus?.refreshAll();
    }
    function clockMs() {
      if (clock.ms !== null) return clock.ms;
      return clock.start === null ? null : performance.now() - clock.start;
    }
    const globeQuat = new THREE.Quaternion();
    const globeR = () => board.radius * GLOBE_R;
    const local = (p) => mode === "3d" ? new THREE.Vector3(p[0], p[1], p[2]).applyQuaternion(globeQuat).multiplyScalar(globeR()) : new THREE.Vector3(p[0] * board.radius, p[1] * board.radius, 0);
    const clampPos = (p) => mode === "3d" ? normalize([+p[0] || 0, +p[1] || 0, +p[2] || 0]) : clampToBoard([p[0], p[1]]);
    const fits = (p) => Array.isArray(p) && p.length === (mode === "3d" ? 3 : 2) && p.every((v) => Number.isFinite(+v));
    function placeGroup() {
      if (!group) return;
      group.position.set(board.x, board.boardY, board.z);
      group.rotation.set(0, board.yaw, 0);
      group.updateMatrixWorld(true);
    }
    const dotR = () => board.radius * Math.max(0.105, 0.15 - Math.max(0, positions.length - 6) * 45e-4);
    let edgeLayer = null;
    let backplate = null;
    let globe = null;
    let hoverRing = null;
    let burst = null;
    let hovered = -1;
    let lift = 0;
    function disposeGroup(g) {
      g?.traverse((o) => {
        o.geometry?.dispose?.();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
        else {
          m?.map?.dispose?.();
          m?.dispose?.();
        }
      });
    }
    function build() {
      const scene = api.scene();
      if (!scene) return;
      if (group) {
        scene.remove(group);
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
      if (mode === "3d") {
        globe = makeGlobe(THREE, globeR());
        group.add(globe.group);
      } else {
        backplate = makeBackplate(THREE, board.radius);
        group.add(backplate.group);
      }
      edgeLayer = makeEdgeLayer(THREE, Math.max(1, edges.length * (mode === "3d" ? 28 : 1)));
      edgeLayer.setRadius(board.radius * (mode === "3d" ? 0.012 : 0.016));
      group.add(edgeLayer.glow, edgeLayer.core);
      const r = dotR() * (mode === "3d" ? 0.8 : 1);
      const dotGeo = new THREE.SphereGeometry(r, 32, 20);
      positions.forEach((p, i) => {
        const dot2 = new THREE.Mesh(
          dotGeo,
          new THREE.MeshStandardMaterial({ color: 15265527, emissive: 8229810, emissiveIntensity: 0.45, roughness: 0.3, metalness: 0.05 })
        );
        dot2.name = "untangle-dot-" + i;
        dot2.position.copy(local(p));
        group.add(dot2);
        dots.push(dot2);
      });
      hoverRing = makeHoverRing(THREE);
      hoverRing.scale.setScalar(r * 1.45);
      group.add(hoverRing);
      burst = makeBurst(THREE);
      group.add(burst.points, burst.wave);
      scene.add(group);
      placeGroup();
      group.userData._ut = {
        state: () => ({ level, positions, edges, board: { ...board }, won, crossings, solvedCount, carried, sprite: !!sprite }),
        move: (i, p) => dropAt(i, p),
        solve: () => solveNow(),
        setLevel: (lvl) => setLevel(lvl, true)
      };
      built = true;
      refresh();
    }
    function drawn(i) {
      const v = local(positions[i]);
      if (i === carried) {
        if (mode === "3d") v.multiplyScalar(1 + lift * dotR() * 0.8 / globeR());
        else v.z += lift * dotR() * 0.9;
      }
      return v;
    }
    function segmentsOf(counts) {
      if (mode !== "3d") return edges.map(([a, b], k) => ({ a: drawn(a), b: drawn(b), color: counts[k] > 0 ? COLORS.RED : COLORS.GREEN }));
      const out = [];
      const rr = globeR() * 1.004;
      edges.forEach(([a, b], k) => {
        const color = counts[k] > 0 ? COLORS.RED : COLORS.GREEN;
        const pts = arcPoints(positions[a], positions[b], arcSegments(positions[a], positions[b])).map(
          (q) => new THREE.Vector3(q[0], q[1], q[2]).applyQuaternion(globeQuat).multiplyScalar(rr)
        );
        if (a === carried) pts[0] = drawn(a);
        if (b === carried) pts[pts.length - 1] = drawn(b);
        for (let s = 0; s + 1 < pts.length; s++) out.push({ a: pts[s], b: pts[s + 1], color });
      });
      return out;
    }
    function paintDot(i) {
      const m = dots[i]?.material;
      if (!m) return;
      if (i === carried) {
        m.color.setHex(COLORS.AMBER);
        m.emissive.setHex(COLORS.AMBER);
        m.emissiveIntensity = 0.9;
      } else {
        m.color.setHex(15265527);
        m.emissive.setHex(8229810);
        m.emissiveIntensity = i === hovered ? 0.9 : 0.45;
      }
    }
    function redraw(counts) {
      positions.forEach((_, i) => {
        const dot2 = dots[i];
        if (!dot2) return;
        dot2.position.copy(drawn(i));
        dot2.scale.setScalar(i === carried ? 1 + 0.18 * lift : 1);
      });
      if (edgeLayer) edgeLayer.set(segmentsOf(counts));
      backplate?.setWon(crossings === 0);
      globe?.setWon(crossings === 0);
      if (globe) globe.graticule.quaternion.copy(globeQuat);
    }
    let lastCounts = (
      /** @type {number[]} */
      []
    );
    function ensureSprite() {
      const wantVR = typeof api.isVR === "function" && api.isVR();
      if (!wantVR) {
        if (sprite) {
          group?.remove(sprite);
          sprite.material.map?.dispose?.();
          sprite.material.dispose?.();
          sprite = null;
        }
        return;
      }
      if (sprite || !group || typeof document === "undefined") return;
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 96;
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }));
      sprite.name = "untangle-hud";
      sprite.scale.set(1.6, 0.3, 1);
      sprite.position.set(0, board.radius + 0.45, 0);
      sprite.userData.canvas = canvas;
      group.add(sprite);
    }
    function drawSprite(text, color) {
      if (!sprite) return;
      const canvas = sprite.userData.canvas;
      const g = canvas.getContext("2d");
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.font = "bold 44px monospace";
      g.textAlign = "center";
      g.fillStyle = color;
      g.fillText(text, canvas.width / 2, 62);
      sprite.material.map.needsUpdate = true;
    }
    function refresh() {
      if (!group) return 0;
      lastCounts = mode === "3d" ? edgeCrossings3(positions, edges) : edgeCrossings(positions, edges);
      crossings = totalCrossings(lastCounts);
      redraw(lastCounts);
      ensureSprite();
      drawSprite("Level " + level + "  \xB7  " + (crossings === 0 ? "solved!" : crossings + " crossing" + (crossings === 1 ? "" : "s")), crossings === 0 ? "#4ade80" : "#e2e8f0");
      return crossings;
    }
    function setLevel(lvl, announce = false, md = mode) {
      level = Math.max(1, Math.round(Number(lvl) || 1));
      mode = MODES_PLAYED.includes(md) ? md : "2d";
      const g = mode === "3d" ? generate3(level) : generate(level);
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
      if (announce) fire("level");
    }
    function selectLevel(lvl, md = mode) {
      touched = true;
      const l = Math.max(1, Math.min(MAX_LEVEL, Math.round(Number(lvl) || 1)));
      const m = MODES_PLAYED.includes(md) ? md : "2d";
      api.send({ op: "restart", level: l, mode: m });
      setLevel(l, true, m);
    }
    const sfx = makeSfx(api);
    const worldOf = (v) => group ? group.localToWorld(v.clone()).toArray() : void 0;
    function celebrate(unlocked, fromMe) {
      const centre = worldOf(new THREE.Vector3(0, 0, 0));
      sfx.play("success", centre);
      if (centre && typeof api.effects?.burst === "function") api.effects.burst(centre, { kind: "sparkle", color: "#3ee08f", count: 48 });
      if (typeof api.announce === "function") api.announce("Level " + level + " solved", { sub: mode === "3d" ? "Globe" : void 0, color: "#3ee08f" });
      if (unlocked) setTimeout(() => sfx.play("levelup", centre), 650);
    }
    function fire(event) {
      if (typeof api.fireNodeTrigger === "function") api.fireNodeTrigger("utevent", (data) => (data?.event ?? "solved") === event);
    }
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
          (c) => mode === "3d" ? c.clone().normalize() : new THREE.Vector3(0, 0, 1),
          board.radius,
          mode !== "3d",
          performance.now() / 1e3
        );
        if (fromMe) fire("solved");
        if (board.autoAdvance) {
          api.toast("Untangled! Level " + (level + 1) + "\u2026");
          setTimeout(() => {
            if (!won) return;
            setLevel(level + 1, fromMe);
          }, 1200);
        } else if (typeof api.announce !== "function") api.toast("Untangled!");
      }
    }
    function dropAt(i, p) {
      if (!positions[i] || !fits(p)) return false;
      participated = true;
      positions[i] = clampPos(p);
      api.send({ op: "move", i, p: positions[i] });
      applyMove(i, positions[i], true, true);
      return true;
    }
    function solveNow() {
      const n = positions.length;
      if (mode === "3d") {
        const inv = globeQuat.clone().invert();
        solvedSphere(n).forEach((q, i) => {
          const v = new THREE.Vector3(q[0], q[1], q[2]).applyQuaternion(inv);
          dropAt(i, [v.x, v.y, v.z]);
        });
        return crossings === 0;
      }
      for (let i = 0; i < n; i++) {
        const angle = i / n * Math.PI * 2;
        dropAt(i, [Math.cos(angle) * 0.85, Math.sin(angle) * 0.85]);
      }
      return crossings === 0;
    }
    const aim = makeAim(api, THREE);
    const dragPlane = new THREE.Plane();
    const planeNormal = new THREE.Vector3();
    const hitPoint = new THREE.Vector3();
    const localHit = new THREE.Vector3();
    const dotWorld = new THREE.Vector3();
    let lastDrop = "none";
    function dotUnder(ray) {
      if (!ray || !group || !dots.length) return -1;
      group.updateMatrixWorld();
      const scale = group.getWorldScale(localHit).x || 1;
      const reach = dotR() * 1.3 * scale;
      let best = -1;
      let bestMiss = reach * reach;
      const front = mode === "3d" ? globeHit(ray, false) : null;
      const frontAlong = front ? front.distanceTo(ray.ray.origin) : Infinity;
      dots.forEach((dot2, i) => {
        dot2.getWorldPosition(dotWorld);
        const miss = ray.ray.distanceSqToPoint(dotWorld);
        const along = dotWorld.sub(ray.ray.origin).dot(ray.ray.direction);
        if (miss > bestMiss || along <= 0 || along > frontAlong + reach * 1.5) return;
        bestMiss = miss;
        best = i;
      });
      return best;
    }
    const globeSphere = new THREE.Sphere();
    const globeCentre = new THREE.Vector3();
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
      if (mode === "3d") {
        const hit = globeHit(ray, true);
        if (!hit) return false;
        localHit.copy(hit);
        group.worldToLocal(localHit);
        localHit.applyQuaternion(globeQuat.clone().invert());
        positions[carried] = normalize([localHit.x, localHit.y, localHit.z]);
        return true;
      }
      planeNormal.set(0, 0, 1).applyQuaternion(group.quaternion);
      dragPlane.setFromNormalAndCoplanarPoint(planeNormal, group.position);
      if (!ray.ray.intersectPlane(dragPlane, hitPoint)) return false;
      localHit.copy(hitPoint);
      group.worldToLocal(localHit);
      positions[carried] = clampToBoard([localHit.x / board.radius, localHit.y / board.radius]);
      return true;
    }
    function pick(i, how) {
      if (!positions[i]) return;
      carried = i;
      carryHow = how;
      paintDot(i);
      sfx.play("pop", worldOf(local(positions[i])));
    }
    function drop(how, event) {
      if (carried === -1) return;
      if (event && how !== "ui" && how !== "cancel") follow(aim.fromClient(event.clientX, event.clientY, event.target));
      const i = carried;
      carried = -1;
      carryHow = "none";
      paintDot(i);
      lastDrop = how;
      gesture.reset();
      sfx.play("click", worldOf(local(positions[i])));
      dropAt(i, positions[i]);
    }
    function isViewport(event) {
      if (aim.locked()) return true;
      const t = event?.target;
      if (!t || t.tagName !== "CANVAS" || t.closest?.("#hud-layer, [data-hud-module]")) return false;
      return t.clientWidth * t.clientHeight > 0.25 * window.innerWidth * window.innerHeight;
    }
    gesture = typeof window !== "undefined" ? createGesture({
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
      rotateStart: (event) => mode === "3d" && !!globeHit(aim.fromClient(event.clientX, event.clientY, event.target), false),
      rotateBy
    }) : { detach() {
    }, reset() {
    }, carryMode: () => "none", rotating: () => false, lastUp: () => "none" };
    let carryHow = "none";
    const yawAxis = new THREE.Vector3(0, 1, 0);
    const pitchAxis = new THREE.Vector3(1, 0, 0);
    const turn = new THREE.Quaternion();
    let rotations = 0;
    function rotateBy(dx, dy) {
      if (mode !== "3d" || !group) return;
      turn.setFromAxisAngle(yawAxis, dx * 8e-3);
      globeQuat.premultiply(turn);
      turn.setFromAxisAngle(pitchAxis, dy * 8e-3);
      globeQuat.premultiply(turn).normalize();
      rotations++;
      redraw(lastCounts);
    }
    function interactive() {
      const m = typeof api.editorMode === "function" ? api.editorMode() : null;
      return m !== "edit" || typeof api.isPlaying === "function" && api.isPlaying();
    }
    api.registerClickHandler(
      (object) => {
        const isDot = !!object?.name?.startsWith("untangle-dot-");
        if (!api.isVR?.() && typeof window !== "undefined") return carried !== -1 || isDot;
        if (carried !== -1) {
          drop("click");
          return true;
        }
        if (!isDot) return false;
        pick(+object.name.slice("untangle-dot-".length), "click");
        return true;
      },
      { modes: ["interact", "play"] }
    );
    api.registerFrameTask(() => {
      frame++;
      if (!built && nodeSeen < 0 && frame > EXPIRE_FRAMES) setLevel(level);
      if (nodeSeen >= 0 && frame - nodeSeen > EXPIRE_FRAMES) {
        nodeSeen = -1;
        nodeLevel = null;
        Object.assign(board, { radius: DEFAULT_BOARD.radius, boardY: DEFAULT_BOARD.boardY, x: DEFAULT_BOARD.x, z: DEFAULT_BOARD.z, yaw: DEFAULT_BOARD.yaw, autoAdvance: DEFAULT_BOARD.autoAdvance });
        placeGroup();
        refresh();
      }
      const underway = roundUnderway();
      if (underway && !wasUnderway && built) {
        if (won) setLevel(Math.min(level + 1, MAX_LEVEL), false);
        else if (clock.start === null) clock.start = performance.now();
      }
      wasUnderway = underway;
      sfx.music(!!group?.parent && built && (!!api.isPlaying?.() || api.editorMode?.() === "interact"));
      if (!group) return;
      const t = performance.now() / 1e3;
      burst?.tick(t);
      const ray = aim.current();
      if (mode === "3d" && api.isVR?.() && carried === -1 && globeHit(ray, false)) {
        const axes = api.input?.()?.axes;
        const rx = axes?.rx ?? 0;
        const ry = axes?.ry ?? 0;
        if (Math.abs(rx) > 0.2 || Math.abs(ry) > 0.2) rotateBy(rx * 4, ry * 4);
      }
      const over = carried === -1 && interactive() ? dotUnder(ray) : -1;
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
          if (mode === "3d") hoverRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), at.clone().normalize());
          else hoverRing.quaternion.identity();
        }
      }
      const wantLift = carried === -1 ? 0 : 1;
      if (lift !== wantLift) {
        lift = Math.abs(wantLift - lift) < 0.02 ? wantLift : lift + (wantLift - lift) * 0.25;
        if (carried === -1) redraw(lastCounts);
      }
      if (carried === -1) return;
      if (!follow(ray)) {
        redraw(lastCounts);
        return;
      }
      refresh();
      const now = performance.now();
      if (now - lastDragSent > 100) {
        lastDragSent = now;
        api.send({ op: "drag", i: carried, p: positions[carried] });
      }
    });
    api.registerNodeGroup({
      group: "Untangle",
      items: [
        {
          type: "utboard",
          label: "Untangle Board",
          defaults: { ...DEFAULT_BOARD, apply: true },
          params: [
            { key: "level", kind: "range", min: 1, max: 40, step: 1 },
            { key: "radius", kind: "range", min: 0.4, max: 3, step: 0.05 },
            { key: "boardY", kind: "range", min: 0.3, max: 3, step: 0.05 },
            { key: "x", kind: "range", min: -20, max: 20, step: 0.1 },
            { key: "z", kind: "range", min: -20, max: 20, step: 0.1 },
            { key: "yaw", kind: "range", min: -3.15, max: 3.15, step: 0.05 },
            { key: "autoAdvance", kind: "toggle" },
            { key: "apply", kind: "toggle" }
          ]
        },
        {
          type: "utvalue",
          label: "Untangle Value",
          defaults: { read: "level" },
          params: [{ key: "read", kind: "select", options: ["level", "crossings", "solved", "dots", "edges", "count", "time", "best", "mode", "unlocked"] }]
        },
        {
          type: "utevent",
          label: "Untangle Event",
          defaults: { event: "solved" },
          params: [{ key: "event", kind: "select", options: ["solved", "level", "start"] }]
        }
      ]
    });
    api.registerEffect("utboard", (object, base, data) => {
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
      "utvalue",
      (data) => {
        switch (data?.read) {
          case "crossings":
            return crossings;
          case "solved":
            return won ? 1 : 0;
          case "dots":
            return positions.length;
          case "edges":
            return edges.length;
          case "count":
            return solvedCount;
          case "time":
            return Math.floor((clockMs() ?? 0) / 1e3);
          case "best":
            return Math.floor((bestOf(progress, mode, level) ?? 0) / 1e3);
          case "mode":
            return mode === "3d" ? 3 : 2;
          case "unlocked":
            return progress[mode]?.unlocked ?? 1;
          default:
            return level;
        }
      },
      { vtype: "number" }
    );
    api.registerValueNode("utevent", () => 0, { vtype: "event" });
    api.onMessage((data) => {
      if (data.op === "drag") applyMove(data.i, data.p, false);
      else if (data.op === "move") applyMove(data.i, data.p, true);
      else if (data.op === "restart") {
        touched = true;
        setLevel(data.level ?? 1, false, data.mode ?? "2d");
      }
    });
    api.registerStateSync({
      getState: () => touched ? { level, positions, mode, rev } : null,
      applyState: (state) => {
        if (!state) return;
        const sameBoard = built && state.level === level && (state.mode ?? "2d") === mode;
        if (sameBoard && typeof state.rev === "number" && state.rev <= rev) {
          syncs.stale++;
          return;
        }
        syncs.applied++;
        remoteApplied = true;
        touched = true;
        if (!sameBoard) setLevel(state.level ?? 1, false, state.mode ?? "2d");
        if (Array.isArray(state.positions) && state.positions.length === positions.length && state.positions.every(fits)) {
          positions = state.positions.map(clampPos);
          if (typeof state.rev === "number") rev = state.rev;
          refresh();
        }
      }
    });
    api.registerMenu("Restart level", () => {
      touched = true;
      api.send({ op: "restart", level, mode });
      setLevel(level);
    });
    api.onSceneClear?.(() => {
      sceneClears++;
      level = 1;
      nodeLevel = null;
      remoteApplied = false;
      won = false;
      carried = -1;
      gesture?.reset();
      if (group) {
        api.scene()?.remove(group);
        group = null;
      }
      built = false;
      touched = false;
      frame = 0;
    });
    menus = makeMenuKinds({
      view: () => ({ mode, modes: MODES_PLAYED, level, progress, running: roundUnderway() }),
      pickLevel: (l) => {
        if (isUnlocked(progress, mode, l)) selectLevel(l, mode);
      },
      pickMode: (m) => selectLevel(continueLevel(progress, m), m),
      continueGame: () => {
        selectLevel(continueLevel(progress, mode), mode);
        fire("start");
      },
      resetProgress: () => {
        progress = defaultProgress();
        saveProgress();
        api.toast("Untangle progress reset");
      },
      time: () => ({ ms: clockMs(), best: bestOf(progress, mode, level), newBest: clock.newBest, solved: won })
    });
    if (typeof api.registerHudElement === "function") {
      api.registerHudElement("levels", menus.levels);
      api.registerHudElement("stats", menus.stats);
    }
    api.registerInteractiveGroup(GROUP);
    api.registerSystemGroup?.(GROUP);
    hook = {
      state: () => ({
        level,
        mode,
        positions,
        edges,
        board: { ...board },
        won,
        crossings,
        solvedCount,
        built,
        touched,
        nodeOwned: nodeSeen >= 0,
        sceneClears,
        sprite: !!sprite,
        carried,
        carryMode: carried === -1 ? "none" : gesture.carryMode() === "none" ? carryHow : gesture.carryMode(),
        lastDrop,
        lastUp: gesture.lastUp(),
        rayMode: aim.mode(),
        rev,
        syncs: { ...syncs }
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
      /** 30b: every board sound / haptic asked for, the local voices still sounding, the music */
      sfx: () => sfx.stats(),
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
          plate: !!group?.getObjectByName("untangle-plate")
        };
      },
      /** world position of dot i (for pointer tests) */
      dotWorld: (i) => dots[i] ? dots[i].getWorldPosition(new THREE.Vector3()).toArray() : null,
      /** world position of a BOARD point [x, y] */
      boardWorld: (p) => group ? group.localToWorld(local(p)).toArray() : null
    };
    if (typeof window !== "undefined") window.__untangle = hook;
  }
};
export {
  index_default as default
};
