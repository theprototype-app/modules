---
number: null
title: "No players list, kit-authority read or export flag on the api — **SHIPPED**"
status: shipped
gap: "~~no `players()` / `isAuthority()` / `isExport()`~~"
blocks: "`navigation`"
workaround: "**SHIPPED** (core 61-nav: `api.players()`, `api.isAuthority()`, `api.isExport()`)"
filed: "2026-11-21"
---

**Found in:** `modules/navigation` (G5 senses, G7 debug view). An enemy chases the nearest PLAYER, one peer
must step the crowd, and a debug view must never draw in an exported game. **Shipped:** `api.players()` =
`[{id, pos (WORLD), me}]` (this peer's camera + every open peer's avatar, the kit's nearestPlayer rule);
`api.isAuthority()` = the kit authority (physics initiator, else the lowest peer id; alone = yes);
`api.isExport()` = running in an exported game. The navigation module picks its own stepper among peers that
are ACTIVE (in Play), so it uses `isAuthority` only as the tie rule's sibling, not as the answer.
