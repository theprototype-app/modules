---
number: 22
title: "A HUD Button cannot drive a module node's input"
status: open
gap: "a **HUD Button cannot drive a module node's input** — `hudbutton` has no runtime value"
blocks: "`football`, `dungeon-realms` (30), `waves`"
workaround: "yes — a `delay` node bridges the stamp into a numeric pulse"
---

**Found in:** `modules/football` (24-B2), and it cost a red test-flight before it was
understood — the wire LOOKS right in the editor and does nothing at runtime.

`evalNode` has no `hudbutton` case: `flowRuntime.js` says so out loud, "hudbutton
contributes no runtime value — its label is authored on the element". Core's own
consumers of a press (`setgamestate`, `hudscreen`, `playanim`) do not read a value at
all — they read the wired source's trigger STAMP through `triggerStampFor`. A MODULE
node cannot: `registerEffect`'s declared inputs are resolved by `resolveInputs`, which
injects only a VALUE, and `undefined` is skipped. So `hudbutton -> mymodulenode.press`
is a silent no-op, while the visually identical `onclick -> mymodulenode.press` works
(On Click DOES evaluate to 1 for its pulse window).

This is the other half of #9. Module nodes can now OUTPUT an event
(`registerValueNode(..., {vtype: 'event'})` + `fireNodeTrigger`); they still cannot
RECEIVE one from the node that every game HUD is built out of.

**Ask:** either give `hudbutton` the `onclick` pulse-window value (one `case` beside it —
`{ pulse: 0.3 }` in its defaults and the same three lines), or hand module effects the
resolved trigger of their wired inputs, e.g. `ctx.inputTrigger('press')` → `{stamp, age}`.
The first is smaller and makes every existing `event -> number` coercion consistent.

**Meanwhile:** the football template wires each HUD Button through a **Delay**
(`seconds: 0.05`), which consumes the stamp and re-emits it as a numeric pulse the module
reads as an ordinary rising edge. `pitch.js` carries the reasoning under "THE HUD-BUTTON
BRIDGE" and a node test asserts both halves (every HUD button reaches a Match Button
through a Delay; none wires straight in).
