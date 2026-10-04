---
number: 17
title: "No change signal for the graph, the trigger log or the game state — **SHIPPED**"
status: shipped
gap: "~~no change signal for the graph / game state~~"
blocks: "`collectible`"
workaround: "**SHIPPED** (core PR #224) — `api.flow.onChange` (graph + trigger log), `api.game.onChange`, `api.peerVars.onChange`, coalesced to one call per frame; the manager listens and polls only on an older app (the ~10Hz touch/count sweep stays: it watches positions and the clock)"
---

> Delivered (core PR #224): `api.flow.onChange`, `api.game.onChange`,
> `api.peerVars.onChange`, journalled like every `register*` and also returning an `off()`
> for a toolbox that mounts and unmounts. Coalesced INSIDE the seam to one call per frame
> (a microtask was measured NOT to fold thirty arriving peer edits). `flow.onChange` covers
> the trigger log too, because a collected-state list changes when a node fires. The
> manager now redraws on these and keeps a clock only for a live respawn countdown; an
> idle panel writes nothing to the DOM (asserted). The original request is kept below.

**Found in:** `modules/collectible` — the manager toolbox and the debug line are
both views over the graph, so both POLL: the toolbox on a 500ms interval,
the collect/touch sweeps on a ~10Hz frame-task throttle. Polling is right for the
respawn countdown (it is a clock, not an event) and wasteful for everything else —
a node's params only change when someone edits them.

Note this is not fatal, and the two rules that make it survivable are worth
keeping if a signal ever lands: the toolbox rebuilds its rows only when a
STRUCTURE signature changes (so an inline `<select>` keeps its focus), and the
counts are written in place with `textContent`.

**Ask:** `api.flow.onChange(fn)` (any node/edge/data change in any graph) and
`api.game.onChange(fn)`, both journalled for teardown like every other
`register*`. `api.hud.registerDebugLine` already has the model — core samples it
on its own 500ms timer, so the module does not own a timer at all.
