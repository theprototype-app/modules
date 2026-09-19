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
function generate(lvl) {
  const rand = mulberry32(2654435769 ^ lvl * 2654435761);
  const n = Math.min(5 + lvl, 16);
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
  const wanted = Math.floor(n * 0.8);
  let added = 0;
  for (const [a, b] of chords) {
    if (added >= wanted) break;
    if (edges.some(([c, d]) => chordsCross(a, b, c, d, n))) continue;
    edges.push([a, b]);
    added++;
  }
  const positions = [];
  for (let i = 0; i < n; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = Math.sqrt(rand()) * 0.9;
    positions.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return { n, edges, positions };
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
function clampToBoard(p) {
  return [Math.max(-1, Math.min(1, p[0])), Math.max(-1, Math.min(1, p[1]))];
}
var DEFAULT_BOARD = { level: 1, radius: 1.1, boardY: 1.6, x: 0, z: 0, yaw: 0, autoAdvance: true };

// modules/untangle/src/index.js
var GROUP = "untangle-module";
var DOT_R = 0.055;
var EXPIRE_FRAMES = 40;
var index_default = {
  id: "untangle",
  name: "Untangle",
  version: "2.0.0",
  description: "Drag the dots until no edges cross \u2014 procedural puzzle game; board pose, level and readouts as flow nodes.",
  /** @param {any} api */
  register(api) {
    const THREE = api.THREE;
    let level = 1;
    let positions = [];
    let edges = [];
    const board = { ...DEFAULT_BOARD };
    let group = null;
    let dots = [];
    let lineMeshes = [];
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
    const local = (p) => new THREE.Vector3(p[0] * board.radius, p[1] * board.radius, 0);
    function placeGroup() {
      if (!group) return;
      group.position.set(board.x, board.boardY, board.z);
      group.rotation.set(0, board.yaw, 0);
      group.updateMatrixWorld(true);
    }
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
          new THREE.MeshStandardMaterial({ color: 15857145, roughness: 0.4 })
        );
        dot.name = "untangle-dot-" + i;
        dot.position.copy(local(p));
        group.add(dot);
        dots.push(dot);
      });
      edges.forEach(([a, b], i) => {
        const geometry = new THREE.BufferGeometry().setFromPoints([local(positions[a]), local(positions[b])]);
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 16281969 }));
        line.name = "untangle-edge-" + i;
        group.add(line);
        lineMeshes.push(line);
      });
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
      positions.forEach((p, i) => dots[i]?.position.copy(local(p)));
      const counts = edgeCrossings(positions, edges);
      edges.forEach(([a, b], i) => {
        const line = lineMeshes[i];
        if (!line) return;
        line.geometry.setFromPoints([local(positions[a]), local(positions[b])]);
        line.material.color.set(counts[i] > 0 ? 16281969 : 4906624);
      });
      crossings = totalCrossings(counts);
      ensureSprite();
      drawSprite("Level " + level + "  \xB7  " + (crossings === 0 ? "solved!" : crossings + " crossing" + (crossings === 1 ? "" : "s")), crossings === 0 ? "#4ade80" : "#e2e8f0");
      ambientSetTension(crossings);
      return crossings;
    }
    function setLevel(lvl, announce = false) {
      level = Math.max(1, Math.round(Number(lvl) || 1));
      const g = generate(level);
      edges = g.edges;
      positions = g.positions;
      won = false;
      carried = -1;
      build();
      if (announce) fire("level");
    }
    let ac = null;
    let padGain = null;
    let padFilter = null;
    function audio() {
      if (ac) return ac;
      ac = new (window.AudioContext || window.webkitAudioContext)();
      padGain = ac.createGain();
      padGain.gain.value = 0.03;
      padFilter = ac.createBiquadFilter();
      padFilter.type = "lowpass";
      padFilter.frequency.value = 400;
      const lfo = ac.createOscillator();
      const lfoGain = ac.createGain();
      lfo.frequency.value = 0.13;
      lfoGain.gain.value = 0.012;
      lfo.connect(lfoGain).connect(padGain.gain);
      for (const [type, freq] of [["triangle", 110], ["triangle", 110.7], ["sine", 220.3]]) {
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
      if (!ac) return;
      padFilter.frequency.linearRampToValueAtTime(320 + Math.max(0, 24 - count) * 60, ac.currentTime + 0.6);
    }
    function blip(freq, duration = 0.07, gain = 0.12) {
      const ctx = audio();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = freq;
      g.gain.setValueAtTime(gain, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(1e-3, ctx.currentTime + duration);
      osc.connect(g).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    }
    function winSting() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() => blip(f, 0.22, 0.14), i * 110));
    }
    function fire(event) {
      if (typeof api.fireNodeTrigger === "function") api.fireNodeTrigger("utevent", (data) => (data?.event ?? "solved") === event);
    }
    function applyMove(i, p, authoritative, fromMe = false) {
      if (!positions[i]) return;
      if (authoritative) touched = true;
      positions[i] = clampToBoard([p[0], p[1]]);
      const total = refresh();
      if (authoritative && total === 0 && !won) {
        won = true;
        solvedCount++;
        winSting();
        if (fromMe) fire("solved");
        if (board.autoAdvance) {
          api.toast("Untangled! Level " + (level + 1) + "\u2026");
          setTimeout(() => {
            if (!won) return;
            setLevel(level + 1, fromMe);
          }, 1200);
        } else api.toast("Untangled!");
      }
    }
    function dropAt(i, p) {
      if (!positions[i]) return false;
      positions[i] = clampToBoard([p[0], p[1]]);
      api.send({ op: "move", i, p: positions[i] });
      applyMove(i, positions[i], true, true);
      return true;
    }
    function solveNow() {
      const n = positions.length;
      for (let i = 0; i < n; i++) {
        const angle = i / n * Math.PI * 2;
        dropAt(i, [Math.cos(angle) * 0.85, Math.sin(angle) * 0.85]);
      }
      return crossings === 0;
    }
    const dragPlane = new THREE.Plane();
    const planeNormal = new THREE.Vector3();
    const hitPoint = new THREE.Vector3();
    const localHit = new THREE.Vector3();
    api.registerClickHandler((object) => {
      if (carried !== -1) {
        const i = carried;
        dots[i]?.material.color.set(15857145);
        carried = -1;
        blip(440);
        dropAt(i, positions[i]);
        return true;
      }
      if (!object?.name?.startsWith("untangle-dot-")) return false;
      carried = +object.name.slice("untangle-dot-".length);
      dots[carried]?.material.color.set(16498468);
      blip(660);
      return true;
    });
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
      if (carried === -1 || !group) return;
      const ray = api.pointerRay();
      if (!ray) return;
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
          params: [{ key: "read", kind: "select", options: ["level", "crossings", "solved", "dots", "edges", "count"] }]
        },
        {
          type: "utevent",
          label: "Untangle Event",
          defaults: { event: "solved" },
          params: [{ key: "event", kind: "select", options: ["solved", "level"] }]
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
        setLevel(data.level ?? 1);
      }
    });
    api.registerStateSync({
      getState: () => touched ? { level, positions } : null,
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
    api.registerMenu("Restart level", () => {
      touched = true;
      api.send({ op: "restart", level });
      setLevel(level);
    });
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
      frame = 0;
    });
    api.registerInteractiveGroup(GROUP);
    api.registerSystemGroup?.(GROUP);
    if (typeof window !== "undefined") {
      window.__untangle = {
        state: () => ({ level, positions, edges, board: { ...board }, won, crossings, solvedCount, built, touched, nodeOwned: nodeSeen >= 0, sceneClears, sprite: !!sprite }),
        move: (i, p) => dropAt(i, p),
        solve: () => solveNow(),
        setLevel: (lvl) => setLevel(lvl, true)
      };
    }
  }
};
export {
  index_default as default
};
