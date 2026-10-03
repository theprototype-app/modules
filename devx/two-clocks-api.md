---
number: 25
title: "Two clocks on the api"
status: open
---

**Found in:** `modules/waves` (the wave's start = the round's start). `api.now()` and every
trigger-log stamp are seconds of day on the synced clock; `api.game.roundCutoff()` returns
the round's `startedAt`, which is session **milliseconds**. The first flight compared them
directly and the wave never started. It is documented nowhere on the api.

**Ask:** either `api.game.roundStartedAt()` in the same seconds as `api.now()`, or a note in
MODULES.md on `roundCutoff` saying "ms — compare to `api.now() * 1000`". Cheap either way.
