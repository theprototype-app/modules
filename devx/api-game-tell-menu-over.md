---
number: 30
title: "`api.game` cannot tell `menu` from `over`"
status: open
gap: "`api.game` cannot say **which** non-running state (menu vs over)"
blocks: "`untangle`"
workaround: "yes — the rising edge of `roundUnderway()` is enough for \"Next\""
---

**Found in:** `modules/untangle` (P4). `roundCutoff()` is `Infinity` for both. The solved
screen's Next is "a round starts on a solved board", which the rising edge of
`roundUnderway()` expresses — every peer sees the same replicated edge, so all advance in
lockstep with no message. **Ask:** `api.game.state()` → `'menu'|'playing'|'paused'|'over'`
(+ `outcome`).
