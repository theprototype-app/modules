---
number: null
title: "`api.flow` cannot remove nodes, and addNodes fails on an object with no flow yet — **SHIPPED**"
status: shipped
gap: "~~no `flow.removeNodes`; `addNodes` needs an existing object graph~~"
blocks: "`navigation`"
workaround: "**SHIPPED** (core 61-nav: `api.flow.removeNodes(ids, graphId)`; `addNodes` creates a missing object graph)"
filed: "2026-11-21"
---

**Found in:** `modules/navigation` (G10: the enemy recipe writes the NPC's nodes into the object's own flow
and "remove" takes them out again). **Shipped:** `api.flow.removeNodes(ids, graphId)` removes nodes and
every edge touching them, replicated, ONE undo step; `api.flow.addNodes(graphId, …)` on an object uuid with
no flow document yet creates it first (the same graph the node editor would make) instead of refusing.
