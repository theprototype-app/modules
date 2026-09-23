# Authoring a module for theprototype.app

This is the single entry point for writing an **external** module — one that
installs from a `.zip` or a URL, not one bundled into the app. It is written to
be read start-to-finish by a person **or** pasted whole into an AI assistant.

- Full API reference: the docs site's [module-sdk](https://docs.theprototype.app/module-sdk/)
  and [module-package](https://docs.theprototype.app/module-package/) pages, plus
  `MODULES.md` in the core repo.
- Worked examples in this repo, roughly in order of how much they ask of you:
  [`_template`](modules/_template/) (start here) ·
  [`door-keypad`](modules/door-keypad/) (replicated objects, a discrete event, a
  deterministic animation from one timestamp, late-joiner state) ·
  [`dungeon`](modules/dungeon/) (**the worked toolbox example**: `api.registerToolbox`
  with a `#dungeon-panel` DOM fallback behind a feature-detect, a node that IS the
  recipe, and a published `userData.play` contract other modules read) ·
  [`dungeon-realms`](modules/dungeon-realms/) (a game as an OVERLAY on another module:
  two modules cannot share code, so they share the scene — the Kit's
  `userData.play` / `userData.kit` seam, read through `api.scene()`) ·
  [`tutorial-room`](modules/tutorial-room/) (derived content: local geometry,
  replicated *intent*) · [`sabers`](modules/sabers/) (per-frame pose streaming,
  VR and desktop from one code path) · [`fps-player`](modules/fps-player/)
  (input claims, `possess`, capability probing) ·
  [`flow-toolkit`](modules/flow-toolkit/) (flow nodes) ·
  [`untangle`](modules/untangle/) (a full replicated game) ·
  [`health`](modules/health/) (a number several peers can lower, converging with no
  authority: pulses counted by core's Counter, a player's own peer row, the first-sight
  rule) · [`waves`](modules/waves/) (a mechanic COMPOSED on another module's node types,
  the wave derived from counters, a run log every peer appends identically).
- Missing something? [DEVX-REQUESTS.md](DEVX-REQUESTS.md) tracks known SDK gaps —
  check it before you work around one.

---

## 1. What a module is

A folder with a `manifest.json` and one self-contained JavaScript file that
default-exports `{ id, name, version, description, register(api) }`. The app
calls `register(api)` once, and everything your module does — objects, clicks,
flow nodes, netcode — is wired through that `api` object.

```bash
npm install                          # once, for the pack + test scripts
npm run new -- my-module "My Module"  # scaffold from modules/_template
npm run pack -- my-module             # -> my-module.zip at the repo root
```

Install it: **burger menu ▸ Modules ▸ User tab ▸ Install from zip**. The module
registers immediately — no reload. (Removing or disabling one *does* need a
reload; SDK v1 registries have no unregister.)

### The trust model

A module is **code running in the user's session**, with the same reach as the
app itself. There is no sandbox, no permission prompt beyond the install warning.
Ship modules you would run yourself, and expect users to read the source of
anything they install. Everything in this repo is MIT and reviewable.

---

## 2. The entry file is self-contained

The app stores your files in IndexedDB and imports the entry as a **blob URL**.
A blob URL has no package resolution and no base path, so:

| In your entry file | Result |
|---|---|
| `import * as THREE from 'three'` | fails — no import map for bare specifiers |
| `import { helper } from './helper.js'` | fails — nothing to resolve `./` against |
| `const THREE = api.THREE` | ✅ the app's own three, same version, no duplicate |
| `await import(api.assetUrl('extra.js'))` | works, but you rarely need it |

`npm run pack` fails the build if it finds a top-level `import` — that error is
this rule, not a bug.

**Multi-file development** is fine as long as you ship one bundled file. esbuild
with no external deps:

```bash
npx esbuild src/index.js --bundle --format=esm --outfile=modules/my-module/module.js
```

Keep `api` as the only outside reference: bundling `three` would ship a second
copy of the library and your objects would fail `instanceof` checks against the
app's.

### Assets

Anything in the zip that is not the entry becomes a blob URL:

```js
const chime = new Audio(api.assetUrl('assets/chime.mp3'));
const map = new THREE.TextureLoader().load(api.assetUrl('assets/wood.png'));
```

List asset paths in the manifest's `files` array — zip installs pick up every
file automatically, but **URL installs only fetch what `files` names**.

---

## 3. manifest.json

```json
{
	"id": "my-module",
	"name": "My Module",
	"version": "1.0.0",
	"format": 1,
	"description": "One line shown on the module card.",
	"entry": "module.js",
	"files": ["module.js", "assets/chime.mp3"]
}
```

| Field | Contract |
|---|---|
| `id` | **required**, must equal the folder name and the `id` in your entry file, and be unique across every module a user might install — it routes your messages |
| `name`, `version` | **required**; `version` is what peers compare (see §7) |
| `format` | the manifest format this module targets. The app supports `1`; a **higher** number makes the app ask the user to confirm before installing. Absent = 0 = installs silently |
| `entry` | defaults to `module.js` |
| `description` | shown on the card |
| `files` | used by URL installs; harmless but good practice for zips |

The zip must have `manifest.json` **at its root**, not inside a folder.
`Compress-Archive` nests the folder and produces "zip has no manifest.json at
its root" — use `npm run pack`.

---

## 4. Replication — the part that bites

**Your module runs on every peer. There is no server.** Whatever a user does
must end up identical everywhere, and there are exactly three ways to get there.

### 4.1 Pick ONE model per feature

**Deterministic** — the same inputs plus the synced clock produce the same
result on every peer, so nothing needs sending. Prefer this. A door that opens
from a broadcast `at` stamp, a puzzle generated from a seed, an effect that is a
pure function of `(data, time)`.

```js
api.registerFrameTask((time) => {
	const age = time - openedAt;              // openedAt came from ONE small message
	door.position.y = base + Math.min(1, age / 0.6) * 2;
});
```

**Authoritative** — one peer decides and broadcasts the result. Physics, dice,
anything where "simulate it yourself" would drift. Only the initiator may
mutate; everyone else forwards their input to it.

```js
if (api.physics.isInitiator()) api.physics.applyImpulse(uuid, [0, 5, 0]);
else api.send({ op: 'push', uuid });   // and the initiator applies it
```

Never mix them for one feature. A deterministic animation that also receives
corrective positions will fight itself.

### 4.2 Apply locally AND send; receivers never re-send

```js
function open(uuid, at) { /* apply — no sending in here */ }

api.registerClickHandler((object) => {
	const at = api.now();
	open(object.uuid, at);                    // local
	api.send({ op: 'open', uuid: object.uuid, at });  // peers
	return true;
});
api.onMessage((data) => {
	if (data.op === 'open') open(data.uuid, data.at); // apply, do NOT re-send
});
```

Re-broadcasting from a receiver is an infinite loop in a mesh.

### 4.3 Late joiners

Someone connects after the door opened. The handshake asks every module for its
state:

```js
api.registerStateSync({
	getState: () => ({ open: [...openUuids] }),        // sent to the new peer
	applyState: (state) => state?.open?.forEach(markOpen)
});
```

If your state is *derivable from the scene* (you read object names and positions
that already replicate), you may not need this at all — that is usually the
better design.

### 4.4 Time and randomness

- `api.now()` is the **synced** clock in seconds. Stamp every replicated time
  with it, never `Date.now()`.
- `Math.random()` in anything replicated is a desync. Send a **seed** and
  generate from it — see `modules/untangle`'s `mulberry32`.
- Don't accumulate (`object.rotation.y += x`) in per-frame code: peers that
  dropped frames end up somewhere else. Compute from a base and a time.

### 4.5 What travels, and what does not

| Travels | Does not travel |
|---|---|
| `api.send()` payloads (`{type:'module', moduleId, ...}`) | **the module itself** — every peer installs it separately |
| `registerStateSync` state, on connect | objects you add to `api.scene()` (scene root is local) |
| Objects created through `/create` (registerPrimitive) | local `userData` you set yourself |
| The `{id, version}` list of loaded modules | assets from your zip |

**Installing a module does not install it for your peers.** They exchange module
id/version lists only; a peer without your module just sees whatever plain scene
objects it created, and both sides get a toast about the mismatch.

### 4.6 Where to put your objects

- **`api.objectsGroup()`** is the replicated scene root. Objects here sync to
  late joiners, appear in the object list, and can be moved or deleted by
  anyone. The clean way to create one is `registerPrimitive` + its `/create`
  command, which runs on every peer.
- **`api.scene()`** is the local scene root. Content here is yours: it never
  enters scene sync, never lands in someone's saved file, and never duplicates
  on connect. Rebuild it from your module state on each peer. Register the group
  name with `api.registerInteractiveGroup('my-module')` to make it clickable,
  and clean it up in `api.onSceneClear()`.

Derived content (a generated dungeon, a game board) belongs in `api.scene()`.
Things the user should be able to select, move and save belong in
`objectsGroup()`.

### 4.7 Derive behavior from the replicated NAME

Object `userData` you set locally is **not** on the peers' copy of that object.
The name is. So a module that behaves differently per object kind reads the
name that `/create` assigned:

```js
api.registerPrimitive('Mykeypad', builder, { command: '/create Mykeypad' });
// later, on any peer:
if (object.name === 'Mykeypad') handleKeypad(object);
```

---

## 5. The api surface (digest)

Full signatures live in the docs site; this is the map.

| Group | Calls |
|---|---|
| Scene | `scene()`, `objectsGroup()`, `registerPrimitive(name, builder, entry?)`, `registerInteractiveGroup(name)`, `registerSystemGroup(name)`, `onSceneClear(fn)` |
| Interaction | `registerClickHandler(fn)` (desktop click **and** VR trigger), `pointerRay()`, `registerFrameTask(time => …)` |
| Flow | `registerNodeGroup(group, components?)`, `registerEffect(type, fn)`, `registerNodeDefs(defs)` |
| Netcode | `send(payload)`, `onMessage(fn)`, `registerStateSync({getState, applyState})`, `peerId()` |
| Input | `registerBindings(list)`, `input()`, `onInput(fn)`, `claimInput(scope)`, `releaseInput(scope)` |
| Physics | `physics.isInitiator()`, `applyImpulse`, `applyTorqueImpulse`, `setJointMotor`, `joints()` |
| Knock | `onHit(cb)` — every knock this peer sees (its own hand's and every peer's `hit`) as `{uuid, by, at, speed, point, linvel, angvel, probe, local}`; returns the unsubscribe, torn down with the module · `hitLog()` — a COPY `{last, recent}` (last hit per live body, the last 32 in order; runtime state, a late joiner's starts empty) |
| Player | `possess(uuid, {camera})`, `releasePossess()`, `selectedUuid()` |
| UI | `registerMenu(label, action)`, `registerVRMenuEntry(entry)`, `toast(text)` |
| Misc | `THREE`, `assetUrl(path)`, `now()`, `sceneAssets()` |

The worked example for the game SDK (`api.game`, `api.peerVars`, `onHit`, `registerStateSync`, `registerToolbox`) is [football](modules/football/): rules as flow nodes, last-touch attribution evaluated BY EACH PEER from `onHit` (no module message for a touch), the physics initiator as the one goal authority, and each player's goals written to their OWN `peerVars` row.

Three that are easy to miss:

- **`registerClickHandler` covers VR too.** You do not write a second input
  path for the headset; the trigger dispatches through the same handler with the
  exact mesh that was hit. Return `true` to consume the click (no selection).
- **`claimInput('keys' | 'locomotion')` pauses the editor's own consumers** so
  your WASD does not also fly the camera. Always release it when your mode ends,
  including on error paths.
- **`onHit` fires on EVERY peer for every hit.** Attribution derived from it is
  deterministic without a message of your own; a per-player counter must still bump
  only when `hit.by === api.peerId()` (or `hit.local`), or every peer banks it.

---

## 6. Edit, Interact, Play

### Content that is listed but never click-selectable

Every module's content is in the object list (the scene tree, or its **Module content**
section). These are the exceptions to "a click in Edit selects it", each with its reason:

| Module | What | Why |
|---|---|---|
| `sabers` | the blades | a desk blade lies ALONG the pointer ray, so a click on it would be every click; listed (`Sabers`) and framed from the list |
| `avatar`, `flow-toolkit` | — | no scene content of their own (possession acts on your object; node definitions only) |

---

## 7. Versioning and compatibility

- Bump `version` in `manifest.json` **and** in the entry file's export — the
  entry's value is what peers compare. Keeping them equal is on you.
- On connect, peers toast when a module is missing on one side or the versions
  differ. It is advisory: the session continues, but replicated behavior may not
  match. Treat a version bump as "my messages may have changed shape".
- Changing the shape of an `api.send` payload or `getState` is a **breaking**
  change for anyone mid-session on the old version. Tolerate missing fields when
  you can (`data.at ?? api.now()`).
- Modules do not pin an app version. If you need a capability that may be
  absent, feature-detect it: `if (typeof api.pointerRay === 'function')`.

---

## 8. Testing your module

### Live reload while you build

Serve the module folder over HTTP and point the app at it — then every save is
one click (or zero) away from running, with no page reload:

```bash
cd modules/my-module
npx serve -l 8099 --cors .     # any static server with CORS works
```

In the app: **Menu ▸ Modules ▸ User**, paste `http://localhost:8099` into the
install field, press **Install**. The card then carries a **Dev URL** row:

- **Reload** re-fetches the files and swaps the new code in live. Everything
  `register(api)` added is torn down first — menu entries, nodes, effects,
  frame tasks, click handlers, input claims, your scene-root groups — so
  repeated reloads cannot stack up duplicates.
- **Auto** polls the URL every ~2s and reloads whenever `module.js` changes.
- A syntax error or a throw during `register()` leaves the **previous version
  running** and toasts the reason; fix the file and reload again.
- Objects your module created inside `objectsGroup()` stay (they are shared
  user content); your own scene-root groups are removed and rebuilt by the new
  code.

Two caveats worth knowing:

- If a peer is connected, bumping `version` re-triggers their "module version
  differs" toast on every reload. That is correct — your dev copy really does
  differ — but keep the version stable while iterating and bump it when you ship.
- When the static server goes away, Auto stops silently (the poll failure is
  deliberately quiet so restarting your server does not spam toasts). If Auto
  seems to stop picking up edits, check the server is still up.

**Two windows, always.** A module that looks perfect in one browser is untested.
Run a second window against the same app, connect the peers, act in one and
watch the other; then reload the second (late joiner) and check it catches up.

**Automated test-flight.** Every module in this repo ships a Playwright script
that installs the **real zip through the real manager** and drives the app:

```bash
npm install
npx playwright install chromium         # once
npm run pack -- --all
APP_URL=https://localhost:5188/ npm test            # all test-flights
APP_URL=https://localhost:5188/ npm test -- keypad  # one
```

`APP_URL` points at any running app instance (a dev server, a lane worktree, or
the deployed site). See [tests/README.md](tests/README.md) for the two-peer
recipe and the `window.__stores` debug hook the checks read.

### Checklist before you ship

- [ ] Two connected windows agree after every interaction.
- [ ] A peer that joins **after** the interaction catches up.
- [ ] No `Math.random()` and no `Date.now()` in replicated paths.
- [ ] Receivers never re-broadcast.
- [ ] Every `claimInput` has a matching `releaseInput`, including on error.
- [ ] `api.onSceneClear` removes your scene-root content and resets state.
- [ ] `npm run pack` succeeds (no top-level imports, manifest matches folder).
- [ ] Works with a mouse **and** with the VR trigger, if it is clickable.

---

## 9. Friction log

Things that cost real time while writing the modules in this repo. Add to this
list when something bites you.

- **Blank card, no error.** The entry threw during `register()`. The app catches
  it, toasts "failed to load" and disables the module — open the console for the
  actual stack.
- **"zip has no manifest.json at its root".** The zip contains the module
  *folder*. `npm run pack` builds the right layout.
- **Your change did not take.** Fixed in the app: installing over a loaded
  module, updating, disabling and removing all apply **live** now, and a Dev URL
  card gives you Reload / Auto (see "Live reload while you build"). On an older
  build the zip was stored but the old code kept running until a page reload.
- **Peers do not see your objects.** You added meshes to `api.scene()` (local by
  design) instead of creating them through `/create`, or you moved an object in
  `objectsGroup()` without telling anyone — a module cannot broadcast a plain
  object move; replicate the pose through your own `api.send` op, or drive the
  object with `api.possess`.
- **The click handler never fires.** Your content is at the scene root and you
  did not `registerInteractiveGroup(name)` — only `objectsGroup` is clickable by
  default. Also check you are walking up from the *hit mesh* to your root
  object; handlers receive the exact mesh, not the group.
- **The animation drifts between peers.** Accumulation, `Date.now()`, or a
  frame-rate-dependent step. Recompute from `(base, api.now())` every frame.
- **Selection steals your interaction.** Return `true` from the click handler.
- **`api.onInput` missed the first seconds of keys.** Fixed in the app: the
  subscription is synchronous now, so a listener registered in `register()` is
  live from the first keypress. On an older build it went through an async
  import and a key pressed right after install did nothing while the same code
  worked later. Edge-detecting from the per-frame snapshot is still a fine
  pattern and works on every build (`fps-player` does this):

  ```js
  let was = false;
  api.registerFrameTask(() => {
  	const down = api.input().codes.has('KeyJ');
  	if (down && !was) toggle();
  	was = down;
  });
  ```

- **Keyboard input stops while an app modal is open.** A button on your module
  card that starts a keyboard-driven mode leaves the user in the Modules
  manager, where no key reaches you. Offer a key binding as well as the button.
- **`api.input()` fires while the user is typing in a panel.** Claim the scope
  (`claimInput('keys')`) only while your mode is active, and ignore input when
  it is not.
- **An EFFECT node pins its target's pose.** The runtime re-seats an effect target's base
  pose every frame while the effect is active (in play), so a `registerEffect` node on an
  object that must move — a knocked crate, a walking enemy — fights every move, replicated
  or not (football's "no node may target the ball"). If your node only needs to *know* its
  object, make it a `registerValueNode` with an `{inputs: {target: 'object'}}` socket and
  wire the Object Selector IN; hide/show the object yourself and restore only what you hid
  (`health` does this).
- **Two clocks.** `api.now()` and every trigger-log stamp are seconds of day on the synced
  clock; `api.game.roundCutoff()` (the round's `startedAt`) is session **milliseconds**.
  Convert (`(ms / 1000) % 86400`) before comparing, and never compare either to
  `performance.now()`. A joiner's `api.now()` also re-bases on connect — decide "did I
  witness this" by identity (the collectible's first-sight rule), never by clock.
- **`api.flow.nodeValue` is ~6 Hz.** The live values republish every 150 ms, so a Counter
  you just pulsed still reads the old count for a moment. Firing again "because the count
  has not moved" doubles the pulse; remember what you fired (`waves` keeps a per-node
  expectation) or derive from the last sweep's numbers (`health`'s kill credit).
- **A second `installModule` on one peer needs the `/^User/` tab locator** — after an
  install the tab reads "User (1)" and an exact match hangs (fixed in `helpers.cjs`).
- **Capping `dt` turns a slow frame rate into slow motion.** `Math.min(dt, 0.1)`
  is the right way to stop a physics step tunnelling, but at 7fps (headless
  Chromium, a background tab) it means sim time advances at 0.7x — a jump that
  takes 0.9s on your machine takes 2s+ there. Tests must poll for the end state,
  never sleep for a computed duration.
