# Rigid-body YXZ offset experiment — Issue #78

This records the #78 checkpoint. Issue #80 subsequently changes joint frames to
YXZ and extends these tests; see [joint-frame validation](physics-joint-rotation-validation.md)
for the current convention and results. The #78 measurements below are historical.

Rigid-body offsets now explicitly compose the already right-handed parser Euler
values in **YXZ** order in both `RigidBody._init()` and
`WorkerPhysicsAdapter`. The Worker runtime uses the same native `MMDPhysics`
implementation. Its stored offset matrix serves initialization, reset, deferred
pose input and body-to-bone projection, so those operations share one convention.

At the #78 checkpoint, joint world frames remained explicitly **XYZ**. The shared
native helper accepts an order, defaults to XYZ, and sets it on every use of a
pooled Euler. This
prevents a previous rigid-body allocation from leaking YXZ into joint creation.
Rigid-body comparisons with other implementations do not settle the joint
convention; that remains a separate investigation.

This changes only rigid-body offset Euler composition. Parser handedness,
`unitStep = 1/60`, `maxStepNum = 10`, positive-delta accumulation, Worker
scheduling/coalescing, gravity, additional damping, linked-body collision policy,
Type-2 authority, IK/grants, joint limits/springs, `STOP_ERP = 0.475`, rendering,
materials and example lighting are unchanged. No public A/B setting was added.

## Independent transform evidence

`tests/rotation-reference.ts` computes scalar 3×3 axis rotation matrices from
the original left-handed binary angles, multiplies `Ry * Rx * Rz`, then applies
`S * R * S` with `S = diag(1, 1, -1)`. It does not use Three.js Euler conversion
or the production transform helper. Original angles are rounded to binary
float32 precision. Matrices are compared with matrices reconstructed from real
Ammo quaternions, avoiding quaternion-sign ambiguity.

Generated PMD and PMX binaries pass through `mmd-parser` with right-handed
conversion and `MMDLoader`. Tests check the converted angles, reflected
translations, PMD bone-relative versus PMX model-space offset normalization,
and effective body types. The nonzero probe bone rest position is
`(0.6, 0.4, -0.2)` in right-handed coordinates. Native reset transforms must
match `boneWorld * referenceOffset` with translated meshes and a rotated parent
and child hierarchy.

| Original-angle fixture | Difference from old XYZ |
| --- | --- |
| Identity `(0, 0, 0)` | None |
| X only `(0.7, 0, 0)` | None |
| Y only `(0, -0.9, 0)` | None |
| Z only `(0, 0, 1.1)` | None |
| Mixed `(0.43, -0.71, 1.13)` | Different |
| Near YXZ singularity `(pi/2 - 1e-5, -0.6, 0.9)` | Different |
| Near pi `(pi - 1e-5, 0.8, -pi + 1e-5)` | Different |
| Negative/wrapped `(-2.4, 4.2, -3.8)` | Different |

All raw initial/reset rigid-body transforms match the reflected reference
within `5e-5` per matrix element in the Node tests. This holds for both formats,
both dynamic modes (1/2), standalone Sync, two-model shared Sync and two-model
Worker-owned worlds. The kinematic mode-0 body is included in every fixture.
Real Ammo constructor observation also checks **both local joint frames**
against `inverse(initialBodyWorld) * jointWorldXYZ` for the multi-axis joint
`(0.31, -0.47, 0.62)`; joints do not silently follow the rigid-body order.

`tests/physics-rotation.test.ts` adds 96 reference cases and 16 constrained
motion/reset/warmup cases. The latter compare native published transforms and
bone poses between Sync and Worker for standalone and shared worlds, PMD/PMX
modes 0/1/2, and PMX deferred/post-physics ancestry. Deferred native snapshots
and Worker input snapshots are also compared with `boneWorld * referenceOffset`.
Dynamic bone projection is independently checked as
`bodyWorld * inverse(referenceOffset)`; mode 2 retains skeletal translation.
Numerical parity checks use `5e-4` per matrix element.

Reset comparisons supply the same authored skeletal snapshot to both backends;
a delayed Worker display is not an equivalent reset input. PMX checks use the
zero-time publication/projection boundary. PMD raw step comparisons precede
additional zero-time synchronization, which can publish mode-2 alignment rather
than the preceding raw solve. No synchronization behavior was changed.

As a regression control, temporarily restoring old XYZ at both production
rigid-body sites fails **64 of 112** focused Node cases: the 48 mixed/edge
reference cases and all 16 mixed-axis motion/projection/deferred-input cases. The 48
identity/single-axis reference cases still pass. Restoring YXZ passes all 112.

`tests/browser/physics-rotation.test.ts` runs 32 fixture combinations with two
models each through the actual bundled classic Worker, separately with
transferable buffers and cross-origin-isolated SharedArrayBuffer transport.
It checks stored initial/reset poses and **Worker-native published raw poses**
against the independent matrix reference, then compares constrained motion,
reset, warmup and mode-1/2 projection with a real shared Sync Ammo world. Each
transport performs more than 3,000 assertions. No solver or transport is mocked;
only delivery of completed result messages is controlled for deterministic
publication boundaries.

These are transform and execution-path consistency results. They do not prove
exact MikuMikuDance parity, visually correct hair/skirt motion, greater stability,
or resolution of intermittent violent oscillations. Optional real-model motion
review can inform a later keep/revert decision.

## Validation

Validation on 2026-10-16:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed: library, examples, tools/tests and TypeScript source check |
| `npm test` | Passed: 781 tests, no skips |
| `npm run test:browser` | Passed: 33 tests, no skips; both rendering backends and both Worker transports |
| `npm run build` | Passed: package, declarations, examples and classic Worker |
| `npm run build:examples` | Passed: static site and verified pinned PMD/Gene Light PMX assets |
| `MMD_EXAMPLE_SITE=dist/examples npm run test:examples` | Passed: 2 tests, no skips; real PMD, Worker Physics and Gene Light PMX at the Pages project path |
| `git diff --check` | Passed |

Browser rendering validation uses the existing macOS software adapter setup:
`CHROME_BIN` points to a temporary launcher adding
`--use-webgpu-adapter=swiftshader` to Chrome. No rendering assertions, timeouts
or production renderer options were changed. An initial focused browser harness
run omitted the `three/addons/` import-map entry and timed out; the harness was
corrected and both transport cases then passed. No final checks are skipped.

## Required post-merge verification

**PENDING until merge**, and not a pre-merge approval/merge blocker:

- Record the merge-triggered [Deploy browser examples workflow](https://github.com/takahirox/three-mmd-loader/actions/workflows/examples-pages.yml)
  URL, **latest run attempt**, final outcome, deployed actual merge SHA and date.
- Verify the public Pages content corresponds to that merge SHA; record this
  separately from browser rendering/physics evidence.
- Open the public PMD, Worker Physics and Gene Light PMX examples in a browser;
  record successful loads and absence of asset/runtime errors for each.
- For transient 503s/timeouts, inspect subsequent retry attempts and results;
  an earlier successful attempt is insufficient evidence for the latest attempt.

No public deployment or public runtime result has been marked passed here.
Optional maintainer subjective visual evaluation is also pending; it is not a
merge blocker and automated tests do not substitute for it.
