# untangle — drag the dots until no edges cross

The SDK's original test-flight game, now a **template game** (21-C C7): the board's
pose and the starting level are node data, the desktop HUD is core HUD elements the
template authors, and the puzzle itself stays imperative because it cannot be nodes
(no arrays in the socket type system, no pointer-ray node). Everything comes from `api`.

Roadmap 30 (2.1.0) finished it: a real drag, a 3D globe mode, 30 levels per mode with a
level selector, locks, progress that stays on the device, and the Games-tab standard shell.

```
modules/untangle/
  src/puzzle.js    the PURE puzzle: RNG, the 30-level curve, generator, crossing test
  src/sphere.js    the PURE globe: great-circle arcs, spherical crossings, generate3
  src/progress.js  the PURE progress model + the storage wrapper (api.storage or localStorage)
  src/gesture.js   press-drag-release AND click-click, window capture listeners
  src/aim.js       the aim ray: VR hand, cursor, or the crosshair under a pointer lock
  src/look.js      the meshes: instanced-tube edges, backplate, globe, hover ring, burst
  src/menu.js      two HUD element kinds: the level grid and the time/best readout
  src/index.js     the module: board, modes, audio, nodes, replication
  src/def.js       the games/untangle template def (room, HUD shell, graph)
  test/            puzzle / progress / sphere / def tests (npm run test:untangle)
  module.js        the bundled, self-contained entry (committed)
```

## Playing

- **Drag**: press a dot, move, release — or click a dot, move, click where it goes (a click
  anywhere drops it, the sky or a HUD button included). Under a pointer lock the dot
  follows the crosshair; with `play.cursor: 'free'` (and in the editor) the cursor.
- **Globe (3D)**: the same graph on a sphere; edges are great-circle arcs and a crossing is a
  spherical one. Right-drag / two fingers / the VR stick (while pointing at it) turn the
  globe — your view only; the dots replicate as unit vectors.
- **Levels**: 30 per mode, level 1 open, solving N opens N+1 for every peer who moved a dot
  on that board. Progress (`{2d, 3d}: {unlocked, solved, best}`) lives under
  `tp:mod:untangle:progress` — `api.storage` on a core that has it, the same key in
  localStorage on one that does not. The menu grid (a module HUD kind) shows the locks,
  Continue and Reset progress (asks first). Picking a level changes the board for everyone.

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
| **Untangle Value** | a number OUT for a HUD Text / Compare | read: level · crossings · solved · dots · edges · count · time · best (s) · mode (2/3) · unlocked |
| **Untangle Event** | an event OUT for a Counter / Set Game State / Sound | event: solved · level · start (the grid's Continue) |

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
- late joiners get `{level, positions, mode}` via `registerStateSync`
- picking a level / mode is `restart {level, mode}`; a round STARTING on a solved board
  (the solved screen's Next) advances every peer in lockstep, no message
- LOCAL, never on the wire: progress, the solve clock, the globe's orientation, hover,
  the carried dot's lift, the burst
