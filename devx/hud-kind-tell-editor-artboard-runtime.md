---
number: 32
title: "A module HUD kind cannot tell the editor artboard from the runtime layer"
status: open
gap: "a module HUD kind's `mount` gets no **editor** flag"
blocks: "`untangle`"
workaround: "yes — `el.closest('#hud-layer')` tells the runtime layer from the artboard"
---

**Found in:** `modules/untangle` (P2). The level grid must be inert in the HUD editor's
preview. `HudElement` knows (`editor`) but `mount(el, element, runtime)` is not told.
**Ask:** pass `{editor}` in `runtime` (or a fourth argument). **Meanwhile:**
`el.closest('#hud-layer')`.
