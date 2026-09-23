# _template

The starting point for a new module. It is a **working** module — a clickable
beacon that pulses on every peer — so you can prove your toolchain before you
write any of your own code.

```bash
npm run new -- my-cool-thing "My Cool Thing"   # copy this folder, rewrite the id
npm run pack -- my-cool-thing                  # -> my-cool-thing.zip at the repo root
```

Then in the app: **burger menu ▸ Modules ▸ User ▸ Install from zip**, pick the
zip, and your card appears. Add a **Beacon** from the sidebar's Add menu (group
"My Module"). A click in the editor's **Edit** mode selects it like any object; press
**I** for **Interact** (or press Play) and click it — it pulses for you and for every
connected peer. Where each click handler runs is a decision the scaffold spells out:
`{modes: ['interact', 'play']}` — see AUTHORING.md §6 "Edit, Interact, Play".

Read [../../AUTHORING.md](../../AUTHORING.md) before you replicate anything: the
replication rules are not optional, and the SDK has ready-made answers for late
joiners, determinism and input claims.

## Files

| File | Why |
|---|---|
| `manifest.json` | id/name/version + `entry` and the `files` list (used by URL installs) |
| `module.js` | the entry — **self-contained**, no `import` statements |
| `README.md` | docs for this repo; `npm run pack` leaves it out of the zip |

Assets (textures, audio) go in a subfolder, get listed in `manifest.json`'s
`files`, and are read with `api.assetUrl('assets/thing.mp3')`.
