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
npm test
npm pack
```

The published artifact consists of native ES modules and requires no build
step. Tests check all public imports, parse generated PMD/PMX/VMD assets,
exercise animation, IK, VPD round trips, shader chunk compatibility, and real
Ammo physics. They also pack the package, install the tarball in an isolated
consumer, and import every public module without access to the repository's
source files. Node.js 20 or newer is needed to run the tests. Browser rendering
and image decoding are not exercised by these Node.js tests.

Source provenance and licenses are recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [LICENSE](LICENSE).

See the [development flow](docs/development-flow.md) and [review guidelines](docs/review-guidelines.md) for contribution guidance.
