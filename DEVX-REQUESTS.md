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

## 7. Multi-selection uuids

`api.selectedUuid()` returns the sticky primary only. Since #15-K the
`selectedObjects` SET is authoritative in core, and menu operations fan over it.
No module here needed it yet; `api.selectedUuids()` would round out the surface.
