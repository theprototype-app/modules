# Test-flights

Every module here ships a Playwright script that installs its **real zip through
the real Modules manager** and then drives the app. Nothing about the install is
stubbed — if the zip layout is wrong or the entry file has an import, the flight
fails exactly where a user would.

```bash
npm install
npx playwright install chromium          # once
npm run pack -- --all                     # flights install from <id>.zip
APP_URL=https://localhost:5188/ npm test          # every flight
APP_URL=https://localhost:5188/ npm test -- door  # one
```

`APP_URL` is any running instance: a core dev server, a lane worktree, or the
deployed site. Flights run **sequentially** — they share the app and the
signaling server.

## How a flight is written

Plain node scripts, no test framework, same shape as the core repo's
`tests/e2e`. `helpers.cjs` gives you:

| Helper | What it does |
|---|---|
| `launch()` / `setupPage(browser, 'A')` | headless Chromium + a page with the `window.__stores` debug hook on, waited through hydration |
| `installModule(peer, 'door-keypad')` | the real manager install (add a third arg when the zip name and module id differ) |
| `connect(A, B)` | dial + approve, then let the mesh settle |
| `sceneCommand(page, '/create Box')` | run a scene command the way the UI does |
| `objectNames(page)` / `projectPoint(page, [x,y,z])` | read the replicated scene / find a world point's pixel |
| `check(ok, label)` / `eventually(fn, pred, label)` | the assertions; `finish(browser)` sets the exit code |

The debug hook (`localStorage.debugStores = 'true'`) publishes the app's
singletons on `window.__stores` — `moduleSDK`, `objectsGroup`, `peers`,
`toastStore`, `commandsHandler` and the rest. That is how a flight reaches a
module's registries without the module exporting anything.

## Two peers, always

A module is only tested when two connected peers agree. Install on **both**
(modules do not travel over the wire), connect them, act on A and assert on B.
Then bring up a third peer *after* the fact to prove `registerStateSync`.

## Gotchas

- **Install on every peer.** Forgetting is the most common false failure: peer B
  simply drops messages for a module it does not have.
- **Modules ▸ Core/User are `role="tab"`, not buttons.** Use `openModules(page)`.
  (Core's own `user-modules` suite still asks for a `button` and times out.)
- **A lane on `localhost` needs a signaling server.** The app treats any host
  that is not `*.app`/`*.io` as local dev and points PeerJS at `:9001`;
  `helpers.cjs` seeds `peerServerConfig` with the hosted box instead. Override
  with `PEER_CONFIG` if you run your own.
- **Never write a store from inside its own subscriber**, including inside a
  `page.evaluate`. `objectsGroup.subscribe(g => { …; objectsGroup.update(v => v) })`
  re-enters svelte's flush and corrupts its queues — the page then throws
  `RangeError: Invalid array length` from *unrelated* stores (annotations,
  locks) and the flight fails somewhere that looks nothing like the cause. Read
  the ref out first (`subscribe(v => (ref = v))()`), then mutate.
- **Let the dev server settle after editing app code.** A page loaded while vite
  is still re-transforming sees half-mounted components, and the flight lies.
- **Synthetic DOM events need `bubbles: true`** to reach Svelte's delegated
  handlers. Real `page.mouse` clicks are always safer.
- **Clicks in the viewport need the object on screen.** For interaction logic,
  calling `moduleSDK.moduleClickHandlers` with the mesh is the same dispatch the
  viewport uses; use real pointer clicks when the picking itself is the subject.
