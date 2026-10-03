---
number: 34
title: "`registerListedGroup` cannot ask to be PICKED"
status: open
gap: "`registerListedGroup` cannot ask to be PICKED by the Edit select"
blocks: "`dungeon`, `sabers`"
workaround: "yes — the Kit registers as an INTERACTIVE group (joining every tap's raycast)"
---

**Found in:** `dungeon`, `sabers` (the modes audit). Only a group passed to
`registerInteractiveGroup` is raycast by the Edit pick, so a group that is merely listed
(`registerSystemGroup` / `registerListedGroup`) shows in the object list but a click on it
in the viewport falls through. The Kit had to become an INTERACTIVE group to be selectable
— which also enrols it in every Interact and Play tap's raycast although it has no click
handler at all.

**Ask:** `registerListedGroup(name, {label, pick: true})` — picked by the Edit select only.
