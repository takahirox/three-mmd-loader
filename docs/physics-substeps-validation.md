# Bounded Bullet substeps — Issue #74

The default `MMDPhysics.maxStepNum` is **10**, previously 3. Callers can still
pass `maxStepNum: 3` or another supported value, including through
`MMDAnimationHelper.add(mesh, { maxStepNum })`. After merging main
(`e0d8648`, PR #76 / Issue #75), the default fixed step is `1/60` seconds;
explicit `unitStep: 1/65` remains supported and tested. Each positive finite
delta is forwarded unchanged, with the unchanged per-call budget `min(floor(delta / unitStep) + 1, maxStepNum)`. Bullet retains
its fractional-time accumulator. Short positive frames can complete zero
substeps; zero, negative and non-finite deltas do not advance Bullet.

Relative to current main, this changes only the default substep limit. It leaves
additional damping (#70),
linked-body collision policy (#72), `STOP_ERP = 0.475`, rigid-body types and
Type-2 synchronization, joints, IK, reset/warmup, gravity, recovery behavior,
rendering, materials, lighting, animation clocks and Worker scheduling intact.
There is no public comparison UI or extra catch-up loop.

## Work and timekeeping trade-off

Bullet consumes all requested full steps from its accumulator before clamping
integration to `maxSubSteps`; excess time is discarded, not saved for later.
Its `stepSimulation` return value is the **requested** count, which can exceed
the actual integrated count. See the
[Bullet implementation](https://github.com/bulletphysics/bullet3/blob/master/src/BulletDynamics/Dynamics/btDiscreteDynamicsWorld.cpp).

Native Ammo integration and independent probe trajectories establish this
step-count impact at both supported baselines:

| Fixed step | Elapsed update | Requested full steps, depending on residual time | Previous cap 3 | Default cap 10 | Integrated work ratio |
| --- | --- | --- | --- | --- | --- |
| Default `1/60` | 100ms | 6 | 3 (50ms) | 6 (100ms) | 2× as many substeps |
| Default `1/60` | 250ms | 15 | 3 (50ms) | 10 (~166.67ms) | 3.33× as many substeps |
| Explicit `1/65` | 100ms | 6 or 7 | 3 (~46.15ms) | 6 or 7 (~92.31–107.69ms) | 2–2.33× as many substeps |
| Explicit `1/65` | 250ms | 16 or 17 | 3 (~46.15ms) | 10 (~153.85ms) | 3.33× as many substeps |

Counts in the table are nominal: Ammo single-precision rounding at an exact
`1/60` boundary can retain nearly a full step (for example, five integrations
on the first 100ms update), which is available on the following frame.

Residual time from earlier frames can make one update integrate more than its
own delta; cumulative simulation must not advance beyond cumulative elapsed
time (tests allow `2e-6` seconds of single-precision error). In the absence of
clamping, accumulated lag stays below one fixed step. At 30/60/120/144 FPS the
new limit does not add steps. At 20 FPS the `1/60` baseline needs three steps;
`1/65` sometimes needs a fourth. At 10 FPS the new limit permits six steps
at `1/60`, or six or seven at `1/65`, preserving the full fixed-step time budget.

These counts measure native integration work, not a universal wall-clock CPU
speed ratio: collision pairs, constraints, model size and the host affect cost.
Slow frames now allow more CPU work, which can worsen frame latency on a busy
machine. The public examples already limit forwarded frame deltas to 100ms.
Worker coalescing still caps accumulated time at 250ms; a full batch exceeds
the ten-step budget and still discards time. Arbitrarily long stalls remain
bounded and discarded time is not recovered on subsequent short frames.

Substeps do not reconstruct intermediate animated/kinematic target poses.
These checks do not prove native MikuMikuDance parity, eliminate other
regression risks or show that the maintainer's intermittent violent oscillation
is resolved. Optional post-merge real-model motion/stability review remains a
separate subjective assessment; it is not an approval or merge prerequisite.

## Automated evidence

`tests/physics-substeps.test.ts` runs 192 deterministic trajectory cases: both
binary PMD/PMX formats, standalone sync, two-model shared sync and two-model
Worker-owned worlds, omitted `unitStep` (`1/60`) and explicit `1/65`,
default cap 10 and explicit 3, at 10/20/30/60/120/144 FPS, a
one-off 100ms stall and a 250ms stall followed by short frames. Fixtures parse
through `mmd-parser` and `MMDLoader`. They contain a moving kinematic anchor, a
constrained dynamic body and an unbound, undamped, collision-free dynamic clock
probe under constant Z gravity. Tests observe actual Ammo 1.1.0 integration;
no solver or accumulator is replaced with a numerical model.

The probe's native/published trajectory must match the independently computed
semi-implicit Euler displacement `g * h² * n * (n + 1) / 2`, within `5e-4`
model units, for the number of completed steps. This catches dropped steps
that `stepSimulation` argument/return assertions alone cannot detect. Tests
check elapsed-time bounds, fractional frames with no integrated steps, retained
explicit caps and no later recovery of discarded long-stall time. Completed
Worker output is compared with synchronous native transforms and skeletal
poses at supported publication/projection boundaries, within `5e-4`. Identical
inputs are supplied through `onBeforePhysics`, including PMD zero-time pose
synchronization; this does not claim parity between delayed and current poses.

Sixteen further cases control Worker request/result delivery with the existing
real-runtime manual scheduler and structured-clone transfers. They batch
three 30ms pending frames plus a 10ms flush into 100ms; twenty pending 60 FPS
frames plus a flush hit the existing 250ms ceiling. Actual native integration,
coherent publication for two models, one in-flight request and no publication
before delivery are checked. Zero/invalid pending updates do not add time.
The scheduler helper was extracted unchanged for reuse; production scheduling
was not modified.

`tests/browser/physics-substeps.test.ts` additionally runs the built classic
Worker with real Ammo, both binary formats, two shared models, default and
explicit caps at both timestep choices, transferable buffers and isolated
SharedArrayBuffer transport.
It checks native clock trajectories, sync body/skeletal parity, mixed frame
rates, 100ms/250ms stalls and deterministically accumulated 100ms/250ms batches.
Only delivery of completed Worker messages is held to control batching; all
Worker execution, transport and solving are real. The batching ceiling is
checked against outgoing message deltas in the deterministic scheduler tests;
native trajectories independently verify bounded integration of those batches.

Existing fractional-time tests now include real-Ammo 10/20 FPS sequences, and
expectations of default 3 are updated. Existing tests retain short-delta,
zero/invalid-delta, custom step/limit, Type-2, damping and collision coverage.

Validation of the combined head on 2026-10-16 (supersedes the earlier
pre-merge-resolution results):

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed: library, examples, tools/tests and TypeScript source check |
| `npm test` | Passed: 669 tests, no skips, including 208 substep trajectory/batching cases |
| `npm run test:browser` | Passed: 31 tests, no skips; both rendering backends and both Worker transports |
| `npm run build` | Passed: package, declarations, example modules and bundled classic Worker |
| `npm run build:examples` | Passed: static site with verified pinned Miku PMD and Gene Light PMX assets |
| `MMD_EXAMPLE_SITE=dist/examples npm run test:examples` | Passed: 2 tests, no skips; real PMD, Worker Physics and Gene Light PMX at the Pages project path |
| `git diff --check` | Passed |

Browser validation uses the same macOS software WebGPU adapter setup documented
for [Issue #72](physics-linked-collision-validation.md): `CHROME_BIN` points to
a temporary launcher adding `--use-webgpu-adapter=swiftshader`. No rendering
assertions or timeouts are changed. Automated technical validation does not
establish subjective real-model visual stability; that assessment has not
been performed.

## Required post-merge verification

The following checks remain **PENDING** until after merge. They are not
pre-merge acceptance criteria or merge blockers.

| Evidence | Status |
| --- | --- |
| Merge-triggered GitHub Pages workflow URL and successful publication | PENDING |
| Published actual merge SHA and deployment date | PENDING |
| Public PMD model/animation example loads without asset/runtime errors | PENDING |
| Public Worker Physics example loads without asset/runtime errors | PENDING |
| Public Gene Light PMX example loads without asset/runtime errors | PENDING |

After merge, record the workflow URL, deployed SHA/date and example evidence
here or in Issue #74. Verify the merge-triggered
[Pages workflow](https://github.com/takahirox/three-mmd-loader/actions/workflows/examples-pages.yml)
publishes the actual merge SHA at <https://takahirox.github.io/three-mmd-loader/>.
Track any deployment problem separately. Successful publication and runtime
loading do not establish visual stability. The maintainer's optional motion
review can inform a later keep/revert decision independently of these checks.
