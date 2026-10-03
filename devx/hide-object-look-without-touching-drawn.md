---
number: 37
title: "no way to hide an object's look without touching it (a module-drawn stand-in: a rigged figure over a capsule enemy)"
status: open
gap: "no way to **hide an object's look without touching it** (a module-drawn stand-in: a rigged figure over a capsule enemy)"
blocks: "`waves` (30c)"
workaround: "yes — the object's meshes hop off layer 0 only between the scene's `onBeforeRender` and `onAfterRender` (chained). A persistent hop is NOT safe: the .tpscene save is `toJSON`, which writes layers. The card (author script) renders a `toJSON` clone, so there the capsules show under the figures. Ask: a per-object `userData.renderHidden` core honours in its renders only"
---

_Filed as a summary-table row only (roadmap 30c, `waves`); the row is the whole request._
