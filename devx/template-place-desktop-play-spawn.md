---
number: 27
title: "A template cannot place the desktop play spawn"
status: open
gap: "a template cannot place the **desktop play spawn** (outside a dungeon it is core's fixed `[0, 2, 3]`, whatever `view` says)"
blocks: "`football`, `waves`"
workaround: "yes — the football lamp strip moved onto the crossbar so the spawn's eye line stays clear; the ask is #23's `teleportPlayer`, or a def/scene `play.spawn`"
---

**Found in:** `modules/football`, `modules/waves` (roadmap 30). Outside a Dungeon Kit level,
entering play puts a desktop player at core's fixed `[0, 2, 3]` (Scene.svelte's `<Player
position>`), not at the def's `view` and not at any object — so a template cannot choose where
its game starts. Football's player lands just outside the blue-end glass, above the ceiling
line, looking through the blue scoreboard.

**Ask:** a scene-level `play.spawn {pos, yaw}` (a def field, saved + replicated with the play
block), or #23's `api.teleportPlayer(position, lookAt)` so a module can do it on Start.

**Meanwhile:** templates keep the line of sight from `[0, 2, 3]` clear (football's lamp strip
rides the crossbar).
