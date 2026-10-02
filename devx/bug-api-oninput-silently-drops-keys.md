---
number: 8
title: "BUG — `api.onInput` silently drops keys for the first seconds"
status: open
gap: "**BUG**: `api.onInput` misses keys for ~2s after register"
blocks: "`fps-player`"
workaround: "yes — edge-detect from `api.input()` in a frame task"
---

**Found in:** `modules/fps-player` (its `J` toggle did nothing right after
install, then started working; the flight passed or failed depending on how much
unrelated setup ran first — the worst kind of bug).

`api.onInput(fn)` subscribes through a dynamic import:

```js
onInput(fn) {
	let unsub = () => {};
	import('./inputRuntime').then((m) => (unsub = m.onInput(fn)));   // moduleSDK.js
	return () => unsub();
}
```

A module calls this during `register()`, gets a function back and reasonably
assumes it is subscribed — but the actual `listeners.add(fn)` happens whenever
that import settles. Measured with a minimal probe module that registers BOTH an
`onInput` listener and a frame task polling `api.input()`, pressing a key at
increasing delays after install:

| key pressed | `api.input()` (frame task) | `api.onInput` |
|---|---|---|
| +0.5s | sees it | **0 calls** |
| +2.5s | sees it | fires |
| +7.5s | sees it | fires |

**Ask:** register synchronously — hold the listener in `moduleSDK` itself and
forward it once the runtime resolves (the same trick `inputRuntimeRef` already
uses for `api.input()`), so a subscription made in `register()` is live from the
first keypress. The returned unsubscribe should work before resolution too.

**Meanwhile:** modules here edge-detect toggle keys from `api.input()` inside a
frame task. That is documented in AUTHORING.md, but it is a trap: the naive code
looks correct and mostly works.
