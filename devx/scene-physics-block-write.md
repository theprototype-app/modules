---
number: 20
title: "No scene-physics block write"
status: open
gap: "a scene-physics block write (`api.physics.setScene({gravity, knock, …})`)"
blocks: "`football`"
workaround: "yes — the template carries the block; the \"Build pitch\" recipe toasts the Inspector rows to set"
---

**Found in:** `modules/football`. The pitch is data: a zero-g block (`gravity: 0`,
`ground.enabled: false`, damping, `ccd`, `knock.enabled`). `api.physics.set(uuid, patch)`
writes ONE OBJECT's body params; the scene block (`scenePhysics.setScenePhysics`, the
replicated `scenephysics` singleton) is not reachable, so the toolbox's "Build pitch"
recipe can build the objects and the graph but cannot switch gravity off.

**Ask:** `api.physics.setScene(partial)` = `setScenePhysics` (nested blocks merge, one
normalize, replicated), plus `api.physics.scene()` to read it.

**Meanwhile:** the template's `.tpscene` carries the block; the recipe toasts which
Inspector rows to set; the flight sets it through the debug hook.
