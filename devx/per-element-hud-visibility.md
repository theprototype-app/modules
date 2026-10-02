---
number: 26
title: "No per-element HUD visibility"
status: open
gap: "no per-element HUD **visibility** (show a list only when it has rows, a panel only while…)"
blocks: "`waves`"
workaround: "yes — a list with `bg: 'transparent'` draws nothing while it is empty"
---

**Found in:** `modules/waves` (roadmap 30, the empty leaderboard). The kills list sat top-right
as an EMPTY dark box until the first kill. A HUD element has no visibility channel: a screen
shows or hides as a whole (`hudscreen`, `showWhile`), and a list's box is drawn whether or not it
has rows.

**Ask:** a `visible` input on the HUD nodes (HUD Text / Bar / List: a number > 0 shows the
element), or a list style `hideEmpty: true`.

**Meanwhile:** the list's `bg` is `'transparent'`, so an empty list draws nothing and the rows
read over the scene when they arrive.
