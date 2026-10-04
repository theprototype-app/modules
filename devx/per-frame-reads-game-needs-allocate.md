---
number: 41
title: "The per-frame reads a game needs allocate, and \"a game view\" is re-derived everywhere"
status: open
---

**Found in:** `modules/dungeon` + `modules/dungeon-realms` + `modules/football` (roadmap 31, the
Quest stutter). A module's frame task reads the viewer every frame: `api.playerPosition()` builds a
fresh `Vector3` AND an array per call (the Kit and Realms each call it every frame), and every game
re-derives "is this a game view" as `api.isPlaying() || api.editorMode() === 'interact'` (Realms,
the Kit, football each their own way). A game's own per-frame path can be allocation-free (31 made
the Kit's, guarded by a GC-count test); the api reads under it cannot.

**Ask:** `api.playerPosition(out?)` writing into a caller's `[x, y, z]` (or `Vector3`), and
`api.gameView()` → `true` in Play and Interact (the one rule, in core).

**Meanwhile:** the modules call them as they are (two small allocations a frame each).
