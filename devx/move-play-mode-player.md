---
number: 42
aliases: [23]
title: "No way to move the PLAY-MODE player"
status: open
---

> **Number:** Filed by 29 as #23, the same number roadmap 30 gave "no play-mode MENU surface" (the summary table's #23). Renumbered #42 by 34-split so every request has its own number; older text that says "#23 (teleportPlayer)" means this one.

**Found in:** `modules/health` (death → respawn at a spawn point). `api.playerPosition()` is
read-only; `api.flyTo` tweens the **editor** camera (and returns early in VR / spectator).
In play the rig (`cameraParent`) owns the camera and re-seats it every frame, so a module
cannot put a respawning player on their spawn pad — the one thing a respawn is for. The
health module flies the editor camera (proven in its flight) and leaves play mode owed.

**Ask:** `api.teleportPlayer(position, lookAt?)` — sets the play rig (and the editor camera
outside play), local only, the same house rule as `flyTo`.

**Meanwhile:** `respawnAt` works in the editor; in play the player comes back at full where
they died.

**30b (being answered by core lane 30b-vr-modes, C1 — not merged yet):** `api.setSpawn([x, y, z], yaw,
{teleport?})` (feet + three.js yaw; `teleport` moves the player now while Interact/Play is on,
otherwise it is the checkpoint used on entering them) and `api.respawnPlayer()`. Dungeon Realms
2.2.0 feature-detects it: each floor's start, a move on Start and on a new floor.
