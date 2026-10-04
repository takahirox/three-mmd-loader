# three-mmd-loader

Standalone MMD addons restored from Three.js r171, after the MMD modules were
removed from the official addons in r172. Loads PMD/PMX models, VMD animation,
and VPD poses, with animation, IK, physics, toon shading, and VPD export.

The package targets **Three.js r186** (`three ~0.186.0`) and is tested with
`three 0.186.1`. Three.js is a peer dependency: the addons use the application's
Three.js instance, including its retained TGALoader and SkeletonUtils addons.

Install the package alongside the supported Three.js version:

```sh
npm install three-mmd-loader three@~0.186.0
```

Use native ES module imports, either from the package root or from addon-style
subpaths:

```js
import { MMDLoader, MMDAnimationHelper } from 'three-mmd-loader';

// Equivalent individual imports:
// import { MMDLoader } from 'three-mmd-loader/loaders/MMDLoader.js';
// import { MMDAnimationHelper } from 'three-mmd-loader/animation/MMDAnimationHelper.js';

const loader = new MMDLoader();
const mesh = await loader.loadAsync( 'model.pmx' );
const helper = new MMDAnimationHelper();
helper.add( mesh, { physics: false } );

// Add mesh to your Three.js scene and call helper.update(deltaSeconds) each frame.
```

The public subpaths are:

| Subpath (after `three-mmd-loader/`) | Named exports |
| --- | --- |
| `loaders/MMDLoader.js` | `MMDLoader` |
| `animation/MMDAnimationHelper.js` | `MMDAnimationHelper` |
| `animation/CCDIKSolver.js` | `CCDIKSolver`, `CCDIKHelper` |
| `animation/MMDPhysics.js` | `MMDPhysics` |
| `exporters/MMDExporter.js` | `MMDExporter` |
| `libs/mmdparser.module.js` | `MMDParser`, `Parser`, `CharsetEncoder` |
| `shaders/MMDToonShader.js` | `MMDToonShader` |

All named exports are also available from `three-mmd-loader`. The APIs follow
the r171 addons; `MMDParser` exposes `Parser` and `CharsetEncoder` constructors.
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
rendering require a browser environment. The restored parser retains the r171
PMX UTF-16LE text support and limitations such as SDEF being treated as BDEF2.

For outlines, use `OutlineEffect` from `three/addons/effects/OutlineEffect.js`;
the loader sets the material's `userData.outlineParameters` as in r171.

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

The vendored parser remains JavaScript with a typed boundary; see the
[migration notes](docs/typescript-migration.md) for the rationale. Tests check all public imports, parse generated PMD/PMX/VMD assets,
exercise animation, IK, VPD round trips, shader chunk compatibility, and real
Ammo physics. They also pack the package, install the tarball in an isolated
consumer, and import every public module without access to the repository's
source files. The isolated consumer also type-checks every public subpath,
including checks that invalid API calls are rejected. Examples, scripts, and tests
also use strict TypeScript. The vendored parser is the sole JavaScript source
exception, enforced by `npm run check:typescript`. Node.js 20 or newer runs
the repository scripts and tests through `tsx`.

The separate browser regression suite requires Google Chrome. Set `CHROME_BIN`
to its executable if it is not installed at the default location (on Linux,
the default command is `google-chrome`). It uses headless Chrome with software
WebGL to compile, link, and render toon, textured, and additive/multiplicative
matcap materials for generated PMD/PMX models without morph targets. Generated
textures keep this check independent of external assets and image decoding.
It also validates the actual example pages using generated MMD/audio fixtures,
including rendering, animation, controls, audio playback, and VPD poses.

Source provenance and licenses are recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [LICENSE](LICENSE).

See the [development flow](docs/development-flow.md) and [review guidelines](docs/review-guidelines.md) for contribution guidance.
