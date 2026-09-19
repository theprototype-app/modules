# theprototype-app/modules

Optional/community modules for [theprototype.app](https://theprototype.app) — one
monorepo, one module per folder under `modules/`, each versioned independently of
app releases via its `manifest.json`. Core modules that ship in the app bundle
live in the main repo (`theprototype-app/core`, `src/modules/`); this repo is for
everything installable through **Modules ▸ Install** (zip upload or URL).

**Writing one?** [AUTHORING.md](AUTHORING.md) is the single entry point — the
rules, the API digest and the testing recipe. Known SDK gaps are tracked in
[DEVX-REQUESTS.md](DEVX-REQUESTS.md).

```bash
npm install
npm run new -- my-module "My Module"   # scaffold from modules/_template
npm run pack -- my-module              # -> my-module.zip, ready to install
```

## Modules

| Module | What it does |
|---|---|
| [_template](modules/_template/) | The starting point: a working clickable beacon demonstrating primitives, click handling, replication and late-joiner state in ~120 commented lines. |
| [door-keypad](modules/door-keypad/) | A combination-lock keypad that opens an actuated door. Code entry checked locally, unlock replicated as one timestamp (the door animation is deterministic from it), late joiners arrive at the right door state. Desktop clicks and the VR trigger, one handler. |
| [sabers](modules/sabers/) | Hand-held glowing blades: a tool posed per frame from the pointer hand in VR and the mouse ray on desktop, with hit sparks and attachment state shared with peers. |
| [fps-player](modules/fps-player/) | Walk mode: mouse look, camera-relative WASD with sprint/jump/crouch, ground and wall raycasts, input claims that pause the editor's own WASD, one undo entry per ride. True first person where the app offers it (probed via `api.possessModes`), third-person chase otherwise. |
| [tutorial-room](modules/tutorial-room/) | An in-scene onboarding room built from one menu button: signs teaching select/move/gizmo, connect/invite, flow basics and VR entry, plus clickable demo interactables. Asset-free (primitives + canvas text). |
| [flow-toolkit](modules/flow-toolkit/) | Reference for flow v2: code-editable nodes shipped via `api.registerNodeDefs` (Wobble + Breathe) that pair with per-object flows and embedded Object Flow nodes. |
| [football](modules/football/) | VR football on the knock: a floating ball, two team gates, last-touch attribution read from `api.onHit` on every peer, duel / teams / free-for-all / practice modes, per-player goals / touches / own goals in `peerVars` rows and a match log saved with the scene — every rule a flow node, the physics the template's data. The Football game in the scenes feed installs it. Needs core ≥ 1.13 (`api.onHit`, `api.hitLog`). |
| [collectible](modules/collectible/) | ONE node where core needed a seven-node recipe: click or walk into an object and it hides, counts and respawns. Shared or per-player scoring (the per-player half is `fireNodeTrigger(…, {replicate:false})` — the pulse never leaves the collector), a counting checkpoint that never hides, a manager toolbox that builds the graph as one undo entry, and a count node that also reads legacy chains. Needs the R3a game SDK seams (`api.game` / `api.peerVars` / `api.flow`). |
| [untangle](modules/untangle/) | The 190 test-flight GAME: drag the dots until no edges cross. Procedural guaranteed-solvable puzzles (seed-deterministic — determinism IS the netcode), desktop+VR drag via `api.pointerRay()`, replicated moves, lockstep win/level advance, generative WebAudio pad + SFX. Needs app ≥ the `api.pointerRay` SDK (core PR #37). |

## Module format

A module is a folder with:

- `manifest.json` — `{ id, name, version, format, description, entry, files }`
  (`entry` defaults to `module.js`)
- `module.js` — **self-contained** (no `import` statements; everything comes from
  the `api` argument): `export default { id, name, version, description, register(api) }`

Full contract: [AUTHORING.md](AUTHORING.md) §2–§3 and the docs site's
[module-package](https://docs.theprototype.app/module-package/) page. The `api`
surface is documented in the core repo's `MODULES.md` and on the docs site's
[module-sdk](https://docs.theprototype.app/module-sdk/) page.

## Build a zip to install

`npm run pack -- <id>` writes `<id>.zip` with `manifest.json` at the zip **root**
(what the manager expects) and refuses a module with a top-level `import`:

```bash
npm run pack -- door-keypad     # one
npm run pack -- --all           # every module
```

Do **not** use `Compress-Archive` on the folder — it nests the directory inside
the zip and the manager rejects it with "zip has no manifest.json at its root".

Then in the app: burger menu ▸ **Modules ▸ User ▸ Install from zip** (or serve
the folder and install by URL).

## Installing does NOT install for your peers

Each peer installs modules themselves. What actually crosses the wire is:

- the `{id, version}` **list** of loaded modules, exchanged on connect — a
  mismatch (missing module, or a different version) raises a toast on both sides
  and nothing else;
- your module's own `api.send()` messages, and its `registerStateSync` state for
  late joiners.

The module's **code and assets never travel**. A peer without the module simply
drops its messages, and only sees whatever plain scene objects it created
through `/create`. Share the zip (or a URL) with the people you session with.

## Testing

Every module ships a Playwright test-flight that installs the real zip through
the real manager and drives the app — see [tests/README.md](tests/README.md).

```bash
npx playwright install chromium                    # once
npm run pack -- --all
APP_URL=https://localhost:5188/ npm test
```

## Testing the flow-toolkit example (batch H demo)

1. Install the zip, create a Box.
2. Select the Box → Flow editor shows "Box has no flow yet" → **Create flow**.
3. Add **Wobble (toolkit)** from the palette's Custom section — the Box wobbles
   (no Object Selector needed inside an object flow).
4. Open the def in the **Node Designer** and edit the formula — your edit sticks.
5. Add a **Flow Input** named `amount` (number) wired into a **Breathe** node's
   `amount`, then right-click the Box → **Add flow to Scene graph** — the Scene
   graph gets an Object Flow node whose `amount` socket drives the breathing.

## Versioning / compatibility

- Bump a module's `manifest.json` version per change; the app toasts on version
  mismatches between peers.
- When the main repo's module SDK changes shape, this repo's modules are updated
  in the same sitting (see the maintenance contract in the cloud repo's
  MAINTAINING.md — same principle: the `api` surface is the API).
