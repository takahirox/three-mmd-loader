# Examples gray ambient color trial — Issue #100

All five demos share `new AmbientLight( 0xAAAAAA, 1 )` in `examples/scene.ts`:
Model and animation, Worker Physics, Audio and camera, Poses, and PMX — Gene
(Light). There is no scene-specific override. Both light intensities remain
**1**, preserving #98. The directional light stays `0xffffff` at `(-1, 2, 1)`
with its existing target. This changes only the shared ambient color; scene,
material, renderer, toon, shadow, camera, animation, and physics settings and
native-oriented shader calculations from #96/#97 are unchanged.

The examples browser tests check ambient `0xAAAAAA`, directional `0xffffff`,
both intensities, and direction/target for all five pages, including Worker.
The Gene test exercises both default and legacy Bullet. These assertions run
against source pages and the built artifact under the Pages hosting prefix.

All five gallery JPEGs are recaptured using `npm run examples:capture` with
the existing pinned real assets, camera, physics, and frame/pose workflow.
Gene now receives a fresh capture because its ambient color also changes.
The manifest records per-entry light colors and intensities, current scene
source hash, browser, capture time, checks, and image hashes. It records the
replaced white-ambient image hashes and preserves those on repeated gray
captures. Historical evidence remains in [the Issue #98 record](examples-lighting-validation.md).
Asset credits and terms remain in [the examples guide](../examples/README.md#gallery-thumbnail-capture)
and [third-party notices](../THIRD_PARTY_NOTICES.md).

This is a color trial, with no claim that the images are visually preferable,
improve MMD fidelity, or fix PMX white clipping. Human visual judgment is not
a pre-merge acceptance gate.

## Pre-merge validation

Validation in the assigned worktree on 2026-10-21 with Node.js 24.12.0 and
Google Chrome 155.0.8059.85 on macOS:

| Check | Result |
| --- | --- |
| `npm ci` | PASS; 18 packages installed, 0 audit vulnerabilities |
| `npm run examples:capture` | PASS; all five real-asset captures, gray/white colors, intensities 1/1, actual Worker backend |
| `npm run typecheck` | PASS; package, examples, tools, and TypeScript source policy |
| `npm test` | PASS; 1,195 tests, 0 failures, 0 skipped |
| `npm run build` | PASS; run by capture, typecheck, tests, and Examples build hooks |
| `npm run build:examples` | PASS; pinned real assets verified |
| `npm run test:browser` | PASS; 54 tests, 0 failures, 0 skipped; includes source-page Examples with generated Miku fixtures and real Gene, plus WebGL2/WebGPU material and Worker regressions |
| `MMD_EXAMPLE_SITE=dist/examples npm run test:examples` | PASS; 3 tests, 0 failures, 0 skipped; all five pages with pinned real assets served only from the built artifact under `/three-mmd-loader/`, Gene default/legacy Bullet |
| Built artifact audit | PASS; all 614 deployment hashes, all five preview copies, capture manifest, scene provenance, compiled light colors/intensities and directional position |

`git diff --check`: PASS.

## Required post-merge verification: PENDING

These checks require the actual merge SHA and remain **PENDING**:

- **Tests workflow:** identify the latest merge-triggered attempt for the exact
  merge SHA; record its run link, SHA, attempt, and conclusion.
- **GitHub Pages workflow:** identify the latest attempt for that same SHA;
  record its run link, attempt, conclusion, publication, and public verification.
- **Deployed setting and assets:** verify the public deployment manifest at
  <https://takahirox.github.io/three-mmd-loader/> identifies that merge SHA;
  verify its asset hashes, compiled gray ambient setting, and refreshed previews.
- **Scene startup/regressions:** check all five deployed pages, including PMD
  sync and Worker and Gene Light PMX, for basic startup and light settings
  (`0xAAAAAA` ambient, `0xffffff` directional, both intensity 1). Record page
  URLs and outcomes.

**Maintainer follow-up:** visually inspect the published Examples, especially
Gene Light PMX, and decide whether to keep or revise `0xAAAAAA`. Record any
later adjustment as separate feedback; subjective approval remains pending
and separate from automated pre-merge acceptance.
