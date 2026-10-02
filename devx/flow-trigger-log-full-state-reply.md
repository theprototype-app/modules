---
number: 18
title: "The flow TRIGGER LOG has no full-state reply — **SHIPPED**"
status: shipped
gap: "~~the flow TRIGGER LOG has no handshake reply, so a late joiner never learns past pulses~~"
blocks: "`collectible`"
workaround: "**SHIPPED** — `gettriggers`/`triggers` carries the log; the module gained a first-sight rule so arriving history is not banked"
---

> Delivered exactly as asked: a `gettriggers` request in the handshake and a `triggers`
> reply carrying the map, merged per node on the newer stamp. Arriving history is made to
> FIRE nothing through a history epoch in `flowRuntime`, so a restored log changes what
> nodes read and never re-runs an action. **This module needed a change too**: it counts
> on a stamp edge, so it now records when it first saw each node and adopts anything older
> without counting — otherwise a joiner banked a point per already-collected gem. The
> original request is kept below for the reasoning.

**Found in:** `modules/collectible`, and it is **pre-existing core behaviour** —
21-F's seven-node recipe stood on exactly the same stamps and behaved the same
way, so this is a gap the module inherited rather than introduced.

`sendHandshake` asks for objects, nodes, annotations, joints, animations, the
post stack, shader graphs, HUDs, HUD values, node defs, module state and the
project — but there is nothing for `flowTriggers`. A pulse is a message, not a
document, so a peer that was not connected when it went out has no way to reach
it. The visible consequence: **a player who joins mid-game sees every collected
gem back on the table** (its Latch reads un-collected, so `whilePlaying` shows
the object again), while a NEW pickup converges perfectly. `nodesync`'s periodic
hash compare covers the graph, not the log, so it never heals either.

The module cannot fix this from outside. Anything it could do — carry its own
"collected" set through `registerStateSync` — would be a **second source of truth
for latch state**, which is precisely what `ctx.trigger` exists to avoid: the
module would then have to re-implement `perRound` retirement, respawn ageing and
the per-player split against its own copy, and the two answers would drift.

**Ask:** a `gettriggers` / `triggers` pair in the handshake carrying the current
`flowTriggers` map (latest stamp per node id). It is small, it is already
latest-wins per node, and every consumer of it — Latch, Once, Counter, HUD timer
and now a collectible — is a pure function of it, so a late joiner would land on
the same world as everyone else with no per-feature work at all.

Meanwhile `tests/module-collectible.test.cjs` ASSERTS the limitation (a joiner
reads 0 collected) rather than skipping it, so a core fix flips that check loudly.
