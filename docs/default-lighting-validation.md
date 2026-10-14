# Mixed example lighting and gallery previews — Issue #66

The shared scene restores ambient intensity 2 and directional intensity 3 for
Model and animation, Worker Physics, Audio and camera, and Poses. Only
`mode === 'gene'` uses native Three.js defaults (1/1). This is the maintainer's
requested per-example art direction. White light colors, direction/position,
cameras, materials, renderer settings, animation, IK and physics are preserved.
No library shading or color management algorithms change.

The four Miku 400×250 JPEGs are recaptured from the real example pages with the
restored lighting, including a separate Worker Physics preview. The Gene JPEG
from Issue #63 is retained byte for byte, with SHA-256
`b0ad142b8a7c7e640893a1e07205e9508484fe28c11ffc2382e6c1780ca6da48`.
The capture command verifies the pinned Miku and Gene assets, rejects fixtures,
checks all five scenes' runtime lights and actual physics backends, and writes
only the four Miku images. Gene's original capture provenance is preserved,
with separate checks of the current runtime. The manifest records the current
scene hash and each entry's mode, intensities, capture scene hash, date, browser,
image hash, frame/pose and checks. Repeated captures preserve Gene and record
Miku's replaced Issue #63 hashes.

See [capture method and rights notices](../examples/README.md#gallery-thumbnail-capture)
and [capture evidence](../examples/screenshots/manifest.json). Miku character
and MMD assets retain their individual terms, separately from MIT; Gene's
preview retains CC BY 4.0 credit and the author's separate usage conditions.
This record does not claim equivalence with MikuMikuDance or new maintainer
visual approval. Optional subjective review is separate from pre-merge checks.
The four new previews were inspected locally for the rendered Miku model,
grid and expected framing.

## Pre-merge validation

Run in the assigned worktree on 2026-10-15, Node.js 24.12.0 and Google Chrome
155.0.8059.79 on macOS (2026-10-15 Japan time / 2026-10-14 UTC).

| Check | Result |
| --- | --- |
| `npm run examples:capture` | PASS, four real Miku captures and Gene runtime verification; repeat produced identical JPEG hashes and preserved Gene provenance |
| `npm run typecheck` | PASS, package/example/tool projects and TypeScript source policy |
| `npm test` | PASS, 324 tests, 0 skipped |
| `npm run test:browser` | PASS, 25 tests, 0 skipped; includes all five gallery pages and Gene's native defaults |
| `npm run build` | PASS |
| `npm run build:examples` | PASS, pinned real assets verified |
| Artifact/thumbnail audit | PASS, all 600 deployment file hashes; all five image copies and capture manifest match; compiled scene and 13 pinned Gene assets verified; no private model paths |
| `MMD_EXAMPLE_SITE=dist/examples npm run test:examples` | PASS, 2 tests, 0 skipped; real assets under the project path, including all five pages and gallery navigation |
| `git diff --check` | PASS |

The source browser suite uses generated Miku test assets and the real licensed
Gene model. Thumbnail capture and the built-artifact browser checks use the
real pinned Miku and Gene assets. The latter serves only `dist/examples/` under
`/three-mmd-loader/`, without falling back to source modules or assets.

Runtime assertions inspect 2/3 lighting for all four Miku pages and 1/1 for
Gene, white colors and unchanged light position/target. Gallery checks decode
all five JPEGs at 400×250 and exercise selection, mobile layout, hashes,
Back/Forward, controls, loading, rendering, animation and physics. Thumbnail
assertions check pinned source commits, per-mode capture conditions, JPEG
headers/dimensions, exact image hashes and Gene's fixed pre-change hash. They
require all four Miku images to differ from their Issue #63 previews and the
Worker capture to be distinct. Build checks verify exact copies of all five
images and the capture manifest. Existing Gene loading/error checks remain.

## Post-merge verification: publication failed; new-site checks PENDING

PR #67 merged at 2026-10-14T16:06:39Z with merge commit
`9b0ef7d966beb374758f00bc5598f8293764d372`, preserving the reviewed head
`3db055db4a162e222aee16a6b1b411b55f004f52` as its second parent. Issue #66
was read and confirmed open immediately before the merge attempt.

The merge-triggered [Pages workflow](https://github.com/takahirox/three-mmd-loader/actions/runs/38595252652)
completed with **FAILURE** at 2026-10-14T16:09:19Z. Build, built-site browser
validation and configuration checks passed. The backup step failed with
`Public content mismatch: node_modules/three/examples/jsm/tsl/display/RetroPassNode.js (HTTP 503)`.
The deployment and rollback steps were skipped; the new commit was not published.

The public deployment manifest still identifies
`d98d77fbd3e36bde670b9130578b895a3caaf912`, whose successful Pages deployment
was recorded at 2026-10-14T11:45:16Z. All five public JPEG requests
returned HTTP 200 and matched that deployment's manifest. The four Miku
previews still have their previous hashes; Gene matches the unchanged pinned
hash. Exact timestamps and expected/observed image hashes are recorded in
[post-merge evidence](issue-66-post-merge-validation.json).

Successful publication of the merged commit, its deployment date, verification
of the four refreshed public previews, and runtime/asset checks of all five
newly published example pages remain **PENDING**. Follow up on the backup HTTP
503 separately and complete those checks after successful publication.
Optional maintainer visual review remains **PENDING**; it is not a pre-merge
blocker. No workflow retry or deployment configuration change was performed.
