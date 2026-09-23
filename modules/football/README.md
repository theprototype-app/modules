# football — VR football on the knock, every rule a flow node

Two gates float at chest height at the ends of a small pitch; one ball floats between
them (zero-g scene physics, fork 2 of roadmap #24). You hit the ball with your hands —
core's **knock** (24-A A1): it flies at the speed you hit it, bounces off the invisible
pitch walls and slows a little. A ball through a gate is a goal for the team whose
player touched it last; a defender's last touch is an own goal on the sheet. Modes decide
when the match ends. Every player's goals, touches and own goals are theirs alone
(peerVars, one writer per row); a match log survives in the saved scene
(`gameState.vars.football.matches`, capped at 50). Colocated play rides the existing
CO0–CO7 ritual; a desktop peer joins the same match with the head probe and grab/throw.

```
modules/football/
  src/rules.js     PURE rules: slots, attribution, modes, outcome, serve, the sheet, and (30b)
                   the match flow: phases, countdown, kick-off nudge, golden goal, the clock
  src/kick.js      PURE controller-tip kick: contact, impulse, haptic scale, bounces (30b)
  src/pitch.js     PURE pitch layout + graph builder — the def's objects/graph/physics source
  src/game.js      replicated match state, ops, authority, the hit feed, goal detection, the
                   ball's celebration / kick-off placement, auto-start and auto-seat (30b)
  src/kicker.js    the tip kick + click kick runtime and the bounce sound (30b)
  src/fx.js        every banner / sound / confetti / haptic / music call, feature-detected (30b)
  src/nodes.js     the "Football" node family (rule ownership, the dungeon-realms pattern)
  src/toolbox.js   host settings + the "Build pitch" / "Fit pitch" recipes
  test/            node tests (no app): every rule with its counterfactual
  module.js        the bundled entry (committed)
```

```bash
npm run build:football        # src/ -> module.js (esbuild)
npm run test:football         # rules + pitch, no app
npm run pack -- football      # -> football.zip
flock -w 5400 /tmp/tp-e2e.lock env APP_URL=https://theprototype.app:5208/ npm test -- football
```

## How a match flows (30b — the Quest round)

The rules, as the menu's **How to play** says them:

- **Hit the ball**: swing a controller through it (the tip of the controller kicks; a click /
  trigger on the ball within 2.5 m kicks it too); desktop: walk into it or click it.
- **Score in the OTHER team's gate**: red attacks the blue gate, blue the red one.
- **First to 5 goals, or the higher score after 3:00**; level at the whistle is a **golden goal**
  (the next goal wins). The clock stops for celebrations and countdowns.
- **After a goal** the ball rests in the net (2.5 s: "GOAL!" with the score, goal + cheer sounds,
  confetti in the scorers' colour, a success buzz for them and a fail buzz for the conceders),
  goes back to the centre spot, a **3-2-1** countdown runs and the team that **conceded kicks
  off**: a whistle and a slow nudge into its own half, leaning 35 degrees so it never rolls into
  its own net.
- **No need to pick a side**: hitting the ball with no match running kicks one off, and pressing
  Start (or hitting the ball) seats an unseated player on the smaller team. The final whistle
  shows "RED WINS!" and the results panel offers **Rematch** (same sides) or **Menu**.

Every countdown digit, banner and sound is derived by each peer from stamps it already holds
(the start / goal / serve ops), so nothing new crosses the wire for them; only the authority
moves the ball. What the game asked the core for is recorded in `__football.game.fx.log()` —
the flights read it, on a 1.17 core (where banners fall back to toasts on desktop and the new
sounds to the ping chimes) and on the 30b union alike.

## Nodes (group "Football")

A node alive in a running graph OWNS its rule group on every peer (its data replicates
with the graph); absent, the defaults — or the toolbox's host settings — return within a
second. **No football node may target the ball**: the flow runtime re-seats a targeted
object's base pose every frame, which would fight the physics body. Match Rules targets
the pitch and names the ball through its `ball` object input.

| Node | Target | Params / inputs |
|---|---|---|
| **Match Rules** `fbrules` | a static object (the pitch) | `ball` (wire an Object Selector) · `mode: duel\|teams\|freeforall\|practice` · `winBy: goals\|time\|either` (30b default `either`) · `goalsToWin` (5) · `matchSeconds` (180) · `serve: auto\|button` · `serveDelay` (the kick-off countdown, 3 s) · `serveSpeed` (the kick-off nudge, 0.5 m/s) · `ownGoals: count\|ignore` · `tie: golden\|draw` (30b) |
| **Team Gate** `fbgate` | the gate's SENSOR box | `team` — a ball entering THIS gate scores for the OTHER team |
| **Match Button** `fbbutton` | the button object | `action: join-red\|join-blue\|spectate\|start\|new-match\|swap-sides\|serve\|rematch` · `press` (event in: a perPlayer HUD Button or On Click) · `physical` (30b; off = only `press` acts, so several HUD buttons may share one target) — a click on the object (desktop or VR trigger, play mode included) runs the action on the clicker's peer |
| **Serve** `fbserve` | any static object | `trigger` (event in) → serve now (an On Rest, a Delay, a button) |
| **Score Lamp** `fblamp` | one lamp object | `team` · `index` — lit while that team's score ≥ index |
| **Records** `fbrecords` | any static object | `show` · `element` (HUD list: the sheet) · `scoreElement` (score / last touch / clock) · `logElement` (the saved matches) |
| **Football Value** `fbvalue` | — (value out) | `read: red\|blue\|goals\|myteam\|lastteam\|started\|left\|players\|serves\|mygoals` |
| **Football Event** `fbevent` | — (event out) | `event: goal\|redgoal\|bluegoal\|serve\|start\|over\|reset\|touch` — wire `start`→Set Game State (playing), `over`→(over) so the DOM HUD screens follow the match |

## Replication

| Feature | Model |
|---|---|
| slots, start, new match, swap, rules override | events from the presser; every peer applies the same pure rule |
| last touch | derived from the knock hit feed every peer receives (`api.onHit`, A2; the debug hook on an A1 build), and from the `kick` op (30b) |
| a tip / click kick (30b) | the kicker sends `{op: 'kick', impulse, by}`; every peer applies the touch and the sound, the physics initiator alone the impulse |
| countdown, banners, sounds, confetti, music (30b) | LOCAL on every peer, derived from the replicated stamps — no message |
| the ball's celebration / kick-off placement (30b) | the authority writes the pose (`api.moveObject`, DEVX #39) |
| goal, serve, match over | the physics initiator decides and broadcasts (with no sim anywhere, the lowest peer id) |
| per-player sheet | `api.peerVars.setMine` by the ONE peer the goal names |
| late joiners | `registerStateSync` carries the whole match state |
| the saved log | `api.game.setVar('football', {matches})` on the game singleton, written by the authority at match end |

## Records (fork 3: session records + a saved match log)

- **Per player, per session**: `goals`, `touches`, `owngoals` on `peerVars` — the one peer
  a goal names writes its own row; a `leaderboard` node renders them; a row survives its
  owner's Esc and drops with a disconnect (the peerVars lifetime). A new match does NOT
  reset them: a session record is a session record (author a reset with `On Game State
  (playing)` → `Set Variable scope:player` if you want one).
- **Match history**: at match end the authority appends `{at, red, blue, winner,
  scorers: [{name, goals}]}` to `gameState.vars.football.matches` (capped 50, names not
  peer ids). `gameState` is in the session payload, so a saved `.tpscene` carries the
  sheet and reopening the scene shows past matches; the Records node's `logElement` lists
  them and `Football Value read: matches` counts them.
- **Cloud leaderboard** (persistent totals by account): not here — a PocketBase collection
  + a plugin in the cloud repo, its own plan.

## The template

`pitchObjects(dims)`, `pitchGraph(names, {hudButtons: true})` and `PITCH_PHYSICS` in
`src/pitch.js` are the def's objects, graph and physics block; the toolbox's **Build pitch**
creates exactly them in an empty scene (through `api.create`, `api.physics.set` and
`api.flow.addNodes`), which is how the test-flight plays without the scenes repo. The
scene-physics block itself has no api write — set gravity 0, ground off and Knock on in
Inspector ▸ Physics (DEVX #20), or load the template.

## Owed on device

The knock's and the tip kick's feel on a Quest (does a normal swing land, with or without the
grip squeezed; is the kick strong enough), ball legibility at 10 m/s, the consoles' reach
through the right-hand glass (arm or laser), the GOAL banner / confetti / crowd on the 30b core
in a headset, the stadium music level under the effects, the spawn on the blue half after
entering Play, haptics on a goal and a kick, the colocated fit of a 3 × 5 m pitch in a real room.
