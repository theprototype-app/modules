---
number: 23
title: "No play-mode MENU surface"
status: answered
gap: "~~no play-mode MENU surface~~"
blocks: "`dungeon-realms`"
workaround: "**ANSWERED by core** — a HUD screen with `input: 'menu'` frees the pointer and core's HUD ring gives arrows/Enter/gamepad A; Dungeon Realms moved its Start/victory menu there in roadmap 30 (the DOM card stays for a graph with no HUD, `drmenu show`)"
---

**Found in:** `modules/dungeon-realms` (21-C C6.2). The start / victory menu is a modal,
keyboard-driven (↑↓ + Enter, because play mode holds pointer lock), focus-owning dialog.
It is neither a HUD element (a HUD publishes values and reacts to presses; it does not own
focus or arrow-key navigation) nor a toolbox (hidden in play mode by design). It stays
module DOM (`#dr-menu`, restyled onto the app's card conventions).

**Ask:** a `hudscreen` variant with `input: 'menu'` that OWNS keyboard focus and arrow
navigation between its buttons while pointer-locked, or `api.registerPlayMenu({buttons})`.

Still open from this list: **#5** (replicated create/move — partly answered by the 17-A
world api: `api.create`/`api.moveObject` exist), **#7**, **#10** (answered differently:
a TEMPLATE carries the placed nodes, so the api needs no graph write path — closing),
**#13** and **#14** (21-B's play-mode work), **#15**.

Also in the same branch: user modules now install/update/disable/remove **LIVE**
(full teardown journal), every card has a **Dev URL + Reload + Auto-poll** row
(A2 — no page reload while you iterate), and the manager grew a **Browse** tab
reading this repo's `index.json` off jsDelivr (A3) — add your modules to
`index.json` (id/name/version/description/author/source/zip) when they land.
