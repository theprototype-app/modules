---
number: 40
title: "A squeezed grip silences the hand's knock"
status: open
---

**Found in:** `modules/football` (30b, the Quest 3 feedback "I should be able to knock the ball
with the controller"). Core's knock skips a GRIPPED hand ("a gripped hand is carrying, not
knocking"), and a player swinging at a ball squeezes the grip. Football now kicks with its own
controller-TIP sphere (kick.js), which does not care about the grip, and drops a tip kick that
follows the same peer's core knock within 250 ms so one swing is never two touches.

**Ask:** gate the knock on "holding something" (a user hold on a body) rather than on the grip
button; then football's tip kick could retire to just the `kick` sound and the scaled haptic.
