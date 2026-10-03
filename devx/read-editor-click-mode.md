---
number: 35
title: "A module cannot read the editor's click mode"
status: open
gap: "a module cannot read the editor's click mode (`api.editorMode()`)"
blocks: "`car`, `essentials`"
workaround: "yes — hints say \"press I (Interact)\" blind"
---

**Found in:** `car`, `essentials` (the modes audit). A game piece no longer hears Edit
clicks, so a module's hints have to tell the user to press `I` blind ("press I (Interact)
and click the body") — it cannot tell whether they already are in Interact, nor say so on
its card.

**Ask:** `api.editorMode()` → `'edit' | 'interact'` (and `'play'` while playing), with an
`onChange` like `api.game.onChange`. Local, never replicated — the same house rule as the
store it reads.
