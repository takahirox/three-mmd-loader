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

## Required post-merge verification: PENDING

No merge, push, workflow dispatch, publication, or public-site verification was
performed during this node. These checks must be recorded after merging and
are not pre-merge approval requirements:

- **Merge-triggered Pages workflow URL/result: PENDING.** Confirm successful
  completion and publication of the merged commit.
- **Deployed commit/date: PENDING.** Read the public deployment manifest and
  compare the commit and image hashes to the merged artifact.
- **Public gallery: PENDING.** Verify
  <https://takahirox.github.io/three-mmd-loader/examples/> serves the four
  refreshed Miku previews (including the separate Worker image) and the
  unchanged Gene preview with the fixed hash above.
- **All five public example pages: PENDING.** Navigate to every scene and
  record whether assets load without runtime errors.

If publication fails, record the actual failure and follow up separately.
Optional maintainer visual review remains PENDING until actually performed;
it is not a pre-merge blocker.
