---
number: 21
title: "XR room bounds and the colocation room anchor"
status: open
gap: "the XR room bounds and the colocation `roomAnchor` on the api"
blocks: "`football`"
workaround: "yes — \"Fit to room\" / \"Centre on room\" feature-detect `api.xrReferenceSpace` / `api.colocation.roomAnchor` and fall back to sliders"
---

**Found in:** `modules/football` (B3, "Fit pitch to room" / "Centre pitch on room"). The
bounded reference space (`XRBoundedReferenceSpace.boundsGeometry`) lives on the renderer's
XR session and `roomAnchor` in `colocation.js`; neither is on the api, so a module cannot
size a pitch to the play area or put the kick-off spot on the point two colocated players
agreed on.

**Ask:** `api.xrReferenceSpace()` (null outside a session) and
`api.colocation.roomAnchor()` → `{position, quaternion, at} | null`.

**Meanwhile:** both toolbox buttons feature-detect exactly those names and fall back to
the Length / Width sliders (+ a toast), which replicate as ordinary `move`s.
