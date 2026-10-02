---
kind: log
title: "Roadmap 31 (31-fb-dungeon) — felt again"
---

- The planner's facts named a "Meshy ball + trails" in football; the shipped scene has neither —
  the VR cost was a physical TRANSMISSION material on the glass (an extra scene pass per eye) and
  six lights + two shadow maps. A def-level check for transmission / shadow-casting lights (the
  author script warning on a VR game) would have caught it at authoring time.
- Scene-root groups are found by `scene.getObjectByName`, a whole-graph search; modules now hold
  the reference and re-check its root each frame. An `api.sceneGroup(name)` that caches would
  make the right thing the easy thing.
