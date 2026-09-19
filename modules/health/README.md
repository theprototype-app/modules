# health — hit points that converge, with nobody in charge

A `health` node gives an object (or the local player) hit points. `damage` and `heal`
nodes fire pulses into a core **Counter** that feeds it, and every peer derives the
number from the same counters. Nobody is an authority, nothing is sent on a timer, and
there is no `registerStateSync`: every bit of state is already replicated.

```
modules/health/
  src/ledger.js    PURE: object hp from counters, player hp from a row, regen, pulses per hit
  src/graph.js     PURE: the chain walk over api.flow snapshots, and the recipe
  src/engine.js    the 10 Hz sweep: derive, fire, death/respawn edges, the round reset
  src/nodes.js     the "Health" node family
  src/toolbox.js   the manager: build a chain per selected object, live rows
  test/            node tests, no app (npm run test:health)
  module.js        the bundled entry (committed)
```

```bash
npm run build:health          # src/ -> module.js (esbuild)
npm run test:health           # ledger + graph, no app
npm run pack -- health        # -> health.zip
flock -w 5400 /tmp/tp-e2e.lock env APP_URL=https://theprototype.app:5215/ npm test -- health
```

## The two ownership models (roadmap 29, fork 2 — locked)

| Scope | Where the number lives | Why it converges |
|---|---|---|
| `object` | `hp = max − hits + heals`, where `hits`/`heals` are the values of the Counters wired into the health's `damage`/`heal` inputs | a damage pulse is one trigger-log entry `(node id, stamp)`, applied exactly once per peer; the Counter's count travels **with** the stamp in the trigger-log handshake (DEVX #18), so a late joiner reads the same count |
| `player` | my own `peerVars` row: `<name>` = hp base, `<name>.at` = the stamp it was written at; regen is `base + regen × (now − at)`, derived at read time, capped at max | one writer per row by construction; regen is a pure function of the clock, so nothing is sent while it ticks |

The counterfactual is the shared-add model: two peers each computing `hp − 1` from their
own read of a game variable lose a hit. The flight shows it losing one while the ledger
reads two.

**Who fires a pulse, and does it replicate** (the engine's one rule):

- a **replicated** source — a stamp on an event node wired into `damage.trigger`, the knock
  feed every peer receives — every peer derives the same pulse and fires it **locally**
  (`{replicate:false}`); the counters agree because every peer applied the same set;
- a source only **this** peer saw — its own click, its own touch — this peer fires a
  **replicated** pulse and the others apply it once (the collectible's model);
- a **player's** health: the same pulses, always local, plus the row write.

**First sight never fires.** A stamp that was already there when a peer first saw a node
is history (the trigger-log handshake, an undo), adopted and never acted on. The same rule
gates the round reset: the first time a peer sees the game shell in use is a seed, and only
a later change to a *new* round zeroes the counters — otherwise a joiner arriving mid-round
would reset the counts the handshake had just delivered (it did, once, in the flight).

## Nodes (group "Health")

| Node | Kind | Params / inputs |
|---|---|---|
| **Health** `health` | value (its hp) — names its object through the `target` input (wire an Object Selector in; a node in an object's own graph owns that object) | `name` · `scope: object\|player` · `max` · `regen` (per second; player scope) · `deathAction: hide\|respawn\|nothing` · `respawnDelay` · inputs `target` (object), `damage`, `heal` (numbers — wire the Counters), `respawnAt` (object — where a player comes back). **Not an effect, on purpose**: the runtime re-seats an effect target's base pose every frame (football's "no node may target the ball"), which would pin a damageable crate or a walking enemy in place. The module hides a dead object itself, in play only, and gives back exactly what it hid. |
| **Damage** `damage` | event out | `amount` (points per event, ≤ 20) · `source: wired\|click\|touch\|zone\|hit` · `radius` · `perSecond` · `scale: none\|speed` · `speedRef` · inputs `trigger` (event: what sets it off when `wired`), `zone` (object, for a hazard). It hurts **whatever health it feeds** — through a Counter's `pulse`, or wired straight into `health.damage`. |
| **Heal** `heal` | event out | `amount` · input `trigger`. The same shape with the opposite sign; a heal past full is remembered (a count-only ledger cannot tell a heal at full from one that landed — the plan's "negative stamp", stated honestly). |
| **Health Reset** `healthreset` | event out | `name`. Wire it into the Counters' `reset`; the module fires it locally on every peer on a new round and on an object's respawn. |
| **Health Value** `healthvalue` | value | `name` · `read: fraction\|current\|max\|alive`. Sums over every health carrying the name (a group bar); `fraction` is what a HUD Bar wants. |
| **Health Event** `healthevent` | event out | `name` · `event: death\|damage\|respawn\|reset`. Fired locally on every peer from the same derived edge, so a Counter of kills converges without a message. |

The recipe (**Health ▸ Make damageable**) builds, per selected object:

```
damage ──▶ counter.pulse ──▶ health.damage ◀──target── objectselector
             ▲
healthreset ─┘ (reset)
```

**Player health** builds the same chain with `scope: player` and no selector. The
player's number is read from their row; the Counter in the chain then counts the hits
this peer took (a free readout).

## Damage sources (`damage.source`)

| Source | What sets it off | Who fires, does it replicate |
|---|---|---|
| `wired` | any event wired into `trigger` — On Click, On Impact, On Enter, On Hit, a Delay, a Key, a HUD button through a Delay | the stamp replicated, so every peer fires its own local pulse; a shared source hurts every player who has that chain — make the source `perPlayer` for one |
| `click` | a desktop click or the VR trigger on the health's object | the clicker, replicated |
| `touch` | the local player walks within `radius` of the health's object (an edge: leave and come back to touch again) | the toucher, replicated |
| `zone` | the local player stands within `radius` of the object wired into `zone`, `amount` every `1/perSecond` seconds | the player hurt, local + their row |
| `hit` | core's knock feed (24-A): a hand or the head probe knocked the object | every peer receives the one `hit` message and fires its own local pulses; `scale: speed` multiplies `amount` by `speed / speedRef` (capped at 3×, floored at one point) |

`touch` and `zone` are self-detected from `api.playerPosition()` — no sensor, no sim, no
initiator, exactly the collectible's touch. Only a peer **in play** detects; a peer in the
editor hurts nothing and is hurt by nothing.

## Death and respawn

- `hide`: the object vanishes on every peer while in play; the module gives it back outside play, on a reset and on a respawn (only what it hid).
- `respawn`: hidden for `respawnDelay` seconds counted from the **killing pulse's stamp**
  (replicated, so every peer reaches the moment together), then the module fires
  `healthreset` for the name — the Counters zero, the object returns. A player comes back
  at full on their own row and the camera flies to the object wired into `respawnAt` —
  through `api.flyTo`, which moves the **editor** camera; in play the rig owns the camera and
  there is no seam to move the player (DEVX #23). The flight proves the fly-to in the editor.
- `nothing`: only the events fire; the graph decides.

## HUD

**Show health (bar)** puts a `healthvalue` (fraction) behind a Bar (min 0, max 1); **Show hit
points** a `current` behind a Text or Icon Row. The debug pill reads
`health (hp): 3/6 · 1 of 2 alive`.

## Owed on device

The feel of being hit in VR (a flash, haptics — `api.haptic` exists, wire it to a
`healthevent damage` is the natural next step), a 3+ player round, and the toolbox in
non-dark themes.
