---
number: 11
title: "No play-mode signal"
status: open
gap: "play-mode signal (`api.isPlaying()` / `onPlayMode`)"
blocks: "`dungeon-realms`"
workaround: "yes — observes `#dungeon-minimap` visibility (brittle DOM)"
---

**Found in:** `modules/dungeon-realms` — the GUI must appear "only after the
red Play button".

Core modules read `sceneStore.isLocked` (the car module's play-gate). An
external module has nothing: no store import, no api. dungeon-realms watches
`#dungeon-minimap`'s `hidden` class — semantically exact (minimap visible ⇔
play mode + a dungeon play contract) but DOM-brittle.

**Ask:** `api.isPlaying()` + `api.onPlayMode(fn)` (fires on enter/leave).
