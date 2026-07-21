# theprototype-app/modules

Optional/community modules for [theprototype.app](https://theprototype.app) — one
monorepo, one module per folder under `modules/`, each versioned independently of
app releases via its `manifest.json`. Core modules that ship in the app bundle
live in the main repo (`theprototype-app/core`, `src/modules/`); this repo is for
everything installable through **Modules ▸ Install** (zip upload or URL).

## Modules

| Module | What it does |
|---|---|
| [flow-toolkit](modules/flow-toolkit/) | Reference for flow v2: code-editable nodes shipped via `api.registerNodeDefs` (Wobble + Breathe) that pair with per-object flows and embedded Object Flow nodes. |

## Module format

A module is a folder with:

- `manifest.json` — `{ id, name, version, description, entry }` (`entry` defaults
  to `module.js`)
- `module.js` — **self-contained** (no `import` statements; everything comes from
  the `api` argument): `export default { id, name, version, description, register(api) }`

The `api` surface is documented in the main repo's `MODULES.md` (nodes, effects,
primitives, click handlers, input, physics, possess, state sync, **registerNodeDefs**).

## Build a zip to install

Zip the CONTENTS of the module folder (manifest.json + module.js at the zip root,
not nested in a directory):

```powershell
Compress-Archive -Path modules/flow-toolkit/* -DestinationPath flow-toolkit.zip -Force
```

Then in the app: burger menu ▸ Modules ▸ install from zip (or serve the folder and
install by URL). Peers receive installed modules automatically (module bytes
replicate through the manager).

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
