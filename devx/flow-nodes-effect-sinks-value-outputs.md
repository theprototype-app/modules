---
number: 9
title: "Module flow nodes are effect SINKS — no value outputs, no triggers"
status: open
gap: "module flow nodes can't OUTPUT values or fire triggers"
blocks: "`dungeon-realms`"
workaround: "yes — rule-ownership pattern; buttons use action selects instead of trigger sockets"
---

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
