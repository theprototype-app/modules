---
number: 11
title: "No play-mode signal — **SHIPPED**"
status: shipped
gap: "~~play-mode signal (`api.isPlaying()` / `onPlayMode`)~~"
blocks: "`dungeon-realms`"
workaround: "**SHIPPED** (`api.isPlaying()` since 17-A; core 1.26, 37-slipped: `api.onPlayMode(fn)` + `api.inGame()` — Play OR a headset game in Interact). dungeon-realms keeps its own rule (desktop Interact is a game view too) and no longer reaches the minimap sniff on any core with `api.isPlaying`"
---

**Found in:** `modules/dungeon-realms` — the GUI must appear "only after the
red Play button".

Core modules read `sceneStore.isLocked` (the car module's play-gate). An
external module has nothing: no store import, no api. dungeon-realms watches
`#dungeon-minimap`'s `hidden` class — semantically exact (minimap visible ⇔
play mode + a dungeon play contract) but DOM-brittle.

**Ask:** `api.isPlaying()` + `api.onPlayMode(fn)` (fires on enter/leave).
