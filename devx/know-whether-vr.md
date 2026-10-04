---
number: 6
title: "Know whether we are in VR"
status: open
gap: "know whether we are in VR"
blocks: "`sabers`"
workaround: "yes — inferred from `pointerRay()` shape"
---

**Found in:** `modules/sabers`.

`isVRMode` is a core store; the api never exposes it. A module can only infer VR
indirectly (e.g. `api.pointerRay()` returning a ray while no mouse has moved).

**Ask:** `api.isVR()` — a one-line read of the existing store.
