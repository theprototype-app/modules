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

### The list underneath, and where a setting is edited

Everything the toolbox already knows about is listed below the form, grouped by the
score it counts into. The layout is built for the scale that matters — a level with
sixty gems — so the settings sit with whoever owns them:

- **The group header** is a fold-away heading: a chevron, the variable name, its live
  counts (*3 collected, 1 left of 4*), and the two settings a whole set of pickups
  shares — **trigger** (click/touch) and **scope** (shared/player). Changing one there
  applies it to **every** collectible in that group. If the members currently disagree
  the control shows an **em-dash** rather than one of the values (core's Inspector rule
  for a multi-selection); picking a value out of it makes them all agree.
- **Click the header to fold the group.** That is a local preference per variable name —
  it survives closing the window, and it is nobody else's business.
- **Each item is one line**: the object's name, its live state — *waiting* · *collected*
  · *back in 4s* · *missing* — and its **respawn** seconds. Respawn stays on the row
  because it is the one setting that really is per-object: the gem behind the waterfall
  comes back, the rest do not. Clicking the row selects the object; clicking the number
  does not.

Nothing in there is a second source of truth. The rows read the graph and the trigger
log, and every edit is written back through the same replicated `nodedata` path the node
editor's own cards use — so a change made here behaves exactly as if you had typed it
into the card, peers included. A group-wide change is one such write **per member**;
members that already hold the value are skipped, so the cost follows the *difference*
rather than the group size. On core 1.15+ the whole press goes through
`api.flow.setNodesData`, so **one Ctrl+Z undoes the whole group change**; an older core
writes the members one by one.

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

All six live on the node card. The toolbox surfaces the three you keep changing —
`trigger` and `scope` on the group header, `respawn` on the item's own row.

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
| First sight | A stamp minted before the module was watching is **not** a pulse it witnessed (core's own `actionSeenAt` reasoning). The first sweep seeds each node's stamp *and records when this module first saw the node*, so a stamp older than that is adopted without counting. Seeding the stamp alone was not enough once core learned to hand a joiner the trigger log (DEVX #18): the seed can happen while the log is still empty, and the history arriving a moment later would otherwise read as a fresh pulse and bank a point per gem somebody else already took. |
| Touch | **Self-proximity**: every peer tests its own camera against the object and fires its own pulse. No sensor, no physics body, no initiator — and it works in VR and in walk mode because in Play mode the camera *is* the player. |
| The counts | Derived from the **graph**, never from the score. A score only goes up, so `left` would go negative the first time something respawned. `collected + left === total` by construction. |
| Legacy scenes | The count node also finds core's old seven-node chains (`SetVariable ← Once ← event → Latch`) and reads each Latch through `api.flow.nodeValue` — core's own round-aware answer, not a second implementation. |
| Late joiners | No `registerStateSync` at all. Every bit of state is already replicated: the graph, the trigger log, the game singleton and the peer rows. AUTHORING.md §4.3 calls that the better design when you can get it. |
| The toolbox | LOCAL, like every toolbox. What it *changes* goes through the replicated paths — `api.flow.setNodeData` for an edit (`setNodesData` for a group edit, one undo step), `api.flow.addNodes` for the recipe. |
| Where a setting is edited | By **who owns it**, which is what a sixty-gem scene forces: `trigger` and `scope` are what a whole score's worth of pickups share, so they live on the **group** header; `respawn` is genuinely per-object, so it stays on the **row**. That is also why a group is a fold-away unit — sixty rows can be one line. |
| A group control over members that disagree | An **em-dash**, never one of the values (core's Inspector rule for a multi-selection). Showing "click" over a mixed set is a lie the next pointer trip silently makes true. Picking a value out of the mixed control applies it to everyone, which is the reason the control exists. |

### A player who joins mid-round arrives up to date

This section used to say the opposite, and the change is core's rather than this
module's. A pickup is an **event**, and the flow trigger log had no full-state reply in
the handshake — so a peer who connected after a collect could not learn it happened, and
its latch (and therefore the object) read un-collected. That was filed as
[DEVX-REQUESTS #18](../../DEVX-REQUESTS.md) and **shipped**: the log now travels with
the rest of the handshake, so a joiner sees the gems that are already gone.

What the module had to do about it is the *first sight* rule above. The module counts on
a stamp EDGE, so history arriving right after the seed looked exactly like a live pulse —
a joiner would have banked a point for every gem already collected. It now remembers when
it first saw each node and treats anything older as history: adopted, never counted. The
test-flight asserts both halves — the joiner AGREES with the host on the count, and the
score does not move when the history lands.

The module still ships no `registerStateSync` "collected" set, and that is the same
decision as before: it would be a second source of truth for latch state, and it would
then have to re-implement `perRound` retirement, respawn ageing and the per-player split
against its own copy — the drift `ctx.trigger` exists to prevent.

### The known race, inherited on purpose

A `shared` add is computed on every peer from one replicated stamp, so two peers
with skewed flow ticks can bank one pickup twice. That is core's `Set Variable`
`add` semantics exactly, and this module deliberately does not invent a different
answer for it — use `scope: 'player'` (one writer per row, immune by construction)
where the number has to be exact, and assert the **world** rather than the score
when you test a shared chain.

## Check it by hand

The automated flight below covers all of this, but these are the steps to *feel* it —
and the order matters, because two of them look like bugs until you know why.

**Setup.** Open the app, install the module (**Modules ▸ Browse**, or
`collectible.zip` through **Modules ▸ User**), and confirm two things appeared: a
**Collectibles** group in the node editor's palette, and the **Collectibles** toolbox
under viewport right-click ▸ **Module tools** (or the **Open Collectibles** button on
the module's card).

**1 — the sixty-second smoke test.**

1. `/create box` three times.
2. Select all three, open the toolbox, press **Make collectible** on the defaults
   (`gems`, shared, click, no respawn, hide on).
3. The toolbox should list three one-line rows under a **gems · 0 collected, 3 left of
   3** header, each naming its object and reading *waiting*.
4. Press **Play**, click a box: **it vanishes**.
5. To watch the counts while playing, add a **Debug** HUD element (HUD editor ▸
   Display ▸ Debug) and click the pill to expand it — the toolbox itself is hidden in
   Play mode by design.
6. Press **Esc**. **All three boxes come back.** That is correct — see below.

**2 — the parameters.** Edit them on the node card, or in the toolbox:

- **Checkpoint** (`hide: off`) — collect it in Play: the object **stays visible** and
  the count still rises. That is a lap gate. (Node card only.)
- **Respawn** (`respawn: 5`) — the number on the item's own row. Collect it and wait: the
  row counts down (*back in 4s*), the object returns by itself, and collecting it again
  **counts a second point**.
- **Touch** (`trigger: touch`) — the group header's first select, so one press converts
  the whole score's worth of pickups. Press Play and *walk into* one with WASD instead of
  clicking. Each peer detects itself, so no physics simulation is involved.

**2b — the group header.** With three gems listed, set the header's **trigger** to
*touch* and watch all three node cards follow. Now set **one** of them back to *click* on
its card: the header select goes to an **em-dash**, because the group no longer agrees.
Pick *click* from it and all three agree again. Then click the header itself — the group
folds shut, the counts stay readable, and it is still folded the next time you open the
window.

**3 — two peers.** Open a second window, **install the module there too** (a peer
without it cannot evaluate the node), and connect them.

- **Shared**: A collects → the gem vanishes on **both** screens, one score.
- **Per-player** (the group header's second select → `player`): A collects → it vanishes
  **only for A**, stays takeable for B, and each banks their own row. Expand the Debug
  pill on both screens:
  the per-player chips agree about *both* people.

**4 — the round.** Wire a HUD button to **Set Game State ▸ playing**, collect a few,
then set it back to **menu**: every gem reads un-collected and the counts reset. That
is `perRound`, derived from the replicated round with nothing sent.

**Expected, not bugs.**

- **Leaving Play brings everything back.** `whilePlaying` hands each object to its
  owner the moment you stop playing, so you can still edit it and hide/show it from
  the object list. That *was* a reported bug (21-F2) and this is the fix.
- **Clicking in the editor collects but nothing vanishes.** The pulse lands; the hide
  only applies while playing. Press Play and it is already gone.
- **The toolbox disappears in Play mode** — it is an authoring tool.
- **A peer joining mid-round now arrives up to date** — gems already taken are already gone for them. That was not true before core shipped the trigger-log handshake reply; if you see the old behaviour, the app predates it (see the section above).

**If you would rather read numbers than click:**

```js
window.__stores.gameState.gameVar('gems', 0)        // the shared score
window.__stores.peerVars.leaderboardRows('gems')    // the per-player rows
window.__stores.flowValues                          // each node's live value
window.__stores.isLocked.set(true)                  // enter Play without the button
```

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

**125 checks**, all green. The recipe builds one node pair per selected object with
canonical edge ids, replicates, and undoes as one entry · a shared click-collect
hides the object on **both** peers in a round · a per-player collect hides it for
the collector only, never reaches the peer's trigger log, and banks into the
collector's own peer row · a `hide: 'off'` checkpoint stays visible and still
counts · a respawn brings the object back by itself and a re-collect counts again ·
back at the menu a `perRound` node reads un-collected, the object is handed back
and a manual hide then sticks · the count node reads a module node and a
hand-built legacy chain as one number · the toolbox lists live rows whose header
agrees with the count node, its edits replicate, and a row click selects the
object · a third peer installs the module, joins, converges on the structure,
does **not** bank the pulses it never witnessed, and sees the next shared collect.

The manager's own section covers the layout: an item row is **measured** to be one
line of name/state/respawn with no select on it · a group folds, stays folded through
the refresh and through closing the window, and folding one leaves the others open ·
one header press sets `trigger` on every member of that group, replicates each edit,
and reaches nothing outside the group · members that disagree show the **em-dash**, and
picking a value out of it makes them agree · a row edit still changes only its own node ·
the state word follows a collect live and counts *back in Ns* for a respawn · and a
twenty-member group flips off one press (**3–10 ms** synchronous, twenty `nodedata`
messages, all twenty landing on the peer), while pressing a value the group already
holds sends nothing at all.
