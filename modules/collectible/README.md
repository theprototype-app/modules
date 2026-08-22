# collectible

**Collectibles** — one node makes an object collectible. Click it or walk into
it: it disappears, it counts, and it comes back if you asked it to. Shared score
or per-player score, respawning or gone for good, and a counting checkpoint that
never vanishes at all.

Core used to build this as a **seven-node recipe** (an event, a Once, a Latch, a
Not, a Visibility and a Set Variable, plus a Delay branch for respawn) wired up
once per object. Every piece of that was an ordinary node doing an ordinary job —
but the thing a user wants ("this gem is a gem") had no single card, and the count
could only be recovered by walking the chain backwards. This module is that one
card.

## Use it

1. Install **Collectibles** on every peer — from **Modules ▸ Browse**, or
   `collectible.zip` through **Modules ▸ User ▸ Install from zip**. Modules do not
   travel over the wire.
2. Select the object(s) you want to be collectible.
3. Open the **Collectibles** toolbox — right-click the viewport ▸ **Module tools ▸
   Collectibles**, or the **Open Collectibles** button on this module's card in
   **Modules ▸ User**. (Deliberately no permanent row in the burger menu: the toolbox
   belongs to a workflow, not to the app's chrome.) Set *Counts into* / *Scope* /
   *Trigger* / *Hide* / *Respawn*, and press **Make collectible**. That builds one
   **Collectible** node plus one Object Selector per object, in the scene graph, as
   **one undo entry**.
4. Press **Play** and start a round (a HUD *Start* button, or the Game shell). Now
   collect them.

Show the score with **Set Variable ▸ HUD Text** as usual, or the count itself with
the **Collectibles** value node (`left` / `collected` / `total`) — the HUD editor's
action catalog offers it as **Show collectibles left**.

You can of course drop a **Collectible** node from the palette by hand and wire it
to an Object Selector yourself; the toolbox is only a faster way to the same graph.
Everything it builds can be taken apart.

### The node's params

| Param | Meaning |
|---|---|
| `variable` | which score this counts into (`gems` by default) |
| `scope` | `shared` — one score for the room · `player` — **my** score, and the gem only vanishes for me |
| `trigger` | `click` — click or VR-trigger it · `touch` — walk within `radius` of it in Play mode |
| `radius` | metres, touch only |
| `respawn` | seconds until it comes back; `0` = gone for good |
| `hide` | `on` — it disappears · `off` — a **counting checkpoint** (a lap gate, a pressure plate) that counts and stays put |

Two flags are stamped on the node and read by **core**, not by this module:
`perRound` (a new round hands every collectible back) and `whilePlaying` (leaving
Play hands *your* collectibles back to the editor, so the object list can hide and
show them normally). Those are 21-F2's two rules, and inheriting them is the whole
reason this module is thin.

## How it works (and why it is built this way)

| Concern | Choice |
|---|---|
| A collect | A discrete **event**: `api.fireNodeTrigger('collectible', …)`, which rides core's existing replicated `nodetrigger` path. No message of ours exists, so there is nothing for a receiver to re-broadcast. |
| Per-player | `fireNodeTrigger(…, { replicate: false })` keeps the pulse in **this peer's** trigger log. That one bit is the entire mechanism: the latch state, the hide and the count are then per-peer for free. |
| "Collected" | `ctx.trigger !== null && (respawn <= 0 \|\| ctx.trigger.age < respawn)` — **one** helper, used by the effect, the count node, the toolbox and the debug line. Four copies of that rule is how a respawn ends up meaning something different in the HUD than it does on screen. |
| Round rules | `ctx.trigger` arrives already folded through `perRound` against the **replicated** round. This module does no round arithmetic at all. |
| The hide | The effect only ever sets `visible = false`. Giving the object **back** is core's restore loop — the only path that also lets manual visibility win outside Play. |
| Counting once | From **stamp edges**: a pulse is identified by its stamp, so "count it once" is "count it when the stamp changes". No Once node and no state to replicate — and a respawn re-collect is a new stamp, so it counts again. |
| First sight | A stamp minted before the module was watching is **not** a pulse it witnessed (core's own `actionSeenAt` reasoning), so the first sweep seeds each node's stamp without counting. That is what stops a late joiner banking the whole scene's history on connect. |
| Touch | **Self-proximity**: every peer tests its own camera against the object and fires its own pulse. No sensor, no physics body, no initiator — and it works in VR and in walk mode because in Play mode the camera *is* the player. |
| The counts | Derived from the **graph**, never from the score. A score only goes up, so `left` would go negative the first time something respawned. `collected + left === total` by construction. |
| Legacy scenes | The count node also finds core's old seven-node chains (`SetVariable ← Once ← event → Latch`) and reads each Latch through `api.flow.nodeValue` — core's own round-aware answer, not a second implementation. |
| Late joiners | No `registerStateSync` at all. Every bit of state is already replicated: the graph, the trigger log, the game singleton and the peer rows. AUTHORING.md §4.3 calls that the better design when you can get it. |
| The toolbox | LOCAL, like every toolbox. What it *changes* goes through the replicated paths — `api.flow.setNodeData` for an inline edit, `api.flow.addNodes` for the recipe. |

### A player who joins mid-round sees the gems back

A pickup is an **event**, and the flow trigger log has no full-state reply in the
handshake — so a peer who connects after a collect cannot learn it happened, and
its Latch (and therefore the object) reads un-collected. Everything from the
moment they join is in sync.

This is **core's** behaviour, not something this module chose: the seven-node
recipe stood on exactly the same stamps and did the same thing. The module
deliberately does not paper over it with its own `registerStateSync` "collected"
set, because that would be a second source of truth for latch state — and it
would then have to re-implement `perRound` retirement, respawn ageing and the
per-player split against its own copy, which is the drift `ctx.trigger` exists to
prevent. Filed as [DEVX-REQUESTS #18](../../DEVX-REQUESTS.md); the test-flight
asserts the limitation so a core fix flips that check loudly.

### The known race, inherited on purpose

A `shared` add is computed on every peer from one replicated stamp, so two peers
with skewed flow ticks can bank one pickup twice. That is core's `Set Variable`
`add` semantics exactly, and this module deliberately does not invent a different
answer for it — use `scope: 'player'` (one writer per row, immune by construction)
where the number has to be exact, and assert the **world** rather than the score
when you test a shared chain.

## Test-flight

```bash
npm run pack -- collectible
APP_URL=https://localhost:5183/ npm test -- collectible
```

`APP_URL` must point at an app that carries the **R3a game SDK seams**
(`api.game`, `api.peerVars`, `api.flow`, `ctx.trigger`,
`fireNodeTrigger(…, {replicate:false})`, `api.hud.registerDebugLine`) — an older
build refuses to register the module with a toast, which is the first thing the
flight would report.

**78 checks**, all green. The recipe builds one node pair per selected object with
canonical edge ids, replicates, and undoes as one entry · a shared click-collect
hides the object on **both** peers in a round · a per-player collect hides it for
the collector only, never reaches the peer's trigger log, and banks into the
collector's own peer row · a `hide: 'off'` checkpoint stays visible and still
counts · a respawn brings the object back by itself and a re-collect counts again ·
back at the menu a `perRound` node reads un-collected, the object is handed back
and a manual hide then sticks · the count node reads a module node and a
hand-built legacy chain as one number · the toolbox lists live rows whose header
agrees with the count node, its inline edits replicate, and a row click selects
the object · a third peer installs the module, joins, converges on the structure,
does **not** bank the pulses it never witnessed, and sees the next shared collect.
