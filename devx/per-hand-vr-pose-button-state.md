---
number: 2
title: "Per-hand VR pose and button state"
status: open
gap: "per-hand VR pose + button state"
blocks: "`sabers`"
workaround: "partly — one hand via `pointerRay()`"
---

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
