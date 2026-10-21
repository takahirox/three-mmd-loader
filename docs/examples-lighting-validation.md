# Examples lighting validation — Issue #98

All five demo pages now explicitly construct a white `AmbientLight` and white
`DirectionalLight` at intensity **1** in `examples/scene.ts`: Model and animation,
Worker Physics, Audio and camera, Poses, and PMX — Gene (Light). The Worker page
uses the same scene setup. Only the two intensity arguments change at runtime;
light positions/targets, cameras, renderer configuration, materials, toon/shadow
rendering, animation, and physics remain unchanged. The corrected MMD shading
from #96/#97 is preserved.

The browser examples test checks both intensities for every Miku page, including
Worker; the Gene browser test already checks both at 1. Existing checks also
verify white colors, direction/target, rendering, controls, and scene startup.
These checks run against source pages and the built site under the Pages prefix.

The four Miku gallery JPEGs are recaptured from the real pinned assets at 1/1,
including the actual Worker backend. Their manifest records current scene and
image hashes, capture conditions, and the replaced Issue #66 2/3 image hashes.
Repeated captures at 1/1 preserve those replaced hashes. Gene's existing 1/1
JPEG remains byte for byte unchanged, with its original capture date/source
hash and separate current runtime verification checks. Historical validation
for the mixed lighting is retained in [the Issue #66 record](default-lighting-validation.md).
Asset rights and credits remain in [the examples README](../examples/README.md#gallery-thumbnail-capture)
and [third-party notices](../THIRD_PARTY_NOTICES.md).

## Pre-merge validation

Validation in the assigned worktree on 2026-10-21 with Node.js 24.12.0 and
Google Chrome 155.0.8059.85 on macOS:

| Check | Result |
| --- | --- |
| `npm ci` | PASS; 18 packages installed, audit found 0 vulnerabilities |
| `npm run examples:capture` | PASS; four real Miku captures at 1/1, Gene runtime verified and original JPEG/provenance preserved |
| `npm run typecheck` | PASS; package, examples, tools, and TypeScript source policy |
| `npm test` | PASS; 1,195 tests, 0 failures, 0 skipped |
| `npm run build` | PASS; run by capture, typecheck, test, and Examples build hooks |
| `npm run build:examples` | PASS; pinned real assets verified |
| `npm run test:examples` | PASS; 3 tests, 0 failures, 0 skipped; all four Miku pages (generated fixtures) and real Gene with default/legacy Bullet |
| `MMD_EXAMPLE_SITE=dist/examples npm run test:examples` | PASS; 3 tests, 0 failures, 0 skipped; real pinned assets served only from the built artifact under `/three-mmd-loader/`, including Worker and Gene default/legacy Bullet |
| Built artifact audit | PASS; all 614 deployment file hashes, all five preview copies, capture manifest, current scene provenance, and compiled 1/1 lights |
| `git diff --check` | PASS |

No model-versus-MMD visual comparison or subjective visual approval is a
pre-merge gate; no visual equivalence is claimed.

## Required post-merge verification: PENDING

This node does not push, merge, dispatch workflows, or publish. The following
checks require the eventual exact merge commit and remain **PENDING until
performed**:

- **Tests workflow: PENDING.** Find the latest merge-triggered attempt for the
  exact merge commit; record the commit, run URL, attempt, and conclusion.
- **GitHub Pages workflow: PENDING.** Find the latest merge-triggered attempt
  for that same commit; record its run URL, attempt, and conclusion, including
  publication and public verification results.
- **Deployed commit and assets: PENDING.** Verify the public deployment manifest
  at <https://takahirox.github.io/three-mmd-loader/> identifies that merge commit,
  and validate the public page/assets and preview hashes against its manifest.
- **All five deployed scenes: PENDING.** Check basic scene startup and inspect
  ambient and directional light intensities, both 1, on Model and animation,
  Worker Physics, Audio and camera, Poses, and PMX — Gene (Light). Record the
  page URLs and outcomes without claiming visual equivalence to MMD.
