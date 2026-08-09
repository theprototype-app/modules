# sabers

A glowing blade held wherever you point — the VR controller in a headset, the
mouse at a desk — that sparks on contact and that your peers can see.

## Use it

1. Install `sabers.zip` on each peer.
2. Press **K**, or hit **Draw / sheathe the saber** on the module card.
3. Point at something. The blade re-aims as you move; touching an object throws
   sparks on your screen and on everyone else's.

## How it works

The vrvsvr prototype this comes from existed to demonstrate one thing: parent the
blade to the **tracked hand** when hand tracking is on and to the **controller**
when it is not. Our SDK erases that branch — `api.pointerRay()` already resolves
to the VR pointer hand or the desktop mouse — so the module poses one blade from
one source and runs in a headset and at a desk with no `isPresenting` check.

| Concern | Choice |
|---|---|
| The blade | **Local** scene content (`api.scene()`, group `sabers-module`), never `objectsGroup`. It is derived state: it must not enter scene sync, saved files or GLTF exports, and must not be selectable. |
| Your pose | Streams to peers as a throttled module op (~12/s). Each peer renders a *ghost* blade for you from it. |
| Disconnects | A ghost with no update for 3s hides itself, so a peer dropping out needs no cleanup message. |
| Hits | Sparks are drawn everywhere (they are decoration), but only the peer where `api.physics.isInitiator()` is true applies the impulse — the authoritative half of golden rule 8. Nobody simulates the same hit twice. |
| The glow | `depthWrite` stays **on**. A `depthWrite: false` shell would make the AO and outline passes paint whatever is behind it across the blade's face. |
| Colour | Hashed from the peer id, so two blades in a room read apart without anyone agreeing on anything. |

## Known gaps

This module is the clearest demand for
[DEVX-REQUESTS #2](../../DEVX-REQUESTS.md): `pointerRay()` gives **one** hand as
origin+direction, so there is no second saber and no blade roll. Per-hand pose
and button state exist in core (`vrControls`) but only for bundled modules. Also
feature-detected: `api.haptic` ([#3](../../DEVX-REQUESTS.md)) and `api.isVR()`
([#6](../../DEVX-REQUESTS.md)) — the latter is inferred from recent mouse
movement to decide how far ahead of you the hilt should sit.

## Test-flight

```bash
npm run pack -- sabers
APP_URL=https://localhost:5188/ npm test -- sabers
```

12 checks driven by a **real mouse** (which is what `pointerRay()` reads):
nothing drawn until asked, the blade appears and re-aims, it stays out of the
replicated scene, a connected peer renders the ghost at the same position
(drift < 5cm), contact sparks locally and on the peer, and sheathing clears it
on both sides.
