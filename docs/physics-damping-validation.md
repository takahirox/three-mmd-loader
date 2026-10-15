# Default additional damping — Issue #70

`RigidBody._init()` calls `info.set_m_additionalDamping( true )` before creating
each native Ammo rigid body. The common construction path covers PMD and PMX
body types 0/1/2 in standalone sync, shared sync and Worker-owned physics.
`AmmoBodyInfo` requires the real binding method; there is no optional fallback
or runtime toggle. The pinned `ammojs-typed` 1.1.0 runtime and declarations
provide the setter.

Model-defined `body.setDamping( positionDamping, rotationDamping )`, friction,
restitution and body-type behavior remain unchanged. Bullet's additional
damping factors and velocity thresholds retain their native defaults. No
stepping, constraints, collision, synchronization, gravity or sleeping policy
changes are included.

`tests/physics-damping.test.ts` parses generated binary PMD and PMX fixtures
with all three body types and shapes, and distinct nonzero model damping.
Subclasses of the real Ammo JS wrappers inspect the native construction info
before the native body constructor runs, then delegate to Ammo. Tests verify
the flag, unchanged native additional factors/thresholds, friction/restitution,
and native body damping and kinematic flags after initialization. They cover
standalone sync, two-model shared sync and `PhysicsWorkerRuntime.handle(add)`.
The Worker test executes the actual Worker-owned construction path directly.

Existing deterministic real-Ammo timestep, type-2, physics-layer and Worker
tests exercise moving kinematic and dynamic bodies, constraints, contacts and
sync/Worker parity. Browser tests exercise the bundled classic Worker with
both transferable and shared transports.

The slow constrained drive in the legacy type-2 regression has a measurable
tradeoff: maximum native joint-anchor lag increases from `0.00166657` with
additional damping disabled to `0.00717941` model units with it enabled, in all
three phase cases. A test-only control disabled the setter to measure the
previous behavior. The old `0.006` absolute test bound is updated to `0.008`,
and the corrected error must also remain below one hundredth of the legacy
teleport error (over 2 model units). The independent native-body oracle and
sync/Worker comparisons retain their existing tolerances. No joint or type-2
implementation is changed to compensate for the damping experiment.

Validation on 2026-10-15:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed: library, examples, tools/tests and TypeScript source check |
| `npm test` | Passed: 371 tests, including 6 focused real-Ammo construction cases |
| `npm run test:browser` | Passed: 25 tests; no skips, including both real Worker transports |
| `npm run build` | Passed: package, declarations, examples modules and bundled Worker |
| `npm run build:examples` | Passed: static site with verified pinned Miku and Gene Light assets |
| `MMD_EXAMPLE_SITE=dist/examples npm run test:examples` | Passed: 2 tests; real PMD, Worker Physics and Gene Light at the Pages project path |
| `git diff --check` | Passed |

Additional damping is an engine-side experiment intended to suppress low-speed
jitter. These tests do not reproduce the maintainer's intermittent violent
instability, prove visual stability or establish exact native MikuMikuDance
equivalence. Optional maintainer real-model motion/visual assessment remains
unperformed and can follow merge without an A/B UI.

## Required post-merge verification

Verified after merge on 2026-10-15; these publication checks were not pre-merge gates.

| Evidence | Status |
| --- | --- |
| Merge-triggered GitHub Pages workflow URL and successful result | [Succeeded](https://github.com/takahirox/three-mmd-loader/actions/runs/38681476618), push event for the merge SHA |
| Published merge SHA and deployment date | `93c515405d623433cb8d1fdebabc54eaba9a9063`; deployment succeeded at 2026-10-15 04:29:49 UTC |
| Public PMD model/animation example loads without asset/runtime errors | Passed: ready, sync physics, 45 rigid bodies, 311 animation tracks |
| Public Worker Physics example loads without asset/runtime errors | Passed: ready, Worker initialized, transferable transport, 45 rigid bodies, 311 animation tracks |
| Public Gene Light PMX example loads without asset/runtime errors | Passed: ready, sync physics, 87 rigid bodies, 5 animation tracks |

The workflow's public verification passed all 603 content checks. The public
deployment manifest served the merge SHA both before and after the live browser
checks. The merge-triggered [Tests workflow](https://github.com/takahirox/three-mmd-loader/actions/runs/38681476608)
also succeeded.

Headless Google Chrome with SwiftShader loaded the public [PMD](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd.html?backend=webgl),
[Worker Physics](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd_worker.html?backend=webgl)
and [Gene Light PMX](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd_pmx_gene.html?backend=webgl)
pages using WebGL. Each exported `ready` promise resolved, the model and animation
were present, and no page runtime exceptions, failed requests or example HTTP
errors were observed. Chrome separately requested the absent origin-root
`https://takahirox.github.io/favicon.ico` (HTTP 404) on each page; the initial
strict HTTP probe returned exit 1 for these favicon requests alone. This does not
affect example assets or physics. Raw observations and the acceptance assessment
are saved in [the post-merge evidence](deployment-evidence/issue-70.json).

These loading checks do not establish visual stability, exact native MMD
equivalence or improvement of the intermittent instability. Optional maintainer
real-model motion/visual assessment remains unperformed.
