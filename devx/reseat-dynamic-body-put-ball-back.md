---
number: 39
title: "A module cannot reseat a dynamic body (put the ball back on the centre spot)"
status: open
---

**Found in:** `modules/football` (30b). After a goal the ball must rest in the net, then go back
to the centre spot for the kick-off. `api.physics` can push a body (`applyImpulse`) but not PLACE
one: there is no module path to core's `applyThrow` (reseat + velocity), and `setBodyVelocity` is
not on the api either.

**Meanwhile:** the authority writes the ball's pose with `api.moveObject` while a simulation runs.
Core's physics reads a pose it did not write as an EXTERNAL hold (the deviation rule): the body
goes kinematic where it was put and drops back to dynamic, at rest, 250 ms after the last write.
Football re-places only when the ball drifted more than 2 cm (a hand knocked it during the
countdown), and retries a kick-off nudge the hold refused. It works, but it leans on an internal
rule and costs a `move` message per re-place.

**Ask:** `api.physics.placeBody(uuid, pos, {rot?, linvel?, angvel?})` — the initiator's
`applyThrow`, replicated through the move stream like every other initiator write.
