# Joint-frame YXZ experiment — Issue #80

The production change is one argument in `Constraint._init()`:
`setBasisFromArray3( form, params.rotation, 'YXZ' )`. The joint world
orientation now uses the same Euler composition as rigid-body offsets from
[#78](https://github.com/takahirox/three-mmd-loader/issues/78).
`PhysicsWorkerRuntime` constructs native joints through this shared code, so
Sync and Worker-owned worlds receive the change together. Reverting that
argument restores the previous joint convention without reverting body offsets.

## Rationale and uncertainty

For column vectors, the proposed right-handed orientation is
`Ry(y) * Rx(x) * Rz(z)`. Multi-axis rotations generally differ from the old
`Rx(x) * Ry(y) * Rz(z)`; zero and single-axis rotations coincide.

- [babylon-mmd Bullet](https://github.com/noname0310/babylon-mmd/blob/main/src/Runtime/Optimized/Physics/mmdBulletPhysics.ts)
  uses `Quaternion.FromEulerAnglesToRef(x, y, z)` for both bodies and joints.
  [Babylon's implementation](https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/core/src/Maths/math.vector.pure.ts)
  delegates to yaw/pitch/roll with arguments `(y, x, z)`, composing YXZ.
- The [independent C# implementation report](https://github.com/masaka1024/mmd2gltf-cs-physics/blob/main/docs/investigations/2026-08-10-multi-model-defects.md)
  also identifies YXZ for body and joint transforms. This is implementation
  evidence, not an official normative specification.
- [Saba](https://github.com/benikabocha/saba/blob/master/src/Saba/Model/MMD/MMDPhysics.cpp)
  uses `setEulerZYX(x, y, z)` for both PMD and PMX joints.
  [Bullet's actual matrix entries](https://github.com/bulletphysics/bullet3/blob/master/src/LinearMath/btMatrix3x3.h)
  implement `Rz(z) * Ry(y) * Rx(x)`. This is a genuine competing ZYX choice,
  not an alternative name for YXZ. The discrepancy remains unresolved.
- [mmd-parser's handedness conversion](https://github.com/takahirox/mmd-parser/blob/master/src/DataCreationHelper.ts)
  negates X and Y Euler angles. Comparisons must account for that reflection;
  it does not determine the composition order. The
  [PMX reference](https://github.com/dskjal/OpenMMD/blob/main/docs/specification/pmx2.1-specification.md)
  describes joint Euler radians without independently settling this question.

This is an isolated compatibility experiment. A visual difference or better
behavior on one model is not proof of exact native MikuMikuDance parity, and
is not evidence of a fix for occasional violent physics oscillation.

## Independent computed frames

`tests/physics-joint-rotation.test.ts` adds 48 computed-frame cases: PMD and PMX,
standalone Sync, two-model shared Sync, and two-model Worker-runtime worlds,
with eight rotations in each combination. Minimal binary fixtures go through
real `mmd-parser` right-handed conversion and `MMDLoader`. Tests explicitly
check the parsed joint angles are `(-float32(x), -float32(y), float32(z))`.

`rightHandedRotation()` in `tests/rotation-reference.ts` forms scalar 3x3
`Rx`, `Ry`, and `Rz` matrices from those parsed angles, and independently
multiplies `Ry * Rx * Rz`. It uses no Euler-to-quaternion conversion or
production helper. The existing body oracle still independently reflects the
original-coordinate matrix as `S * R * S`, with `S = diag(1, 1, -1)`.

The cases include identity, each single axis, mixed `(0.43, -0.71, 1.13)`,
near a YXZ singularity, near pi, and negative/wrapped angles. The four multi-axis
cases explicitly differ from XYZ. Bodies have fixed nonidentity rotations and
unequal positions independent of the varying joint rotation. Constructor
observation leaves the native Ammo frames untouched and checks both local
frames as `inverse(initialBodyWorld) * expectedJointWorld`, then reconstructs
the world joint from each body/frame pair. Matrix tolerance is `5e-5`.

Existing rigid-body reference tests now expect the explicit YXZ joint world
basis while retaining their body initialization, reset, projection and deferred
input checks. Together the two focused Node files have 176 cases.

## Native Bullet trajectories

The new Node file separately adds 16 real integration cases (both binary
formats, all eight joint rotations). A slider permits translation in
`[-0.35, 0.35]` along joint X, locks the other five axes, and is driven by
world gravity `(2, -5, 3)` for 90 fixed `1/60` steps. Its pivot is at the dynamic
body's center of mass to avoid an off-center torque. Collision masks exclude
contacts, so this probes constraint axes rather than collision response.

Each case runs three real Ammo worlds: unmodified production construction,
independently constructed YXZ reference frames, and independently constructed
old XYZ frames. Reference constructors replace only local frames using the
scalar oracle and body-world inverses; the native Bullet constraint and solver
remain active in all runs. No solver output is mocked.

Assertions check every production trajectory matrix against the YXZ native
reference within `0.002`, transverse displacement below `0.002`, locked
orientation within `5e-5`, and nonzero travel between `0.02` and `0.38`.
Finite-step constraint error and transient limit overshoot under gravity have
separate tolerances from the computed-frame checks. Multi-axis XYZ trajectories
differ by more than `0.02`; identity and single-axis trajectories remain
equivalent within `0.002`.

Temporarily restoring only the production joint argument to XYZ fails exactly
32 of the 64 new Node cases: 24 multi-axis frame cases and eight multi-axis
solver cases. All 32 identity/single-axis controls pass. YXZ was restored before
final validation.

## Actual Worker and projection coverage

`tests/browser/physics-rotation.test.ts` uses the real bundled classic Worker
and real Ammo on both threads. Each transport tests 64 scenarios: both formats,
body types 1/2, all eight rotations, and standalone/shared worlds. Mode-0 bodies
are present in every fixture. Transferable-buffer and cross-origin-isolated
SharedArrayBuffer runs each perform more than 5,000 assertions.

The main-thread native reference constraint uses independently computed scalar
joint frames; the Worker uses the production constructor. Before substituting
the reference frames, the test also checks both main-thread production local
frames. Anisotropic nonzero linear/angular limits and translational/angular
springs, gravity, and controlled kinematic motion exercise native simulation.
Raw Worker publications and projected bones must match the native reference
within `5e-4`, including initial/rotated reset and warmup. Body initialization
and projection also retain their independent offset oracle.

Only completed message delivery is held to establish deterministic publication
boundaries. Shared Sync warmup captures every model before PMD Type-2 native
alignment, matching the Worker's raw result boundary. Production scheduling,
transport and Type-2 synchronization are unchanged. The Node `ManualWorker`
coverage uses real Bullet through the Worker runtime with controlled scheduling;
the browser coverage additionally verifies actual separate-thread execution.

These are controlled frame, solver and publication checks. The browser motion
probe advances six frames plus warmup; it is not sustained natural animation-loop
physics or a long-running stability assessment.

## Preserved production settings

Only the joint Euler-order argument changes. The rigid-body YXZ sites and the
resource helper's explicit per-call order selection/default remain intact.
Parser coordinates, `unitStep = 1/60`, default `maxStepNum = 10`, additional
damping, `STOP_ERP = 0.475`, collision groups/masks and linked-body collisions,
spring coefficients and limit values, frame-offset policy, Type-2 authority,
IK/grants, warmup/reset, gravity, materials, lighting, Worker transport and
scheduling remain unchanged. Different test-fixture limits/springs/gravity are
confined to tests. There is no public A/B toggle or order fallback heuristic.

## Validation

Validation on 2026-10-17 (Asia/Tokyo):

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed: library, examples, tools/tests and TypeScript source check |
| `npm test` | Passed: 845 tests, no skips |
| `npm run test:browser` | Passed: 33 tests, no skips; both rendering backends and Worker transports |
| `npm run build` | Passed: package, declarations, examples and classic Worker |
| `npm run build:examples` | Passed: static site and verified pinned PMD/Gene Light PMX assets |
| `MMD_EXAMPLE_ASSETS=1 npm run test:examples` | Passed: 2 tests, no skips; source pages with original PMD and pinned Gene Light PMX assets |
| `MMD_EXAMPLE_SITE=dist/examples npm run test:examples` | Passed: 2 tests, no skips; actual static artifact and original assets at `/three-mmd-loader/` |
| `git diff --check` | Passed; staged diff also checked |

Browser checks use the existing macOS software adapter setup: a temporary
`CHROME_BIN` launcher adds `--use-webgpu-adapter=swiftshader`. No production
renderer configuration or browser rendering assertions were changed.

## Required post-merge verification

**PENDING until merged**, not a pre-merge approval/merge blocker:

- Inspect the merge-triggered [Deploy browser examples workflow](https://github.com/takahirox/three-mmd-loader/actions/workflows/examples-pages.yml),
  including its **latest attempt**. Record the workflow URL, result, actual
  published merge SHA and deployment date; verify the public content's SHA.
- Load the public PMD, Worker Physics and Gene Light PMX examples, recording
  asset/runtime errors or their absence for each. Label a controlled smoke test
  separately from sustained natural animation-loop physics.
- If an HTTP 503 or browser timeout occurs, inspect the latest attempt and
  retry status before concluding failure; an earlier successful attempt does
  not establish the latest attempt's result.

No merge, publication or public-runtime check is claimed here. Optional later
maintainer evaluation of appearance, constrained motion and long-running
stability is **not yet assessed** and is not a merge blocker. Later observations
can inform keeping or reverting this isolated change.
