---
number: 13
title: "The play contract is name-keyed to `'dungeon-module'`"
status: open
gap: "play contract is name-keyed to `'dungeon-module'`"
blocks: "`dungeon-realms`"
workaround: "yes — squats the core module's group name"
---

**Found in:** `modules/dungeon-realms`. `src/lib/dungeonPlay.js: dungeonData()`
does `scene.getObjectByName('dungeon-module')` — the ONLY door into play-mode
walking/collision/spawns/minimap is squatting the core dungeon module's group
name. It works (this module does it, and gets WASD + collision + minimap for
free), but two dungeon-ish modules cannot coexist, and `clearGroup` in either
module deletes the other's world.

**Ask:** `dungeonData()` scans scene-root children for `userData.play` (first
match wins, name kept as tiebreak), or an explicit `api.registerPlayData(fn)`.
