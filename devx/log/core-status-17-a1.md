---
kind: log
title: "Core status (17-A1, 2026-08-09 — filed by the core window, branch `feat/module-platform`)"
---

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

### 21-C C6 (2026-09-19, modules `feat/29-c6-dungeon`) — what dungeon-realms 2.0 retired

- **#11** — `api.isPlaying()` is the play gate (the `#dungeon-minimap` DOM watch is gone, kept only as the fallback on an older app).
- **#13** — the Kit (`dungeon` 2.0) is the ONE publisher of `userData.play` on `'dungeon-module'`; Realms publishes nothing of its own and puts its gems/portals on the minimap through the Kit's `setMarkers` seam → `userData.play.markers`.
- **#14** — Game Rules ▸ disableFlight writes `userData.play.grounded` (through the Kit); the capture-phase Q/E swallow is deleted.
- **#9/#12** — Realms Value / Realms Event / Realms HUD Rows replace the `drhud` node: the HUD is core HUD elements the template authors.
- The `#dungeon-panel` overlay is a registered toolbox (the SDK's worked example, AUTHORING.md).
