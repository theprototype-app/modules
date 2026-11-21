---
number: null
title: "No way to read the static colliders and terrain as triangles (a navmesh bake's input) — **SHIPPED**"
status: shipped
gap: "~~no static-collider / terrain triangle query~~"
blocks: "`navigation`"
workaround: "**SHIPPED** (core 61-nav: `api.colliderGeometry({maxTriangles, signatureOnly})`)"
filed: "2026-11-21"
---

**Found in:** `modules/navigation` (roadmap 61 G1). A navmesh is baked from what the player can stand
on and what blocks them; the module had no read of the physics shapes. **Shipped:**
`api.colliderGeometry(opts)` returns the STATIC colliders + terrain as WORLD triangles
(`{positions: Float32Array, indices: Uint32Array, triangles, truncated}`), the MOVING solids (dynamic bodies,
flow-animated objects) as `moving: [{uuid, min, max}]` boxes a bake treats as temporary obstacles, and a
cheap `signature` so a module rebakes on edit only. `{signatureOnly: true}` skips the triangles (the
module polls it to debounce a rebake). `maxTriangles` caps the copy (`truncated` says it was hit).
