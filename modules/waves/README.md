# waves — wave survival on the health module, derived on every peer

Pre-placed enemies carry the [health](../health/) module's chains. A `waves` node reads
their hit counters and derives the wave; each wave heals the survivors back with local
pulses, walks the living enemies from their spawn points to a goal on the synced clock,
and when the last wave's last enemy falls every peer fires `over` and appends the same
run to `gameState.vars`. Kills sit on the killer's own peer row. Nobody is an authority,
nothing is sent on a timer, and the module has no `registerStateSync`. **Needs the health
module installed** (it authors the health module's node types as ordinary graph data).

```
modules/waves/
  src/curve.js     PURE: the size curve, kills needed, the wave from the counters, the walk
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
flock -w 5400 /tmp/tp-e2e.lock env APP_URL=https://theprototype.app:5215/ npm test -- waves
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
| **Waves Value** `wavesvalue` | value | `name` · `read: wave\|left\|size\|waves\|done` |
| **Waves Event** `wavesevent` | event out | `name` · `event: start\|wave\|over`, fired locally on every peer from the same derived edge — wire `over` into Set Game State (over) |

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
pads, four enemies (`hit` to kill) and the graph above — the integrator stages it.

## Owed on device

The feel of a wave arriving in VR (a sound on `wavesevent wave` is one node away), knocking
an enemy down with a hand at a real reach, a 3+ player run, and the arena toolbox in
non-dark themes. Object regen is not offered (see the health README); wave hp scaling
(`hpScale` in the plan) is not: it would need per-wave `max` writes (replicated node data
from every peer) — the size curve is the difficulty curve.
