---
number: null
title: "A module cannot add a View menu row or an object menu row — **SHIPPED**"
status: shipped
gap: "~~no View-menu toggle / object-menu action seam~~"
blocks: "`navigation`"
workaround: "**SHIPPED** (core 61-nav: `api.registerViewToggle(spec)`, `api.registerObjectAction(spec)`)"
filed: "2026-11-21"
---

**Found in:** `modules/navigation` (G7 overlay toggles, G10 "Make this an enemy"). **Shipped:**
`api.registerViewToggle({id, label, tooltip, get, set})` = a row in the viewport menu's View submenu, LOCAL
(core never stores it; the module keeps the state, here in `api.storage`). `api.registerObjectAction({id,
label, icon, tooltip, when(uuid), open(uuid), apply(uuid, spec)})` = a row in the object menu (`open` is the
person's sheet) plus a UI-less `apply` the agent tools call (`game_setup {npc}` -> `set_npc` -> the
navigation module's `applyEnemy`), so the sheet and the agent build the same guard. Both are journalled
(unregistered on unload). Core lists "Make this an enemy…" even without the module and offers to install
it from the gallery.
