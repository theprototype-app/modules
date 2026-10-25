# Captions (in-browser)

Speech to captions **on this device** — no audio leaves it. Moonshine (English, MIT) runs through
transformers.js 4 on WebAssembly in a Worker, and the app uses it wherever it turns speech into
text:

- **Timeline ▸ sequence menu ▸ Captions ▸ Caption the speech in audio clips** — timed caption cues
  on a new caption track.
- **Live captions** of voice chat (Settings ▸ Accessibility ▸ Live captions), for speakers who allow it.

Settings ▸ Accessibility ▸ Captions from speech picks the engine (Auto uses this module for English
when it is installed). Other languages use the speech-to-text server presets (Settings ▸ AI).

## What it downloads

| What | Size (over the wire) | Kept in |
|---|---|---|
| transformers.js 4.3.1 + ONNX Runtime Web (jsep) | ~7 MB | Cache Storage `tp-ml-runtime` (shared) |
| Moonshine tiny, 8-bit (default) | ~32 MB | Cache Storage `transformers-cache` |
| Moonshine base, 8-bit (card ▸ Switch model) | ~67 MB | Cache Storage `transformers-cache` |

Everything is fetched once, right after install; every runtime file is checked against a pinned
SHA-384 and imported from a blob URL (the app's CSP never lets a CDN run script directly).

## The shared ML runtime (for module authors)

Modules that run transformers.js use the SAME pinned files and the same Cache Storage bucket
`tp-ml-runtime`, keyed by the file URL, so a device keeps one copy (the planned Kokoro voice
module, roadmap 62, follows this). Copy `RUNTIME` from `module.js` verbatim — the URLs and
SHA-384s are the contract; bump them together in every module that uses them.

## Card buttons

- **Download the speech model now** — loads it (if the install-time download was interrupted).
- **Switch model (tiny ⇄ base)** — base is slower and more accurate.

Licences: see THIRD_PARTY_LICENSES.txt. The module itself is MIT.
