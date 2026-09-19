# dungeon — the Dungeon Kit

A level-generation **toolbox**, not a game: one seed → a multi-floor dungeon campaign
(rooms, corridors, decor, torches, typed spawn slots), rendered as instanced meshes
at the scene root and published as a **play contract** the app walks in play mode.
The playable co-op game built on it is [`dungeon-realms`](../dungeon-realms/).

```
modules/dungeon/
  src/gen/        the 9-stage PURE-DATA generator (zero THREE/DOM — node-runnable)
  src/contract.js the userData.play record (pure, node-tested)
  src/render.js   the instanced level renderer (floors, walls, decor, torches, lights)
  src/kit.js      world state {seed, params, floorIndex}, replication, the seam
  src/toolbox.js  api.registerToolbox (+ the #dungeon-panel fallback)
  src/nodes.js    the "Dungeon" node — the recipe as a node
  test/           gen.test / campaign.test / contract.test (no app needed)
  module.js       the bundled, self-contained entry (committed)
```

```bash
npm run build:dungeon    # src/ -> module.js (esbuild)
npm run test:dungeon     # generator + contract acceptance (100-seed sweep, <50ms)
npm run pack -- dungeon  # -> dungeon.zip
APP_URL=https://localhost:5216/ npm test -- dungeon.test   # the test-flight
```

## The toolbox (Modules ▸ Dungeon Kit)

Seed + 🎲, Rooms (0 = the per-floor auto ramp), Extra loops, Floors, **Generate** /
**Clear**, a floor stepper and a stats footer. It is `api.registerToolbox` over the
app's shared ToolboxWindow (draggable, resizable, themed, in its own z-band); on an
app without that call it falls back to the old fixed `#dungeon-panel` DOM, mounting
the same controls (the AUTHORING.md feature-detect rule). A toolbox is LOCAL: what it
changes goes through the replicated paths — the Kit's own `generate` / `floor` /
`clear` ops, or the Dungeon **node** when one owns the recipe.

## The node (group "Dungeon Kit")

**Dungeon** — `seed · roomCount (0 = auto) · levelCount · loopChance · gemDensity ·
apply`. A node alive in a running graph with `apply` on regenerates the identical
campaign on every peer from its replicated data and broadcasts nothing: the node IS the
recipe. A template carries it wired to an Object Selector (module effect nodes run
wired, or unwired inside an object's own graph). The toolbox edits this node when it
exists (`api.flow.setNodeData`) so the two never fight.

## The contract (`userData.play` on the scene-root group `dungeon-module`)

Core reads `{grid, width, height, minX, minY, rooms, floorValue}` (walking, collision,
spawns, the minimap) and `grounded` / `markers` (play settings). The rest is the
**inter-module seam** — an installed module's entry file has no imports, so a rule
module reads the Kit's record through `api.scene()` instead:

| field | what |
|---|---|
| `contract` | `2` — bump when a field changes shape |
| `seed`, `params`, `floorIndex`, `levelCount`, `name`, `theme`, `checksum`, `campaignChecksum` | the world |
| `props[]` | every prop with `wx`/`wz` world coords (gems carry `index`) |
| `portals[]` | `kind: 'up' \| 'down'`, `gated`, world coords |
| `spawns[]` | typed enemy slots, world coords |
| `grounded` | `true` by default — a dungeon is walked |
| `markers[]` | `{x, z, kind}` for the minimap; a bare Kit publishes **none** |

`userData.kit` is the function half: `generate(seed, params)`, `showFloor(k)`,
`clear()` (each replicates), `setMarkers(owner, list)`, `setGrounded(bool|null)`,
`state()`, `campaign()`, `stats()`, `onChange(fn)`. World coordinates: cell `(x, y)`
of floor k is at `(x + ox + 0.5, y + oy + 0.5)`; floor k+1's DOWN portal stands exactly
where floor k's UP portal stands, so travel rebuilds the world around the players.

## The generator

See the stage list in [`dungeon-realms/README.md`](../dungeon-realms/README.md#the-generator);
it moved here unchanged with its tests (21-C C6). Deterministic from one integer seed
(per-stage forked mulberry32, no transcendentals), 100% flood-fill connectivity with
internal re-roll, ≤ 50 ms per 60-room floor.

## Replication

Deterministic (golden rule 8): `{op:'generate', seed, params, checksum}`, `{op:'floor',
floorIndex}`, `{op:'clear'}`; every peer regenerates locally and the checksum only
DETECTS divergence. Late joiners get `{seed, params, floorIndex}` via `registerStateSync`.
