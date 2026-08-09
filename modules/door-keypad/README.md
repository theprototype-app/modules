# door-keypad

A combination-lock keypad that opens an actuated door. Four buttons, a secret
order, a wrong press starts you over, and the door swings for everyone in the
session — with a mouse or with the VR trigger.

## Use it

1. Install `door-keypad.zip` (**Modules ▸ User ▸ Install from zip**) on every
   peer — modules do not travel over the wire.
2. From the Add menu's **Door & Keypad** group, place **Keypad button 1–4** and
   one **Door (hinged)**. Arrange them however you like; the door's origin is its
   hinge edge, so it swings around wherever you put it.
3. Press the buttons. Accepted presses glow; a wrong one flashes red and resets.
   Get all four right and the door swings open on every connected peer.

The code comes from the door — **Reveal the code** on the module card prints it
on your screen only, and **Lock the door** re-arms it.

## How it works (and why it is built this way)

| Concern | Choice |
|---|---|
| The pieces | Ordinary replicated objects via `registerPrimitive` + `/create`. Placing, moving, saving, undoing and deleting are the editor's job, not the module's. |
| The kind | Derived from the replicated object **name** (`Kpbutton3`), never from local `userData` — peers do not have your `userData`. |
| The secret | FNV-1a over the **door's uuid**. Every peer computes the same code with nothing on the wire, and a new door is a new code. `Math.random()` would desync instantly. |
| A press | A discrete event: applied locally, then `api.send`. Receivers apply it and never re-broadcast. |
| The swing | **Deterministic** from one `openedAt` stamp on `api.now()`, the synced clock. No motion messages at all — the animation is a pure function of `(stamp, time)`, so peers land on an identical pose (the flight asserts they agree to 1e-4). |
| Late joiners | `registerStateSync` ships `{openedAt, entered}`, so someone arriving after the unlock finds the door open at the right angle. |
| Desktop + VR | One `registerClickHandler`. The VR trigger dispatches through the same handler with the exact mesh hit; returning `true` consumes the click so pressing never selects the button. |

Concurrent presses from two peers can briefly disagree on progress. That is
deliberate: the failure mode is a reset, which is self-healing, and it costs no
locking. The unlock itself is broadcast explicitly so it can never be half-open.

## Known gap

Unlocking does **not** fire a flow trigger, so node graphs cannot react to it —
`fireObjectClick` is core-module-only. Filed as
[DEVX-REQUESTS #4](../../DEVX-REQUESTS.md). Haptics on press are feature-detected
(`api.haptic`, [#3](../../DEVX-REQUESTS.md)) and simply absent until that lands.

## Test-flight

```bash
npm run pack -- door-keypad
APP_URL=https://localhost:5188/ npm test -- door-keypad
```

13 checks: real-zip install on two peers, pieces replicate, the derived code
matches the module's own, a wrong press resets, the code opens the door on both
peers with an identical pose, a third peer joining afterwards catches up, and
re-locking closes it everywhere.
