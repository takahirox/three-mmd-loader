# @takahirox/three-mmd

Standalone MMD addons restored from Three.js r171, after the MMD modules were
removed from the official addons in r172. Loads PMD/PMX models, VMD animation,
and VPD poses, with animation, IK, physics, toon shading, and VPD export.

The package targets **Three.js r186** (`three ~0.186.0`) and is tested with
`three 0.186.1`. Three.js is a peer dependency: the addons use the application's
Three.js instance, including its retained TGALoader and SkeletonUtils addons.
`mmd-parser ^1.1.4` is an external runtime dependency installed automatically
with this package; its implementation and public types come from that package.

After the maintainer publishes the first release, install the package alongside
the supported Three.js version:

```sh
npm install @takahirox/three-mmd three@~0.186.0
```

Use native ES module imports, either from the package root or from addon-style
subpaths:

```js
import { MMDLoader, MMDAnimationHelper, MMDOutlineEffect } from '@takahirox/three-mmd';
import { WebGPURenderer } from 'three/webgpu';

// Equivalent individual imports:
// import { MMDLoader } from '@takahirox/three-mmd/loaders/MMDLoader.js';
// import { MMDAnimationHelper } from '@takahirox/three-mmd/animation/MMDAnimationHelper.js';

const loader = new MMDLoader();
const mesh = await loader.loadAsync( 'model.pmx' );
const helper = new MMDAnimationHelper();
helper.add( mesh, { physics: false } );

const renderer = new WebGPURenderer( { antialias: true } );
await renderer.init(); // WebGPU, with Three.js WebGL2 fallback when unavailable
const outlines = new MMDOutlineEffect( renderer );

// Add mesh to your scene, call helper.update(deltaSeconds), then:
// outlines.render(scene, camera);
```

The public subpaths are:

| Subpath (after `@takahirox/three-mmd/`) | Named exports |
| --- | --- |
| `loaders/MMDLoader.js` | `MMDLoader` |
| `animation/MMDAnimationHelper.js` | `MMDAnimationHelper` |
| `animation/CCDIKSolver.js` | `CCDIKSolver`, `CCDIKHelper` |
| `animation/MMDPhysics.js` | `MMDPhysics` |
| `exporters/MMDExporter.js` | `MMDExporter` |
| `materials/MMDToonMaterial.js` | `MMDToonMaterial` |
| `effects/MMDOutlineEffect.js` | `MMDOutlineEffect` |
| `materials/MMDUV.js` | `mmdAdditionalUV` |

All named exports are also available from `@takahirox/three-mmd`. The APIs follow
the r171 addons except for the migrated rendering path described below. For parser APIs and raw model/motion/pose types, import
directly from `mmd-parser`:

```js
import { Parser, CharsetEncoder } from 'mmd-parser';
```

The internal `libs/mmdparser.module.js` subpath and package-root
`MMDParser`, `Parser`, and `CharsetEncoder` exports have been removed.
`MMDExporter` exports VPD poses, not PMD/PMX models or VMD animations.

Synchronous physics requires an initialized [Ammo.js](https://github.com/kripken/ammo.js)
runtime exposed as `globalThis.Ammo` before creating `MMDPhysics` or adding a
mesh with physics enabled (the helper's default). Ammo is supplied by the
application. The Examples and primary regression tests use the Ammo-compatible
WASM build of official Bullet commit
`d3afe76132fc76b0f9b2359cbaef47a3766e7fbb` by default.
The npm package includes the same optional runtime, manifest and licenses in
`dist/vendor/bullet/`. Copy that entire directory from the installed package
(`node_modules/@takahirox/three-mmd/dist/vendor/bullet/`) to your served
`vendor/bullet/` directory, then load its classic script:

```html
<script src="./vendor/bullet/ammo.js"></script>
```

```js
// Await initialization before creating physics.
const ammoURL = new URL( './vendor/bullet/ammo.js', document.baseURI );
globalThis.Ammo = await globalThis.Ammo( {
  locateFile: path => new URL( path, ammoURL ).href
} );
helper.add( anotherMesh );
```

The library continues to accept your own compatible Ammo.js build, including
`ammojs-typed` and asm.js; it does not select or download a backend.
WebAssembly requires browser support and a separately served binary; use
`application/wasm`, preferably on the same origin. Handle setup errors in your
application. The Examples enforce a 10-second initialization deadline, verify
the instantiated WASM exports and pinned source identity, and stop on failure.
Worker recovery uses the initialized main-thread engine. There is no automatic
fallback to the old Bullet build.

Normal Examples need no Bullet query parameter. `?bullet=legacy` explicitly
rolls back to `ammojs-typed@1.1.0` WASM for diagnostics; `?bullet=master` and
`?bullet=default` are aliases for the new default. There is no engine selector.
See [default runtime verification and rollback](docs/bullet-default.md) and
[build provenance and historical comparison](docs/bullet-experiment.md).
This switch does not establish a fix for intermittent 120 FPS instability.
Pass `{ physics: false }` when
adding a mesh to use animation without Ammo. Model texture decoding and
rendering require a browser environment. The `mmd-parser` dependency
supports PMX UTF-16LE text and SDEF skinning type `3` with right-handed
center vectors. Version **1.1.3** is the minimum parser version for SDEF.
PMX SDEF uses quaternion skinning on both TSL backends, including vertex
morphs, normals, outlines and shadows. See [SDEF and private model viewing](docs/sdef.md)
for the algorithm, tests and optional local YYB Miku workflow.

Direct PMX type 2 bone morphs use `mmd-parser 1.1.4` or newer. The animation
helper applies their existing `morphTargetInfluences` weights after VMD tracks
and before IK, grants and physics, including static and paused updates.
`helper.enable('boneMorph', false)` disables bone offsets. See
[bone morph playback and private model inspection](docs/bone-morphs.md) for
composition, pose/seek behavior, supported scope and local viewer controls.

MMD rendering uses **TSL / NodeMaterial**. `MMDToonMaterial` extends Three.js
`MeshPhongNodeMaterial`, with [dedicated MMD ambient and color composition](docs/material-shading.md),
toon direct irradiance, separate Phong specular and MMD
sphere mapping (`matcap` plus `matcapCombine`: `MultiplyOperation` for `.sph`,
`AddOperation` for `.spa`). PMX [SubTexture mode 3](docs/subtexture.md) uses
`matcapMode: 'subtexture'` to multiply RGBA at morphed additional UV1 XY before
specular lighting. Standard color/opacity, diffuse and alpha textures,
user emissive, normal/bump/displacement maps, sidedness and transparency use Three's
node material facilities. `diffuse` remains an alias for `color`. Set
`material.needsUpdate = true` after changing texture presence or sphere blend
mode, as with other Three.js material shader configuration changes.

Use `WebGPURenderer` from `three/webgpu`; `{ forceWebGL: true }` selects the
WebGL2 TSL backend explicitly. Both backends use the same MMD material and
outline implementation. The legacy GLSL `MMDToonShader` export/subpath and
WebGL-only `OutlineEffect` integration have been removed.

`MMDOutlineEffect` wraps `renderer.render(scene, camera)` with an inverted,
expanded `BackSide` hull, adapted from Three.js r186 `ToonOutlinePassNode`.
`effect.enabled` toggles outlines globally; `effect.dispose()` releases its
cached materials (also released when source materials are disposed).
Per-material `userData.outlineParameters` retains `visible`, `thickness`,
`color` (RGB array), and `alpha`. PMD edge flags and PMX edge size/color/alpha
remain independent across material groups. The `mmdEdgeRatio` geometry
attribute includes PMX per-vertex `edgeRatio` and PMD per-vertex edge disable
flags, multiplying extrusion thickness. Outlines use the same mesh and Three's
morphing/skinning/displacement setup as the surface, so animation requires no
separate outline mesh or skeleton synchronization.

PMX [material morphs](docs/material-morphs.md) update surfaces, sampler colors,
alpha and outlines through TSL uniforms. The helper evaluates direct and group
weights from immutable PMX bases; `helper.enable('materialMorph', false)` restores
those bases. Static sliders use `helper.update(0)`.

PMX [group morphs](docs/group-morphs.md) support direct vertex, bone, UV and material targets,
including VMD playback and a private local inspection viewer.

PMX [UV and additional UV morphs](docs/uv-morphs.md) support direct/group weights, VMD playback and TSL vec4 channel access.

Development and validation:

```sh
npm ci
npm run typecheck
npm test
npm run test:browser
npm pack
```

Try the [public browser examples](https://takahirox.github.io/three-mmd-loader/).
They are built from this repository and automatically deployed after updates
to `main`. See the [examples guide](examples/README.md#deployment) for the
workflow and one-time GitHub Pages setup.

Run the [browser examples](examples/README.md) locally:

```sh
npm run examples:assets
npm run dev
```

Open http://127.0.0.1:8080/ for model animation with IK/physics, synchronized
audio/camera animation, and VPD poses. MMD modules come from this checkout.
The asset setup downloads the former r171 example assets and their notices
for the examples; these assets have separate terms and are excluded from Git
and the npm package. The deployed site includes the assets and their notices.
See the examples guide for credits, manual setup, and checks.

The published artifact contains compiled native ES modules and TypeScript
declarations; consumers need no build step. Maintained sources are TypeScript
and `npm run build` emits JavaScript and declarations into `dist/`. `npm test`
and the browser/example commands build the package first; `npm pack` builds it
through `prepack`. Manual `npm publish` also runs strict type checks and the
offline Node/package regression tests before uploading. See the
[release guide](docs/releases.md) for maintainer prerequisites and dry-runs.
Before publication, validate consumers with a local packed tarball rather than
installing an unpublished registry package. TypeScript consumers should install matching Three.js types
with `npm install --save-dev @types/three@~0.186.0`. Root and documented `.js`
subpath imports resolve to the same API in both JavaScript and TypeScript.

The loader and animation helper use public result types from `mmd-parser`;
Three.js geometry, IK, and other transformed data keep their local types. See
the [migration notes](docs/typescript-migration.md). Tests check all public
imports, parse generated PMD/PMX/VMD assets,
exercise animation, IK, VPD round trips, node material properties and edge ratios, and real
Ammo physics. They also pack the package, install the tarball in an isolated
consumer, and import every public module without access to the repository's
source files. The isolated consumer also type-checks every public subpath,
including checks that invalid API calls are rejected. Examples, scripts, and tests
also use strict TypeScript. `npm run check:typescript` rejects JavaScript
sources outside generated `dist/` output. Node.js 20 or newer runs
the repository scripts and tests through `tsx`.

The separate browser regression suite requires Google Chrome. Set `CHROME_BIN`
to its executable if it is not installed at the default location (on Linux,
the default command is `google-chrome`). It uses headless Chrome with software
WebGL2 through `WebGPURenderer({ forceWebGL: true })` to test actual rendered
pixels for toon gradients, diffuse textures, Phong specular, emissive, alpha,
sidedness and additive/multiplicative sphere mapping. It verifies per-material
outline visibility/thickness/color/alpha, per-vertex edge ratios and combined
skinning/morphing. Generated textures and PMD/PMX models keep these checks
independent of external assets and image decoding. When Chrome supplies a
WebGPU adapter, the same assertions run on native WebGPU; otherwise the suite
reports that capability-gated rendering was skipped.
It also validates the actual example pages using generated MMD/audio fixtures,
including rendering, animation, controls, audio playback, and VPD poses.

Source provenance and licenses are recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [LICENSE](LICENSE).

See the [development flow](docs/development-flow.md) and [review guidelines](docs/review-guidelines.md) for contribution guidance.

PMX rotation/translation grants, including local grants and physics phase
ordering and layered authored/body/post-physics composition, are documented in
[docs/grants.md](docs/grants.md), with generated
fixture tests and a private loopback inspector.

The loopback-only `npm run dev:sdef` viewer also provides **Generated Physics
layers fixture** and a private `physics-layers/` source. It runs real Ammo with
step/pause/reset controls and reports authored, pre-physics, body and final
transforms. Post kinematic inputs are explicitly deferred to the next step;
dynamic post effects deform the skeleton without teleporting mode-1 bodies.
Private models remain optional, ignored and excluded from published artifacts.

Physics forwards positive elapsed seconds to Bullet, which accumulates short
frames using the default `1/60` fixed step. Zero, negative and non-finite deltas
do not advance Bullet. See the [timekeeping experiment and validation](docs/physics-timestep-validation.md)
for the removed legacy minimum and its possible effect on motion/settling.

PMD and PMX rigid bodies enable Bullet's additional damping during construction
in sync, shared sync and Worker physics. Model-defined linear/angular damping
is retained, and Bullet's additional factors and thresholds stay at their
defaults. This experiment targets low-speed jitter; it does not establish a fix
for violent instability or exact native MikuMikuDance behavior. See the
[additional damping validation](docs/physics-damping-validation.md).

Joint-connected bodies can collide when both model collision masks permit it.
This differs from legacy Three.js and can increase vibration when overlapping
bodies' contact separation competes with joint limits. See the
[linked-body collision experiment and validation](docs/physics-linked-collision-validation.md).

Joint frames and rigid-body offsets compose parsed right-handed Euler angles
in YXZ order in Sync and Worker physics. The joint convention is a reversible
compatibility experiment; exact native MMD parity and improved long-running
stability remain unproven. See the
[joint-frame rationale and validation](docs/physics-joint-rotation-validation.md).

Opt-in real-model setup: `npm run models:setup -- gene`, then `npm run dev:sdef`
and choose Gene in **Installed models**. Safe manual acquisition import:
`npm run models:import -- /path/to/model.zip --category sdef`. See
[local model setup, source terms and diagnostics](docs/local-models.md).


### Optional worker physics

Omitting `physicsMode`, or selecting `'sync'`, preserves current-frame physics
and standalone `MMDPhysics` behavior. Select `'worker'` at setup to run Ammo in
a classic Worker and display the latest completed result:

```ts
// Keep main-thread Ammo initialized (as above) to allow automatic sync fallback.
helper.add( mesh, {
  animation,
  physics: true,
  physicsMode: 'worker',
  workerPhysics: {
    ammoURL: new URL( './vendor/bullet/ammo.js', document.baseURI ).href,
    onFallback: reason => console.warn( reason )
  }
} );
const physics = helper.objects.get( mesh )!.physics!;
await physics.ready; // optional setup-time readiness; never await per frame
helper.update( delta );
```

`ammoURL` must serve a compatible **classic** Ammo script exposing an `Ammo`
factory or initialized API. Each Worker initializes its own Ammo. For the pinned
WASM build, copy the complete `dist/vendor/bullet/` directory, keeping
`ammo.js` and `ammo.wasm` together with their manifest and licenses. The Worker
resolves factory `locateFile` paths relative to `ammoURL`, independent of the page and Worker bundle directories.
Keep a compatible initialized main-thread runtime available for sync fallback.
The packaged
`animation/MMDPhysicsWorker.js` bundles its dependencies and needs no import
map. Bundlers/deployments must preserve this asset beside `MMDPhysics.js`; use
`workerPhysics.createWorker: () => new Worker( yourWorkerURL )` to override its
location or satisfy CSP. Allow the Worker URL in `worker-src`, the classic Ammo
glue in `script-src`, and the binary in `connect-src`; restrictive policies may
also need `script-src 'wasm-unsafe-eval'` for WASM compilation. Use same-origin
URLs and serve over HTTP(S), not `file:`. COOP/COEP is only needed for SAB, not
for WebAssembly or transferable mode.
Standalone construction accepts these same options as its fourth argument.
Mode selection is fixed at setup; dispose/recreate to change it.

Transport is automatic: SharedArrayBuffer with atomic publication when runtime
capability and cross-origin isolation are available, otherwise reusable
transferable ArrayBuffers. COOP/COEP headers are optional. There is one request
in flight per world. Main-thread frames never wait, spin or call `Atomics.wait`.
While busy, the rendered pose reuses the last complete result; unsent skeletal
poses are skipped and elapsed time is coalesced up to 0.25 seconds. Bullet's
`maxStepNum` (default **10**, overridable through `helper.add(mesh, { maxStepNum })`)
still limits catch-up at main's `unitStep = 1/60` seconds. A 100ms update
can integrate about six substeps instead of the previous cap of three,
increasing CPU work on slow frames. Longer stalls, including a full 0.25s
Worker batch, can still discard simulation time. Substeps use the supplied
kinematic pose; they do not reconstruct intermediate animation poses. This is
a bounded timekeeping experiment, not a demonstrated cure for physics
oscillation or proof of native MMD parity. See the
[validation record](docs/physics-substeps-validation.md). About one frame of visual latency
is typical, but a busy Worker can take longer.

Raw results are projected between the existing before/after-physics phases.
PMX post IK/grants and dynamic-parent reprojection remain on the main thread.
The Worker aligns mode-2 body positions immediately after its own step, before
accepting the next input. Post-phase kinematic inputs use the preceding
**displayed** final pose. Under delay, this pose differs from the current-frame
sync pose; animation-driven contacts can therefore differ. For identical
sequenced inputs, both backends use the same Bullet/body rules. This is an
intentional responsiveness/visual-latency tradeoff, not a strict sync replay.

`ready` resolves after model initialization or fallback; async `warmup(cycles)`
settles one frame per completion at fixed animation time through both pose
phases. `workerStatus` reports initialization, remaining warmup cycles,
in-flight work and the last completed sequence. `physicsMode` and `transport`
report the actual backend and transport. Zero-time PMX updates only reproject;
PMD retains its existing minimum-step behavior. Gravity changes are ordered in
the Worker. Helper enable/disable suspends submissions/warmup and invalidates
pending results. Reset captures the pre-physics pose and invalidates previous
results; loop resets use the same path. Removal releases that model's Ammo
resources and preserves other shared participants. Disposing the last model
terminates the Worker and releases communication resources.

Set `helper.sharedPhysics = true` **before** adding models and select `'worker'`
for every participating model. They share one Worker, world, step and coherent
result packet. An existing Ammo `world` cannot be passed into worker mode.
`world`, `bodies` and `constraints` expose native objects only in sync mode;
worker mode exposes snapshots in `bodyResults` and supports `createHelper()`.

Unsupported environments, missing configuration, initialization/runtime errors
and watchdog timeouts (default 10 seconds; `workerPhysics.timeout` overrides it)
warn, call `onFallback`, terminate the Worker and rebuild the whole shared world
synchronously with cleared velocities. Keep main-thread Ammo initialized for
this fallback. If it is absent, `initializationError` explains why physics is
frozen; `ready` still settles so an application can report the error. The
Worker needs no main-thread Ammo when it operates successfully.

Open the dedicated [Worker Physics example](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd_worker.html)
from the gallery, or run `npm run examples:assets` then `npm run dev` locally.
Its entry point requests Worker mode; [Model and animation](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd.html)
requests sync. Choose the example from the gallery to select the execution mode;
both share the same scene and controls. See the
[comparison and fallback guide](examples/README.md#worker-physics-and-comparison).
Each page's initial mode is fixed; `?physicsMode=...` does not override it.
Their status shows the actual backend/transport, any Worker fallback diagnostic,
and mean main-thread helper-update time. Compare the same scene and device after
warmup; this measures helper CPU
time, not universal FPS improvement or end-to-end latency. No isolation headers
are needed for this demonstration. Browser tests additionally serve an isolated
origin to exercise SAB when supported.
