# Linked-body collision policy — Issue #72

`MMDPhysics` registers each joint with `world.addConstraint( constraint, false )`.
Bullet's second argument is `disableCollisionsBetweenLinkedBodies`: `true`
adds collision-ignore references for the linked bodies; `false` leaves contact
subject to the normal group/mask filtering. Both bodies' masks must allow the
other body's group. The constraint remains registered and solves in either
case. See Bullet's [API](https://github.com/bulletphysics/bullet3/blob/master/src/BulletDynamics/Dynamics/btDiscreteDynamicsWorld.h),
[registration implementation](https://github.com/bulletphysics/bullet3/blob/master/src/BulletDynamics/Dynamics/btDiscreteDynamicsWorld.cpp)
and [ignore-reference handling](https://github.com/bulletphysics/bullet3/blob/master/src/BulletDynamics/Dynamics/btRigidBody.cpp).

This changes the inherited [legacy Three.js policy](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/animation/MMDPhysics.js),
which passed `true`.
[Saba](https://github.com/benikabocha/saba/blob/master/src/Saba/Model/MMD/MMDPhysics.cpp)
uses Bullet's default `false`;
[babylon-mmd's Bullet backend](https://github.com/noname0310/babylon-mmd/blob/main/src/Runtime/Optimized/Physics/mmdBulletPhysics.ts)
and [UMTNativePlugin](https://github.com/CandidumGames/UMTNativePlugin/blob/main/Source/NativeContext.cpp)
pass explicit `false`. These references motivate a focused compatibility
experiment; they do not independently prove native MikuMikuDance's policy.

**Risk:** Contact separation for already-overlapping connected bodies can
compete with joint position/rotation limits, increasing vibration, jitter or
instability. This experiment is not a demonstrated fix for the maintainer's
intermittent violent oscillation. The maintainer can later assess real-model
motion by eye and decide whether to retain or revert it. That optional visual
review is not a pre-merge gate and has not been performed.

Only joint registration changes in production. Joint frames, geometry, body
types, model group/mask values, spring parameters, limits, `STOP_ERP = 0.475`,
damping, timekeeping, IK and Type-2/body synchronization retain their existing
behavior. The common implementation serves standalone sync, shared sync and
Worker-owned worlds, with no new public setting or comparison UI.

## Automated evidence

`tests/physics-linked-collision.test.ts` parses generated binary PMD and PMX
fixtures through `mmd-parser` and `MMDLoader`, checking the original group/mask
metadata survives. Each fixture has two radius-0.5 spheres initially separated
by 0.75 units, in groups 2 and 7. A kinematic anchor and dynamic probe have a
joint that allows X separation while locking Y/Z and rotation. Each run uses
zero gravity and exactly 24 updates of `1/65` seconds in pinned real
`ammojs-typed` 1.1.0. Native wrapper subclasses only observe worlds and bodies;
allocation, collision detection, filtering and solving still run in Ammo.

The 42 cases cover both formats in standalone sync, two-model shared sync and
`PhysicsWorkerRuntime.handle(add/frame)`:

- Permitted linked and unlinked pairs produce native penetrating manifold
  points, positive contact impulses and X separation beyond 0.95 units.
- Rejecting either linked body's mask prevents contacts, impulses and
  separation. An unlinked blocked pair provides the filtering control.
- With contacts blocked, a probe driven at unit Y velocity stays on the
  joint's locked axis; the identical unlinked probe travels over 0.3 units.
  This verifies non-contact constraint solving remains active.

As a regression control, temporarily restoring the old `true` registration
fails exactly the six permitted linked-contact cases (both formats, all three
paths), while the other 36 cases still pass. The final source uses `false`.

The bundled classic Worker browser regression also runs both binary formats,
with two separated copies of each case sharing one Worker world, through
transferable and shared transports. It checks permitted separation,
either-mask rejection and a moving-anchor joint response against an unlinked
non-contact control, using 12 fixed updates per case. Existing Type-2,
physics-layer, fractional-time and
sync/Worker parity regressions remain applicable. Their shared phase fixture
now explicitly masks out only the anchor/joint-probe pair, preserving its
separate joint and unlinked-contact oracles under the new policy. The Type-2
contact variant explicitly re-enables that mask when it removes the joint.
The former implicit suppression allowed these oracles to depend on joint
registration. With linked contact enabled, their slightly different input
paths exceeded the existing parity tolerance; explicit fixture filtering
restores the intended isolation without changing tolerances or production
synchronization. Permitted linked contact is covered by the dedicated native
and Worker cases above.

Validation on 2026-10-15:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed: library, examples, tools/tests and TypeScript source check |
| `npm test` | Passed: 413 tests, no skips, including 42 focused real-Ammo cases |
| `npm run test:browser` | Passed: 25 tests, no skips; both rendering backends and both Worker transports; software adapter setup below |
| `npm run build` | Passed: package, declarations, example modules and bundled classic Worker |
| `npm run build:examples` | Passed: static site with verified pinned Miku PMD and Gene Light PMX assets |
| `MMD_EXAMPLE_SITE=dist/examples npm run test:examples` | Passed: 2 tests, no skips; real PMD, Worker Physics and Gene Light PMX at the Pages project path; same software adapter |
| `git diff --check` | Passed |

Browser environment: on this macOS host, an isolated probe found that the
default `navigator.gpu.requestAdapter()` stalled, while frame callbacks and
WebGL2 worked. The initial default-adapter suite timed out in existing
rendering tests and was stopped. Validation uses `CHROME_BIN` pointing to a
temporary launcher that adds Chromium's explicit software WebGPU adapter:

```sh
#!/bin/sh
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --use-webgpu-adapter=swiftshader "$@"
```

This selects a [supported Chromium/Dawn test adapter](https://dawn.googlesource.com/dawn/+/HEAD/webgpu-cts/README.md)
without changing repository test assertions, timeouts or backend coverage.
Use `CHROME_BIN=/path/to/launcher npm run test:browser` (and the same environment
for `test:examples`) to reproduce this host's setup. A probe confirmed WebGPU
adapter/device creation and WebGL2 with the launcher.

These checks establish collision policy and technical regression coverage,
not subjective visual stability.

## Required post-merge verification

PR #73 merged with a merge commit, `0876a28de0ac9a02aba69251e1adafd760e0f580`,
at 2026-10-15 05:37:18 UTC. Issue #72 was read immediately before the merge
and confirmed open; GitHub accepted the expected PR head. The
[post-merge Tests workflow](https://github.com/takahirox/three-mmd-loader/actions/runs/38687772606)
passed.

| Evidence | Status |
| --- | --- |
| Merge-triggered [GitHub Pages workflow](https://github.com/takahirox/three-mmd-loader/actions/runs/38687772616) | FAILED before deployment: gallery browser test timed out after 300 seconds; last reported stage `history Forward` |
| Published actual merge SHA and deployment date | PENDING |
| Public PMD model/animation example loads without asset/runtime errors | PENDING |
| Public Worker Physics example loads without asset/runtime errors | PENDING |
| Public Gene Light PMX example loads without asset/runtime errors | PENDING |

The Pages run targeted the actual merge commit. Its separate Gene Light
built-site test passed, but the failed gallery test caused setup and deployment
to be skipped. At 2026-10-15 05:43:45 UTC, the public deployment manifest still
reported the previous commit, `93c515405d623433cb8d1fdebabc54eaba9a9063`.
Checks against that older deployment would not verify this merge.

Handle the Pages test timeout as a separate deployment follow-up. After
successful publication, verify the actual merge SHA/date and all three public
examples at <https://takahirox.github.io/three-mmd-loader/>. These checks remain
**PENDING**; no manual visual review has been performed. Machine-readable
merge and deployment evidence is in [issue-72.json](deployment-evidence/issue-72.json).
