# waves — a VR wave shooter on the health module, derived on every peer

**2.1.0 (30c): real models.** The three guns are Meshy-made sci-fi guns held at the grip, and
the grunts, runners and tanks are rigged robots that WALK (a walk clip played at the speed they
really move, a flinch when hit, a fall when they die), with a Meshy crystal on the tower. The
models ride inside the zip (`assets/`, 6.6 MB); every rule, hit volume and name is the 30b one.
See [The models](#the-models-30c).

**2.0.0 (30b): the template is a shooter.** A gun rides your controller (desktop: the view,
click to fire), five levels of waves pour out of three portals — grunts, then runners, then
tanks — and every enemy that reaches the crystal explodes against it. Pick a gun and an
ability on the menu; the free hand's grip (desktop: Q) fires the ability. See
[The shooter](#the-shooter-30b) below; the engine underneath is unchanged in kind.

Pre-placed enemies carry the [health](../health/) module's chains. A `waves` node reads
their hit counters and derives the wave; each wave heals the survivors back with local
pulses, walks the living enemies from their spawn points to a goal on the synced clock,
and when the last wave's last enemy falls every peer fires `over` and appends the same
run to `gameState.vars`. Kills sit on the killer's own peer row. Nobody is an authority,
nothing is sent on a timer, and the module has no `registerStateSync`. **Needs the health
module installed** (it authors the health module's node types as ordinary graph data).

```
modules/waves/
  src/curve.js     PURE: the size curve, kills needed, the wave from the counters, the walk,
                   30b: kinds, knockback, Slow-mo's warped clock, Pulse shoves, levels
  src/guns.js      PURE (30b): Blaster / Scatter / Beam, the trigger rules, the pellet cone
  src/abilities.js PURE (30b): Shield / Slow-mo / Pulse, the cooldown, the Pulse's shoves
  src/vr.js        PURE (30b): aim rays, ray x board, press edges, the in-game gate
  src/prefs.js     (30b) the loadout + options, on this device (api.storage)
  src/weapon.js    (30b) the gun in the hand / the view, hitscan, damage, the beam's heat
  src/assets.js    (30c) the GLB loader (three's, bundled on the runtime three) + the models
  src/figures.js   PURE (30c): the stand-in layer, gait, walk rate, facing, the death, gun fits
  src/avatars.js   (30c) the walking figures + the crystal, following the enemy objects
  build-gltf.mjs   (30c) builds src/gltf/loader.chunk (GLTFLoader + SkeletonUtils, three shimmed)
  assets/          (30c) gun-*.glb, enemy-*.glb, crystal.glb — Meshy-made, post-processed
  src/powers.js    (30b) the ability on the free hand's grip / Q, its looks
  src/juice.js     (30b) tracers, muzzle flashes, the kill pop — pooled, LOCAL
  src/feel.js      (30b) sounds + haptics through the options, feature-detected
  src/session.js   (30b) banners, level-ups, the breach's blast, results, the best run
  src/menu.js      (30b) the Loadout / Options buttons, the music, the footsteps
  src/start.js + board.js  (30b) the headset's START board and banner fallback
  src/engine.js    the 10 Hz sweep: derive, heal into the next wave, walk, events, the log
  src/nodes.js     the "Waves" node family
  src/toolbox.js   the arena builder (the recipe is pure and node-tested)
  src/hud.js       the DOM HUD as data + the node graph that drives it
  src/def.js       the template def (waves.def.json, emitted by the build)
  test/            node tests, no app (npm run test:waves)
  module.js        the bundled entry (committed)
```

```bash
npm run build:waves           # src/ -> module.js (esbuild) + waves.def.json
npm run test:waves            # curve + recipe + def, no app
npm run pack -- health waves  # both zips (the flight installs both)
e2e-slot -- env APP_URL=https://theprototype.app:5246/ npm test -- module-waves
e2e-slot -- env APP_URL=… WAVES_TPSCENE=<staged scene.tpscene> npm test -- waves-shooter
```

## The ledger trick (why a joiner lands on the right wave)

An enemy's hits never reset between waves. At the start of each wave every peer fires
**local** heal pulses for the enemies that wave uses — `healsBefore(i, wave) × hp` minus
what the heal counter already shows — so an enemy's hit counter reads `hp × kills` and
its heal counter `hp × (appearances − 1)`. Wave `n` is complete when every enemy it uses
has been killed once per wave it appeared in (`killsNeeded`). That is a pure function of
the hit counters, which travel with their stamps in the trigger-log handshake (DEVX #18):
a late joiner reads the same counters, derives the same wave, and fires no heals (its
heal counters arrived healed). The health module's overkill guard is what keeps a counter
an exact multiple of `hp`.

The wave's **start** is a replicated stamp too: the round's `startedAt` for wave 1, the
previous wave's last killing pulse plus `interval` after that. Enemy `i` of a wave leaves
its spawn point `stagger × i` seconds after the start and walks straight to the goal at
`speed` — `enemyPosition()` is pure in `(data, time)`, so every peer places it identically
and nothing is sent. Positions are written **locally** to each peer's copy; when no run is
on, the enemies stand where the scene put them.

**No spawner.** The spike (roadmap 29 fork 3) proved a module can author and pulse core's
`spawn` node — but a spawned copy is a transient clone with no nodes and a uuid minted by
the initiator, pulses carry no payload, and copies exist only while the physics sim runs.
Per-copy health cannot ride the trigger log, so the enemies are pre-placed (the Towers B8
ruling) and the recipe gives each one its chains.

## Nodes (group "Waves")

| Node | Kind | Params / inputs |
|---|---|---|
| **Waves** `waves` | value (the current wave) | `name` (the enemies' health name) · `waves` · `sizeStart` / `sizeStep` (enemies in wave 1, more per wave) · `interval` (seconds between waves) · `speed` / `stagger` (the walk) · `reach` · `spawnPrefix` (objects named `Spawn…` are the spawn points, cycled) · input `goal` (an object; without one the enemies hold their spawn points) |
| **Waves Value** `wavesvalue` | value | `name` · `read: wave\|left\|size\|waves\|done\|level` |
| **Waves Event** `wavesevent` | event out | `name` · `event: start\|wave\|over\|level\|breach`, fired locally on every peer from the same derived edge — wire `over` into Set Game State (over), `breach` into a wired damage on the player |
| **Waves Player** `wavesplayer` (30b) | value, LOCAL | `read: ability\|heat\|score\|best` — this player's ability charge (0..1), the beam's heat, score, best score |

30b adds to **Waves**: `perLevel` (waves per level, 0 = none), `levelSpeed` (the walk's
speed-up per level) and `breach` (an enemy reaching the goal explodes against it). All
three are absent from a node that does not use them — a pre-30b arena is unchanged.

## The arena recipe (**Waves ▸ Enemies from selection** / **Add boxes as enemies**)

Select the enemies and, last, the goal. Per enemy the recipe authors:

```
damage(source) ──▶ counter.pulse ──▶ health.damage ◀──target── objectselector(enemy)
healthreset ──────▶ counter.reset (both counters)
heal ──▶ counter.pulse ──▶ health.heal
objectselector(enemy) ──zone──▶ damage(zone, reach, enemy dmg / s) ──▶ health(player).damage
```

plus, once: the `waves` node with its goal selector, `wavesevent(over) → setgamestate(over)`,
and the player's health chain (`scope: player`, respawn) if none carries the name. `source`
is how an enemy is killed: `click` (desktop), `hit` (a knock, speed-scaled) or `touch`.
Everything is ordinary replicated graph through `api.flow.addNodes`, one undo entry.

## Scoring and the run log

- **Kills** — the health module credits the peer that dealt the killing blow (its click,
  its own hand's knock) on its own `kills` peerVars row: one writer per row, a Leaderboard
  node renders them.
- **The run** — at `over` every peer appends `{at, waves, reached, cleared, players:
  [{name, kills}]}` to `gameState.vars['waves:<name>'].runs` (capped at 50). The inputs are
  replicated and the entry is keyed by the last kill's stamp, so every peer appends the
  same object and the append is idempotent — the flight asserts A, B and the joiner hold
  byte-identical entries. A saved `.tpscene` carries the log (the football precedent).

## The HUD and the template

`hud.js` is the Towers / Stars Room / football shape: **menu** (Start) · **hud** (wave,
enemies left, the player's bar, the kills list) · **over** (the sheet and the log) with
`showWhile`, and `hudGraph()` the eleven nodes that drive it (a HUD Button pulses Set Game
State directly; Waves Value → HUD Text; Health Value → HUD Bar; Leaderboard on `kills`).
`waves.def.json` is the template def for the scenes checkout: a ground, a goal, three spawn
pads, (30b) ten enemies of three kinds and the graph above, plus the How to play / Loadout /
Options / Results screens — the integrator stages it (30b staging: cloud-lane-30-staging/30b-waves).

## The shooter (30b)

**The start a headset can reach.** Core draws no DOM HUD inside a headset, so a VR player
never saw Start and the round never began — the enemies stood still. In a headset, in the
game (Play / Interact) with no round running, a board stands 2.4 m ahead: aim a controller
at it and pull the trigger. It pulses the template's `wv-start` hudbutton node, replicated —
the DOM button's own path. After a run the board shows the result and "shoot to play again".
Where core offers the VR game panel (30b C2), the same menu is also on the panel.

**Guns.** Hitscan from the controller's aim (desktop: the crosshair ray). An enemy hit takes
the gun's damage as REPLICATED pulses on the damage node that feeds its hit counter — one per
point, never more than it has left (a per-peer expectation covers the counter's ~6 Hz
republish), and a killing shot credits the shooter's own `kills` and `score` rows (points ×
level: grunt 100, runner 150, tank 400). **Blaster** semi-auto; **Scatter** 7 pellets, slow;
**Beam** ticks while held and overheats (locks until it cools). The gun hand is an option:
right, left or both.

**Knockback is a pure function.** Each hit in an enemy's current life shoves it `knock`
metres back along its lane (`setbackOf(hits, heals, max, knock)`), so every peer places it
the same with nothing sent. Abilities that move enemies are REPLICATED events in a
round-scoped game variable `waves:fx:<name>` — `{k:'slow', at, until}` stretches every
enemy's clock to 40% (`warpedElapsed`), `{k:'push', at, d:{uuid: m}}` adds shoves computed
once by the player who fired the Pulse. The Shield is LOCAL: while it holds, a breach does
not fire this player's `breach` event, so their own health row is spared.

**The breach.** An enemy within `reach` of the goal explodes: every peer derives the same
arrival from the same clock and counters and fires LOCAL pulses to kill it (no credit), and
the run's `breach` event (locally, per player) — the template wires it to a wired damage of 2
on the player's health (the crystal, 10, no regen). At zero, `healthevent death → Set Game
State (over, lost)`. A win is all 15 waves.

**Levels.** `perLevel: 3`: level 1 is grunts (waves 1-3), level 2 brings runners, level 3
tanks, levels 4-5 everything, 12% faster per level. The roster's NAMES are the curve
(`ROSTER` in def.js); the kind is read off the name (`Runner`, `Tank`).

**Menu.** Play · How to play (four illustrated rows) · Loadout · Options (music off/low/high,
sound effects, gun hand, vibration). Navigation and the loadout/option buttons are
PER-PLAYER hudbutton pulses (local screens, local choices); Start / Again / Restart / Quit
replicate. Choices and the best run live in `api.storage` on this device.

**Feature-detected core seams (30b round):** `api.announce` (banners; else a desktop toast for
the big moments and the board in a headset), `api.playSound`'s game set + `api.music` (else
silent), `api.hapticPattern` (else one `api.haptic` pulse per pattern), `api.effects.burst`
(else the module's own pop), `api.setSpawn` (the Home pad). Nothing breaks without them.

## Owed on device

30b: the gun's seat in the hand (`GRIP_OFFSET`), the aim, the board's reach and legibility,
the grip ability next to core's grab, the Beam's heat read on the gun, Slow-mo and Pulse as
felt, the music and footsteps' level, and a two-player run's breaches. Earlier: the feel of a wave arriving in VR (a sound on `wavesevent wave` is one node away), knocking
an enemy down with a hand at a real reach, a 3+ player run, and the arena toolbox in
non-dark themes. Object regen is not offered (see the health README); wave hp scaling
(`hpScale` in the plan) is not: it would need per-wave `max` writes (replicated node data
from every peer) — the size curve is the difficulty curve.

## The models (30c)

| file | what | tris | size |
|---|---|---|---|
| `assets/gun-blaster.glb` | the Blaster: slate + brass, oak grip, cyan strips | 2.8k | 0.59 MB |
| `assets/gun-scatter.glb` | the Scatter: a sawn-off double barrel, orange cell | 2.7k | 0.61 MB |
| `assets/gun-beam.glb` | the Beam: coil ring emitter, magenta orb | 2.6k | 0.67 MB |
| `assets/enemy-grunt.glb` | a stocky orange robot, cyan visor — walk / run / hit / death | 7.2k, 24 joints | 1.37 MB |
| `assets/enemy-runner.glb` | a lean lime sprinter, red visor — runs | 7.3k, 24 joints | 1.29 MB |
| `assets/enemy-tank.glb` | a gunmetal + brass brute, violet chest, yellow visor — walks heavy | 7.3k, 24 joints | 1.54 MB |
| `assets/crystal.glb` | the defended crystal (its own emission map) | 0.8k | 0.57 MB |

Made with Meshy.ai through the budgeted pipeline (`packs` repo `tools/meshy`, requester
`30c-game-assets`): text-to-3D preview → keep → PBR refine; the enemies auto-rigged (`rig`, 5 cr —
Meshy's walking + running clips) plus `animate` (Hit Reaction + Shot and Fall Backward, 3 cr each),
merged by `meshy-rigged` (clips by bone name, the refine's normal + roughness maps put back, the
rig's self-lit emissive dropped). The tank's first paint carried a number-like shoulder badge (no
text/logos): a 10 cr retexture with the original UVs, swapped onto the same rig (`--retexture`).
Guns and crystal through `meshy-post` (30 cm / 1.1 m, barrel down −Z, 1024² JPEG).

**How they stand in.** The enemy OBJECTS are untouched: names, capsule bodies, health chains —
a shot still meets the capsule. A figure (a SkeletonUtils clone with its own materials, so a
hit flash paints one enemy) follows its object every frame under the module's own root group
(`waves-module`, never in objectsGroup — never saved, never sent), faces the goal, and plays its
walk clip at `speed / clipSpeed` (figures.js `walkRate`; a shove backwards does not walk).
While a figure shows, the object's own meshes are hidden for the length of each RENDER only: the
scene's `onBeforeRender` hops them to layer 30 (no camera draws it), its `onAfterRender` puts them
back. Outside a render they are exactly the authored meshes on layer 0 — which matters, because
the `.tpscene` save and a late join are `toJSON`, and `toJSON` WRITES layers (a persistent hop
saved 41 enemy meshes onto the helper layer in a first try). So a save, a raycast (the shot
still meets the capsule), the editor's pick (click a figure: the enemy is selected) all see the
30b enemy; only the frame shows the figure. `visible` was never an option (a replicated fact).
The card renders the module root too (`thumb.sceneGroups`), over the capsules. A death plays where it fell (~1.4 s), sinks, and frees the figure for the enemy's next
life. The Meshy crystal follows the `Goal core` and dims with it. Any model that fails to load
leaves that thing's 30b primitive in place.

**The loader.** The api hands a module THREE but no GLTFLoader (DEVX #36). `build-gltf.mjs`
bundles three's own `GLTFLoader` + `SkeletonUtils` (three 0.185.1, core's version) against a
generated shim that re-exports `globalThis.__wavesTHREE`; `assets.js` sets it to `api.THREE`
and imports the chunk from a blob, so every class is the scene's own. A core with
`api.loadModel` is used first. The GLBs are plain glTF-binary (no Draco/Meshopt/KTX2/WebP).

