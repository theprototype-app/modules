---
number: 33
title: "The VR trigger has no editor mode"
status: open
gap: "the VR trigger has no editor mode — a `{modes}` game piece still eats it in the headset editor"
blocks: "every clickable module"
workaround: "no — owed on device; modules already pass `modes`, so the fix is core-only"
---

**Found in:** the roadmap-30 modes audit (`tests/modes-audit.test.cjs`). Core 30 routes a
desktop click by the editor's mode — Edit selects, Interact and Play reach the module
handlers that asked for them — but VR's trigger passes no mode, so it still offers EVERY
handler first. A `{modes: ['interact', 'play']}` piano key therefore still eats the
trigger in the headset editor, and a VR user cannot select the piano to move it — the very
thing the desktop split fixed.

**Ask:** give the VR trigger the same `editorMode` (a radial-menu toggle beside the desktop
`I`), and pass it to `runClickHandlers`.

**Meanwhile:** every module passes `modes` anyway, so the VR half lands with no module
change. Owed on device: the music modules and sabers under the new routing in a headset.
