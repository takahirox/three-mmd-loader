# Texture resource path validation — Issue #106

Validated locally on 2026-10-31 in the assigned worktree, based on code baseline
5ae203246ccffd86a3e8fb7be0e34b9559c33a46 (the upstream readiness checkpoints
contain no loader changes). The downstream candidate patch at
[3bf1b9d](https://github.com/takahirox/mmd-gltf/blob/3bf1b9d30036e5d0519fa2b43e3ffbfa797052af/patches/three-mmd-loader-resource-path.patch)
was reviewed and adapted. This record describes the current implementation's
checks, independently of the downstream patch's earlier results.

Environment: macOS arm64, Node.js 26.12.1, npm 11.20.0, Google Chrome
156.0.8078.74. Dependency installation with npm ci succeeded (18 packages,
zero audit vulnerabilities).

## Commands and outcomes

| Command | Outcome | Seconds |
| --- | --- | ---: |
| `npm run typecheck` | Passed, including strict source, examples, tools/tests and repository TypeScript checks. | 2.63 |
| `npm test` | Passed: 1,202 tests; includes offline tarball installation and JS/strict TypeScript consumers. | 5.6 |
| `npm run test:legacy` | Passed: 1,202 tests with the legacy Ammo runtime. | 5.38 |
| `npm run test:browser` | Passed: 55 tests, zero skips; WebGL2 and native WebGPU, including the installed-tarball consumer. | 612.97 |
| `npm run build` | Passed: runtime ESM, declarations, Worker and pinned Bullet assets. | 1.06 |
| `MMD_EXAMPLE_FIXTURES=1 npm run build:examples` | Passed: generated fixtures only; no third-party asset download for this build. | 1.77 |
| `npm run test:examples` | Passed: 3 tests, zero skips, including the real pinned Gene checks. | 116.55 |
| `MMD_EXAMPLE_SITE=dist/examples MMD_EXAMPLE_FIXTURES=1 npm run test:examples` | Passed: 1 test; 2 expected real-Gene skips on the synthetic artifact. | 29.93 |
| `npm pack --dry-run --json` | Passed: 63 files, including MMDResourcePath.js and its declaration. | 1.31 |
| `npm publish --dry-run --access public` | Exit 1: version 0.1.2 is already published. Build, typecheck, 1,202 tests and prepack all passed first. | 10.27 |
| `git diff --check` | Passed; checked again after staging the final documentation. | 0.02 |

The publish dry-run did not publish a package. npm refused the already-published
version, as required by registry immutability; no overwrite, forced retry or
release-version change was attempted. A future release must select an unused
version under the [release policy](releases.md). This is a release limitation,
not a loader/typecheck/test failure.

The generated dist/examples fixture artifact was removed after validation, as
required by the release guide. It must not be deployed as the public examples.

## Focused coverage

Seven Node tests exercise separator/dot normalization, spaces/Unicode, escaped
literal-percent names (including %25FF.png and 100%25ab.png), unsafe traversal,
nested escapes, controls, malformed encoding, drive/UNC paths, invalid Unicode,
cache identity, handler ordering, TGA pathname selection, default/custom toon,
all PMX sphere modes and PMD base/sphere maps. Generated PMD/PMX bytes and parsed
filenames/material records are checked independently from fetch URLs.

The Chrome test loads generated PMD/PMX models through MMDLoader and observes
raw HTTP request targets and statuses. It verifies canonical URLs, single
requests for aliases, handler and URL-modifier inputs, real PNG/TGA decoding,
absolute/protocol-relative/root-relative/data/blob references, built-in toon,
and pre-fetch rejection for invalid paths in all PMX texture families.
Separate 404, HTTP-200 invalid-image, and disconnected-response cases preserve
original in-flight error callbacks and canonical cached-error diagnostics.
A new texture cache retries the same URL successfully after a 404.

Both the existing browser SubTexture failure/fallback regression and the
existing example missing-texture recovery checks passed. No unrelated rendering,
physics, IK or original third-party model/image files were changed.

## Required post-merge verification — pending

After merge, verify the latest Tests and Deploy browser examples workflow
attempts for the exact merge SHA. Inspect pages-setup-evidence and
pages-deployment-evidence, requiring successful publication and public
deployment-manifest.json verification of that SHA, HTTP responses and file
hashes, following the [deployment policy](../examples/README.md#deployment).
These checks require the merge-triggered deployment and were not performed
locally.

No library release, downstream dependency migration or physical Android test
was performed. A corrected release and downstream shim removal belong to
subsequent integration work. Desktop Chrome results do not establish the cause
or resolution of the Android image-load/decode failure tracked in mmd-gltf #73.
Physical Android verification and a downstream release are not pre-merge gates
for this library correction.
