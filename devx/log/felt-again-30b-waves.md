---
kind: log
title: "Roadmap 30b (30b-waves) — felt again"
---

- **#27** (`api.game` cannot tell `menu` from `over`): the results panel must not fire on Quit or
  Restart; Waves reads the crystal's health value (0 = destroyed) to tell a loss from a quit.
- **#28** (no camera on the api): the headset's START board faces the way the CONTROLLERS point
  (`api.vrHand` yaw), since the head's direction is not readable.
- **#23 / #27** (placing the player): Waves calls `api.setSpawn?.(home, 0)` — the 30b C1 seam —
  and writes `physics.play.spawn` into its def; both no-ops on a core without C1.
- A per-player HUD Button's stamp IS readable by a module (`api.flow.triggerStamp` on the
  `hudbutton` node, `perPlayer: true`): the Waves Loadout / Options screens need no new seam —
  an alternative to #22's Delay bridge for local choices.
