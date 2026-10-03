---
kind: log
title: "Roadmap 30c (30c-game-assets) — felt again"
---

- **#36** (no model loader): see above — solved in the module, at the cost of a build step and a
  hand-kept three version (three 0.185.1 = core's). `api.loadModel` is feature-detected first.
- **#37** (a stand-in look): the figure trick needs the object's own meshes hidden without a saved
  or replicated fact; a render-scoped layer hop does it (nothing outlives a render, so switching the
  module off mid-session leaves nothing behind either).
- A figure's hit flash needs its OWN materials: a SkeletonUtils clone shares them with the source,
  so `assets.instance()` clones the materials per figure (textures stay shared).
