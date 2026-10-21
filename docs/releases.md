# Manual npm releases

The next release candidate is **`@takahirox/three-mmd@0.1.2`**, updating the
registry-confirmed published 0.1.1. See the
[0.1.2 release record](releases/0.1.2.md) for exact source, registry evidence,
changes, local validation and pending post-merge
checks. The GitHub repository remains `takahirox/three-mmd-loader`; examples
remain at https://takahirox.github.io/three-mmd-loader/.

## Package contract

The package includes PMD/PMX loading, VMD animation, IK, synchronous/Worker
physics, TSL materials, outlines and **VPD** export. `MMDExporter` does not
export PMD, PMX or VMD. Three.js **`~0.186.0`** is the sole peer dependency
(tested with 0.186.1); **`mmd-parser ^1.1.4`** is the sole mandatory runtime
dependency. No new mandatory Ammo dependency is introduced.

Use native ESM from the package root or any of the eight `.js` subpaths in
[README](../README.md). TypeScript uses the same imports;
install matching `@types/three@~0.186.0` in TypeScript applications. Consumers
initialize their own compatible Ammo and expose `globalThis.Ammo` before
synchronous physics; animation with `{ physics: false }` needs no Ammo.

The optional pinned runtime is included in
`node_modules/@takahirox/three-mmd/dist/vendor/bullet/`: `ammo.js`, `ammo.wasm`,
`manifest.json` and eight license files. Copy the whole directory into the
application's served assets. Load the classic `ammo.js`, await its factory
with `locateFile: path => new URL(path, ammoURL).href`, and assign the result
to `globalThis.Ammo`. The [README](../README.md) has complete initialization
and Worker examples. This repository-built Ammo-compatible distribution uses
unmodified official Bullet commit `d3afe76132fc76b0f9b2359cbaef47a3766e7fbb`
and Emscripten 4.0.10; it is not an official Ammo.js release. Artifact/recipe
hashes and licenses are verified by tests.

The classic Worker ships at `dist/animation/MMDPhysicsWorker.js`, resolved
relative to its runtime module. Preserve it when bundling, or use
`workerPhysics.createWorker` to serve that bundle explicitly. Pass the served
Ammo glue URL as `workerPhysics.ammoURL`; WASM resolves beside the glue. Keep
main-thread Ammo initialized for recovery. Serve WASM as `application/wasm`.
Shared memory is optional; non-isolated pages use transferables.

## Automated checks before merge

Use Node.js 20+ and run:

```sh
npm ci
npm run typecheck
npm test
npm run test:legacy
npm run test:browser
npm run build
MMD_EXAMPLE_FIXTURES=1 npm run build:examples
npm run test:examples
MMD_EXAMPLE_SITE=dist/examples MMD_EXAMPLE_FIXTURES=1 npm run test:examples
npm pack --dry-run --json
npm publish --dry-run --access public
git diff --check
```

Browser tests require Chrome (`CHROME_BIN` overrides its path). WebGL2 is
mandatory; native WebGPU runs when an adapter is available. The fixture build
uses generated assets without downloading licensed MMD models.
**Do not deploy the fixture artifact as public examples.** Remove the local
`dist/examples` fixture artifact after validation. The Pages workflow builds
and validates public assets independently. The Tests workflow checks fixtures
and npm dry-runs without uploading the fixture site or publishing to npm.

`prepack` builds runtime ESM, declarations, the classic Worker and pinned Bullet
assets. `prepublishOnly` runs `npm run typecheck` (which builds first) and
`npm test`. A failed build, type check or offline test aborts publication.
Browser checks are pre-merge gates; Chrome is not needed on the release host.
The npm scripts do not depend on interactive repository edits.

The offline package test packs without lifecycle recursion and installs the
local tarball and pinned dependency tarballs with an empty cache. It imports
the root and every documented subpath in JS and strict TypeScript. The browser
package test separately installs the tarball and initializes its real Ammo WASM
and classic Worker from installed files, with no source aliases. These internal
test pack/install calls suppress lifecycle scripts; the release command must
keep lifecycle scripts enabled. Never use `--force` or try to overwrite a
published version.

The npm file allowlist includes runtime `dist/` modules/declarations, pinned
Bullet glue/WASM/manifest/licenses, `THIRD_PARTY_NOTICES.md`, and npm's automatic
package manifest, README and LICENSE. Tests check export targets and reject
unexpected tarball paths. Examples, private/downloaded models, textures,
fixture assets, local viewers, scripts, archives, credentials and CI artifacts
are excluded. No npm token, secret or automatic npm publication workflow is
required. GitHub Pages deployment is separate from npm publication.

## Maintainer handoff

After merging the candidate, use a clean, updated `main` checkout with Node.js
20+ and development dependencies installed by `npm ci`. Record `git rev-parse
HEAD` as the final merge/source SHA and confirm the latest **attempt** of both
**Tests** and **Deploy browser examples** workflows for that SHA. See the
release record for required post-merge evidence; local results do not establish
merge-triggered CI or public deployment success.

External prerequisites belong to the maintainer: npm login, publishing rights
for the personal `@takahirox` scope, and npm 2FA/token authorization as required
by the account/package policy. GitHub access and a successful dry-run do not
establish npm authorization. The agent cannot authenticate for the maintainer
and does not create credentials. Keep credentials outside the repository.
See npm's [scoped publishing guide](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
and [2FA documentation](https://docs.npmjs.com/about-two-factor-authentication/).

Once repository readiness and these external prerequisites are satisfied, the
single final publication command from that checkout is:

```sh
npm publish
```

`publishConfig` selects `https://registry.npmjs.org/` and public access, so no
extra flag is required. The lifecycle builds and checks the package before
uploading. This task does **not** execute real publication. Rare severe PMD
physics instability is still under investigation; further visual approval or
a confirmed stability improvement is not a release-preparation gate.

## Registry verification

Before choosing any release version, query public npm online with cache bypass:

```sh
npm view @takahirox/three-mmd versions dist-tags --json --registry=https://registry.npmjs.org/ --prefer-online
curl -sS -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' -w '\nHTTP %{http_code}\n' "https://registry.npmjs.org/@takahirox%2fthree-mmd?release_check=$(date +%s)"
```

Select an unused semver version and update both `package.json` and the lockfile
(including its root package entry). A successful metadata response listing a
version establishes publication; package-level 404 means no visible package,
while version-level 404 means that version is absent. Neither proves scope
ownership or publication permission. A 401/403 is an authorization error;
DNS, connection and timeout errors leave status unknown. Retry inconsistent
cached metadata with a fresh temporary npm cache. The historical Issue #45
404 and the 0.1.1 candidate's old availability evidence are superseded by the
fresh 0.1.1 publication and 0.1.2 availability evidence in the current record.
If publication is delayed, recheck version availability before publishing.

Users can already install published 0.1.1 with `npm install
@takahirox/three-mmd three@~0.186.0`. To validate this candidate before it is
published, run `npm pack` and install local `takahirox-three-mmd-0.1.2.tgz` in
a consumer alongside the supported Three.js peer.

**Optional after the maintainer publishes:** query `npm view
@takahirox/three-mmd@0.1.2 version --registry=https://registry.npmjs.org/
--prefer-online` to confirm the new registry version. This post-publication
check and any release tag are outside this task's completion requirements.
