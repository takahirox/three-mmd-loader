# Default example lighting and gallery previews — Issue #63

The shared scene now constructs white AmbientLight and DirectionalLight with
their native Three.js default intensity of 1 for animation, audio, pose, Worker
Physics and Gene Light. Only the two intensity expressions changed in the scene;
light direction/position, camera positions, materials, animation, outlines,
tone mapping and MMD shading/color-space algorithms are unchanged.

All five gallery cards have fresh 400×250 JPEGs captured from their actual
example pages. Worker Physics has a separate image. The capture command verifies
the pinned real Miku/MMD and Gene Light assets, rejects fixtures, checks the
runtime lights and actual physics backend, and records scene/image hashes.
See [the method and rights notices](../examples/README.md#gallery-thumbnail-capture)
and [capture evidence](../examples/screenshots/manifest.json). Miku/Three.js
asset and character rights remain separate from MIT; Gene's derivative preview
retains CC BY 4.0 credit and the author's separate usage conditions.

The previews were inspected locally for a rendered model, grid, and valid
framing. This does not claim exact MikuMikuDance parity or a separately confirmed
maintainer visual outcome. Subjective review is optional.

## Pre-merge validation

Run in the assigned worktree on 2026-10-14, Node.js 24.12.0 and Google Chrome
155.0.8059.79 on macOS. Every final check below uses the changed checkout.

| Check | Result |
| --- | --- |
| `npm run examples:capture` | PASS, five real scenes; a repeat produced identical JPEGs on this environment |
| `npm run typecheck` | PASS, package/example/tool projects and TypeScript source policy |
| `npm test` | PASS, 324 tests, 0 skipped |
| `npm run test:browser` | PASS, 25 tests, 0 skipped |
| `npm run build` | PASS |
| `npm run build:examples` | PASS, real pinned asset downloads verified |
| Artifact/thumbnail audit | PASS, all 600 deployment file SHA-256s verified; all five images and capture manifest match source bytes; 13 Gene files match the pinned allowlist; no private content |
| `npm pack --dry-run --ignore-scripts --json` after the site build | PASS, 48 package files; no examples, screenshots, fonts, capture tooling or model assets |
| `MMD_EXAMPLE_SITE=dist/examples npm run test:examples` | PASS, 2 tests, 0 skipped; real assets under the project path |
| `git diff --check` | PASS |

The normal example browser run uses the existing generated Miku test assets
and real licensed Gene Light. Thumbnail capture and the static-artifact browser
run use the real pinned Miku and Gene assets, never fixture previews. The
artifact run serves only `dist/examples/` under `/three-mmd-loader/`, with no
fallback to source-checkout modules or assets.

Runtime assertions inspect default intensity 1, white colors and unchanged
light position/target in all five modes. Gallery checks decode all five JPEGs
at 400×250 and exercise selection, mobile layout, hash links, Back/Forward,
controls, readiness, rendering, animation and actual physics modes. The new
thumbnail test checks image hashes, pinned source commits, capture state and
current scene provenance; build tests verify exact copies of the new Worker
image and capture manifest. Gene tests retain their runtime-error and missing
asset checks. Thumbnail generation is now a dedicated command, replacing the
older Gene-only test capture switch that adjusted the camera and disabled physics.

An initial unit run failed when concurrent build hooks removed `dist/` during
testing; the final runs were executed sequentially. An initial browser gallery
run exceeded its 120-second source timeout. The navigation test now uses the
same bounded 300-second budget for source and built paths, retaining every
assertion; the successful source run took about 87 seconds. Other browser
checks passed on the initial run and the complete final rerun.

## Required post-merge verification: PENDING

No merge, push, workflow dispatch, publication, or public-site verification was
performed during this node. These checks must be recorded after merging and
must not block pre-merge approval or merging:

- **Merge-triggered Pages workflow: PENDING.** Record its successful workflow
  URL and confirm it publishes the merged commit.
- **Deployment commit/date: PENDING.** Read the public deployment manifest and
  compare the deployed commit and thumbnail hashes to the merged artifact.
- **Public gallery: PENDING.** Check
  <https://takahirox.github.io/three-mmd-loader/examples/> serves all five
  refreshed thumbnails, including the separate Worker and refreshed Gene images.
- **Public example startup: PENDING.** Navigate to each of the five scenes and
  check that assets load and no runtime errors occur; record the results.

If publication fails, file a follow-up and report the actual failure instead
of claiming success. Optional subjective review remains a separate follow-up.
