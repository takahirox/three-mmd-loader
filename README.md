# three-mmd-loader

Standalone MMD addons restored from Three.js r171, after the MMD modules were
removed from the official addons in r172. Loads PMD/PMX models, VMD animation,
and VPD poses, with animation, IK, physics, toon shading, and VPD export.

The package targets **Three.js r186** (`three ~0.186.0`) and is tested with
`three 0.186.1`. Three.js is a peer dependency: the addons use the application's
Three.js instance, including its retained TGALoader and SkeletonUtils addons.
`mmd-parser ^1.1.4` is an external runtime dependency installed automatically
with this package; its implementation and public types come from that package.

Install the package alongside the supported Three.js version:

```sh
npm install three-mmd-loader three@~0.186.0
```

Use native ES module imports, either from the package root or from addon-style
subpaths:

```js
import { MMDLoader, MMDAnimationHelper, MMDOutlineEffect } from 'three-mmd-loader';
import { WebGPURenderer } from 'three/webgpu';

// Equivalent individual imports:
// import { MMDLoader } from 'three-mmd-loader/loaders/MMDLoader.js';
// import { MMDAnimationHelper } from 'three-mmd-loader/animation/MMDAnimationHelper.js';

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

| Subpath (after `three-mmd-loader/`) | Named exports |
| --- | --- |
| `loaders/MMDLoader.js` | `MMDLoader` |
| `animation/MMDAnimationHelper.js` | `MMDAnimationHelper` |
| `animation/CCDIKSolver.js` | `CCDIKSolver`, `CCDIKHelper` |
| `animation/MMDPhysics.js` | `MMDPhysics` |
| `exporters/MMDExporter.js` | `MMDExporter` |
| `materials/MMDToonMaterial.js` | `MMDToonMaterial` |
| `effects/MMDOutlineEffect.js` | `MMDOutlineEffect` |

All named exports are also available from `three-mmd-loader`. The APIs follow
the r171 addons except for the migrated rendering path described below. For parser APIs and raw model/motion/pose types, import
directly from `mmd-parser`:

```js
import { Parser, CharsetEncoder } from 'mmd-parser';
```

The old `three-mmd-loader/libs/mmdparser.module.js` subpath and package-root
`MMDParser`, `Parser`, and `CharsetEncoder` exports have been removed.
`MMDExporter` exports VPD poses, not PMD/PMX models or VMD animations.

Physics requires an initialized [Ammo.js](https://github.com/kripken/ammo.js)
runtime exposed as `globalThis.Ammo` before creating `MMDPhysics` or adding a
mesh with physics enabled (the helper's default). Ammo is supplied by the
application and is not bundled with this package. For example, using the
`ammojs-typed` distribution used by the tests:

```js
import AmmoFactory from 'ammojs-typed';

globalThis.Ammo = await AmmoFactory();
helper.add( anotherMesh );
```

Install that optional distribution separately (`npm install ammojs-typed`), or
initialize your own compatible Ammo.js build. Pass `{ physics: false }` when
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
`MeshPhongNodeMaterial`, with toon direct irradiance, Phong specular and MMD
sphere mapping (`matcap` plus `matcapCombine`: `MultiplyOperation` for `.sph`,
`AddOperation` for `.spa`). Standard color/opacity, diffuse and alpha textures,
emissive, normal/bump/displacement maps, sidedness and transparency use Three's
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

PMX [group morphs](docs/group-morphs.md) support direct vertex and bone targets,
including VMD playback and a private local inspection viewer.

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
through `prepack`. TypeScript consumers should install matching Three.js types
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
