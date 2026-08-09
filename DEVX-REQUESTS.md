# SDK gaps found while writing these modules

Requests **from** module authors **to** the core module SDK
(`theprototype-app/core`, `src/lib/moduleSDK.js`). Each one was hit while
building a module in this repo, verified against the SDK surface as it actually
is, and worked around rather than patched around — a module never reaches into
core internals, because an installed module has no imports and core-only
privileges are exactly what makes an example useless as an example.

Feeds roadmap **17-A1** (SDK gaps). Status is what the *modules* need, not a
promise from core.

| # | Gap | Blocks | Worked around? |
|---|---|---|---|
| 1 | first-person camera for `possess` | `fps-player` | partly — third-person walk mode ships, first person does not |
| 2 | per-hand VR pose + button state | `sabers` | partly — one hand via `pointerRay()` |
| 3 | `api.haptic(hand, intensity, ms)` | `door-keypad`, `sabers` | yes — silent, no feedback |
| 4 | fire a flow trigger on an object | `door-keypad` | yes — module ops only, flows can't react |
| 5 | create/move a **replicated** object from module code | `tutorial-room`, `fps-player` | yes — own scene-root content + own ops |
| 6 | know whether we are in VR | `sabers` | yes — inferred from `pointerRay()` shape |
| 7 | multi-selection uuids | — | yes — `selectedUuid()` is enough so far |
| 8 | **BUG**: `api.onInput` misses keys for ~2s after register | `fps-player` | yes — edge-detect from `api.input()` in a frame task |

---

## 1. First-person camera for `possess`

**Found in:** `modules/fps-player`.

`api.possess(uuid, {camera})` accepts `'chase' | 'orbit' | 'none'`. `'chase'`
sits at a hard-coded `(0, 2.2, 4.5)` behind the object and `lookAt`s it
(`possess.js: chaseCamera`); there is no eye-height / zero-distance option and no
mouse-look. Nothing else on the api can move the editor camera:
`OrbitControls.update()` re-derives the camera from its own spherical state
every frame, so a module writing `camera.position` is reverted, and `controls`
is not exposed.

**Ask:**

```js
api.possess(uuid, {
	camera: 'first',        // eye at the object, no chase offset
	eyeHeight: 1.7,         // metres above the object's origin
	mouseLook: true         // pointer lock drives yaw/pitch; Esc releases both
});
api.possessModes;           // ['chase','orbit','none','first'] — capability probe
```

The capability list matters more than the mode: a module cannot feature-detect
today, because an unknown `camera` value silently degrades to "no camera control
at all" instead of failing. `fps-player` reads `api.possessModes` and uses first
person the moment it appears.

**Meanwhile:** the module ships a complete camera-relative walk controller
(WASD/sprint/jump/crouch, ground raycasts, input claims, one undo per ride) with
the existing chase camera, and says so on screen.

## 2. Per-hand VR pose and button state

**Found in:** `modules/sabers`.

`api.pointerRay()` gives the *pointer* hand as a `Raycaster` — origin and
direction, one hand, no roll and no grip/trigger state. A two-handed VR tool
(a saber per hand, a tool that reacts to grip) cannot be posed from it. Core has
all of this in `vrControls` (`controllerIndexFor`, the `registerVRFrameHook` /
`registerGripDropHook` registries the `vrsleeve` module uses), but those are
core-module privileges: `vrsleeve` lives in `src/modules/` and imports
`$lib/vrSleeve` directly, which an installed module cannot do.

**Ask:**

```js
api.vrHand('left');   // {position:[x,y,z], quaternion:[x,y,z,w], gripped, trigger, connected}
                      // null when that hand is not tracked (or not in VR)
api.registerVRFrameHook(fn);       // the vrsleeve registries, on the module api
api.registerGripDropHook(fn);
```

**Meanwhile:** `sabers` poses one saber from `pointerRay()` (correct hand, no
roll) and renders the second only as a mirrored ghost.

## 3. `api.haptic(hand, intensity, ms)`

**Found in:** `modules/door-keypad` (a keypad press wants a click),
`modules/sabers` (a hit wants a thump).

`hapticPulse()` exists in `vrControls.js` and the core `piano` module calls it by
importing `$lib/vrControls`. It is not on the api, so every external module is
silently non-haptic. Already on the 17-A1 list; both modules feature-detect
(`typeof api.haptic === 'function'`) and simply skip the pulse today.

## 4. Fire a flow trigger on an object

**Found in:** `modules/door-keypad`.

The `essentials` core module makes a click drive the node graph with
`import('../../lib/flowRuntime').then(m => m.fireObjectClick(uuid))` — the
replicated `nodetrigger` path. An external module cannot import it, so a module
event can never become a flow event, which is the natural way to let *users*
extend a module ("when the door unlocks, do my thing").

**Ask:** `api.fireObjectClick(uuid)` (or a general
`api.fireObjectEvent(uuid, 'unlock')`) — it is already replicated, so this is
one line of surface over an existing path.

**Meanwhile:** the door emits its own module op only; flows cannot react to it.

## 5. Create or move a **replicated** object from module code

**Found in:** `modules/tutorial-room` (build a room from a menu button),
`modules/fps-player` (move the player capsule so peers see it walk).

An external module has exactly two ways to put something in the shared scene:
`registerPrimitive` + the user typing/clicking `/create`, or nothing. Core
modules call `sceneCommand('/create X')` and `spawnAtPoint()` (essentials) and
broadcast `{type:'move'}` through `peers` directly (possess) — both are
imports. There is no `api.create(...)` and no way to broadcast an object
transform, so a module that wants to *build* something replicated has to either
make the user click a sidebar button per object, or keep its content local and
re-implement replication for it.

**Ask:**

```js
api.create('/create Box 1 1 1', { at: [x, y, z], name: 'Tutorial-sign' }); // → uuid, replicated
api.moveObject(uuid, { pos, rot, scale });   // the throttled `move` the editor sends
```

**Meanwhile:** `tutorial-room` builds its room in `api.scene()` (local root) and
replicates it as "room spawned with layout N" — one message, deterministic
rebuild on every peer. That is a *better* pattern for derived content and worth
keeping, but it means the room cannot be selected, edited or saved like normal
objects, which is exactly what an onboarding room wants to teach.

## 6. Know whether we are in VR

**Found in:** `modules/sabers`.

`isVRMode` is a core store; the api never exposes it. A module can only infer VR
indirectly (e.g. `api.pointerRay()` returning a ray while no mouse has moved).

**Ask:** `api.isVR()` — a one-line read of the existing store.

## 8. BUG — `api.onInput` silently drops keys for the first seconds

**Found in:** `modules/fps-player` (its `J` toggle did nothing right after
install, then started working; the flight passed or failed depending on how much
unrelated setup ran first — the worst kind of bug).

`api.onInput(fn)` subscribes through a dynamic import:

```js
onInput(fn) {
	let unsub = () => {};
	import('./inputRuntime').then((m) => (unsub = m.onInput(fn)));   // moduleSDK.js
	return () => unsub();
}
```

A module calls this during `register()`, gets a function back and reasonably
assumes it is subscribed — but the actual `listeners.add(fn)` happens whenever
that import settles. Measured with a minimal probe module that registers BOTH an
`onInput` listener and a frame task polling `api.input()`, pressing a key at
increasing delays after install:

| key pressed | `api.input()` (frame task) | `api.onInput` |
|---|---|---|
| +0.5s | sees it | **0 calls** |
| +2.5s | sees it | fires |
| +7.5s | sees it | fires |

**Ask:** register synchronously — hold the listener in `moduleSDK` itself and
forward it once the runtime resolves (the same trick `inputRuntimeRef` already
uses for `api.input()`), so a subscription made in `register()` is live from the
first keypress. The returned unsubscribe should work before resolution too.

**Meanwhile:** modules here edge-detect toggle keys from `api.input()` inside a
frame task. That is documented in AUTHORING.md, but it is a trap: the naive code
looks correct and mostly works.

## 7. Multi-selection uuids

`api.selectedUuid()` returns the sticky primary only. Since #15-K the
`selectedObjects` SET is authoritative in core, and menu operations fan over it.
No module here needed it yet; `api.selectedUuids()` would round out the surface.

---

## Core status (17-A1, 2026-08-09 — filed by the core window, branch `feat/module-platform`)

| # | Ask | Status |
|---|---|---|
| 1 | possess first person | **SHIPPED** — `api.possess(uuid, {camera:'first', eyeHeight, mouseLook})` + `api.possessModes` probe. mouseLook = pointer lock; X turns the OBJECT, Y pitches the camera, leaving the lock releases. |
| 2 | per-hand pose + buttons | **SHIPPED** (first half) — `api.vrHand('left'|'right')` → `{position, quaternion, trigger, gripped, connected}` or null; poll from a frame task. The hook registries (`registerVRFrameHook`/`registerGripDropHook`) on the api → backlog (need teardown journaling). |
| 3 | api.haptic | **SHIPPED** — `api.haptic(intensity, ms, hand?)` (note the arg order: hand LAST, optional — both hands when omitted). |
| 4 | fire a flow trigger | **SHIPPED** — `api.fireObjectClick(uuid)` (replicated `nodetrigger` path). |
| 5 | replicated create/move | **BACKLOG** — needs a design pass (undo attribution, viewer `__localOnly` gating, spawn parity). Keep the derived-content pattern. |
| 6 | api.isVR | **SHIPPED** — `api.isVR()`. |
| 7 | selectedUuids | **BACKLOG** (no module needs it yet). |
| 8 | onInput drops early keys | **FIXED** - onInput (and claim/release/registerBindings) now goes through the primed inputRuntimeRef, so a subscription made in register() is live from the first keypress; pre-settle unsubscribe sticks. e2e-proven in the core user-modules suite. |

Also in the same branch: user modules now install/update/disable/remove **LIVE**
(full teardown journal), every card has a **Dev URL + Reload + Auto-poll** row
(A2 — no page reload while you iterate), and the manager grew a **Browse** tab
reading this repo's `index.json` off jsDelivr (A3) — add your modules to
`index.json` (id/name/version/description/author/source/zip) when they land.
