# dungeon-realms — co-op dungeon crawl, every rule on the node canvas

A multi-floor procedural dungeon you *play*, as an **overlay on the Dungeon Kit**
(`modules/dungeon`, id `dungeon` — install both). The Kit generates and renders the
world from one seed and publishes `userData.play`; this module reads that contract
through `api.scene()` and adds the game: gems, gem-gated portals, P1/P2 slots,
travel-together co-op and the start/victory menu. Press the app's red **Play**
button, pick **Player 1 / Player 2**, walk with WASD, collect gems to unseal the
boss-room portal, stand on it together, and climb to the top floor to claim the
dragon's hoard. Two peers get the identical dungeon from the Kit's `{seed, params}`
— determinism *is* the netcode.

```
modules/dungeon-realms/
  src/rules.js     the PURE rules (gem share, objective text, markers, travel-together)
  src/overlay.js   gems + portals from the Kit's contract, in Realms' own group
  src/game.js      the rule state machine: observes the Kit, drives travel through it
  src/nodes.js     Game Rules · Start Menu · Prop Counter · Realms Value / HUD Rows / Event
  src/gui.js       the start / victory MENU (module DOM, keyboard-driven)
  test/            node tests for the rules (no app needed)
  module.js        the bundled, self-contained entry (committed)
```

```bash
npm run build:dungeon-realms   # src/ -> module.js (esbuild)
npm run test:dungeon-realms    # the pure rules
npm run pack -- dungeon && npm run pack -- dungeon-realms
APP_URL=https://localhost:5216/ npm test -- dungeon-realms   # the test-flight (both zips)
```

## How the two modules fit (21-C C6)

An installed module's entry file may have **no imports**, so two modules cannot share
code. They share the **scene**: the Kit owns the ONE scene-root group `dungeon-module`
and publishes `userData.play` (raster, rooms, world-space props and portals, seed,
floor) plus `userData.kit` (`generate` / `showFloor` / `setMarkers` / `setGrounded`).
Realms OBSERVES `{seed, floorIndex}` every frame and rebuilds its overlay group
`dungeon-realms` whenever the world changes — whoever changed it (a portal here, the
Kit's toolbox, a Dungeon node, a late-join sync) — and DRIVES travel by calling
`kit.showFloor`, which the Kit replicates itself. Realms replicates only rule events.

- **Minimap:** uncollected gems + portals go through `kit.setMarkers` →
  `userData.play.markers` (DEVX #13). A bare Kit puts nothing there.
- **No flying:** Game Rules ▸ disableFlight writes `userData.play.grounded` through the
  Kit (DEVX #14) — the old capture-phase Q/E swallow is gone.
- **Play gate:** `api.isPlaying()` (DEVX #11).
- **HUD:** DELETED as module DOM. The template authors core HUD elements and this
  module publishes into them — **Realms Value** (a number: gems / need / total / level /
  levels / players / started / won / sealed / score → a HUD Text, Compare, Gate),
  **Realms HUD Rows** (lines into a HUD list element by id: objective / players / level /
  gems / all) and **Realms Event** (start / gem / unseal / travel / victory / reset →
  a Counter, Set Game State, a Sound).
- **Menu:** stays module DOM (`#dr-menu`) — a modal, keyboard-driven, focus-owning
  dialog under pointer lock is not a HUD (DEVX #23).

## The generator (C1 — now in the Kit)

The pipeline below lives in `modules/dungeon/src/gen/` since 21-C C6 (moved with its
node tests); it is documented here because this is the game it was written for.
Spec-shaped pipeline, each stage a pure function on a per-stage forked
mulberry32 stream (inserting a draw in one stage never reshuffles another):

1. RNG — mulberry32 + float/int/pick/chance + `fork(label)`. No `Math.random`,
   no `Date.now`, and **no sin/cos/log** (IEEE-754 does not pin transcendentals
   across JS engines — the ellipse scatter uses disc rejection sampling).
2. Scatter — `roomCount × 1.4` candidates in an ellipse (radius ∝ √roomCount);
   archetypes small/medium/large 45/40/15, shapes rect/ellipse/octagon
   60/22/18, ≥ 2 large forced.
3. Separation — AABB push-apart (2-cell pad, cap 300), snap to grid, cull to
   `roomCount`.
4. Graph — Bowyer–Watson Delaunay → Prim MST → loop re-adds (`loopChance`,
   reject > 2.2× mean MST edge, ≥ 1 loop forced).
5. Semantics before carving — boss = largest, entrance = degree-1 farthest,
   critical path, treasure leaves (≤ 4), shrines off-path at 40–70% depth,
   elite arenas on-path at 55–85%, `difficulty = 0.15 + 0.85·depth/max`.
6. Corridors — L-shaped, seeded elbow, straight when spans overlap ≥ 3; width
   3 critical / 2 default / 1 treasure spur.
7. Raster + fields — `Uint8Array` VOID/FLOOR/WALL (walls = void cells touching
   floor), doorways, `Int16Array` BFS field from the entrance.
8. Decoration + spawns (data only) — pillar lattices, spaced torches, debris,
   crates, braziers, chests, shrine crystals, **gems** (the objective), typed
   enemy spawn slots (bestiary-injected, elite in arenas) — none on walls,
   doorways or each other.
9. Presentation — seeded name ("The Ashen Vaults of Vor'gul"), per-room tints,
   stats. Validation (100% flood-fill connectivity, boss depth ≥ 60%, loops,
   placement legality) re-rolls internally with a derived seed, max 5.

The campaign layer stacks `levelCount` floors (`hash(seed, i, 'floor')`), ramps
size/difficulty/density, themes them (crypt → sewer → forge → frost → roost),
places a **gated UP portal** in every boss room and a DOWN portal in every
entrance room above floor 1, types every spawn from the bestiary, and computes
**world offsets so floor k+1's DOWN portal stands exactly where floor k's UP
portal stands** — travel rebuilds the world around the players, so arriving
peers are already standing on the arrival portal (no teleport API needed).

## How movement works (and what the module does NOT do)

The Kit's group `dungeon-module` publishes `userData.play` in the exact
`dungeonPlay.js` shape — the app's own play mode then provides WASD walking,
wall-slide collision, per-peer spawn rooms and the corner minimap for free
(spawn rooms are ordered entrance-first, so P1/P2 start together). This module
adds: gems, portal gating, the menu, the markers and the grounded flag.

## The node family (group "Dungeon Realms")

Every rule is node-ownable. A node ALIVE in a running graph owns its rule group
on every peer (node data replicates with the graph); remove it and module
defaults return in ~1s. Drop nodes into any object's flow — the implicit-owner
rule runs them with zero wiring — or wire them to an Object Selector in the
scene flow. `range` params accept wired value inputs.

| Node | Owns | Params |
|---|---|---|
| **Game Rules** | gameplay | gemShare (portion to unseal) · pickupRadius · allPlayersPortal · disableFlight |
| **Start Menu** | the play-mode menu | show (auto/always/never) · button1–4 (action selects) |
| **Prop Counter** | an extra counter | prop (score/keys/…) · initial · showInHud |
| **Realms Value** | a readout (number OUT) | read: gems · need · total · level · levels · players · started · won · sealed · score |
| **Realms HUD Rows** | lines into a core HUD list | element (HUD list id) · show: objective / players / level / gems / all |
| **Realms Event** | an event OUT | event: start · gem · unseal · travel · victory · reset |

The recipe node is the Kit's **Dungeon** (group "Dungeon Kit"): seed · roomCount ·
levelCount · loopChance · gemDensity · apply.

Reference graph — this is what the `games/dungeon-realms` TEMPLATE carries, wired
(a template is `api.seedFlowGraph`, DEVX #10):

```
[Number 1337] ──seed──▶ [Dungeon Kit ▸ Dungeon (apply ✓)] ──▶ [Object Selector: Entrance]
[Game Rules (gemShare .7, all-players ✓)]   [Start Menu (join-p1 · join-p2 · start · new-dungeon)]
[Realms Value: gems] ──▶ [HUD Text "Gems {v}"]     [Realms HUD Rows: objective ▸ list]
[Realms Event: start] ──▶ [Set Game State: playing]  [Realms Event: victory] ──▶ [Set Game State: over]
```

## Replication model

The WORLD is the Kit's (deterministic, golden rule 8): it replicates `{op:'generate',
seed, params, checksum}` / `{op:'floor'}` / `{op:'clear'}` and syncs `{seed, params,
floorIndex}` to late joiners. This module replicates only discrete rule events: `gem`,
`slot`, `start`, `reset`, `onportal`, `prop`, and syncs `{seed, floorIndex, collected,
slots, started, wonAt, propValues}` — applied when the Kit shows that seed, whichever
module's sync arrives first.

## Controls

- Red **Play** button → walk mode; the start menu appears (menu: ↑/↓ + Enter —
  the pointer is locked; buttons are also clickable whenever it is not).
- WASD walk (app play mode) · gems collect on walk-over (or click) · stand on
  the unsealed portal (together, by default) to travel · Esc leaves play mode.
- Editor mode: clicking a portal travels too; clicking a sealed one tells you
  how many gems are missing.
