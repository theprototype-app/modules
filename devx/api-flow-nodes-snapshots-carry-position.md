---
number: 16
title: "`api.flow.nodes()` snapshots carry no POSITION — **SHIPPED**"
status: shipped
gap: "~~`api.flow.nodes()` carries no node POSITION~~"
blocks: "`collectible`"
workaround: "**SHIPPED** (core PR #224) — snapshots carry `x`/`y` and `api.flow.freeRegion({w, h, graphId})` answers where a block lands; the recipe uses it and falls back to its fixed rows on an older app"
---

> Delivered both shapes (core PR #224): `x`/`y` on every snapshot, and
> `api.flow.freeRegion({w, h, graphId})` — left-aligned under the lowest card — so the
> placement rule is core's one copy (the HUD editor's bindings call the same function).
> The collectible recipe asks it once per pair. The original request is kept below.

**Found in:** `modules/collectible` — the manager's "Make collectible" recipe
creates a node pair per selected object and has to lay the rows out, but a
snapshot is `{id, type, graphId, data}` with no `x`/`y`. So a recipe cannot ask
"where is the graph already occupied" and every module that writes nodes will
invent its own guess; two of them will stack on each other.

The workaround is honest but coarse: derive the row index from how many of MY
OWN node type the graph already holds (`collectibles.length`), which is
deterministic and idempotent, and wrong the moment a user drags one of them.

**Ask:** add `x`, `y` to the snapshot (read-only is fine — `addNodes` already
takes them on the way in), or an `api.flow.freeRegion({w, h})` that answers
"somewhere empty" so layout stays core's problem.
