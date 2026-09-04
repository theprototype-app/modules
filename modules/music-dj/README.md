# Music DJ (23-C4)

Two **decks** and a **crossfader** as audio devices on the engine.

- **Deck** - drop an audio item from the Explorer on it to load a track by CONTENT HASH
  (every peer pulls and decodes its own copy). Play/Stop, Cue (stopped: set the cue point
  here; playing: jump to it), a **platter** you scrub (one revolution = 2 s of audio) and a
  **pitch** fader (varispeed 0.5x..1.5x: pitch and tempo are one control in v1). The
  playhead is never streamed: the device document holds `{startedAt, offset, rate}` and
  every peer derives the position from them and its clock. A scrub or a pitch move is one
  live gesture: throttled previews while it runs (`api.audio.previewParams`), ONE commit when
  it stops - one undo entry. The face re-bases offset/startedAt whenever it writes a rate,
  so the position stays continuous everywhere; a bare `rate` edit from the Inspector keeps
  playback continuous locally but re-derives the document position (the v1 limit).
- **Crossfader** - inputs `a` and `b`, one `out`, a `position` (-1..1) and a `curve`
  (linear / constant power / sharp). Gains glide, never jump.

Sidebar: **Music DJ: booth** adds two decks and a crossfader (and a Music Lab speaker when
that module is installed). Needs core's `api.registerDropHandler` and
`api.audio.previewParams` (23-C2/C4).
