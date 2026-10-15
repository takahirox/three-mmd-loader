# Fractional physics time — Issue #68

`MMDPhysics._stepSimulation` now forwards each positive finite elapsed delta
unchanged, including values below `unitStep`. Bullet accumulates that fractional
time and integrates fixed substeps only when enough time has arrived. The
inherited Three.js implementation deliberately forced at least one `1/65` step
for perceived stability; at 120/144 FPS this made simulation run faster than
elapsed time. Removing that floor is a focused, reversible timekeeping
experiment, not a proven cure for the reported oscillation. Motion and settling
characteristics may differ, especially at high refresh rates.

The default `unitStep = 1/65`, default `maxStepNum = 3`, parameter overrides and
existing `floor(delta / unitStep) + 1` budget capped at `maxStepNum` remain.
`Math.floor` replaces signed 32-bit truncation so large finite deltas cannot
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
frame. One-second 30/60/120/144 FPS sequences feed a deterministic Bullet-style
accumulator; simulated time must lag elapsed time by less than one fixed step
and may never run ahead (apart from numerical tolerance).

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

Validation on 2026-10-15:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed: library, examples, tools/tests and TypeScript source check |
| `npm test` | Passed: 365 tests |
| `npm run test:browser` | Passed: 25 tests; no skips, including both real Worker transports |
| `npm run build` | Passed: package, declarations, examples modules and bundled Worker |
| `npm run build:examples` | Passed: static site with verified pinned Miku and Gene Light assets |
| `MMD_EXAMPLE_SITE=dist/examples npm run test:examples` | Passed: 2 tests; real PMD, Worker Physics and Gene Light at the Pages project path |
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
| Merge-triggered GitHub Pages workflow URL | PENDING |
| Deployed merge SHA and deployment date | PENDING |
| Public PMD model/animation example loads without asset/runtime errors | PENDING |
| Public Worker Physics example loads without asset/runtime errors | PENDING |
| Public Gene Light PMX example loads without asset/runtime errors | PENDING |

After merge, record the workflow URL, deployed SHA/date and results here or in
the issue. Confirm that the merge-triggered workflow published the merge commit
at <https://takahirox.github.io/three-mmd-loader/>. Track any publication failure
separately from this timekeeping experiment.
