# SDK gaps found while writing these modules

Requests **from** module authors **to** the core module SDK
(`theprototype-app/core`, `src/lib/moduleSDK.js`). Each one was hit while
building a module in this repo, verified against the SDK surface as it actually
is, and worked around rather than patched around — a module never reaches into
core internals, because an installed module has no imports and core-only
privileges are exactly what makes an example useless as an example.

Feeds roadmap **17-A1** (SDK gaps). Status is what the *modules* need, not a
promise from core.
<!-- intro-end -->

## Filing a request (one file each — core roadmap 34, R4 A4)

1. Copy a request file to `devx/<slug>.md` — `<slug>` = a few kebab-case words naming the gap.
2. Front matter, then the body (**Found in:** · what breaks · **Ask:** · **Meanwhile:** — the
   shape every request here has):

   ```
   ---
   number: null
   title: "No way to …"
   status: open
   blocks: "`your-module`"
   workaround: "yes — what the module does instead"
   filed: "2026-10-02"
   ---
   ```

   `number: null` — **never pick a number yourself.** Two lanes picking "the next one" is how the
   old single file ended up with three #26s; the integrator numbers new requests at merge.
3. `node scripts/devx.cjs` validates every file (that is all a lane runs). A follow-up on an existing
   request ("felt again in round N") goes in its file, or as a note under `devx/log/`.

**At merge (the integrator):** `node scripts/devx.cjs --assign` numbers the new files (the next free
numbers, oldest `filed` first) and regenerates `devx/index.json` and the `DEVX-REQUESTS.md` index.
Nobody edits those two by hand.

Numbers are the summary table's: a lane's own section headers had drifted from it (three were
"#26"), so each file carries the table's number. `aliases` lists a number older text used — #42
was filed as #23, a number roadmap 30 also gave "no play-mode MENU surface".
