# Fractional physics time and default interval — Issues #68 and #75

Since Issue #68, `MMDPhysics._stepSimulation` forwards each positive finite elapsed delta
unchanged, including values below `unitStep`. Bullet accumulates that fractional
time and integrates fixed substeps only when enough time has arrived. The
inherited Three.js implementation deliberately forced at least one `1/65` step
for perceived stability; at 120/144 FPS this made simulation run faster than
elapsed time. Removing that floor is a focused, reversible timekeeping
experiment, not a proven cure for the reported oscillation. Motion and settling
characteristics may differ, especially at high refresh rates.

Issue #75 changes only the default fixed interval from `unitStep = 1/65` to
`1/60` seconds. Explicit overrides (including `1/65`), the default
`maxStepNum = 3`, and the existing `floor(delta / unitStep) + 1` budget capped at
`maxStepNum` remain. The historical claim that `1/60` broke models more easily
has no established reproduction or demonstrated applicability to the current
implementation. Trying `1/60` again is an experiment; it is not a confirmed fix
for intermittent severe, persistent instability.
Issue #68 also replaced signed 32-bit truncation with `Math.floor` so large finite deltas cannot
wrap the substep budget to zero or negative. Long stalls still lose simulation
time when the required substeps exceed the cap; catch-up policy is a separate
experiment. No body, joint, damping, collision, gravity, IK, type-2, reset/warmup
or Worker scheduling policy changes are included.

Zero, negative and non-finite deltas never call Bullet. PMX zero-time skeletal
evaluation retains its existing behavior. PMD deliberately stops forcing a
physical step at zero/negative time, while retaining its legacy bone/body pose
synchronization (including type-2 alignment). Thus PMD pose synchronization can
still write a transform without advancing the simulation clock. The same
stepping function serves standalone sync, shared sync and Worker-owned worlds.

## Automated evidence

`tests/physics-timestep.test.ts` records the actual `world.stepSimulation`
arguments for short, equal, ordinary and long deltas, custom parameters, zero
and invalid time. Shared PMD/PMX worlds are checked for one call per positive
frame. The former JavaScript accumulator model has been replaced with 48
real-Ammo cases: parsed binary PMD and PMX fixtures, standalone sync, shared
sync and Worker-owned shared worlds, omitted `unitStep` and explicit `1/65`,
and 30/60/120/144 FPS. A constrained, undamped dynamic probe moves at one model
unit per second along the joint's free axis, with contacts disabled by authored
masks. Its native displacement independently measures actual simulated time.
A quarter-step prefix completes no substep and is retained across invalid
updates. Each following one-second cadence completes 60 or 65 steps, with lag
below one fixed step (`2e-6` seconds tolerance) and native displacement error
below `3e-5` model units. A 250 ms stall executes exactly three substeps. Tiny
and full-step updates afterward verify fractional retention without replaying
discarded stall time. Bullet returns the requested count before clamping, so
that return value alone cannot establish the executed work; native motion is
checked on every update. Shared paths check both probes and one world call per
frame. Worker add messages must contain the selected interval and unchanged cap.
The deterministic Worker scheduler uses structured-clone ownership transfers
and the production runtime with actual Ammo; it does not create an OS thread.

The same rates also run real Ammo with a moving kinematic/constrained pair and
an isolated undamped dynamic probe in both PMD and PMX. The probe's native
translation must equal the time integrated by actual completed Bullet steps
within `3e-5` model units, with accumulated time within one fixed step of elapsed
time (`2e-6` seconds tolerance for Ammo's single-precision arithmetic). Invalid
updates cannot move that probe or invoke Bullet. At 120/144 FPS, some positive
frames must complete zero substeps.

`tests/worker-physics.test.ts` replays identical pre-physics input tapes through
real Ammo sync and Worker-owned worlds at all four rates, with moving kinematic
bodies, joints/contacts, pre/post/post-parent PMX phases, PMD modes 0/1/2 and
zero-time updates. It records Worker-owned Bullet arguments and compares raw
outputs/native poses and supported skeletal boundaries within `5e-4`. These
comparisons concern completed simulation boundaries; delayed display and queue
coalescing policies remain unchanged. The browser regression also mixes these
rates through the bundled classic Worker, with Transferable and SAB transports,
and verifies that the first short frame does not integrate a dynamic body.
Both the omitted default and explicit `1/65` now run through the actual bundled
Worker for PMD/PMX joint/contact fixtures and PMX sync/Worker comparisons, with
both transports and constrained IK variants. Worker implementation and
queue/coalescing policy are unchanged.

## Step-count and CPU-work implications

Measured by the native probe over each one-second cadence after a quarter-step
prefix (which avoids ambiguous float boundaries):

| Render rate | Default `1/60` steps | Explicit `1/65` steps | Mean substeps/frame (`1/60` vs `1/65`) |
| --- | --- | --- | --- |
| 30 FPS | 60 | 65 | 2 vs 2.167 |
| 60 FPS | 60 | 65 | 1 vs 1.083 |
| 120 FPS | 60 | 65 | 0.5 vs 0.542 |
| 144 FPS | 60 | 65 | 0.417 vs 0.451 |

This is five fewer integrations per simulated second, about 7.7% fewer fixed
steps, while each step is about 8.3% longer. Substep count is a CPU-work proxy,
not a measured wall-clock or FPS improvement: solver/contact complexity,
rendering, Worker messaging and per-frame synchronization still contribute.
The unchanged three-step cap integrates at most 50 ms per call at `1/60`, versus
about 46.154 ms at `1/65`; stalls still discard excess whole steps. A longer
fixed interval could degrade joint stability despite the slightly lower work.
These tests do not establish visual/physical parity with MikuMikuDance or fix
the intermittent violent oscillation.

## Validation for Issue #75

Validation completed on 2026-10-16 (JST):

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed: library, examples, tools/tests and TypeScript source check |
| `npm test` | Passed: 457 tests, no skips |
| `npm run test:browser` | Passed: 29 tests, no skips, including both timestep choices through real Worker transports |
| `npm run build` | Passed: package, declarations, examples modules and bundled Worker |
| `npm run build:examples` | Passed: static site with verified pinned Miku and Gene Light assets |
| `MMD_EXAMPLE_SITE=dist/examples npm run test:examples` | Passed: 2 tests, no skips; real PMD, Worker Physics and Gene Light asset loading/runtime checks at the Pages project path |
| `git diff --check` | Passed |

Maintainer real-model visual evaluation at ordinary/high refresh rates has
**not been performed**. It is an optional separate follow-up to assess motion,
persistent oscillation and whether to keep or revert the experiment. Automated
checks are not a subjective visual stability assessment.

## Required post-merge verification

This worktree cannot verify a future merge deployment. These items remain
**PENDING** and do not block pre-merge approval:

| Evidence | Status |
| --- | --- |
| Merge-triggered GitHub Pages workflow URL, final run attempt and result | PENDING |
| Deployed merge SHA and deployment date | PENDING |
| Public PMD model/animation example loads without asset/runtime errors | PENDING |
| Public Worker Physics example loads without asset/runtime errors | PENDING |
| Public Gene Light PMX example loads without asset/runtime errors | PENDING |

After merge, record the workflow URL, final run attempt/result, deployed SHA/date
and results here or in the issue. Re-check the latest workflow attempt after a
transient HTTP 503 or browser-test timeout; an unfinished check is not a pass.
Confirm that the merge-triggered workflow published the merge commit
at <https://takahirox.github.io/three-mmd-loader/>. Track any publication failure
separately from this timekeeping experiment.
