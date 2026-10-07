# smart-unwrap

**Smart unwrap (xatlas)**: an automatic UV unwrapper for the UV editor. Core's
Unwrap menu ships projections (box, planar, cylindrical, spherical). This module
adds **Smart (xatlas)**, which cuts the mesh into charts along creases and seams,
flattens each chart (planar, ortho or LSCM), and packs them into one atlas with
no overlap. Other tools call this "smart UV project" or "lightmap pack". Under
the hood it is [xatlas](https://github.com/jpcy/xatlas) compiled to WebAssembly.
The `.wasm` travels inside the zip, so it needs no network, no CDN and no CSP
change.

## Use it

1. Burger menu ▸ **Modules ▸ Install** (from zip: `npm run pack -- smart-unwrap`
   writes `smart-unwrap.zip`).
2. Select a mesh and open the **UV editor**.
3. **Unwrap ▾** ▸ **Smart (xatlas)**. With faces picked in Edit Mesh, only those
   faces are unwrapped and the rest of the mesh keeps its UVs. That part is core's
   scoped-unwrap path.

The first unwrap instantiates the wasm (about 177 kB) and later ones reuse it.
The result is committed by core (`uvEditor.unwrapObject`) as one undo entry and
replicated as a `meshgeo` snapshot. Peers **without** the module still get the
unwrapped mesh, because only the peer who presses the button runs xatlas.

If the menu was already open in a UV editor when you installed the module, close
and reopen the editor. The editor reads the backend list when it opens.

## Options

The UV editor calls the backend with `{margin: 0.02}`. A script can pass more
through `uvEditor.unwrapObject(uuid, 'mod-smart-unwrap-xatlas', options)`:

| option | default | meaning |
|---|---|---|
| `margin` | `0.01` | gap between charts as a fraction of the texture, the same meaning as for the built-in packer. It is converted to xatlas padding of `margin × resolution / 2` texels per chart. |
| `resolution` | `512` | the texture size the padding is computed for. Going higher is not reliably tighter: at 1024 the 216-tri sphere covered 46% of the square, against 49% at 512, and took about 10× longer. The 12k-tri sphere went from 50% to 54% coverage. |
| `padding` | (from `margin`) | xatlas padding in texels, which overrides `margin` |
| `chartOptions` | `{fixWinding: true}` | raw xatlas `ChartOptions` (`maxChartArea`, `maxCost`, `normalSeamWeight`, …), merged last |
| `packOptions` | see below | raw xatlas `PackOptions`, merged last |

The pack defaults are `bilinear: true`, `rotateCharts: false`, and `bruteForce`
for meshes of 4000 triangles or fewer.

**Why `rotateCharts` is off:** xatlas's packer turns a chart 90° by
*transposing* it (it swaps u and v), and a transpose is a mirror. With it on, a
216-triangle UV sphere came back with 2 of its 6 charts mirrored, so painted text
would read backwards on those faces. With it off and `fixWinding` on, every
triangle in the tests winds counter-clockwise (unmirrored for three's v-up UVs).
The cost is a slightly looser pack. `rotateChartsToAxis` is a true rotation and
stays on.

## Limits

- **Main thread.** A few hundred triangles take tens of ms. A 12k-triangle sphere
  takes about 1.5 s and a 9.6k-triangle torus knot about 1.5 s, and the UI waits
  for it. (These times are from node on a Steam Deck. A worker would keep the UI
  responsive and is a possible next step.)
- **One atlas, 0..1.** If xatlas spills into several atlases at the chosen
  resolution, the backend re-packs into one so that nothing overlaps once
  normalised.
- **Degenerate faces** (zero area or NaN) are ignored by xatlas. They get
  `[0,0]` UVs and ride one extra island, so every face is still accounted for.
- **Welding is exact.** Corners are joined only when their positions are
  bit-identical, which is true of every mesh the editor builds. A mesh whose
  "shared" vertices differ by float noise unwraps with more seams.
- **Failure** (missing asset or a wasm abort) shows a toast and returns
  nothing, so core commits nothing. The next unwrap starts a fresh runtime.

## Lifecycle

`api.registerUnwrapBackend` is journaled by the SDK (`sdk/backends.js`
`onDispose`). Unloading or live-updating the module removes **Smart (xatlas)**
from the menu with no code here. The module's own `api.onUnload` drops the
cached wasm runtime so its memory can be collected.

## Which wasm build, and why

**xatlas-wasm 0.1.3** (mode777, MIT declared in package.json; xatlas itself is
MIT, © Jonathan Young), not **watlas 1.0.1** (toji, MIT). The reasons:

- **Size.** The xatlas-wasm `.wasm` is 177 kB, a plain C API with 6 imports and
  no embind or C++ exceptions. watlas is 225 kB with 56 embind and exception
  imports.
- **Glue.** xatlas-wasm has a 39 kB release glue, and its emscripten
  `Module.instantiateWasm` hook takes our blob-URL bytes with no patching.
  watlas has an 87 kB ASSERTIONS build that *aborts* if `instantiateWasm` or
  `wasmBinary` is supplied, and it resolves `watlas.wasm` against
  `import.meta.url`, which is meaningless for a blob-URL module. It would need
  its minified glue patched.
- **Threads.** Both run single-threaded on the main thread (no pthreads or
  SharedArrayBuffer), and both expose the same xatlas API (positions + indices
  in, then per-vertex uv / xref / chartIndex and per-chart face lists out).
- **The cost.** xatlas-wasm is young (one maintainer, a few stars), and its repo
  has no LICENSE file of its own, only the MIT declaration. The text and
  attributions are in [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt),
  which ships in the zip.

### Refreshing the vendored build

`module.js` carries the xatlas-wasm glue between the `VENDORED` markers, and
`assets/xatlas.wasm` is the binary. Both come from the npm tarball through
`vendor.mjs`, which reads the package as **text** and never runs it:

```bash
mkdir /tmp/xw && cd /tmp/xw && npm pack xatlas-wasm@0.1.3 --ignore-scripts && tar xzf *.tgz
node modules/smart-unwrap/vendor.mjs /tmp/xw/package/dist/index.mjs
npm run test:smart-unwrap
```

## Tests

`npm run test:smart-unwrap` runs in node with no app. It loads the real
`module.js` and the real `assets/xatlas.wasm` through a fake `api` whose
`assetUrl` returns blob URLs, as the app does. It then unwraps a cube (12 tris),
a UV sphere (216), a cylinder (240), a scoped half-sphere and a 12k-tri sphere.
It checks properties rather than exact numbers:

- 3 corners per face, every uv in [0,1], no zero-area uv triangle and a total
  area of at most 1
- the islands partition the faces, and no two islands overlap on a 512² raster
- every triangle is counter-clockwise, and the cube has 6 or fewer islands

Counterfactuals show that each check catches a broken result: stacked islands,
a duplicated island, collapsed UVs, shifted UVs, a dropped face, unwelded input
and xatlas's mirroring `rotateCharts`. The suite also covers the lazy and
cached instantiation, the unload hook and the failure path.
