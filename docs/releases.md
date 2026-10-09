# Manual npm releases

Issue #45 prepares the first release as **`@takahirox/three-mmd@0.1.0`**.
The GitHub repository remains `takahirox/three-mmd-loader`, and the examples
remain at https://takahirox.github.io/three-mmd-loader/. The package includes
loading, animation/physics, TSL materials, outlines and **VPD** export;
`MMDExporter` does not export PMD, PMX or VMD.

## Automated checks before merge

Use Node.js 20+ and install development dependencies with `npm ci`. Run:

```sh
npm run typecheck
npm test
npm run test:browser
MMD_EXAMPLE_FIXTURES=1 npm run build:examples
npm run test:examples
MMD_EXAMPLE_SITE=dist/examples npm run test:examples
npm pack --dry-run
npm publish --dry-run --access public
```

Browser tests require Chrome (`CHROME_BIN` overrides its path). WebGL2 is
mandatory; native WebGPU runs when an adapter is available. The example
fixture build uses generated assets without downloading licensed models.
**Do not deploy this fixture artifact as the public examples.** The Pages
workflow continues to build the original public assets independently.
The Tests workflow also checks the fixture site and npm dry-runs, without
uploading the fixture site or publishing to npm.

`prepack` builds runtime ES modules and declarations. `prepublishOnly` runs
`npm run typecheck` (which builds first) and `npm test` before npm can upload.
These offline Node checks include animation/physics, VPD round trips, examples,
and an isolated tarball-installed ESM/strict TypeScript consumer that imports
the package root and every supported `.js` subpath. Any failure stops publishing.
Browser checks are pre-merge gates and do not require Chrome on the release host.

The tarball test packs with `--ignore-scripts` to avoid lifecycle recursion and
disables inherited npm dry-run settings for its local pack/install operations.
It packs the installed Three.js and mmd-parser dependencies too, then installs
offline with an empty cache. It needs neither an unpublished npm package nor
a source alias. `npm publish --dry-run` runs the same prepublish checks without
uploading; it does not establish account or scope authorization. Do not disable
lifecycle scripts for a real release.

The npm file allowlist includes only runtime `dist/` modules/declarations,
`THIRD_PARTY_NOTICES.md`, and npm's automatic package manifest, README and LICENSE.
Package tests check every export target and reject unexpected tarball paths.
Examples/assets, screenshots, private/downloaded models and notices, local
viewers, scripts, fixtures, archives, credentials and CI artifacts are excluded.

## Maintainer prerequisites and publication

These are manual maintainer actions, separate from implementation/merge gates:

1. Confirm that the npm account owns the personal `@takahirox` scope, or has
   appropriate publishing permissions if that scope is managed by an organization.
   GitHub repository access does not grant npm scope access. Do not use another
   package name if authorization fails.
2. Log in to public npm with `npm login --registry=https://registry.npmjs.org/`
   and confirm the expected identity with
   `npm whoami --registry=https://registry.npmjs.org/`.
3. Satisfy npm's publishing authentication requirements: enabled account 2FA
   and its interactive challenge, or an unexpired granular access token with
   publishing permission and bypass 2FA where package policy permits it.
   Manage login, scope ownership, 2FA and tokens yourself; the agent does not
   provision them. Keep credentials outside this repository; no repository
   secrets or automated npm publishing workflow are needed. See npm's
   [scoped public publishing guide](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
   and [2FA documentation](https://docs.npmjs.com/about-two-factor-authentication/).
4. After merge, check out clean, updated `main`, install development dependencies
   with `npm ci`, and ensure the version has not already been published. Future
   releases update both package/lockfile versions before merging.

From that checkout, the release command is:

```sh
npm publish
```

`publishConfig` selects `https://registry.npmjs.org/` and public access, so no
extra access flag is required. The command builds and verifies the package
before uploading. This issue does **not** execute that release command.

## Registry checks and consumer installation

Query public npm explicitly, without relying on a custom registry or stale cache:

```sh
npm view @takahirox/three-mmd name version --registry=https://registry.npmjs.org/ --prefer-online
curl -sS -H 'Cache-Control: no-cache' -w '\nHTTP %{http_code}\n' 'https://registry.npmjs.org/@takahirox%2fthree-mmd'
```

A 404 means the public registry reports no visible release; it does not prove
name availability, scope ownership or publishing permission. A 401/403 is an
authentication/authorization error. DNS, connection and timeout failures leave
registry status unknown. If cached npm output disagrees, repeat against the
explicit public registry with a fresh temporary cache and compare the direct
HTTP response; do not interpret stale metadata as a release or a free name.

Only after the maintainer publishes can consumers use the registry command:

```sh
npm install @takahirox/three-mmd three@~0.186.0
```

Before publication, use `npm pack` and install the resulting local
`takahirox-three-mmd-0.1.0.tgz` in a consumer with `three@~0.186.0` (and matching
`@types/three@~0.186.0` for TypeScript). The automated tests perform the fully
offline version of this check. There are **no required post-merge checks** for
Issue #45; publication and any subsequent registry verification are separate
maintainer release operations.

## Issue #45 preparation evidence

Validated before commit on 2026-10-10 (JST), with Node.js 24.12.0 and npm 11.6.2:

| Check | Result |
| --- | --- |
| `npm ci`, build and strict `npm run typecheck` | Passed |
| `npm test` | 224 passed, no skips; includes isolated scoped ESM/TypeScript tarball consumers |
| `npm run test:browser` | 17 passed, no skips; WebGL2 and native WebGPU both exercised |
| Fixture build, local `test:examples`, built-site `test:examples` | Passed without fetching licensed assets; existing Pages prefix exercised |
| Two `npm pack --dry-run --json` runs | Identical integrity; scoped version 0.1.0, 40 files (18 JS, 18 declarations, four metadata/legal files) |
| `npm publish --dry-run --access public` | Passed; lifecycle ran type checks and all 224 Node tests, selected public npm/public access, uploaded nothing |
| Injected type-check and package-test failures | Each stopped the publish dry-run with exit 1 before publication; temporary edits restored |

The repeated pack SHA-1 was `98022e73b13a657a8dd8a4ab58c970baf792de97`.
Asset manifests, model/motion content, screenshots, fonts and the Pages
deployment workflow were unchanged. The generated fixture site was removed
after validation to prevent accidental deployment.

Direct public-registry requests with cache bypass and explicit-registry
`npm view --prefer-online` both returned **404**. `npm whoami` against public
npm returned **401 Unauthorized**. No DNS/network failure was observed; no
visible release was found, and scope/name ownership or publication permission
could not be verified. The maintainer must log in as the scope owner/authorized
publisher and satisfy npm's 2FA/token requirements before the separate manual
release. No package was published and no post-merge checks are required.
