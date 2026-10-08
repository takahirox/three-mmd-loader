# TypeScript migration (Issues #16, #18, and #20)

The maintained modules in `src/` use strict TypeScript. `npm run typecheck`
builds the package and examples first, then checks the package source, browser
examples, scripts, and tests using separate strict configurations. `npm run build` emits native ES
modules and declarations into `dist/`; Three.js remains an external peer.
Package exports expose the root and documented `.js` subpaths, with
`types` conditions pointing to the corresponding declarations.

Issue #20 replaces the former local parser with the external runtime dependency
`mmd-parser ^1.1.3`. MMDLoader imports `Parser`, and MMDExporter imports
`CharsetEncoder`, directly from the dependency. The loader and helper use its
public PMD/PMX/VMD/VPD result types. Local types now describe Three.js meshes,
geometry, IK, grants, and transformed physics parameters rather than duplicate
raw parser results. The parser subpath and root constructor re-exports have
been removed; consumers import parser APIs and raw data types from `mmd-parser`.

Browser examples keep their `/src/` URLs: the development server maps them to
compiled `dist/` modules, and the static build copies those modules to the
site's `src/` directory. Import maps resolve `mmd-parser` to the installed
`build/mmdparser.module.mjs` artifact, served locally and copied with its license
into the static site. No parser source is copied into the addon package.
Issue #18 also migrates examples, scripts, and tests to strict TypeScript. Browser modules compile into `dist/example-modules/`
and keep the same `.js` URLs in development and in the static site. Node 20+
runs repository scripts and tests with the pinned `tsx` loader. The Pages
setup and deployment jobs install development tooling before executing these scripts.
The npm file allowlist excludes the static example site from package tarballs.

Validation before merge:

- `npm run typecheck` checks all maintained implementations with `strict` and
  runs `check:typescript`. That check rejects repository JavaScript outside
  generated `dist/` output; it considers
  tracked files and new files, ignoring removed paths during migration.
- `npm test` builds the package, runs runtime and example-build checks, guards
  the required TypeScript sources, and installs a tarball into an isolated
  JavaScript/TypeScript consumer. The consumer imports every public subpath
  and verifies both valid calls and rejection of invalid calls.
- `npm run test:browser` builds and runs the shader and example-page checks
  against compiled modules in headless Chrome.
- `npm run build:examples` builds the package and the site with the actual
  example assets. This downloads the asset manifest's fixtures when needed.

Strict checking also exposed misspelled camera/audio cleanup calls and audio
elapsed-time state, and invalid accesses in the experimental shared-physics
path, plus a grant hierarchy lookup through the wrong object. Those accesses now use the helper's typed state and the physics methods
already present in the implementation.

No post-merge verification is required by Issues #16 and #20. When preparing
a PR, include the executed check results.

Issue #22 replaces the GLSL `MMDToonShader` export with `MMDToonMaterial`
(`materials/MMDToonMaterial.js`) and adds `MMDOutlineEffect`
(`effects/MMDOutlineEffect.js`). The material inherits Three.js Phong node
material properties; `MMDToonMaterialParameters` and `MMDOutlineParameters`
describe MMD additions. Use `WebGPURenderer` for WebGPU or its `forceWebGL`
backend for WebGL2. Browser import maps and static builds include
`three.webgpu.js` and `three.tsl.js`. See the README for rendering migration
and automated backend coverage.
