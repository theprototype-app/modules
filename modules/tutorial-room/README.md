# tutorial-room

An in-scene onboarding room, built from one button: five signs teaching select,
build, connect, flow and VR, each with a plinth you click to tick it off. Every
peer in the session sees the same room and the same ticks.

## Use it

Install `tutorial-room.zip`, open **Modules ▸ User**, and press **Build the
tutorial room**. Walk (or orbit) around the arc, try each lesson, and click a
plinth when you have. **Remove the tutorial room** takes it away everywhere.

Asset-free by design: primitives plus canvas-drawn text, so the zip is a single
file with nothing to fetch, share or hash.

## How it works

The room is **derived content**, and that decides everything else:

- It lives at the **local scene root** (`api.scene()`), not in `objectsGroup`. It
  never enters scene sync, a saved `.tpscene`, or a GLTF export — if it did, a
  joining peer would get the room twice, once as geometry and once as the module
  rebuilding it.
- What crosses the wire is the **intent**: `{op:'build', at}` and `{op:'clear'}`.
  Every peer runs the same build code and lands on the same room — determinism IS
  the netcode, the same bargain the dungeon module makes with its seed. The
  flight asserts both peers place all five stations at byte-identical
  coordinates.
- Ticks are discrete ops plus a `registerStateSync` payload, so a late joiner
  gets the room *and* the session's progress rather than a blank slate.
- Scene-root content is not clickable until you call
  `api.registerInteractiveGroup('tutorial-room')` — that one line is the
  difference between working plinths and dead ones.

## Design notes

Two things the first version got wrong, both obvious on a screenshot and
invisible in a test:

- The stations were spread over 270°, which put two of them **behind** the
  viewer. They now sit on a 144° arc in front of the origin (`-Z`, where the
  editor camera looks), so all five read from one spot.
- The welcome sign stood on a post in the middle of the room and covered the sign
  behind it. It is now a banner above the arc.

Canvas text draws its colours straight as sRGB bytes; round-tripping a hex
through `THREE.Color` would re-linearise it and come out dark. The texture is
tagged `SRGBColorSpace` for the same reason.

## Known gap

The room would ideally be made of **real replicated objects**, so a newcomer
could select, move and delete the very things the signs are teaching about. An
external module cannot create replicated objects from code
([DEVX-REQUESTS #5](../../DEVX-REQUESTS.md), backlogged in core pending a design
pass on undo attribution and viewer gating), so it is local content plus a
rebuild message instead.

## Test-flight

```bash
npm run pack -- tutorial-room
APP_URL=https://localhost:5188/ npm test -- tutorial-room
```

16 checks: no room until built, building from the real card puts five stations
up on both peers from one message, both peers place them identically, the room
stays out of the replicated scene, clicking a plinth ticks it on both sides and
clicking again clears it, a third peer joining later arrives with the room *and*
the two ticks it missed, and removing it clears everywhere.
