# untangle — drag the dots until no edges cross

The SDK's original test-flight game, now a **template game** (21-C C7): the board's
pose and the starting level are node data, the desktop HUD is core HUD elements the
template authors, and the puzzle itself stays imperative because it cannot be nodes
(no arrays in the socket type system, no pointer-ray node). Everything comes from `api`.

```
modules/untangle/
  src/puzzle.js  the PURE puzzle: RNG, generator, crossing test (node-tested)
  src/index.js   the module: board, drag, audio, nodes, replication
  src/def.js     the games/untangle template def (room, HUD, graph)
  test/          puzzle.test.mjs — determinism, solvability over 40 levels
  module.js      the bundled, self-contained entry (committed)
```

```bash
npm run build:untangle    # src/ -> module.js (esbuild) + untangle.def.json
npm run test:untangle     # the pure puzzle
npm run pack -- untangle  # -> untangle.zip
APP_URL=https://localhost:5216/ npm test -- untangle.test   # the test-flight
```

## Nodes (group "Untangle")

| Node | What | Params |
|---|---|---|
| **Untangle Board** | owns the board while alive: pose, radius, starting level, autoAdvance | level · radius · boardY · x · z · yaw · autoAdvance · apply |
| **Untangle Value** | a number OUT for a HUD Text / Compare | read: level · crossings · solved · dots · edges · count |
| **Untangle Event** | an event OUT for a Counter / Set Game State / Sound | event: solved · level |

The board node's `level` is the **starting** level — applied when the node's value
changes, so `autoAdvance` can move on without the node putting the level back, and
never on first sight over a state sync that already landed (a late joiner keeps the
level the room is on). Remove the node and the default pose returns within a second.

**The install gate.** With no Untangle Board node in any graph the module waits ~40
frames and then falls back to today's behaviour (a level-1 board appears on its own);
with a node, the node decides. A scene clear (`applySession` runs `/clear all` first)
resets to level 1 and the node re-applies its level on the next tick — the template
suite asserts that ordering, because its failure mode is "every game template silently
starts at level 1".

## The VR HUD

The 512×96 canvas sprite over the board is the **VR-only** path (gated on
`api.isVR()`): DOM is invisible in a headset. On desktop there is no sprite; the
template's HUD Text elements read the value nodes instead.

## Replication

- the puzzle is a PURE function of the level (seeded RNG) — every peer generates the
  identical graph; a saved scene carries the LEVEL (seed input), never the positions
- positions are board units (the unit disc), so a radius change re-renders without
  touching the model; drags stream as throttled previews, the DROP is the authoritative
  `move`; win = zero crossings, checked on every peer from the same positions — all
  peers advance in lockstep without a "win" message
- `utevent solved` is pulsed with `api.fireNodeTrigger` on the peer that dropped the
  solving dot (it replicates, so a Counter counts it once)
- late joiners get `{level, positions}` via `registerStateSync`
