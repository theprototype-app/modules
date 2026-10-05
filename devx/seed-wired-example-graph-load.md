---
number: 10
title: "No way to seed a wired example graph on module load — **SHIPPED**"
status: shipped
gap: "~~seed a wired example graph on module load~~"
blocks: "`dungeon-realms`"
workaround: "**SHIPPED** (core 1.23, 36-dataflow) — `api.flow.seedGraph({key, graphId?, nodes, edges})`: `addNodes` (replicated, one undo entry) but ABSENT-ONLY — nothing is added once any node carries the seed mark `data.seed = '<module>:<key>'` or is one of the module's own node types"
---

> Delivered (core 1.23, 36-dataflow): `api.flow.seedGraph({key, graphId?, nodes, edges})` — the
> `addNodes` shape (indices or ids in `edges`, replicated creates, ONE undo entry), ABSENT-ONLY:
> it adds nothing when any node in any graph already carries `data.seed = '<moduleId>:<key>'` or is
> one of THIS module's node types (the scene already uses the module — the graph is the user's).
> Call it from `init` where you would author content. The original request is kept below.


**Found in:** `modules/dungeon-realms` — the ask was literally "when the module
loads the nodes should show, already connected, in the node editor".

Nodes/edges are replicated flow-graph DATA (`flowGraphs`), and the api exposes
no write path (`registerNodeDefs` seeds *definitions*, not instances). A module
that wants to greet the user with a working, editable graph cannot.

**Ask:** `api.seedFlowGraph(graphId, {nodes, edges})`, absent-only like
`registerNodeDefs` (never clobber a user's edit), or a manifest `exampleGraph`
the manager offers to insert.

**Meanwhile:** the README documents the reference graph and every node works
dropped-in with zero wiring (implicit owner) — but nothing appears "already
connected".
