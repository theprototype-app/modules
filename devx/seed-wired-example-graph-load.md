---
number: 10
title: "No way to seed a wired example graph on module load"
status: open
gap: "seed a wired example graph on module load"
blocks: "`dungeon-realms`"
workaround: "no — reference graph documented in the README instead"
---

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
