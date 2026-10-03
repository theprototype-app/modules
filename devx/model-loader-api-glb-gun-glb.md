---
number: 36
title: "No model loader on the api (a GLB gun, a GLB enemy)"
status: open
gap: "no **model loader** on the api (`api.loadModel(url)` / `api.GLTFLoader`) — the detailed ask is \"30. No model loader\" below"
blocks: "`waves` (30b, 30c)"
workaround: "yes (30c) — `build-gltf.mjs` bundles three's GLTFLoader + SkeletonUtils against a shim of the RUNTIME three (`globalThis.__wavesTHREE`), imported from a blob: +45 kB per module that does it, and it must track core's three version by hand"
---

**Found in:** 30b-waves. The round's Meshy pipeline can make a gun or an enemy as a `.glb`, and a
module zip can carry it (`api.assetUrl('assets/gun.glb')`), but the api hands a module `THREE`
only — no `GLTFLoader`. Bundling three's loader into a module pulls a SECOND copy of three (its
`import … from 'three'`), whose classes are not the scene's; aliasing `three` to the runtime
`api.THREE` needs a hand-written shim of ~40 names.

**Ask:** `api.loadModel(url) -> Promise<THREE.Group>` through core's own loader (the same path an
Explorer import takes), or `api.GLTFLoader`.

**Meanwhile:** the Waves guns are built from primitives (src/models.js); the enemies are the
template's capsule groups.

**30c:** worked around in the module (row #36): Waves 2.1.0 bundles three's own loader against a
shim of `api.THREE` and ships Meshy guns, rigged walking enemies and a crystal inside its zip.

<!-- 30b-integrate: the round-2 lanes each numbered from #29/#30; renumbered to #36 (model
     loader, cited as #36 by 30c), #37 (render-only hide, cited by 30c), #38 untangle, #39/#40 football. -->
