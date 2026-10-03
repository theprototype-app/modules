---
number: 24
title: "Live values are ~6 Hz, and a pulse's count cannot be read back synchronously"
status: open
---

**Found in:** `modules/health` (kill credit), `modules/waves` (heals into the next wave).
`api.flow.nodeValue` reads `flowValues`, republished every 150 ms. A module that fires a
pulse into a Counter and reads the Counter on its next sweep sees the OLD count and, if it
decides from that, fires again — the waves module double-healed until it kept its own
expectation per node, and the health module credits a kill from the last sweep's number
minus what it just fired rather than from the counter.

**Ask:** `api.flow.triggerCount(id)` beside `triggerStamp` (the `count` half of the same
log entry — it is already in the map), or make `nodeValue` read a Counter live.
