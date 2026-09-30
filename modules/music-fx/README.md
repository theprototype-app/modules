# Music FX

Six **audio devices** for the app's audio engine (#23 C3): a four-channel mixer and five
pedals. Every one of them is a `registerAudioDevice` spec and nothing else — core owns
the object, the replication, the undo, the saving, the cables and the clock.

| Device | Ports | WebAudio | Params |
|---|---|---|---|
| **Mixer** | `in1..in4` → `out`, `send` | per channel `StereoPanner` → fader gain → out; fader → send level → send (post-fader) | `master`; per channel `gain`, `pan`, `mute`, `solo`, `send` |
| **Delay** | `in` → `out` | `DelayNode` + feedback gain | `time` (1/4, 1/8, 1/8T, 1/16 synced to the shared transport, or `free`), `ms`, `feedback`, `mix` |
| **Reverb** | `in` → `out` | `ConvolverNode` with a **generated** impulse (a decaying noise burst) | `size`, `decay`, `mix` |
| **Filter** | `in` → `out` | `BiquadFilterNode` | `type` (low / high / band / notch), `cutoff`, `q`, `mix` |
| **Distortion** | `in` → `out` | drive gain → `WaveShaperNode` (tanh, 4x oversampled) → tone low-pass | `drive`, `tone`, `mix` |
| **Bitcrush** | `in` → `out` | an `AudioWorklet` loaded from a blob URL built from a string in `module.js` | `bits`, `rate` (sample-and-hold divisor), `mix` |

Add any of them from the viewport **Add ▸ Devices: Music FX**, or use the sidebar
button **Music FX: demo chain**, which drops the five pedals and the mixer in a row and
cables them in series into the mixer's `in1`. If a Music Lab piano and speaker are
already in the scene, the chain plugs in between them; otherwise a toast says what to
cable.

**Sound goes nowhere until it is cabled.** A pedal's `out` and the mixer's `out` and
`send` connect to nothing; only the device you cable them into (a Music Lab speaker,
say) reaches a bus. **Re-order a chain by re-plugging it** — that is what the cables
are for, and every peer watches them move.

## Every pedal is dry/wet

`in → dry → out` and `in → effect → wet → out`. `mix` 0 is a bypass, `mix` 1 is fully
wet. The filter defaults to fully wet; the others to a blend.

## Stomp it, mute it (0.2.0)

Every pedal has a `bypass` toggle: a click on its footswitch (or the LED) stomps it, fully
dry whatever Mix says, and the LED goes dark. Each mixer strip has a mute button at the
front edge. Both write the device's own params, so a stomp replicates, saves and undoes
like any knob — and in VR a held-trigger SWEEP across the footswitches or the mute buttons
flips each one it passes.

## A knob is a param write, never a rebuild

Every `onParam` glides an `AudioParam` on the running graph (`setTargetAtTime`, ~15 ms).
The nodes a cable is plugged into are the same nodes after the write as before, so a
fader move does not click, does not gap, and does not cut the delay's echoes or the
reverb's tail. The reverb regenerates its impulse on `size` / `decay`, debounced 120 ms,
because a knob drag writes many times a second and a 6 s buffer is not free. The impulse
is a **seeded** noise burst — a pure function of `size` and `decay` — so every peer
builds the same room and a device rebuilt after an undo sounds like the one it replaced.

## The synced delay follows the shared transport

A synced division is `f(params, bpm)` where `bpm` is the replicated transport
(`api.audio.transport().bpm`). One frame task, throttled to 4 Hz, re-reads it and
re-aims every synced delay that it moved — so `setBpm` on any peer moves every peer's
delays to the same time, computed from the same number.

## The bitcrusher

The worklet processor is a string in `module.js`; it is turned into a blob URL and loaded
with `audioWorklet.addModule` once per `AudioContext`, so the module stays one file. If
that fails (no `audioWorklet`, a CSP that refuses blob workers), the same algorithm runs in
a `ScriptProcessorNode` on the main thread and the built handle's `mode` reads `'script'`
instead of `'worklet'`. The flight reports which path it took; on the core dev server it
is the worklet.

## Testing

```bash
npm run pack -- music-fx
APP_URL=https://localhost:5216/ npm test -- music-fx
```

The flight installs the real zip on three peers, registers a test source and a test sink
in-page (it does not depend on Music Lab), and measures every claim through the
destination tap: the filter moves the spectral centroid, distortion and the bitcrusher put
power above the fundamental, the delay and the reverb keep sounding after the source
stops, the delay time follows `setBpm` on both peers, a re-ordered chain reads
differently and repeatably, the mixer's mute / solo / send do what they say, a fader move
neither clicks nor restarts anything, a knob turned on A is heard on B, and a late joiner
hears the finished rig.
