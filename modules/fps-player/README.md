# fps-player

Walk mode. Mouse look, WASD with **strafe**, sprint, jump, crouch, ground and
wall raycasts — the first-person counterpart to core's `possess`, which is tank
drive (A/D turn, no strafe, no jump).

## Use it

1. Install `fps-player.zip`.
2. Add a **Player capsule** (Add ▸ FPS Player) and press **J**.
3. WASD to move, **Shift** sprint, **Space** jump, **C** crouch, **Esc** to
   leave. Leaving restores the editor's camera and input, and the whole ride is
   one undo entry.

Use the key, not just the card button: keyboard input is suppressed while an app
modal is open, so starting from the manager means nothing moves until you close
it.

## The camera, honestly

This module owns the **body**; `possess` owns the **view**.

- On an app with the 17-A1 SDK it asks for `camera: 'first'` with `mouseLook`,
  and you are inside the capsule's head with core driving yaw and pitch.
- On an older app, `possess` only offers `chase | orbit | none`, and nothing on
  the api can move the editor camera directly (`OrbitControls.update()` re-derives
  it from its own state every frame). The walk then runs in **third person** and
  the module takes pointer lock itself for the turn.

Which one you get is decided by probing `api.possessModes` — never by passing a
mode and hoping, because an unrecognised `camera` value degrades to *no* camera
control rather than failing. That is [DEVX-REQUESTS #1](../../DEVX-REQUESTS.md),
now shipped in core.

## How it works

| Concern | Choice |
|---|---|
| The body | A replicated `Fpsplayer` capsule (`registerPrimitive`), so peers see a normal object and it saves/undoes like one. |
| Ownership | `api.possess(uuid, {speed: 0, turnSpeed: 0, …})` — possess keeps the selection lock, the input claims, the camera, the Esc handling, the ONE undo entry and the final move, while its own tank controls write nothing. This module supplies the motion. |
| Input claims | `possess` claims `keys` + `locomotion`, so the editor stops flying the camera with the same WASD. The flight asserts both are released on exit. |
| Movement | Camera-relative velocity from the vrvsvr prototype's `Player.svelte`, rewritten: yaw-relative forward/strafe, `×1.7` sprint, `×0.45` + squash while crouching, jump velocity derived from the desired height (`√(2gh)`). |
| Collision | Raycasts, not rapier: a wall probe cancels a blocked step and a downward probe finds the floor. A module may only mutate physics on the peer that steps the sim, so a capsule body would need the initiator-only dance for no benefit at this scale. |
| Replication | Free — possess broadcasts throttled `move`s while a direction key is held. A jump that lands with no key held is the one case peers see late; the next step corrects it. |
| Toggle keys | Edge-detected from `api.input()` in the frame task, **not** `api.onInput`, which misses keys for the first seconds after a module registers ([DEVX-REQUESTS #8](../../DEVX-REQUESTS.md)). |

## Test-flight

```bash
npm run pack -- fps-player
APP_URL=https://localhost:5188/ npm test -- fps-player
```

17 checks driven by **real keys**: the capsule replicates, J possesses it and
claims keys+locomotion, W walks, Shift sprints measurably further, D strafes, C
squashes and standing restores, Space leaves the floor and gravity returns it, a
peer sees the walk, a wall blocks forward motion while backing away still works
(so a blocked walk can't be confused with a frozen module), and Esc restores the
editor's input.
