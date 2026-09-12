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
  src/rules.js     PURE rules: slots, attribution, modes, outcome, serve, the sheet (node-tested)
  src/pitch.js     PURE pitch layout + graph builder — the def's objects/graph/physics source
  src/game.js      replicated match state, ops, authority, the hit feed, goal detection
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

## Nodes (group "Football")

A node alive in a running graph OWNS its rule group on every peer (its data replicates
with the graph); absent, the defaults — or the toolbox's host settings — return within a
second. **No football node may target the ball**: the flow runtime re-seats a targeted
object's base pose every frame, which would fight the physics body. Match Rules targets
the pitch and names the ball through its `ball` object input.

| Node | Target | Params / inputs |
|---|---|---|
| **Match Rules** `fbrules` | a static object (the pitch) | `ball` (wire an Object Selector) · `mode: duel\|teams\|freeforall\|practice` · `winBy: goals\|time\|either` · `goalsToWin` · `matchSeconds` · `serve: auto\|button` · `serveDelay` · `serveSpeed` · `ownGoals: count\|ignore` |
| **Team Gate** `fbgate` | the gate's SENSOR box | `team` — a ball entering THIS gate scores for the OTHER team |
| **Match Button** `fbbutton` | the button object | `action: join-red\|join-blue\|spectate\|start\|new-match\|swap-sides\|serve` · `press` (event in: a perPlayer HUD Button or On Click) — a click on the object (desktop or VR trigger, play mode included) runs the action on the clicker's peer |
| **Serve** `fbserve` | any static object | `trigger` (event in) → serve now (an On Rest, a Delay, a button) |
| **Score Lamp** `fblamp` | one lamp object | `team` · `index` — lit while that team's score ≥ index |
| **Records** `fbrecords` | any static object | `show` · `element` (HUD list: the sheet) · `scoreElement` (score / last touch / clock) · `logElement` (the saved matches) |
| **Football Value** `fbvalue` | — (value out) | `read: red\|blue\|goals\|myteam\|lastteam\|started\|left\|players\|serves\|mygoals` |
| **Football Event** `fbevent` | — (event out) | `event: goal\|redgoal\|bluegoal\|serve\|start\|over\|reset\|touch` — wire `start`→Set Game State (playing), `over`→(over) so the DOM HUD screens follow the match |

## Replication

| Feature | Model |
|---|---|
| slots, start, new match, swap, rules override | events from the presser; every peer applies the same pure rule |
| last touch | derived from the knock hit feed every peer receives (`api.onHit`, A2; the debug hook on an A1 build) |
| goal, serve, match over | the physics initiator decides and broadcasts (with no sim anywhere, the lowest peer id) |
| per-player sheet | `api.peerVars.setMine` by the ONE peer the goal names |
| late joiners | `registerStateSync` carries the whole match state |
| the saved log | `api.game.setVar('football', {matches})` on the game singleton, written by the authority at match end |

## The template

`pitchObjects(dims)`, `pitchGraph(names, {hudButtons: true})` and `PITCH_PHYSICS` in
`src/pitch.js` are the def's objects, graph and physics block; the toolbox's **Build pitch**
creates exactly them in an empty scene (through `api.create`, `api.physics.set` and
`api.flow.addNodes`), which is how the test-flight plays without the scenes repo. The
scene-physics block itself has no api write — set gravity 0, ground off and Knock on in
Inspector ▸ Physics (DEVX #20), or load the template.

## Owed on device

The knock's feel on a Quest, ball legibility at 10 m/s, the physical buttons' reach at a
real gate, haptics on a hit, the colocated fit of a 3 × 5 m pitch in a real room.
