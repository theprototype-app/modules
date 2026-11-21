---
number: null
title: "A module cannot read or make 78's Path objects — **SHIPPED**"
status: shipped
gap: "~~no Path object read / create~~"
blocks: "`navigation`"
workaround: "**SHIPPED** (core 61-nav: `api.paths.of(uuid)`, `api.paths.list()`, `api.paths.create({points, closed, name})`)"
filed: "2026-11-21"
---

**Found in:** `modules/navigation` (roadmap 61 G1: "Patrol reads 78's Path object ONLY"). A Patrol node must
follow the path the person draws, and editing the path must change the patrol, so the module may not keep its
own list of points. **Shipped:** `api.paths.of(uuid)` = 78's one read api (`pathOf`): `{uuid, name, points:
[{pos (WORLD), …}], closed, mode, speed, length, period, poseAt, eventsBetween}` or null; `api.paths.list()` =
`[{uuid, name}]` for a picker; `api.paths.create({points, closed, name})` makes a Path through 78's own
`createPath` (replicated, one undo step) and resolves to its uuid.
