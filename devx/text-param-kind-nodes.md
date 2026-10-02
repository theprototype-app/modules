---
number: 12
title: "No `text` param kind for module nodes"
status: open
gap: "`text` param kind for module nodes"
blocks: "`dungeon-realms`"
workaround: "yes — button labels derive from their action select"
---

**Found in:** `modules/dungeon-realms` — "buttons with text", "GUI node needs
an editor". `NodeParam.kind` is `'range' | 'select' | 'toggle'`; there is no
free-text input, so menu titles and button labels cannot be authored on the
node. Labels derive from the action select instead ("start" → "Start
adventure"). A `{kind: 'text'}` param (rendered as the ⚙-tab name/note fields
already are) would unlock authored GUI copy.
