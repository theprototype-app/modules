# Music Voice (23-C5)

Four audio devices on the engine: a **Mic**, a **Looper**, a **Synth** and a **Theremin**.

- **Mic** - this peer's own RAW microphone into the graph (`api.audio.captureMic`: a separate
  capture from voice chat, no echo cancellation / noise suppression / auto gain, never gated
  by push-to-talk). Params: level, a `monitor` toggle (hear yourself on the local instruments
  bus without a speaker; off by default because sound goes nowhere until cabled), take length.
  The red button records a take through core's recorder; the Explorer item's CONTENT HASH is
  written into the device document (`lastTake`), so it replicates, undoes, and enters the Scene
  manifest. Pressing the button while a take runs ends it early. Every peer's copy of a Mic is
  that peer's own mic - the bytes that travel are the takes.
- **Looper** - `in` and `out`. Press Record: the record window starts at the NEXT bar boundary
  and lasts `bars` bars, quantized through the transport's scheduler (a stopped transport is
  started for you). The take is a `MediaRecorder` bounce of a gain gate on the shared audio
  clock, with a 3 ms SYNC PIP just before the gate opens: every peer finds the pip in the
  decoded bytes and cuts exactly `bars * 4 * 60 / bpm` seconds after it, so the loop is the
  same samples everywhere and its period is exact. Playback is scheduled on the bar the window
  started on (`startedBeat`), every `bars` bars, pure of `(beat, at, bpm)`; a late joiner or a
  restarted transport starts mid-loop at the phase the transport says. Record again to OVERDUB:
  the playing loop (scaled by `feedback`) is mixed into the new window and the result is a new
  hash. One take = one undo entry (previews for the LED, one commit with `before`). Params:
  bars, level, feedback, play, thru (the live input passes to `out`). Buttons: Record, Play,
  Clear. The loop is a scene asset by hash. The raw Explorer item keeps the pip at its head.
- **Synth** - polyphonic osc -> low-pass -> ADSR voices. Params: wave, attack, decay, sustain,
  release, cutoff, resonance, level, polyphony (the oldest voice is stolen), gate (the note
  length of a click). One octave of keys on the face; a key is a replicated note, synthesized
  on every peer at the stamped time. In VR the pressing hand's trigger holds the note and its
  release ends it (an `off` note); a held note is released after 10 s regardless.
- **Theremin** - VR-native. In VR a frame task reads `api.vrHand(hand)`: hand height above the
  body = pitch (four octaves over a metre), horizontal distance from the body = volume (loud at
  the body, silent past 0.8 m). The pose is written as `api.audio.previewParams` at ~15 Hz -
  replicated, no history - and EVERY peer synthesizes from the document. Continuous pitch, so
  no notes. On desktop `pitch` and `volume` are ordinary params (Inspector, toolbox, a script).
  Params: pitch, volume, wave, hand.

Sidebar: **Music Voice: demo** adds the four, cables the synth into the looper, and cables the
looper, the mic and the theremin into a Music Lab speaker when that module is installed.

Needs core 23-D1 (`api.audio.captureMic` / `record({stream})` / `recording`, `assets` on the
device spec) and 23-C4 (`api.audio.previewParams`, `setParams` with `before`).
