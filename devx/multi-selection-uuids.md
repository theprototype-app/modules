---
number: 7
title: "Multi-selection uuids"
status: open
gap: "multi-selection uuids"
blocks: "—"
workaround: "yes — `selectedUuid()` is enough so far"
---

`api.selectedUuid()` returns the sticky primary only. Since #15-K the
`selectedObjects` SET is authoritative in core, and menu operations fan over it.
No module here needed it yet; `api.selectedUuids()` would round out the surface.
