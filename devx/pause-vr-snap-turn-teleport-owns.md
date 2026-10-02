---
number: 38
title: "A module cannot pause VR snap turn (or teleport) while it owns a stick"
status: open
---

**Found in:** `modules/untangle` (roadmap 30b, the globe hold). One hand's trigger holds the
globe and that hand's stick should scale it — the edit-mode object grab's map (X scales, Y
reels). `api.claimInput('locomotion')` pauses only the LEFT stick's walking; the RIGHT stick's
X is core's snap turn and its Y teleports where a scene allows it, and nothing on the api
stands them down. Core's own gestures do it through `registerNavSuppressor` in vrControls,
which a module cannot reach.

**Ask:** `api.claimInput('turn')` (and `'teleport'`), or `api.suppressNavigation(fn)` wrapping
`registerNavSuppressor` (torn down with the module).

**Meanwhile:** the untangle hold scales on the stick's Y (forward grows, back shrinks) — the
axis snap turn does not use — and claims `'locomotion'` for the left hand.
