# dungeon-realms — co-op dungeon crawl, every rule on the node canvas

A multi-floor procedural dungeon you *play*: generate a campaign from one seed,
press the app's red **Play** button, pick **Player 1 / Player 2** in the start
menu, walk with WASD, collect gems to unseal the boss-room portal, stand on it
together, and climb to the top floor to claim the dragon's hoard. Two peers get
the identical dungeon from `{seed, params}` — determinism *is* the netcode.

```
modules/dungeon-realms/
  src/gen/       the 9-stage PURE-DATA generator (zero THREE/DOM — node-runnable)
  src/           renderer / game / GUI / nodes / audio (bundled by esbuild)
  test/          node tests: determinism, connectivity, perf (no app needed)
  module.js      the bundled, self-contained entry (committed)
```

```bash
npm run build:dungeon-realms   # src/ -> module.js (esbuild)
npm run test:dungeon-realms    # generator acceptance: 100-seed sweep, <50ms
npm run pack -- dungeon-realms # -> dungeon-realms.zip (manifest + module.js only)
APP_URL=https://localhost:5189/ npm test -- dungeon-realms   # the test-flight
```

## The generator (C1)

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

The group is named `dungeon-module` and publishes `userData.play` in the exact
`dungeonPlay.js` shape — the app's own play mode then provides WASD walking,
wall-slide collision, per-peer spawn rooms and the corner minimap for free
(spawn rooms are ordered entrance-first, so P1/P2 start together). The module
adds: gems, portal gating, the GUI, and swallows the Q/E fly keys while the
game runs (Game Rules ▸ disableFlight). See DEVX-REQUESTS #13/#14.

## The node family (group "Dungeon Realms")

Every rule is node-ownable. A node ALIVE in a running graph owns its rule group
on every peer (node data replicates with the graph); remove it and module
defaults return in ~1s. Drop nodes into any object's flow — the implicit-owner
rule runs them with zero wiring — or wire them to an Object Selector in the
scene flow. `range` params accept wired value inputs.

| Node | Owns | Params |
|---|---|---|
| **Dungeon** | the campaign recipe | seed · roomCount (0 = auto ramp) · levelCount · gemDensity · apply |
| **Game Rules** | gameplay | gemShare (portion to unseal) · pickupRadius · allPlayersPortal · disableFlight |
| **Start Menu** | the play-mode menu | show (auto/always/never) · button1–4 (action selects) |
| **Game HUD** | the top-left HUD | showGems/Level/Players/Objective · corner |
| **Prop Counter** | an extra HUD counter | prop (score/keys/…) · initial · showInHud |

Reference graph (build it in any object's flow — a module cannot seed node
instances yet, DEVX #10):

```
[Number: 1337] ──seed──▶ [Dungeon (apply ✓)]      [Game Rules (gemShare .7, all-players ✓)]
                          [Start Menu (join-p1 · join-p2 · start · new-dungeon)]
                          [Game HUD (top-left)]   [Prop Counter (score)]
```

Buttons "program what happens next" via their action select — trigger OUT
sockets need core support (DEVX #9). GUI text params need a `text` kind
(DEVX #12).

## Replication model

Deterministic (golden rule 8): `{op:'generate', seed, params, checksum}` — every
peer regenerates locally, the checksum only *detects* divergence (toast, never
fight). Discrete events: `floor`, `gem`, `slot`, `start`, `onportal`, `prop`,
`clear`. Late joiners get the full state via `registerStateSync` and rebuild
mid-game. The Dungeon NODE path broadcasts nothing at all — the node's
replicated data regenerates identically on every peer.

## Controls

- Red **Play** button → walk mode; the start menu appears (menu: ↑/↓ + Enter —
  the pointer is locked; buttons are also clickable whenever it is not).
- WASD walk (app play mode) · gems collect on walk-over (or click) · stand on
  the unsealed portal (together, by default) to travel · Esc leaves play mode.
- Editor mode: clicking a portal travels too; clicking a sealed one tells you
  how many gems are missing.
