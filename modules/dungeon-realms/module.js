// modules/dungeon-realms/src/rules.js
var DEFAULT_RULES = {
  gemShare: 0.7,
  pickupRadius: 0.9,
  allPlayersPortal: true,
  disableFlight: true
};
var DEFAULT_MENU = {
  show: "auto",
  button1: "join-p1",
  button2: "join-p2",
  button3: "start",
  button4: "new-dungeon"
};
function gemTotals(total, collected, gemShare) {
  if (!total) return { total: 0, need: 0, have: 0 };
  const share = Math.min(1, Math.max(0.05, Number(gemShare) || 0));
  const need = Math.max(1, Math.ceil(total * share));
  return { total, need, have: Math.min(collected, total) };
}
function objectiveText(s) {
  if (s.won) return "Victory! Press Esc to leave play mode.";
  const missing = Math.max(0, s.need - s.have);
  if (s.sealed)
    return "Collect " + missing + " more gem" + (missing === 1 ? "" : "s") + (s.topFloor ? " to claim the dragon\u2019s hoard" : " to unseal the portal");
  if (s.topFloor) return "The hoard is yours!";
  return s.allPlayersPortal && s.players > 1 ? "Portal unsealed \u2014 stand on it together!" : "Portal unsealed \u2014 step through!";
}
function minimapMarkers(play, collected) {
  if (!play) return [];
  const out = [];
  for (const p of play.props ?? []) if (p.kind === "gem" && !collected.has(p.index)) out.push({ x: p.wx, z: p.wz, kind: "gem" });
  for (const p of play.portals ?? []) out.push({ x: p.wx, z: p.wz, kind: "door" });
  return out;
}
function canTravelTogether(slots, onPortal, me, allPlayersPortal) {
  if (!allPlayersPortal) return true;
  const others = Object.values(slots).map((slot) => slot?.peerId).filter((peerId) => peerId && peerId !== me);
  return others.every((peerId) => !!onPortal[peerId]);
}

// modules/dungeon-realms/src/hash.js
function hash32(seed, ...parts) {
  let h = 2166136261 ^ seed >>> 0;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 2654435769;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// modules/dungeon-realms/src/overlay.js
var GEM_GLOW = 2.4;
var PORTAL_GLOW = 2.2;
function paintRing(ring, hex, glow) {
  ring.material.color.setHex(hex);
  if (ring.material.emissive) {
    ring.material.emissive.setHex(hex);
    ring.material.emissiveIntensity = glow;
  }
}
function buildOverlay(THREE, play, collected) {
  const group = new THREE.Group();
  const theme = play.theme ?? {};
  const gemColor = theme.gemColor ?? 3793088;
  const gems = (play.props ?? []).filter((p) => p.kind === "gem").slice().sort((a, b) => a.index - b.index);
  const gemWorld = gems.map((p) => ({ x: p.wx, y: 0.55, z: p.wz, index: p.index }));
  const gemMesh = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.17, 0),
    new THREE.MeshStandardMaterial({ color: gemColor, emissive: gemColor, emissiveIntensity: GEM_GLOW, roughness: 0.25, metalness: 0.1 }),
    Math.max(1, gemWorld.length)
  );
  gemMesh.name = "dr-gems";
  gemMesh.count = gemWorld.length;
  group.add(gemMesh);
  for (const portal of play.portals ?? []) {
    const portalGroup = new THREE.Group();
    portalGroup.name = "dr-portal-" + portal.kind;
    portalGroup.position.set(portal.wx, 0, portal.wz);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.05, 0.1, 10, 36),
      new THREE.MeshStandardMaterial({ color: 5593702, emissive: 5593702, emissiveIntensity: 0.3, roughness: 0.4, metalness: 0.3 })
    );
    ring.name = "dr-portal-ring";
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.1;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.92, 28),
      new THREE.MeshBasicMaterial({ color: 3752016, transparent: true, opacity: 0.55 })
    );
    disc.name = "dr-portal-disc";
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.08;
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 2.6, 28, 1, true),
      new THREE.MeshBasicMaterial({ color: 3793151, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
    );
    column.name = "dr-portal-column";
    column.position.y = 1.35;
    column.visible = false;
    portalGroup.add(ring, disc, column);
    portalGroup.userData.portal = { kind: portal.kind, gated: portal.gated };
    group.add(portalGroup);
  }
  group.userData._dr = { gemWorld, theme };
  applyGems(group, collected);
  return group;
}
function applyGems(group, collected) {
  const gemMesh = group.getObjectByName("dr-gems");
  const { gemWorld } = group.userData._dr;
  if (!gemMesh || !gemWorld.length) return;
  const matrix = new gemMesh.matrixWorld.constructor();
  gemWorld.forEach((gem, i) => {
    if (collected.has(gem.index)) matrix.makeScale(0, 0, 0);
    else matrix.makeTranslation(gem.x, gem.y, gem.z);
    gemMesh.setMatrixAt(i, matrix);
  });
  gemMesh.instanceMatrix.needsUpdate = true;
}
function setPortalSealed(group, sealed, theme) {
  const portal = group.getObjectByName("dr-portal-up");
  if (portal) {
    const ring = portal.getObjectByName("dr-portal-ring");
    const disc = portal.getObjectByName("dr-portal-disc");
    if (ring) paintRing(ring, sealed ? 5593702 : 3793151, sealed ? 0.3 : PORTAL_GLOW);
    const column = portal.getObjectByName("dr-portal-column");
    if (column) {
      column.visible = !sealed;
      column.material.color.setHex(theme?.gemColor ?? 3793151);
    }
    if (disc) {
      disc.material.color.setHex(sealed ? 3752016 : theme?.gemColor ?? 3793088);
      disc.material.opacity = sealed ? 0.35 : 0.75;
    }
    portal.userData.portal.sealed = sealed;
  }
  const down = group.getObjectByName("dr-portal-down");
  if (down) {
    const downRing = down.getObjectByName("dr-portal-ring");
    if (downRing) paintRing(downRing, 3776767, PORTAL_GLOW * 0.6);
    down.userData.portal.sealed = false;
  }
}
function animateOverlay(THREE, group, collected, time) {
  const data = group.userData._dr;
  if (!data) return;
  const gemMesh = group.getObjectByName("dr-gems");
  if (gemMesh && data.gemWorld.length) {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const axis = new THREE.Vector3(0, 1, 0);
    data.gemWorld.forEach((gem, i) => {
      if (collected.has(gem.index)) return;
      position.set(gem.x, gem.y + Math.sin(time * 2 + gem.x) * 0.08, gem.z);
      quaternion.setFromAxisAngle(axis, time * 1.6 + gem.index);
      matrix.compose(position, quaternion, scale);
      gemMesh.setMatrixAt(i, matrix);
    });
    gemMesh.instanceMatrix.needsUpdate = true;
  }
  group.children.forEach((child) => {
    if (child.name === "dr-portal-up" || child.name === "dr-portal-down") {
      const open = child.userData.portal?.sealed === false;
      const ring = child.getObjectByName("dr-portal-ring");
      if (ring && open) ring.rotation.z = time * 0.8;
      const disc = child.getObjectByName("dr-portal-disc");
      if (disc && open) disc.material.opacity = 0.6 + Math.sin(time * 2.4) * 0.15;
      const column = child.getObjectByName("dr-portal-column");
      if (column?.visible) {
        column.material.opacity = 0.16 + Math.sin(time * 3.1) * 0.06;
        column.rotation.y = time * 0.5;
      }
    }
  });
}

// modules/dungeon-realms/src/gui.js
var Z = 900;
var root = null;
var menuCard = null;
var selectedIndex = 0;
var menuButtons = [];
var menuAction = null;
var keyHandler = null;
function ensureRoot() {
  if (root && document.body.contains(root)) return root;
  document.getElementById("dr-gui")?.remove();
  root = document.createElement("div");
  root.id = "dr-gui";
  root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:" + Z + ";font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;";
  document.body.appendChild(root);
  return root;
}
function renderMenuButtons() {
  if (!menuCard) return;
  const list = menuCard.querySelector(".dr-buttons");
  if (!list) return;
  list.innerHTML = "";
  menuButtons.forEach((button, index) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "dr-btn";
    el.dataset.id = button.id;
    el.textContent = button.label;
    const selected = index === selectedIndex && !button.disabled;
    el.style.cssText = "display:block;width:100%;margin:6px 0;padding:10px 18px;border-radius:10px;font-size:15px;text-align:center;cursor:pointer;transition:transform .06s;" + (button.disabled ? "background:rgba(255,255,255,.04);color:#6b7280;border:1px solid rgba(255,255,255,.06);cursor:default;" : selected ? "background:linear-gradient(180deg,#0ea5e9,#0369a1);color:#fff;border:1px solid #7dd3fc;transform:scale(1.03);" : "background:rgba(255,255,255,.08);color:#e5e7eb;border:1px solid rgba(255,255,255,.14);");
    if (!button.disabled) {
      el.onmouseenter = () => {
        selectedIndex = index;
        renderMenuButtons();
      };
      el.onclick = () => menuAction?.(button.id);
    }
    list.appendChild(el);
  });
}
function showMenu(model) {
  ensureRoot();
  const fresh = !menuCard;
  if (fresh) {
    menuCard = document.createElement("div");
    menuCard.id = "dr-menu";
    menuCard.style.cssText = "position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);min-width:320px;max-width:420px;pointer-events:auto;background:rgba(13,18,28,.92);border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:22px 26px;color:#e5e7eb;backdrop-filter:blur(8px);box-shadow:0 18px 60px rgba(0,0,0,.5);text-align:center;";
    root.appendChild(menuCard);
    selectedIndex = 0;
  }
  const lines = (model.lines ?? []).map((l) => '<div style="margin:2px 0">' + l + "</div>").join("");
  menuCard.innerHTML = '<div style="font-size:11px;letter-spacing:.2em;color:#67e8f9;text-transform:uppercase;margin-bottom:6px">Dungeon Realms</div><div class="dr-title" style="font-size:21px;font-weight:700;margin-bottom:4px">' + model.title + "</div>" + (model.subtitle ? '<div style="font-size:13px;color:#9ca3af;margin-bottom:8px">' + model.subtitle + "</div>" : "") + (lines ? '<div style="font-size:13px;color:#cbd5e1;margin-bottom:8px">' + lines + "</div>" : "") + '<div class="dr-buttons" style="margin-top:12px"></div><div style="font-size:11px;color:#64748b;margin-top:12px">' + (model.hint ?? "&#8593;&#8595; select &nbsp;&middot;&nbsp; Enter confirm") + "</div>";
  menuButtons = model.buttons;
  menuAction = model.onAction;
  if (selectedIndex >= menuButtons.length) selectedIndex = 0;
  renderMenuButtons();
  if (!keyHandler) {
    keyHandler = (event) => {
      if (!menuCard) return;
      if (event.code === "ArrowUp" || event.code === "ArrowDown") {
        const dir = event.code === "ArrowUp" ? -1 : 1;
        let next = selectedIndex;
        for (let i = 0; i < menuButtons.length; i++) {
          next = (next + dir + menuButtons.length) % menuButtons.length;
          if (!menuButtons[next].disabled) break;
        }
        selectedIndex = next;
        renderMenuButtons();
      } else if (event.code === "Enter" || event.code === "NumpadEnter") {
        const button = menuButtons[selectedIndex];
        if (button && !button.disabled) menuAction?.(button.id);
      } else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", keyHandler, true);
  }
}
function hideMenu() {
  menuCard?.remove();
  menuCard = null;
  menuButtons = [];
  menuAction = null;
  if (keyHandler) {
    window.removeEventListener("keydown", keyHandler, true);
    keyHandler = null;
  }
}

// modules/dungeon-realms/src/audio.js
var ctx = null;
var bus = null;
function ensure() {
  if (typeof AudioContext === "undefined") return null;
  if (!ctx) {
    ctx = new AudioContext();
    bus = ctx.createGain();
    bus.gain.value = 0.25;
    bus.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {
  });
  return ctx;
}
function tone(freq, dur, type = "triangle", delay = 0, gain = 0.5) {
  const c = ensure();
  if (!c || !bus) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(1e-3, t0 + dur);
  osc.connect(env).connect(bus);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}
function gemChime(combo = 0) {
  const base = 620 * Math.pow(2, Math.min(combo, 12) * 0.07);
  tone(base, 0.18, "triangle");
  tone(base * 1.5, 0.22, "sine", 0.05, 0.3);
}
function portalWhoosh() {
  const c = ensure();
  if (!c || !bus) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(140, t0);
  osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.5);
  env.gain.setValueAtTime(1e-4, t0);
  env.gain.exponentialRampToValueAtTime(0.3, t0 + 0.2);
  env.gain.exponentialRampToValueAtTime(1e-3, t0 + 0.7);
  osc.connect(env).connect(bus);
  osc.start(t0);
  osc.stop(t0 + 0.8);
}
function sealBreak() {
  tone(392, 0.3, "square", 0, 0.2);
  tone(523, 0.3, "square", 0.1, 0.2);
  tone(784, 0.5, "triangle", 0.2, 0.35);
}
function startThump() {
  tone(110, 0.35, "sine", 0, 0.6);
  tone(220, 0.2, "triangle", 0.05, 0.25);
}
function winFanfare() {
  [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.5, "triangle", i * 0.16, 0.4));
  tone(1568, 0.9, "sine", 0.64, 0.2);
}

// modules/dungeon-realms/src/game.js
var GROUP_NAME = "dungeon-realms";
var KIT_GROUP = "dungeon-module";
function createGame(api) {
  const THREE = api.THREE;
  const state = {
    /** the Kit world this rule state belongs to (observed) */
    seed: (
      /** @type {number | null} */
      null
    ),
    campaignChecksum: 0,
    checksum: 0,
    floorIndex: 1,
    levelCount: 0,
    /** @type {Record<number, Set<number>>} floor -> collected gem indices */
    collected: {},
    /** @type {Record<string, {peerId: string, name: string} | null>} */
    slots: { p1: null, p2: null },
    started: false,
    startedAt: 0,
    wonAt: 0,
    /** @type {Record<string, boolean>} peerId -> standing on the UP portal */
    onPortal: {},
    myOnPortal: false,
    combo: 0,
    lastGemAt: 0,
    /** @type {Record<string, number>} custom prop counters (drprop nodes) */
    propValues: {},
    /** a late-join state waiting for the Kit to show its seed */
    wanted: (
      /** @type {any} */
      null
    ),
    _wasSealed: (
      /** @type {boolean | undefined} */
      void 0
    ),
    _menuSuppressed: false
  };
  const config = {
    rules: { ...DEFAULT_RULES },
    menu: { ...DEFAULT_MENU },
    /** @type {Record<string, {initial: number, showInHud: boolean}>} */
    props: {}
  };
  let guiDirty = true;
  let playingNow = false;
  let groundedSent = (
    /** @type {boolean | null} */
    null
  );
  let eventSink = null;
  const me = () => api.peerId() ?? "me";
  const shortName = (peerId) => peerId === me() ? "you" : String(peerId).slice(0, 6);
  const collectedSet = (floor = state.floorIndex) => state.collected[floor] ??= /* @__PURE__ */ new Set();
  const kitGroup = () => api.scene()?.getObjectByName(KIT_GROUP) ?? null;
  const kit = () => kitGroup()?.userData?.kit ?? null;
  const play = () => kitGroup()?.userData?.play ?? null;
  const group = () => api.scene()?.getObjectByName(GROUP_NAME) ?? null;
  const gemCount = (floor = state.floorIndex) => {
    if (floor === state.floorIndex) return (play()?.props ?? []).filter((p) => p.kind === "gem").length;
    const dungeon = kit()?.campaign?.()?.floors[floor - 1];
    return dungeon ? dungeon.props.filter((p) => p.kind === "gem").length : 0;
  };
  function gemTotals2(floor = state.floorIndex) {
    return gemTotals(gemCount(floor), collectedSet(floor).size, config.rules.gemShare);
  }
  const sealed = () => {
    const { need, have } = gemTotals2();
    return have < need;
  };
  const topFloor = () => state.floorIndex >= (state.levelCount || 1);
  const players = () => ["p1", "p2"].filter((slot) => state.slots[slot]).length;
  function disposeOverlay() {
    const existing = group();
    if (!existing) return;
    existing.traverse((child) => {
      child.geometry?.dispose?.();
      if (child.material && !Array.isArray(child.material)) child.material.dispose?.();
    });
    existing.parent?.remove(existing);
  }
  function publishMarkers() {
    kit()?.setMarkers?.(GROUP_NAME, minimapMarkers(play(), collectedSet()));
  }
  function rebuild() {
    disposeOverlay();
    const scene = api.scene();
    const p = play();
    if (!scene || !p) return;
    const built = buildOverlay(THREE, p, collectedSet());
    built.name = GROUP_NAME;
    built.userData._dr.game = {
      state,
      config,
      collect: (index) => collectGem(state.floorIndex, index),
      travel: (target) => travel(target),
      start: () => start(),
      claimSlot: (slot) => claimSlot(slot),
      menuAction: menuAction2,
      gemTotals: gemTotals2,
      sealed,
      objective
    };
    scene.add(built);
    setPortalSealed(built, sealed(), p.theme);
    publishMarkers();
    guiDirty = true;
  }
  function resetForWorld() {
    state.collected = {};
    state.started = false;
    state.wonAt = 0;
    state.onPortal = {};
    state.myOnPortal = false;
    state.combo = 0;
    state._wasSealed = void 0;
    state._menuSuppressed = false;
  }
  function applyWanted(remote) {
    state.collected = {};
    Object.entries(remote.collected ?? {}).forEach(([floor, indices]) => {
      state.collected[floor] = new Set(indices);
    });
    state.slots = { p1: null, p2: null, ...remote.slots ?? {} };
    state.started = !!remote.started;
    state.startedAt = remote.startedAt ?? 0;
    state.wonAt = remote.wonAt ?? 0;
    state.propValues = remote.propValues ?? {};
    state._wasSealed = void 0;
  }
  function observe() {
    const p = play();
    if (!p) {
      if (state.seed != null || group()) {
        disposeOverlay();
        state.seed = null;
        state.levelCount = 0;
        resetForWorld();
        hideMenu();
        guiDirty = true;
      }
      return;
    }
    const newWorld = p.seed !== state.seed || p.campaignChecksum !== state.campaignChecksum;
    const newFloor = p.floorIndex !== state.floorIndex || p.checksum !== state.checksum;
    if (!newWorld && !newFloor) {
      if (!group()) rebuild();
      return;
    }
    if (newWorld) {
      state.seed = p.seed;
      state.campaignChecksum = p.campaignChecksum;
      state.levelCount = p.levelCount;
      if (state.wanted && state.wanted.seed === p.seed) {
        applyWanted(state.wanted);
        if (state.wanted.floorIndex && state.wanted.floorIndex !== p.floorIndex) kit()?.showFloor(state.wanted.floorIndex, { broadcast: false });
        state.wanted = null;
      } else resetForWorld();
    } else {
      state.onPortal = {};
      state.myOnPortal = false;
      state._wasSealed = void 0;
      portalWhoosh();
      api.toast("LEVEL " + p.floorIndex + " / " + p.levelCount + " \u2014 " + p.name);
    }
    state.floorIndex = p.floorIndex;
    state.checksum = p.checksum;
    rebuild();
    guiDirty = true;
  }
  function newDungeon(seed) {
    const k = kit();
    if (!k) {
      api.toast('Dungeon Realms needs the Dungeon Kit module \u2014 install "dungeon" first');
      return false;
    }
    const ok = k.generate(seed, k.state().params);
    if (ok) eventSink?.("reset");
    return ok;
  }
  function collectGem(floor, index, broadcast = true) {
    const set = collectedSet(floor);
    if (set.has(index)) return;
    set.add(index);
    const g = group();
    if (floor === state.floorIndex && g) {
      applyGems(g, set);
      const wasSealed = state._wasSealed ?? true;
      const nowSealed = sealed();
      if (wasSealed && !nowSealed && !topFloor()) {
        sealBreak();
        api.toast("The portal unseals!");
        setPortalSealed(g, false, play()?.theme);
        if (broadcast) eventSink?.("unseal");
      }
      state._wasSealed = nowSealed;
      publishMarkers();
    }
    if (broadcast) {
      const now = api.now();
      state.combo = now - state.lastGemAt < 4 ? state.combo + 1 : 0;
      state.lastGemAt = now;
      gemChime(state.combo);
      api.send({ op: "gem", floor, index });
      eventSink?.("gem");
    }
    guiDirty = true;
    if (floor === state.floorIndex && topFloor() && state.started && !state.wonAt && !sealed()) {
      state.wonAt = api.now();
      winFanfare();
      if (broadcast) eventSink?.("victory");
      guiDirty = true;
    }
  }
  function travel(target) {
    const k = kit();
    if (!k || target === state.floorIndex) return false;
    const ok = k.showFloor(target);
    if (ok) eventSink?.("travel");
    return ok;
  }
  function claimSlot(slot, broadcast = true, peerId = me()) {
    const mineAlready = state.slots[slot]?.peerId === peerId;
    Object.keys(state.slots).forEach((key) => {
      if (state.slots[key]?.peerId === peerId) state.slots[key] = null;
    });
    if (!mineAlready) state.slots[slot] = { peerId, name: shortName(peerId) };
    guiDirty = true;
    if (broadcast) api.send({ op: "slot", slot, peerId: mineAlready ? null : peerId });
  }
  function applyRemoteSlot(data) {
    Object.keys(state.slots).forEach((key) => {
      if (data.peerId && state.slots[key]?.peerId === data.peerId) state.slots[key] = null;
    });
    state.slots[data.slot] = data.peerId ? { peerId: data.peerId, name: shortName(data.peerId) } : null;
    guiDirty = true;
  }
  function start(broadcast = true) {
    if (state.seed == null || state.started) return;
    state.started = true;
    state.startedAt = api.now();
    state.wonAt = 0;
    startThump();
    guiDirty = true;
    if (broadcast) {
      api.send({ op: "start" });
      eventSink?.("start");
    }
  }
  function reset(broadcast = true) {
    state.started = false;
    state.wonAt = 0;
    guiDirty = true;
    if (broadcast) api.send({ op: "reset" });
  }
  function bumpProp(name, delta, broadcast = true) {
    state.propValues[name] = (state.propValues[name] ?? 0) + delta;
    guiDirty = true;
    if (broadcast) api.send({ op: "prop", name, value: state.propValues[name] });
  }
  function clear() {
    disposeOverlay();
    state.seed = null;
    state.levelCount = 0;
    resetForWorld();
    state.propValues = {};
    state.wanted = null;
    hideMenu();
    guiDirty = true;
  }
  function menuAction2(id) {
    if (id === "join-p1") claimSlot("p1");
    else if (id === "join-p2") claimSlot("p2");
    else if (id === "start") start();
    else if (id === "quit") {
      if (state.started || state.wonAt) {
        reset();
        eventSink?.("reset");
      }
    } else if (id === "resume") {
      state._menuSuppressed = true;
      guiDirty = true;
    } else if (id === "new-dungeon" || id === "play-again" || id === "generate") {
      const seed = hash32(api.now() * 1e3 | 0, "dice") % 1e5;
      if (newDungeon(seed)) api.toast("New dungeon \u2014 seed " + seed);
    }
    guiDirty = true;
  }
  function slotLabel(slot, fallback) {
    const claim = state.slots[slot];
    if (!claim) return fallback;
    return fallback + " \u2014 " + (claim.peerId === me() ? "you (click to leave)" : claim.name);
  }
  function buttonFor(action) {
    switch (action) {
      case "join-p1":
        return { id: action, label: slotLabel("p1", "Join as Player 1") };
      case "join-p2":
        return { id: action, label: slotLabel("p2", "Join as Player 2") };
      case "start":
        return { id: action, label: "Start adventure", disabled: state.seed == null };
      case "resume":
        return { id: action, label: "Resume" };
      case "new-dungeon":
        return { id: action, label: "New dungeon \u{1F3B2}" };
      case "play-again":
        return { id: action, label: "Play again \u{1F3B2}" };
      default:
        return null;
    }
  }
  function objective() {
    const { need, have } = gemTotals2();
    return objectiveText({
      won: !!state.wonAt,
      sealed: sealed(),
      need,
      have,
      topFloor: topFloor(),
      allPlayersPortal: config.rules.allPlayersPortal,
      players: players()
    });
  }
  function refreshGui() {
    guiDirty = false;
    const showMode = config.menu.show ?? "auto";
    const menuWanted = playingNow && showMode !== "never" && (showMode === "always" || !state.started && !state._menuSuppressed || state.wonAt > 0);
    const p = play();
    if (menuWanted && state.wonAt) {
      const seconds = Math.max(0, Math.round(state.wonAt - state.startedAt));
      const totalGems = Object.values(state.collected).reduce((sum, set) => sum + set.size, 0);
      showMenu({
        title: "Victory!",
        subtitle: "The dragon\u2019s hoard is yours",
        lines: [
          "Gems collected: " + totalGems,
          "Time: " + Math.floor(seconds / 60) + "m " + seconds % 60 + "s",
          "Floors conquered: " + state.levelCount
        ],
        buttons: [buttonFor("play-again"), buttonFor("resume")].filter(Boolean),
        onAction: menuAction2
      });
    } else if (menuWanted) {
      const { total } = gemTotals2();
      const buttons = p ? [config.menu.button1, config.menu.button2, config.menu.button3, config.menu.button4].map(buttonFor).filter(Boolean) : [{ id: "generate", label: "Generate a dungeon \u{1F3B2}" }];
      if (state.started && !buttons.some((b) => b.id === "resume")) buttons.push(buttonFor("resume"));
      showMenu({
        title: p ? p.name : "Dungeon Realms",
        subtitle: p ? "LEVEL " + state.floorIndex + " / " + state.levelCount + " \xB7 " + p.rooms.length + " rooms \xB7 " + total + " gems hidden" : kit() ? "Co-op gem hunt \xB7 collect gems, unseal portals, reach the top" : 'Install the Dungeon Kit module (id "dungeon") to generate a world',
        buttons,
        onAction: menuAction2
      });
    } else hideMenu();
  }
  function isPlaying() {
    if (typeof api.isPlaying === "function") return !!api.isPlaying();
    const minimap = typeof document !== "undefined" ? document.getElementById("dungeon-minimap") : null;
    return !!minimap && !minimap.classList.contains("hidden");
  }
  function playerXZ() {
    if (typeof api.playerPosition === "function") {
      const p = api.playerPosition();
      if (p) return { x: p[0], y: p[1], z: p[2] };
    }
    const origin = api.pointerRay()?.ray?.origin;
    return origin ? { x: origin.x, y: origin.y, z: origin.z } : null;
  }
  function tick(time) {
    observe();
    const playing = isPlaying();
    if (playing !== playingNow) {
      playingNow = playing;
      if (!playing) state._menuSuppressed = false;
      guiDirty = true;
    }
    const grounded = !!config.rules.disableFlight;
    if (grounded !== groundedSent && kit()) {
      kit().setGrounded?.(grounded);
      groundedSent = grounded;
    }
    const g = group();
    if (g) animateOverlay(THREE, g, collectedSet(), time);
    if (playingNow && state.started && !state.wonAt && g) {
      const pos = playerXZ();
      if (pos) {
        const gems = g.userData._dr?.gemWorld ?? [];
        const set = collectedSet();
        const r2 = config.rules.pickupRadius * config.rules.pickupRadius;
        for (const gem of gems) {
          if (set.has(gem.index)) continue;
          const dx = pos.x - gem.x;
          const dz = pos.z - gem.z;
          if (dx * dx + dz * dz < r2 && Math.abs(pos.y - gem.y) < 2.6) collectGem(state.floorIndex, gem.index);
        }
        const portal = g.getObjectByName("dr-portal-up");
        if (portal && !sealed()) {
          const dx = pos.x - portal.position.x;
          const dz = pos.z - portal.position.z;
          const on = dx * dx + dz * dz < 1.4 * 1.4;
          if (on !== state.myOnPortal) {
            state.myOnPortal = on;
            state.onPortal[me()] = on;
            api.send({ op: "onportal", peerId: me(), on });
          }
          if (on && canTravelTogether(state.slots, state.onPortal, me(), config.rules.allPlayersPortal)) travel(state.floorIndex + 1);
        }
      }
    }
    if (guiDirty) refreshGui();
  }
  function handleMessage(data) {
    if (data.op === "gem") collectGem(data.floor, data.index, false);
    else if (data.op === "slot") applyRemoteSlot(data);
    else if (data.op === "start") {
      state.started = true;
      state.startedAt = api.now();
      guiDirty = true;
    } else if (data.op === "reset") {
      state.started = false;
      state.wonAt = 0;
      guiDirty = true;
    } else if (data.op === "onportal") {
      state.onPortal[data.peerId] = !!data.on;
    } else if (data.op === "prop") {
      state.propValues[data.name] = data.value;
      guiDirty = true;
    }
  }
  function getState() {
    if (state.seed == null) return null;
    return {
      seed: state.seed,
      floorIndex: state.floorIndex,
      collected: Object.fromEntries(Object.entries(state.collected).map(([floor, set]) => [floor, [...set]])),
      slots: state.slots,
      started: state.started,
      startedAt: state.startedAt,
      wonAt: state.wonAt,
      propValues: state.propValues
    };
  }
  function applyState(remote) {
    if (!remote || remote.seed == null) return;
    const p = play();
    if (p && p.seed === remote.seed) {
      state.seed = p.seed;
      state.campaignChecksum = p.campaignChecksum;
      state.levelCount = p.levelCount;
      applyWanted(remote);
      if (remote.floorIndex && remote.floorIndex !== p.floorIndex) kit()?.showFloor(remote.floorIndex, { broadcast: false });
      else {
        state.floorIndex = p.floorIndex;
        state.checksum = p.checksum;
        rebuild();
      }
      state.wanted = null;
    } else state.wanted = remote;
    guiDirty = true;
  }
  return {
    state,
    config,
    kit,
    play,
    group,
    newDungeon,
    collectGem,
    travel,
    claimSlot,
    start,
    reset,
    bumpProp,
    clear,
    menuAction: menuAction2,
    tick,
    handleMessage,
    getState,
    applyState,
    gemTotals: gemTotals2,
    sealed,
    topFloor,
    players,
    objective,
    isPlaying,
    markGuiDirty: () => guiDirty = true,
    /** @param {(event: string) => void} fn */
    onEvent: (fn) => eventSink = fn
  };
}

// modules/dungeon-realms/src/nodes.js
var EXPIRE_FRAMES = 40;
var EVENTS = ["start", "gem", "unseal", "travel", "victory", "reset"];
var READS = ["gems", "need", "total", "level", "levels", "players", "started", "won", "sealed", "score"];
var ROWS = ["objective", "players", "level", "gems", "all"];
var BUTTON_ACTIONS = ["join-p1", "join-p2", "start", "new-dungeon", "quit"];
function registerNodes(api, game) {
  let frame = 0;
  const seen = { rules: -1, menu: -1 };
  const propSeen = {};
  const pressLevel = /* @__PURE__ */ new Map();
  const MENU_OPTIONS = ["none", "join-p1", "join-p2", "start", "resume", "new-dungeon"];
  api.registerNodeGroup({
    group: "Dungeon Realms",
    items: [
      {
        type: "drrules",
        label: "Game Rules",
        defaults: { ...DEFAULT_RULES },
        params: [
          { key: "gemShare", kind: "range", min: 0.05, max: 1, step: 0.05 },
          { key: "pickupRadius", kind: "range", min: 0.4, max: 3, step: 0.1 },
          { key: "allPlayersPortal", kind: "toggle" },
          { key: "disableFlight", kind: "toggle" }
        ]
      },
      {
        type: "drmenu",
        label: "Start Menu",
        defaults: { ...DEFAULT_MENU },
        params: [
          { key: "show", kind: "select", options: ["auto", "always", "never"] },
          { key: "button1", kind: "select", options: MENU_OPTIONS },
          { key: "button2", kind: "select", options: MENU_OPTIONS },
          { key: "button3", kind: "select", options: MENU_OPTIONS },
          { key: "button4", kind: "select", options: MENU_OPTIONS }
        ]
      },
      {
        type: "drprop",
        label: "Prop Counter",
        defaults: { prop: "score", initial: 0, showInHud: true },
        params: [
          { key: "prop", kind: "select", options: ["score", "keys", "skulls", "torches"] },
          { key: "initial", kind: "range", min: 0, max: 100, step: 1 },
          { key: "showInHud", kind: "toggle" }
        ]
      },
      {
        type: "drvalue",
        label: "Realms Value",
        defaults: { read: "gems" },
        params: [{ key: "read", kind: "select", options: READS }]
      },
      {
        type: "drrows",
        label: "Realms HUD Rows",
        defaults: { element: "", show: "objective" },
        params: [
          { key: "element", kind: "text", placeholder: "HUD list id", maxLength: 40 },
          { key: "show", kind: "select", options: ROWS }
        ]
      },
      {
        // 30: the menu on core HUD screens — a HUD Button (through a Delay, DEVX #22) or an
        // On Click pulses `press`, and the action runs on the presser's peer
        type: "drbutton",
        label: "Realms Button",
        defaults: { action: "start", press: 0 },
        params: [{ key: "action", kind: "select", options: BUTTON_ACTIONS }]
      },
      {
        type: "drevent",
        label: "Realms Event",
        defaults: { event: "start" },
        params: [{ key: "event", kind: "select", options: EVENTS }]
      }
    ]
  });
  const assign = (target, next) => {
    let changed = false;
    for (const key of Object.keys(next)) {
      if (target[key] !== next[key]) {
        target[key] = next[key];
        changed = true;
      }
    }
    if (changed) game.markGuiDirty();
  };
  api.registerEffect("drrules", (object, base, data) => {
    seen.rules = frame;
    assign(game.config.rules, {
      gemShare: Math.min(1, Math.max(0.05, data.gemShare ?? DEFAULT_RULES.gemShare)),
      pickupRadius: data.pickupRadius ?? DEFAULT_RULES.pickupRadius,
      allPlayersPortal: !!(data.allPlayersPortal ?? DEFAULT_RULES.allPlayersPortal),
      disableFlight: !!(data.disableFlight ?? DEFAULT_RULES.disableFlight)
    });
  });
  api.registerEffect("drmenu", (object, base, data) => {
    seen.menu = frame;
    assign(game.config.menu, {
      show: data.show ?? DEFAULT_MENU.show,
      button1: data.button1 ?? DEFAULT_MENU.button1,
      button2: data.button2 ?? DEFAULT_MENU.button2,
      button3: data.button3 ?? DEFAULT_MENU.button3,
      button4: data.button4 ?? DEFAULT_MENU.button4
    });
  });
  api.registerEffect("drprop", (object, base, data) => {
    const name = data.prop ?? "score";
    propSeen[name] = frame;
    const existing = game.config.props[name];
    const next = { initial: Math.round(data.initial ?? 0), showInHud: !!(data.showInHud ?? true) };
    if (!existing || existing.initial !== next.initial || existing.showInHud !== next.showInHud) {
      game.config.props[name] = next;
      game.markGuiDirty();
    }
  });
  api.registerEffect(
    "drbutton",
    (object, base, data, time, ctx2) => {
      const level = Number(data.press) > 0 ? 1 : 0;
      const key = ctx2?.id ?? object.uuid;
      const was = pressLevel.get(key);
      pressLevel.set(key, level);
      if (was === void 0 || was === level || level !== 1) return;
      const action = BUTTON_ACTIONS.includes(data.action) ? data.action : "start";
      game.menuAction(action);
    },
    // 'number': a Delay's pulse, an On Click, a Compare all drive it (DEVX #22)
    { inputs: { press: "number" } }
  );
  const lastRows = {};
  api.registerEffect("drrows", (object, base, data, time, ctx2) => {
    if (!api.hud?.rows) return;
    const element = String(data.element ?? "").trim();
    if (!element) return;
    const rows = rowsFor(data.show ?? "objective");
    const key = JSON.stringify(rows);
    const id = ctx2?.id ?? element;
    if (lastRows[id] === key) return;
    lastRows[id] = key;
    api.hud.rows(element, rows);
  });
  function rowsFor(show) {
    const s = game.state;
    const p = game.play();
    const { total, need, have } = game.gemTotals();
    const level = p ? "LEVEL " + s.floorIndex + " / " + s.levelCount + " \xB7 " + p.name : "no dungeon";
    const gems = have + " / " + need + " needed \xB7 " + total + " hidden";
    const players = ["p1", "p2"].filter((slot) => s.slots[slot]).map((slot) => slot.toUpperCase() + " " + s.slots[slot].name + (s.slots[slot].peerId === (api.peerId() ?? "me") ? " (you)" : ""));
    const props = Object.entries(game.config.props).filter(([, def]) => def.showInHud).map(([name, def]) => name + ": " + (s.propValues[name] ?? def.initial ?? 0));
    if (show === "objective") return p ? [game.objective()] : [];
    if (show === "players") return players;
    if (show === "level") return p ? [level] : [];
    if (show === "gems") return p ? [gems, ...props] : [];
    return p ? [gems, level, ...players, ...props, game.objective()] : [];
  }
  api.registerValueNode(
    "drvalue",
    (data) => {
      const s = game.state;
      const { total, need, have } = game.gemTotals();
      switch (data?.read) {
        case "need":
          return need;
        case "total":
          return total;
        case "level":
          return s.seed == null ? 0 : s.floorIndex;
        case "levels":
          return s.levelCount;
        case "players":
          return game.players();
        case "started":
          return s.started ? 1 : 0;
        case "won":
          return s.wonAt ? 1 : 0;
        case "sealed":
          return s.seed != null && game.sealed() ? 1 : 0;
        case "score":
          return s.propValues.score ?? game.config.props.score?.initial ?? 0;
        default:
          return have;
      }
    },
    { vtype: "number" }
  );
  api.registerValueNode("drevent", () => 0, { vtype: "event" });
  game.onEvent((event) => {
    if (typeof api.fireNodeTrigger !== "function") return;
    api.fireNodeTrigger("drevent", (data) => (data?.event ?? "start") === event);
  });
  function tick() {
    frame++;
    if (seen.rules >= 0 && frame - seen.rules > EXPIRE_FRAMES) {
      seen.rules = -1;
      assign(game.config.rules, { ...DEFAULT_RULES });
    }
    if (seen.menu >= 0 && frame - seen.menu > EXPIRE_FRAMES) {
      seen.menu = -1;
      assign(game.config.menu, { ...DEFAULT_MENU });
    }
    for (const [name, at] of Object.entries(propSeen)) {
      if (frame - at > EXPIRE_FRAMES) {
        delete propSeen[name];
        delete game.config.props[name];
        game.markGuiDirty();
      }
    }
  }
  return { tick, rowsFor };
}

// modules/dungeon-realms/src/index.js
var index_default = {
  id: "dungeon-realms",
  name: "Dungeon Realms",
  version: "2.1.0",
  description: 'Co-op dungeon crawl on the Dungeon Kit: gem-gated portals, P1/P2 play, travel-together floors \u2014 every rule and readout a flow node. Requires the "dungeon" (Dungeon Kit) module.',
  /** @param {any} api the module SDK surface */
  register(api) {
    const game = createGame(api);
    const nodes = registerNodes(api, game);
    api.registerSystemGroup(GROUP_NAME);
    api.registerInteractiveGroup(GROUP_NAME);
    api.registerMenu("Generate dungeon", () => {
      const seed = hash32(api.now() * 1e3 | 0, "menu") % 1e5;
      if (game.newDungeon(seed)) api.toast("Dungeon Realms seed " + seed + " \u2014 press the red Play button to start");
    });
    api.registerMenu("Clear dungeon", () => {
      game.kit()?.clear();
      game.clear();
    });
    api.registerClickHandler((mesh) => {
      let cursor = mesh;
      while (cursor && !cursor.userData?.portal && cursor.name !== "dr-gems") cursor = cursor.parent;
      if (!cursor) return false;
      if (cursor.name === "dr-gems") {
        if (!game.state.started || game.state.wonAt) return true;
        const ray = api.pointerRay();
        const gems = game.group()?.userData._dr?.gemWorld ?? [];
        const set = game.state.collected[game.state.floorIndex] ?? /* @__PURE__ */ new Set();
        const point = new api.THREE.Vector3();
        for (const gem of gems) {
          if (set.has(gem.index)) continue;
          point.set(gem.x, gem.y, gem.z);
          if (ray && ray.ray.distanceToPoint(point) < 0.55) {
            game.collectGem(game.state.floorIndex, gem.index);
            return true;
          }
        }
        return true;
      }
      const portal = cursor.userData.portal;
      if (portal.kind === "down") game.travel(game.state.floorIndex - 1);
      else if (portal.sealed) {
        const { need, have } = game.gemTotals();
        api.toast("Sealed \u2014 collect " + (need - have) + " more gem" + (need - have === 1 ? "" : "s"));
      } else game.travel(game.state.floorIndex + 1);
      return true;
    });
    api.onMessage((data) => game.handleMessage(data));
    api.registerStateSync({
      getState: () => game.getState(),
      applyState: (remote) => game.applyState(remote)
    });
    api.onSceneClear(() => game.clear());
    api.registerFrameTask((time) => {
      nodes.tick();
      game.tick(time);
    });
    if (api.hud?.registerDebugLine)
      api.hud.registerDebugLine(() => {
        const s = game.state;
        if (s.seed == null) return null;
        const { have, need } = game.gemTotals();
        return "realms seed " + s.seed + " floor " + s.floorIndex + "/" + s.levelCount + " gems " + have + "/" + need + (s.started ? " playing" : "");
      });
    api.registerBindings([
      { label: "Menu \u2014 select option", keys: "ArrowUp / ArrowDown" },
      { label: "Menu \u2014 confirm", keys: "Enter" }
    ]);
    if (typeof window !== "undefined") {
      window.__dungeonRealms = { game, nodes };
    }
  }
};
export {
  index_default as default
};
