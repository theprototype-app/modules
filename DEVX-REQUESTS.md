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
| 9 | module flow nodes can't OUTPUT values or fire triggers | `dungeon-realms` | yes — rule-ownership pattern; buttons use action selects instead of trigger sockets |
| 10 | seed a wired example graph on module load | `dungeon-realms` | no — reference graph documented in the README instead |
| 11 | play-mode signal (`api.isPlaying()` / `onPlayMode`) | `dungeon-realms` | yes — observes `#dungeon-minimap` visibility (brittle DOM) |
| 12 | `text` param kind for module nodes | `dungeon-realms` | yes — button labels derive from their action select |
| 13 | play contract is name-keyed to `'dungeon-module'` | `dungeon-realms` | yes — squats the core module's group name |
| 14 | grounded (no-fly) play-mode option | `dungeon-realms` | yes — window-capture swallows Q/E while the game runs |
| 15 | peer roster + disconnect hook | `dungeon-realms`, `football` | yes — `api.peerIds()` (the replicated roster) diffed each second frees a vanished peer's slot; `football` does exactly this. The name half is `api.peerNames()` |
| 16 | `api.flow.nodes()` carries no node POSITION | `collectible` | yes — the recipe derives its row from how many of its own nodes exist |
| 17 | no change signal for the graph / game state | `collectible` | yes — a 500ms toolbox poll and a ~10Hz frame-task sweep |
| 18 | ~~the flow TRIGGER LOG has no handshake reply, so a late joiner never learns past pulses~~ | `collectible` | **SHIPPED** — `gettriggers`/`triggers` carries the log; the module gained a first-sight rule so arriving history is not banked |
| 19 | `api.game.setState(state, outcome)` — a module cannot move the game shell | `football` | yes — a Football Event node fires `start`/`over`/`reset` and the template wires it to Set Game State |
| 20 | a scene-physics block write (`api.physics.setScene({gravity, knock, …})`) | `football` | yes — the template carries the block; the "Build pitch" recipe toasts the Inspector rows to set |
| 21 | the XR room bounds and the colocation `roomAnchor` on the api | `football` | yes — "Fit to room" / "Centre on room" feature-detect `api.xrReferenceSpace` / `api.colocation.roomAnchor` and fall back to sliders |
| 22 | a **HUD Button cannot drive a module node's input** — `hudbutton` has no runtime value | `football` | yes — a `delay` node bridges the stamp into a numeric pulse |

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

## 9. Module flow nodes are effect SINKS — no value outputs, no triggers

**Found in:** `modules/dungeon-realms` (asked to put the *entire game logic* on
the node canvas).

`registerNodeGroup` + `registerEffect` give a module node exactly one runtime
behavior: a per-frame call `(object, base, data, time)` when the node is wired
to an object target (or implicitly owns an object graph). `resolveInputs`
already feeds WIRED VALUES into `data` (every `range` param gets an input
socket for free — that half is great). But a module node cannot:

- **output a value** (`evalNode` has no module hook) — "current gem count" can
  never feed a core Number/If node;
- **fire or receive a trigger pulse** — a GUI button cannot expose a trigger
  OUT socket, an event node cannot start a module action;
- receive the node **id** — two nodes of one type are indistinguishable except
  by their param values.

**Ask:** `registerValueNode(type, (data, time, ctx) => value)` +
`api.fireNodeTrigger(nodeId/handle)` + pass `anim.id` into module effects.

**Meanwhile:** dungeon-realms uses a *rule-ownership* pattern — a node ALIVE in
a running graph overrides that rule group (its replicated data is identical on
every peer, so no netcode); buttons "program what happens next" through an
action `select` param instead of a wired trigger.

## 10. No way to seed a wired example graph on module load

**Found in:** `modules/dungeon-realms` — the ask was literally "when the module
loads the nodes should show, already connected, in the node editor".

Nodes/edges are replicated flow-graph DATA (`flowGraphs`), and the api exposes
no write path (`registerNodeDefs` seeds *definitions*, not instances). A module
that wants to greet the user with a working, editable graph cannot.

**Ask:** `api.seedFlowGraph(graphId, {nodes, edges})`, absent-only like
`registerNodeDefs` (never clobber a user's edit), or a manifest `exampleGraph`
the manager offers to insert.

**Meanwhile:** the README documents the reference graph and every node works
dropped-in with zero wiring (implicit owner) — but nothing appears "already
connected".

## 11. No play-mode signal

**Found in:** `modules/dungeon-realms` — the GUI must appear "only after the
red Play button".

Core modules read `sceneStore.isLocked` (the car module's play-gate). An
external module has nothing: no store import, no api. dungeon-realms watches
`#dungeon-minimap`'s `hidden` class — semantically exact (minimap visible ⇔
play mode + a dungeon play contract) but DOM-brittle.

**Ask:** `api.isPlaying()` + `api.onPlayMode(fn)` (fires on enter/leave).

## 12. No `text` param kind for module nodes

**Found in:** `modules/dungeon-realms` — "buttons with text", "GUI node needs
an editor". `NodeParam.kind` is `'range' | 'select' | 'toggle'`; there is no
free-text input, so menu titles and button labels cannot be authored on the
node. Labels derive from the action select instead ("start" → "Start
adventure"). A `{kind: 'text'}` param (rendered as the ⚙-tab name/note fields
already are) would unlock authored GUI copy.

## 13. The play contract is name-keyed to `'dungeon-module'`

**Found in:** `modules/dungeon-realms`. `src/lib/dungeonPlay.js: dungeonData()`
does `scene.getObjectByName('dungeon-module')` — the ONLY door into play-mode
walking/collision/spawns/minimap is squatting the core dungeon module's group
name. It works (this module does it, and gets WASD + collision + minimap for
free), but two dungeon-ish modules cannot coexist, and `clearGroup` in either
module deletes the other's world.

**Ask:** `dungeonData()` scans scene-root children for `userData.play` (first
match wins, name kept as tiebreak), or an explicit `api.registerPlayData(fn)`.

## 14. No grounded (no-fly) play-mode option

**Found in:** `modules/dungeon-realms`. Play mode's Q/E fly keys let players
leave the dungeon vertically; `slideMove` clamps only XZ. A module cannot
constrain the player (no camera-rig access — correctly so). dungeon-realms
swallows Q/E keydowns at window capture while the game runs, which works but is
the kind of DOM interception this file exists to retire.

**Ask:** honor `userData.play.grounded: true` in PointerLockControls (skip the
translateY keys, optionally snap Y to eye height), so the CONTRACT carries it.

## 15. No peer roster or disconnect hook

**Found in:** `modules/dungeon-realms` — the travel-together portal rule needs
"every slotted player stands on the portal", but a module cannot see who is
still connected (`peerId()` is self-only; `handleDisconnected` is core). A
vanished peer wedges the gate until someone frees their slot manually.

**Ask:** `api.peers()` → `[{id, name}]` + `api.onPeerConnected/Disconnected`.
The name half would also fix the HUD showing id prefixes instead of nicknames.

## 16. `api.flow.nodes()` snapshots carry no POSITION

**Found in:** `modules/collectible` — the manager's "Make collectible" recipe
creates a node pair per selected object and has to lay the rows out, but a
snapshot is `{id, type, graphId, data}` with no `x`/`y`. So a recipe cannot ask
"where is the graph already occupied" and every module that writes nodes will
invent its own guess; two of them will stack on each other.

The workaround is honest but coarse: derive the row index from how many of MY
OWN node type the graph already holds (`collectibles.length`), which is
deterministic and idempotent, and wrong the moment a user drags one of them.

**Ask:** add `x`, `y` to the snapshot (read-only is fine — `addNodes` already
takes them on the way in), or an `api.flow.freeRegion({w, h})` that answers
"somewhere empty" so layout stays core's problem.

## 17. No change signal for the graph, the trigger log or the game state

**Found in:** `modules/collectible` — the manager toolbox and the debug line are
both views over the graph, so both POLL: the toolbox on a 500ms interval,
the collect/touch sweeps on a ~10Hz frame-task throttle. Polling is right for the
respawn countdown (it is a clock, not an event) and wasteful for everything else —
a node's params only change when someone edits them.

Note this is not fatal, and the two rules that make it survivable are worth
keeping if a signal ever lands: the toolbox rebuilds its rows only when a
STRUCTURE signature changes (so an inline `<select>` keeps its focus), and the
counts are written in place with `textContent`.

**Ask:** `api.flow.onChange(fn)` (any node/edge/data change in any graph) and
`api.game.onChange(fn)`, both journalled for teardown like every other
`register*`. `api.hud.registerDebugLine` already has the model — core samples it
on its own 500ms timer, so the module does not own a timer at all.

## 18. The flow TRIGGER LOG has no full-state reply — **SHIPPED**

> Delivered exactly as asked: a `gettriggers` request in the handshake and a `triggers`
> reply carrying the map, merged per node on the newer stamp. Arriving history is made to
> FIRE nothing through a history epoch in `flowRuntime`, so a restored log changes what
> nodes read and never re-runs an action. **This module needed a change too**: it counts
> on a stamp edge, so it now records when it first saw each node and adopts anything older
> without counting — otherwise a joiner banked a point per already-collected gem. The
> original request is kept below for the reasoning.

**Found in:** `modules/collectible`, and it is **pre-existing core behaviour** —
21-F's seven-node recipe stood on exactly the same stamps and behaved the same
way, so this is a gap the module inherited rather than introduced.

`sendHandshake` asks for objects, nodes, annotations, joints, animations, the
post stack, shader graphs, HUDs, HUD values, node defs, module state and the
project — but there is nothing for `flowTriggers`. A pulse is a message, not a
document, so a peer that was not connected when it went out has no way to reach
it. The visible consequence: **a player who joins mid-game sees every collected
gem back on the table** (its Latch reads un-collected, so `whilePlaying` shows
the object again), while a NEW pickup converges perfectly. `nodesync`'s periodic
hash compare covers the graph, not the log, so it never heals either.

The module cannot fix this from outside. Anything it could do — carry its own
"collected" set through `registerStateSync` — would be a **second source of truth
for latch state**, which is precisely what `ctx.trigger` exists to avoid: the
module would then have to re-implement `perRound` retirement, respawn ageing and
the per-player split against its own copy, and the two answers would drift.

**Ask:** a `gettriggers` / `triggers` pair in the handshake carrying the current
`flowTriggers` map (latest stamp per node id). It is small, it is already
latest-wins per node, and every consumer of it — Latch, Once, Counter, HUD timer
and now a collectible — is a pure function of it, so a late joiner would land on
the same world as everyone else with no per-feature work at all.

Meanwhile `tests/module-collectible.test.cjs` ASSERTS the limitation (a joiner
reads 0 collected) rather than skipping it, so a core fix flips that check loudly.

## 22. A HUD Button cannot drive a module node's input

**Found in:** `modules/football` (24-B2), and it cost a red test-flight before it was
understood — the wire LOOKS right in the editor and does nothing at runtime.

`evalNode` has no `hudbutton` case: `flowRuntime.js` says so out loud, "hudbutton
contributes no runtime value — its label is authored on the element". Core's own
consumers of a press (`setgamestate`, `hudscreen`, `playanim`) do not read a value at
all — they read the wired source's trigger STAMP through `triggerStampFor`. A MODULE
node cannot: `registerEffect`'s declared inputs are resolved by `resolveInputs`, which
injects only a VALUE, and `undefined` is skipped. So `hudbutton -> mymodulenode.press`
is a silent no-op, while the visually identical `onclick -> mymodulenode.press` works
(On Click DOES evaluate to 1 for its pulse window).

This is the other half of #9. Module nodes can now OUTPUT an event
(`registerValueNode(..., {vtype: 'event'})` + `fireNodeTrigger`); they still cannot
RECEIVE one from the node that every game HUD is built out of.

**Ask:** either give `hudbutton` the `onclick` pulse-window value (one `case` beside it —
`{ pulse: 0.3 }` in its defaults and the same three lines), or hand module effects the
resolved trigger of their wired inputs, e.g. `ctx.inputTrigger('press')` → `{stamp, age}`.
The first is smaller and makes every existing `event -> number` coercion consistent.

**Meanwhile:** the football template wires each HUD Button through a **Delay**
(`seconds: 0.05`), which consumes the stamp and re-emits it as a numeric pulse the module
reads as an ordinary rising edge. `pitch.js` carries the reasoning under "THE HUD-BUTTON
BRIDGE" and a node test asserts both halves (every HUD button reaches a Match Button
through a Delay; none wires straight in).

## 19. A module cannot move the game shell

**Found in:** `modules/football` (24-B). The match starts and ends INSIDE the module —
the physics initiator sees the ball enter a gate, counts, and decides the match is over —
but `api.game` is read-mostly (`roundCutoff`, `roundUnderway`, `playActive`, `getVar`,
`setVar`): there is no `setState`, so the module cannot put the shell into `playing` or
`over` and the DOM HUD's `showWhile` screens cannot follow the match on their own.

**Ask:** `api.game.setState(state, outcome?)` over `gameState.setGameState` (replicated
latest-wins, idempotent when already in that state — so several peers applying the same
op is harmless).

**Meanwhile:** the module registers an EVENT node (`fbevent`: start / over / reset /
goal / serve / touch) pulsed through `api.fireNodeTrigger` on the peer where the event
originated, and the template wires `start` → Set Game State (playing), `over` → (over),
`reset` → (menu). The module also calls `api.game.setState?.()` when it appears.

## 20. No scene-physics block write

**Found in:** `modules/football`. The pitch is data: a zero-g block (`gravity: 0`,
`ground.enabled: false`, damping, `ccd`, `knock.enabled`). `api.physics.set(uuid, patch)`
writes ONE OBJECT's body params; the scene block (`scenePhysics.setScenePhysics`, the
replicated `scenephysics` singleton) is not reachable, so the toolbox's "Build pitch"
recipe can build the objects and the graph but cannot switch gravity off.

**Ask:** `api.physics.setScene(partial)` = `setScenePhysics` (nested blocks merge, one
normalize, replicated), plus `api.physics.scene()` to read it.

**Meanwhile:** the template's `.tpscene` carries the block; the recipe toasts which
Inspector rows to set; the flight sets it through the debug hook.

## 21. XR room bounds and the colocation room anchor

**Found in:** `modules/football` (B3, "Fit pitch to room" / "Centre pitch on room"). The
bounded reference space (`XRBoundedReferenceSpace.boundsGeometry`) lives on the renderer's
XR session and `roomAnchor` in `colocation.js`; neither is on the api, so a module cannot
size a pitch to the play area or put the kick-off spot on the point two colocated players
agreed on.

**Ask:** `api.xrReferenceSpace()` (null outside a session) and
`api.colocation.roomAnchor()` → `{position, quaternion, at} | null`.

**Meanwhile:** both toolbox buttons feature-detect exactly those names and fall back to
the Length / Width sliders (+ a toast), which replicate as ordinary `move`s.

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
| 9 | module nodes are effect sinks | **SHIPPED** (21-A1) — `api.registerValueNode(type, fn, {vtype, inputs})` for a node that OUTPUTS a value, and `api.fireNodeTrigger(type, match?)` for one that fires an EVENT. `registerEffect` takes the same `{inputs}`. The blocking bug was in `flowSockets.outputType`: it answered `'effect'` for every unknown type, and an effect output may only reach an effect input, so a module value could not be wired to anything at all. **Two contracts to read before you use it:** the evaluator must be a PURE function of `(data, time)` (values are never sent — every peer derives them, so unreplicated local state desyncs silently), and `fireNodeTrigger` REPLICATES, so call it on ONE peer or a Counter counts it once per peer. |
| 12 | no `text` param kind | **SHIPPED** (21-A1) — `{key, kind: 'text', placeholder?, maxLength?}`. It writes on COMMIT (change/blur), never on `input`: a node edit replicates the whole node, so a per-keystroke write is one broadcast per character. |
| — | a module node cannot learn its own id | **SHIPPED** (21-A1) — an effect's 5th arg and a value node's 3rd are `{id, graphId}`. Additive, so a four-parameter effect is byte-unchanged. This is what lets one module host several instances of the same node type. |
| — | no module UI surface (the `#dr-gui` / `#dungeon-panel` workaround) | **SHIPPED** (21-A5) — `api.registerToolbox({id, title, mount, …})` over core's shared ToolboxWindow: write plain DOM and inherit header drag + position persistence, the width grip, z-band focus, the <=640px bottom sheet and the whole `.tbx-*` CSS contract. Opened from the sidebar's Modules section, the viewport menu and an optional `shortcut`. Retire the hand-rolled fixed overlays — they sit in z bands they do not own. |
| 15 | peer roster + disconnect hook | **YES, per 24-B D2** — `api.peerIds()` (the replicated roster) polled each second is the disconnect signal (`football` frees a vanished player's slot this way) and `api.peerNames()` the name half. A push-style `onPeerConnected/Disconnected` stays unbuilt: no module has needed more than the diff. |

### 21-A (2026-08-18, core branch `feat/21-module-node-io`)

`#9`, `#12` and the module UI surface are all in. Together they unblock the thing every
game needed and no module could express: **module state reaching a core HUD**. A score
kept in your own replicated state becomes `registerValueNode` -> a HUD Text node; a
level cleared becomes `fireNodeTrigger` -> a Counter; your host settings become a
toolbox instead of an overlay at `z-index: 900`.

Still open from this list: **#5** (replicated create/move — partly answered by the 17-A
world api: `api.create`/`api.moveObject` exist), **#7**, **#10** (answered differently:
a TEMPLATE carries the placed nodes, so the api needs no graph write path — closing),
**#13** and **#14** (21-B's play-mode work), **#15**.

Also in the same branch: user modules now install/update/disable/remove **LIVE**
(full teardown journal), every card has a **Dev URL + Reload + Auto-poll** row
(A2 — no page reload while you iterate), and the manager grew a **Browse** tab
reading this repo's `index.json` off jsDelivr (A3) — add your modules to
`index.json` (id/name/version/description/author/source/zip) when they land.
