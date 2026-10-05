---
number: 9
title: "Module flow nodes are effect SINKS — no value outputs, no triggers — **SHIPPED**"
status: shipped
gap: "~~module flow nodes can't OUTPUT values or fire triggers~~"
blocks: "`dungeon-realms`"
workaround: "**SHIPPED** (core 21-A1 + R3a; verified by 36-dataflow) — `api.registerValueNode(type, fn, {vtype, inputs})` outputs values (incl. `vtype: 'event'`), `api.fireNodeTrigger(type, match, opts)` fires pulses, module effects get `{id, graphId, trigger}` as a 5th arg; the 1.23 value graph memoizes them once per tick"
---

> Delivered (core 21-A1 `moduleNodeIO`, R3a `trigger`, audited by 36-dataflow for 1.23): a module node
> can OUTPUT a value (`api.registerValueNode(type, (data, time, ctx) => v, {vtype, inputs})` — number,
> boolean, vector3, color, object or event; declared `inputs` are resolved like a core node's), FIRE a
> trigger (`api.fireNodeTrigger(type, match, {replicate})`) and learn its own id (`ctx.id`, the 5th arg
> of a module effect: `{id, graphId, trigger}`). 1.23 adds the value-graph memo (one evaluation per
> node per tick, cycle-safe), so a module value can sit anywhere in a chain
> (module → Math → a rule input) for free. The original request is kept below.


**Found in:** `modules/dungeon-realms` (asked to put the *entire game logic* on
the node canvas).

`registerNodeGroup` + `registerEffect` give a module node exactly one runtime
behavior: a per-frame call `(object, base, data, time)` when the node is wired
to an object target (or implicitly owns an object graph). `resolveInputs`
already feeds WIRED VALUES into `data` (every `range` param gets an input
socket for free — that half is great). But a module node cannot:

- **output a value** (`evalNode` has no module hook) — "current gem count" can
  never feed a core Number/If node;
- **fire or receive a trigger pulse** — a GUI button cannot expose a trigger
  OUT socket, an event node cannot start a module action;
- receive the node **id** — two nodes of one type are indistinguishable except
  by their param values.

**Ask:** `registerValueNode(type, (data, time, ctx) => value)` +
`api.fireNodeTrigger(nodeId/handle)` + pass `anim.id` into module effects.

**Meanwhile:** dungeon-realms uses a *rule-ownership* pattern — a node ALIVE in
a running graph overrides that rule group (its replicated data is identical on
every peer, so no netcode); buttons "program what happens next" through an
action `select` param instead of a wired trigger.
