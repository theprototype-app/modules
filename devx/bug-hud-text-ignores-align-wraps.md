---
number: 28
title: "BUG — HUD text ignores `align` unless it wraps"
status: fixed
gap: "~~**BUG**: a HUD Text / Timer / list row ignores `style.align` unless it wraps~~"
blocks: "`football`, `dungeon-realms`, `waves`, `untangle`"
workaround: "**FIXED in core 1.17** — the text row takes `justify-content` from `align` (30-visuals-core); the 30 menus stay left-aligned (still right on 1.16), untangle's titles are wide centred boxes"
---

**Found in:** all three roadmap-30 game HUDs. `HudElement.svelte` renders a text / timer element as
`<div class="hud-el hud-text" style="text-align: …">`, and `.hud-text` is `display: flex;
align-items: center`. The label becomes an anonymous flex ITEM sized to its content, so
`text-align: center` has nothing to centre: a title, a clock or a node-driven score always sits at
the box's left edge. Wrapped text (`wrap: true`) happens to fill the box and centres. List rows
(`.hud-list-row`, also flex) behave the same.

**Ask:** map `style.align` onto `justify-content` (`flex-start` / `center` / `flex-end`) on the
flex text elements and list rows — one line in `boxStyle`, every saved document keeps its look
where it was left-aligned (the default).

**Meanwhile:** the 30 game menus align left to their button column on purpose, and the few things
that must look centred (the football clock, the waves banner) get a box barely wider than the text.
