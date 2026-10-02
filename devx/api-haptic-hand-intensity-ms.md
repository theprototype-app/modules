---
number: 3
title: "`api.haptic(hand, intensity, ms)`"
status: open
gap: "`api.haptic(hand, intensity, ms)`"
blocks: "`door-keypad`, `sabers`"
workaround: "yes — silent, no feedback"
---

**Found in:** `modules/door-keypad` (a keypad press wants a click),
`modules/sabers` (a hit wants a thump).

`hapticPulse()` exists in `vrControls.js` and the core `piano` module calls it by
importing `$lib/vrControls`. It is not on the api, so every external module is
silently non-haptic. Already on the 17-A1 list; both modules feature-detect
(`typeof api.haptic === 'function'`) and simply skip the pulse today.
