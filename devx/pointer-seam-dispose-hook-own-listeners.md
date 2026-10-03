---
number: 29
title: "No pointer seam and no dispose hook for a module's own listeners"
status: open
gap: "no **pointer seam** (pointerdown/up, click-miss) and no module **dispose hook**"
blocks: "`untangle`"
workaround: "yes — window CAPTURE listeners, self-detaching when a newer copy owns the module's hook"
---

**Found in:** `modules/untangle` (roadmap 30, P0). A real drag needs the PRESS: core
dispatches a module click only on a short STATIONARY pointerup (the editor's select rule,
play's tap), so a press that moves never reaches a module — and until release OrbitControls
orbits the camera under the dot. The "any click drops a carried dot" rule also needs a
MISS: core has `moduleClickMissHandlers` (23-B1) but only `vrPatch` reaches it.

**Ask:** `api.registerPointerHandler({down, move, up}, {modes})` with the hit (or null) and a
way to claim the gesture (core stops orbit/select for it); `api.onClickMiss(fn)` over the
existing registry; `api.onDispose(fn)` so a module's own listeners join the teardown journal.

**Meanwhile:** `gesture.js` listens on `window` in the CAPTURE phase (it runs before the
canvas's listeners), stops propagation only for a press on its own dot or a carrying click,
and detaches itself the first time it fires after a newer copy of the module replaced
`window.__untangle` (a dev reload); a torn-down board makes it inert.
