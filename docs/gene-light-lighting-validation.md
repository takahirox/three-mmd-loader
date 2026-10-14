# Gene Light scene lighting validation — Issue #61

Checked on 2026-10-14 before merge, using Node.js 24.12.0 and Google Chrome
155.0.8059.79 on macOS.

`initExample('gene')` now omits the intensity arguments when constructing its
white AmbientLight and DirectionalLight. Both default to 1 in pinned Three.js
0.186.1. PMD animation, Worker Physics, audio, and pose modes retain intensities
2 and 3. The directional light stays at (-1, 2, 1), targeting the origin.
Materials, loaders, renderer settings, and other scene features are unchanged.

This is a scene-lighting adjustment. The automated rendering checks do not
establish exact MMD shading parity or a visually confirmed fix for the reported
washed-out appearance.

## Pre-merge checks

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | PASS, 323 tests, 0 skipped |
| `npm run build` | PASS |
| `npm run build:examples` | PASS, real pinned assets verified |
| `npm run test:examples` | PASS, 2 tests, 0 skipped |
| `MMD_EXAMPLE_SITE=dist/examples npm run test:examples` | PASS, 2 tests, 0 skipped |
| `git diff --check` | PASS |

The browser suites inspect the actual scene lights: Gene has exactly two lights
at intensity 1; all four existing examples retain ambient 2 and directional 3.
They also verify white light colors and the unchanged light position and target.
The suites cover loading, rendering, controls, animation, physics, morphs,
layout, and expected failure handling. The Gene check uses the real licensed
PMX and textures and verifies normal operation has no runtime errors.

The built-site run serves only the static artifact under `/three-mmd-loader/`,
using the original Miku assets as well as Gene. It cannot fall back to source
checkout imports. Both suites pass without cross-origin isolation.

## Required post-merge publication verification — COMPLETED

The merge-triggered Pages workflow succeeded and published merge commit
`5a2263cfe0eb883f0b5651e56659d1dc176e4f53` on 2026-10-14 UTC. All five
published examples loaded and rendered with the expected intensities, without
scene asset or runtime errors. The browser also observed an unrelated site-root
favicon 404. Workflow, deployment timestamps, and full outcomes are recorded in
[the post-merge verification report](gene-light-post-merge-verification.md).
These checks were completed after merge. Optional maintainer visual comparison
remains separate from the automated results above.
