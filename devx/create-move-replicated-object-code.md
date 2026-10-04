---
number: 5
title: "Create or move a **replicated** object from module code"
status: open
gap: "create/move a **replicated** object from module code"
blocks: "`tutorial-room`, `fps-player`"
workaround: "yes — own scene-root content + own ops"
---

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
