---
number: 14
title: "No grounded (no-fly) play-mode option"
status: open
gap: "grounded (no-fly) play-mode option"
blocks: "`dungeon-realms`"
workaround: "yes — window-capture swallows Q/E while the game runs"
---

**Found in:** `modules/dungeon-realms`. Play mode's Q/E fly keys let players
leave the dungeon vertically; `slideMove` clamps only XZ. A module cannot
constrain the player (no camera-rig access — correctly so). dungeon-realms
swallows Q/E keydowns at window capture while the game runs, which works but is
the kind of DOM interception this file exists to retire.

**Ask:** honor `userData.play.grounded: true` in PointerLockControls (skip the
translateY keys, optionally snap Y to eye height), so the CONTRACT carries it.
