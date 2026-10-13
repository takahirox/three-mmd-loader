# PMX type-2 synchronization audit — Issue #53

PMX type 2 now preserves skeletal translation and applies physical rotation on
the bone, while Bullet retains the native body's translation and rotation.
The correction removes both pre-phase post-step alignment and post-phase
next-step alignment for PMX. PMD's legacy alignment remains. No time-step,
transport, public option, or mode-1 authority change is involved.

## Requirements and compatibility policy

The [PMX format description](https://gist.github.com/felixjones/f8a06bd48f9da9a4539f/38797afea2bdaaa0eb391a179542444142e269cd#rigid-bodies)
defines the rigid-body mode byte, body pose, mass, collision filtering and joints.
Its mode-2 designation combines physics and bone position; it does not prescribe
a Bullet `setCenterOfMassTransform` call or a pre/post-step alignment schedule.
This document distinguishes that format meaning from the native positioning
policy chosen for compatibility.

[Bullet's step implementation](https://github.com/bulletphysics/bullet3/blob/master/src/BulletDynamics/Dynamics/btDiscreteDynamicsWorld.cpp)
detects collisions, solves contact/joint constraints, and integrates transforms.
Writing a transform afterward does not rerun those operations. An alignment
before the next solve is temporally honest, but still injects a discontinuity
into a dynamic trajectory while retaining velocity. Whether an MMD adapter
should do so is a compatibility decision, not a Bullet requirement.

The independent runtime audit, performed on 2026-10-14, found:

| Runtime/source | Bone translation and rotation | Native body positioning |
| --- | --- | --- |
| [Three.js r169 `MMDPhysics`](https://github.com/mrdoob/three.js/blob/r169/examples/jsm/animation/MMDPhysics.js), `updateBone`/`_setPositionFromBone` | Retains type-2 bone position; obtains rotation from body × inverse offset, relative to parent | After projection, copies the bone/body-offset origin into COM and motion state |
| This project's previous adapter (Issue #39) | Retains skeletal position, physical rotation, and PMX post composition | Same write for pre bones; final position staged for post bones/post ancestors and consumed before the next step |
| [Saba at `29b8efa`](https://github.com/benikabocha/saba/blob/29b8efa8b31c8e746f9a88020fb0ad9dcdcf3332/src/Saba/Model/MMD/MMDPhysics.cpp), `DynamicAndBoneMergeMotionState::ReflectGlobalTransform` | Converts body × inverse offset, restores the skeletal global translation, publishes the bone transform | Dynamic motion state stores the Bullet result; bone reflection does not reposition the native body |
| [babylon-mmd at `ccb750d`](https://github.com/noname0310/babylon-mmd/blob/ccb750db2998ed1067017eaf67f3fc987cfba6f8/src/Runtime/Physics/mmdAmmoPhysics.ts), `syncBodies`/`syncBones` | PhysicsWithBone saves/restores skeletal world translation around physical rotation projection | With physics enabled, `syncBodies` leaves both dynamic modes alone; `syncBones` does not write the native body. Initialization and explicitly disabled physics have separate paths |

These are source comparisons, not executions of those entire render engines.
Their shared skeletal-only merge supplies the independent expected policy for
the numerical oracle below. The correction is justified by measured solver
damage, rather than by assuming every native detail must match another runtime.
It intentionally allows an authored type-2 bone to be spatially separated from
its dynamic body: joints, contacts and kinematic anchors move the native body.
Authored skeletal movement alone does not drag it. Reset still places bodies at
the controlling phase pose.

## Enforced invariants

For effective PMX mode 2:

1. Preserve the authored/pre/final skeletal position at its phase boundary.
2. Compute local physical rotation as
   `inverse(parentWorldRotation) * bodyRotation * inverse(bodyOffsetRotation)`.
   Post bones then append authored rotation and ordered post grant/IK, as in
   Issue #39. Reproject when a post ancestor moves; never double-apply the offset.
3. COM position and rotation remain the integrated Bullet result after
   projection. Preserve velocities, collision/constraint state and the dynamic
   trajectory; neither bone projection nor post staging writes native poses.
4. There is no type-2 next-step alignment input, including for post ancestors.
   Worker capture emits an absent input; the runtime also ignores a supplied
   type-2 deferred pose. Post mode 0 still consumes the preceding completed final
   pose on the next positive step. A later pose never influences an earlier step.
5. `bodyResults` remains the raw COM result captured before adapter alignment.
   It equals the native PMX type-2 result. PMD can still differ after its legacy
   alignment. PMX `delta=0` evaluates the skeleton without advancing/writing bodies.
6. Reset positions bodies from the reset/before-physics pose, clears deferred
   state and velocities/contact history, and captures reset results. Warmup uses
   the regular phase schedule. Joint-converted effective type 1 remains type 1
   for projection and input authority, even if the file's original mode was 2.

## Executable discrepancy

`tests/type2-fixture.ts` parses the repository's authored binary PMX fixture and
creates a mode-0 sphere, an effective type-2 body under a moving/rotating parent,
and a mode-1 probe. The type-2 body has translation and Euler rotation offsets.
One variant locks joint translation to the kinematic sphere with free rotation;
another places an overlapping type-2 sphere in contact with it. No private model,
network download, deployment or manual visual review is required.

`tests/type2-physics.test.ts` constructs a separate real Ammo/Bullet oracle world.
Construction shares the adapter's shapes/joint setup, but the oracle directly
steps Bullet and writes only scalar mode-0 input. It never invokes dynamic
synchronization/projection/staging. The expected bone translation and rotation
are checked independently from authored scalars and quaternion algebra. This
isolates the audited synchronization defect rather than testing shape loading.

Before the correction, the new pre-phase test failed on frame 0:

| Quantity (constrained fixture, first frame) | Independent expectation | Previous result | Corrected result |
| --- | --- | --- | --- |
| Bone parent-space position | `(2, -0.3, 0.2)` | Same | Same |
| Pre bone local quaternion | Identity within numerical tolerance | Same | Same |
| Raw Bullet body position | `(0.85, 0.10, 0)` | Same | Same |
| Native position after projection | Raw Bullet position | `(2.70, 0.30, 0.20)` | Raw Bullet position |
| Post bone local quaternion | Physical rotation × authored Y rotation of 0.2 rad | Same on first frame | Same |
| Post next-step position input | Absent | Approximately `(2.69601, 0.30, 0.16027)`; post-ancestor case `(2.70, 0.30, 0.20)` | Absent |

The pre-phase native write jumps 1.87150 units after the completed joint solve.
The raw first-frame body quaternion is approximately
`(0.034271, -0.106021, 0.143572, 0.983347)`; removing the body rotation offset
produces the expected bone rotation. The contact fixture's raw first-frame
position is `(-0.77, 0, 0)` after separating overlapping spheres; the old pre
alignment instead places it at approximately `(1.20, 0.20, 0.20)`.

The permanent `reproduce legacy type2 alignment damage` tests replay the old
schedule explicitly: pre alignment uses the retained legacy method after each
step; post alignment writes the preceding computed final origin before the next
step, preserving native rotation. The corrected adapter runs alongside it with
identical inputs. Reported 60-frame measurements (model units):

| Controlling phase | Old maximum joint-anchor error | Corrected maximum joint-anchor error | Maximum native trajectory difference, joint / contact |
| --- | --- | --- | --- |
| Pre | 4.73560 | 0.00167 | 3.90606 / 4.34463 |
| Post | 2.06518 | 0.00167 | 2.03582 / 4.35877 |
| Post ancestor | 2.06660 | 0.00167 | 2.03768 / 4.31621 |

Post alignment correctly avoids a first-frame post-step teleport, but begins
injecting positions on frame 1 and changes subsequent constraints/contacts.
Simply moving the pre write before integration would retain that demonstrated
trajectory mismatch. Skeletal-only merging removes both writes while retaining
the expected bone pose. Contact comparisons measure actual body movement and
trajectory error; joint error compares the two rotated native joint anchors.

Reproduce with:

```sh
npm ci
npm run build
node --import tsx --test tests/type2-physics.test.ts tests/physics-layers.test.ts tests/worker-physics.test.ts
```

The new oracle matrix covers pre/post/post-parent, both `pmxAnimation` values,
individual/shared worlds, contacts/joints, 60 moving frames and repeated zero
delta calls. Native transform comparisons use absolute component tolerance
`5e-4`; zero-time native stability uses `1e-7`. Joint-anchor bounds are `0.06`
for the broad matrix and `0.006` for the measured legacy comparison. Contacts
must cause at least `0.1` displacement, so a disabled collision path cannot pass.

Reset/warmup tests exercise rotated parents/offsets and physical rotation.
Existing layer lifecycle tests now explicitly check type-2 native state through
warmup, reset, paused seeks, loops and transfer. Existing post grant/IK and
joint-conversion tests retain their mode-1 authority guarantees. Old alignment
assertions in `physics-layers.test.ts` were changed using the independent
Saba/Babylon policy and direct-Bullet oracle; the reset position-only case now
isolates collisions so its constant-position expectation is valid.

Worker tests replay the exact sync pre-physics tape for all three phases and both
joint/contact fixtures, including zero delta. They compare raw output, actual
Worker-owned native transforms and bones at the simulation boundary within
`5e-4`; post-composed display poses are evaluated later. Browser tests exercise
the bundled classic Worker with moving authored type-2 bones and a real joint in
both Transferable and SAB modes, comparing raw results to the same sequence.
Existing bounded scheduling, visual delay, stale-generation, no-main-Ammo,
transport and no-main-thread-wait tests remain in place. PMD retains native
alignment; additional synthetic PMD adapter tests replay modes 0/1/2 with real
joints/contacts, zero delta and reset in sync and Worker, supplementing the
parsed PMD fixture tests.

## Validation

Checks run on 2026-10-14 with locked public dependencies and the repository's
headless Chrome runner:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed: library, examples, tools/tests and TypeScript source check |
| `npm test` | Passed: 285 tests |
| `npm run test:browser` | Passed: 21 tests, including both real Worker transports |
| `npm run build` | Passed: package, declarations and bundled classic Worker |
| `git diff --check` | Passed |

Required post-merge verification for this issue is **none**. Optional visual
inspection of hair/skirt models has not been performed and is not a completion
requirement.
