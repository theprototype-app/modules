# Music Lab

Two **audio devices** for the app's audio engine (#23), and one cable between them.

| Device | Ports | What it is |
|---|---|---|
| **Piano** | `out` (audio) | One octave, C4..B4. Click a key — desktop click or VR trigger, one path — and every peer hears the same note at the same stamped time and sees the same key dip. |
| **Speaker** | `in` (audio) | The spatial output: an HRTF `PannerNode` that follows the object, with a cone, so where you put it and which way you point it are both audible. |

Add both from the viewport **Add ▸ Devices: Music Lab**, or use the sidebar button
**Music Lab: piano + speaker**, which drops one of each and cables them together.

**Sound goes nowhere until it is cabled.** The piano's voices land on the piano's own
output gain and stop there; the speaker is the only thing here that reaches the
`instruments` bus. Pull the cable and the room goes quiet — that is what a patch means.

## Params

*Piano* — `level` (0..1), `release` (0.05..2 s), `wave` (sine / triangle / saw /
square). *Speaker* — `level` (0..1), `cone` (inner angle 10..360°; the outer angle is
that plus 60°, at a quarter gain), `rolloff` (0.1..5), `maxDistance` (5..200 m,
default 40 — the distance voice chat carries).

Every one of them is live: `onParam` adjusts the running graph and never rebuilds it.

## How it replicates

Nothing in this module sends a message. A note goes out through `api.audio.note`,
which stamps it with the wall clock and hands every peer the same
`onNote(handle, {note, velocity, at})`; each peer builds its own voice and starts it
at `api.audio.timeFor(at)`. The device objects, their params and the cable are core's
`userData.device` document and the patch — so they replicate, undo, save and reach a
late joiner with no state sync of this module's own.

The key dip runs from `onNote`, not from the click: the peer who did not click has to
dip the same key.

## Testing

```bash
npm run pack -- music-lab
APP_URL=https://localhost:5216/ npm test -- music-lab
```

The flight installs the real zip on three peers and measures actual sound through a
destination tap: silent uncabled, heard when cabled, quieter when the speaker is moved
away or turned around, silent again when it is unplugged, and heard by a late joiner.
