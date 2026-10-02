---
number: 4
title: "Fire a flow trigger on an object"
status: open
gap: "fire a flow trigger on an object"
blocks: "`door-keypad`"
workaround: "yes — module ops only, flows can't react"
---

**Found in:** `modules/door-keypad`.

The `essentials` core module makes a click drive the node graph with
`import('../../lib/flowRuntime').then(m => m.fireObjectClick(uuid))` — the
replicated `nodetrigger` path. An external module cannot import it, so a module
event can never become a flow event, which is the natural way to let *users*
extend a module ("when the door unlocks, do my thing").

**Ask:** `api.fireObjectClick(uuid)` (or a general
`api.fireObjectEvent(uuid, 'unlock')`) — it is already replicated, so this is
one line of surface over an existing path.

**Meanwhile:** the door emits its own module op only; flows cannot react to it.
