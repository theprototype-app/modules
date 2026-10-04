---
number: 19
title: "A module cannot move the game shell"
status: open
gap: "`api.game.setState(state, outcome)` — a module cannot move the game shell"
blocks: "`football`"
workaround: "yes — a Football Event node fires `start`/`over`/`reset` and the template wires it to Set Game State"
---

**Found in:** `modules/football` (24-B). The match starts and ends INSIDE the module —
the physics initiator sees the ball enter a gate, counts, and decides the match is over —
but `api.game` is read-mostly (`roundCutoff`, `roundUnderway`, `playActive`, `getVar`,
`setVar`): there is no `setState`, so the module cannot put the shell into `playing` or
`over` and the DOM HUD's `showWhile` screens cannot follow the match on their own.

**Ask:** `api.game.setState(state, outcome?)` over `gameState.setGameState` (replicated
latest-wins, idempotent when already in that state — so several peers applying the same
op is harmless).

**Meanwhile:** the module registers an EVENT node (`fbevent`: start / over / reset /
goal / serve / touch) pulsed through `api.fireNodeTrigger` on the peer where the event
originated, and the template wires `start` → Set Game State (playing), `over` → (over),
`reset` → (menu). The module also calls `api.game.setState?.()` when it appears.
