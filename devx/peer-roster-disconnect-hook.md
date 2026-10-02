---
number: 15
title: "No peer roster or disconnect hook"
status: open
gap: "peer roster + disconnect hook"
blocks: "`dungeon-realms`, `football`"
workaround: "yes — `api.peerIds()` (the replicated roster) diffed each second frees a vanished peer's slot; `football` does exactly this. The name half is `api.peerNames()`"
---

**Found in:** `modules/dungeon-realms` — the travel-together portal rule needs
"every slotted player stands on the portal", but a module cannot see who is
still connected (`peerId()` is self-only; `handleDisconnected` is core). A
vanished peer wedges the gate until someone frees their slot manually.

**Ask:** `api.peers()` → `[{id, name}]` + `api.onPeerConnected/Disconnected`.
The name half would also fix the HUD showing id prefixes instead of nicknames.
