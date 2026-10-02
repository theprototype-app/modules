---
number: 31
title: "No camera on the api"
status: open
gap: "no **camera** on the api (the crosshair ray under a lock)"
blocks: "`untangle`"
workaround: "yes — `pointerRay().camera`, else the scene camera nearest `playerPosition()`"
---

**Found in:** `modules/untangle` (P0). Under a pointer lock the carry must follow the
CROSSHAIR; a 1.16 core's `pointerRay()` returns the stale last-mouse ray there. **Ask:**
`api.camera()` (or `pointerRay()` = the crosshair under a lock — roadmap 30 `30-core-modes`
P4). **Meanwhile:** `aim.js` takes the camera a Raycaster remembers (`pointerRay().camera`),
else the scene camera nearest `playerPosition()`, and builds the NDC (0,0) ray; it uses the
api ray as-is once it already IS the crosshair.
