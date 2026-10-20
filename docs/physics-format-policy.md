# Unified PMD/PMX physics policy — Issue #92

PMD and PMX use the same physics processing after input normalization. Effective
Type 0 follows the skeleton through Bullet's kinematic MotionState; Type 1 gets
position and rotation from Bullet; Type 2 retains skeletal **local** translation
and gets rotation from Bullet. Type 2 never writes the native dynamic transform
after stepping or queues a next-step position alignment. Explicit reset and
reconstruction deliberately place all bodies at the input pose and clear their
velocity/history. Warmup uses the ordinary input/step/output pipeline.

This is a direct policy change, with no new option. It does **not** establish the
cause or resolution of the maintainer's intermittent violent PMD motion. Real
model visual improvement remains **UNVERIFIED** and is not an acceptance test.

## Physics-relevant format branch inventory

Audit scope: `src/loaders/MMDLoader.ts`, `src/animation/`, the `mmd-parser` input
boundary, normalized metadata in `src/types.ts`, and Worker protocol/runtime.
Material, texture, UV, rendering and skinning branches are outside this audit;
vertex morph indexing does not change skeletal/body input. The table includes
implicit property/capability checks as well as explicit `format`/`isPmd` tests.
The named methods are stable search anchors for the branches.

| Location / observed difference before #92 | Classification | Disposition / evidence |
| --- | --- | --- |
| `MMDLoader.load`, `loadPMD`, `loadPMX`: binary reader selected by file extension | Required file representation | Retain. PMD has fixed-width names/counts and separate IK records; PMX uses variable strings/index widths and bone flags. Both readers request right-handed conversion. Binary fixtures exercise both. |
| Parser handedness: positions, rotations, joint limits/springs reflected from file coordinates | Required file representation | Retain parser conversion, then common runtime. `physics-rotation`, `physics-joint-rotation` and `physics-linked-collision` test both parsed formats against scalar/native oracles. |
| Loader bone metadata: `transformationClass`/`flag` present only when the parsed bone has them | Genuine feature support | Retain PMX deformation order and phase bits. PMD records have neither field; parent/local rest coordinates are normalized identically. `physics-layers`, `grant` and `animation-warmup` cover ordering/rest inputs. |
| Loader IK: PMD separate `iks`, `maxAngle * 4`, conventional named knee axis; PMX bone `ik`, radians and explicit link limits | Required representation and genuine feature support | Retain. PMD has no per-link limit payload. Independent [PMD reader](https://github.com/noname0310/babylon-mmd/blob/master/src/Loader/Parser/pmdReader.ts) converts its cap by four and infers knee bounds; PMX limits need X/Y handedness reflection and bound exchange. `physics-format-policy` asserts cap/limit normalization; `ik` exercises analytical targets, PMD knee and PMX bounds. The knee convention is inferred metadata, not a separate physics solver. |
| Loader grants: extract `bone.grant` only from PMX input | Genuine feature support | Retain support for PMX append metadata, local/global modes and transform classes. PMD parsing exposes bone types rather than PMX grant payloads; broader PMD bone-type inheritance support is not implemented here. No format branch exists in the normalized GrantSolver. `grant` tests composition/order. |
| Loader bone/group morph extraction: PMX types 0/2 feed the skeletal controller; PMD morphs contain vertex data | Genuine feature support | Retain distinct input capabilities. PMX bone/group morphs can change before/after-physics input; PMD's vertex morph representation supplies no such bone payload. `bone-morph`, `physics-layers`, `animation-warmup` test phase input. PMX impulse/soft-body features are not implemented; this change adds none. |
| Loader rigid-body position: PMX model-space origin minus associated bone rest position; PMD already bone-relative | Required file representation | Retain. Unbound bodies use the common identity bone. Independent [Saba PMD/PMX constructors](https://github.com/benikabocha/saba/blob/29b8efa8b31c8e746f9a88020fb0ad9dcdcf3332/src/Saba/Model/MMD/MMDPhysics.cpp) compose these representations differently before constructing equivalent offsets. `physics-rotation` parses nonzero offsets from both binary formats; paired fixtures in `physics-format-policy` assert identical normalized bodies/constraints. |
| `RigidBody` mode-2 `skeletalPositionOnly` gated on PMX; PMD `updateBone/_setPositionFromBone` writes COM + MotionState | Legacy/unjustified behavior | Remove format gate and the native write method. Independent Saba `DynamicAndBoneMergeMotionState` is selected by **both** PMD DynamicAdjustBone and PMX DynamicAndBoneMerge; reflection only publishes a bone pose. Direct-Bullet oracle in `type2-physics` supplies numerical expectations without invoking adapter projection/input. |
| `RigidBody.updateFromBone`, `deferFromBone`, `setDeferredPose`: legacy mode-2 pending origin can reposition a dynamic body | Legacy/unjustified behavior | Remove dynamic staging/consumption entirely. Only mode 0 accepts deferred input; stale finite Type-2 slots cannot resurrect teleports. `worker-physics` inspects Worker-owned native bodies, including malicious/stale pending positions. |
| `WorkerPhysicsAdapter.deferAfterPhysics`: PMD mode-2 exception | Legacy/unjustified behavior | Remove; only phase-deferred Type 0 produces pending input in either format. Existing PMX post Type-0 scheduling remains tested by `physics-layers` and `physics-motion-state`. |
| `MMDPhysics.update`, helper shared update, Worker world/runtime: PMX-only read-only zero-time evaluation | Legacy/unjustified behavior | Apply to both formats: zero/negative/nonfinite physics delta never stages native MotionState inputs or integrates, and cannot flush elapsed-time backlog. Skeletal evaluation may refresh the next positive step's deferred Type-0 pose. Explicit reset publication remains allowed. `physics-format-policy`, `physics-timestep`, `physics-motion-state`, `worker-physics` cover sole-PMD, sole-PMX and mixed shared worlds. |
| Helper `pose`, `_addMesh`, `_getBoneMorphController`: PMX gets authored/rest/input/output snapshots/restoration; plain PMD uses old bone backup | Legacy/unjustified behavior | Share snapshots and authored-pose restoration for both formats. Paired tests exposed PMD `mixer.setTime` being overwritten by a stale backup and reset/warmup consuming projected output. New seek/loop tests assert authored scalar positions independently. The controller applies bone morphs only when normalized morph metadata exists. |
| Helper warmup: opt-out PMD without pose layers bypasses the normal animation/physics boundary | Legacy/unjustified behavior | Remove shortcut. Same warmup pipeline, fixed clock and reset input for both formats, including Worker completion/fallback. `physics-format-policy` compares trajectories through warmup/reset; `animation-warmup` covers startup ramps, cancellation and asynchronous edits. |
| Helper `pose`, `_animateMesh`, `_animateAfterPhysics`: PMX ordered before/after-physics IK/grants and post-layer composition | Genuine feature support | Retain. PMX flag `0x1000` and transformation classes have no PMD equivalent. Shared snapshots do not enable PMX phases on PMD. `physics-layers` tests both `pmxAnimation` settings, post ancestors, IK/grants, dynamic authority and joint-converted Type 1. PMD captures its common output snapshots without a post phase. |
| `RigidBody` and Worker adapter ancestor walk tests PMX `flag & 0x1000` | Genuine feature support | Retain. A post bone/ancestor's kinematic target is only available after physics and must be consumed next step. Type 2 is excluded regardless of phase. PMD has no post-physics flag. `physics-motion-state`, `physics-layers`, `worker-physics` test deferred Type 0 and non-deferred dynamic bodies. |
| Worker model `format` and copied bone flags/default PMD metadata | Required metadata / genuine feature support | Retain transport fields so the Worker can interpret PMX phases. It reconstructs skeletons and uses the same MMDPhysics implementation. No format-specific simulation policy remains there. Real bundled browser Worker tests run both binary formats and transports. |
| Modes/shapes/mass; damping, gravity, groups/masks; constraints/joints/springs/ERP; joint mode-2-to-1 normalization | No format difference after normalization | Common implementation retained. Loader joint conversion applies equally to both and publishes effective mode metadata. `physics-rotation`, `physics-joint-rotation`, `physics-damping`, `physics-linked-collision`, `physics-layers` verify the shared rules. Supported joint implementation remains the existing spring 6DoF; no new PMX joint kinds are enabled. |
| Positive delta / substep accumulator / max steps; reset manifold/velocity clearing; helper loop reset/seek; shared Sync clock; Worker buffers, latency, fallback and warmup | No other format-dependent simulation branch | Shared policies retained. `physics-substeps`, `physics-motion-state`, `animation-warmup`, `worker-physics` and new paired lifecycle tests cover these paths. Worker delay still means delayed display; equality is asserted on matching elapsed-time/input tapes. |

The independent-runtime comparisons above are source audits, not executions of
those complete engines. The policy follows the direct-Bullet numerical evidence
and does not import their gravity, timesteps, solver settings or collision policy.
The earlier [Issue #53 audit](type2-physics-validation.md) records the original
PMX-only correction; #92 supersedes its PMD compatibility exception.

## Regression evidence

`tests/type2-physics.test.ts` runs the same real Bullet shapes/joint construction
in a separate oracle world, stages only scalar kinematic MotionState inputs and
steps Bullet directly. Expected bone position comes from authored scalars;
rotation comes from parent/body/offset quaternion algebra. It never invokes the
oracle's dynamic projection, alignment or deferred input. PMD and PMX share
normalized fixture bodies/constraints; PMX additionally runs pre/post/post-parent
cases, both helper animation settings, and standalone/shared Sync. Tests run
60/120 FPS, joint-only, contact-only and simultaneous joint/contact variants.
Native/raw trajectories must match within `5e-4`, and repeated zero-time native
poses within `1e-7`. Contact-only fixtures must actually separate; joint-only
fixtures bound anchor error and require physical rotation. An explicit historical
teleport reproducer lives only in tests.

`tests/physics-format-policy.test.ts` checks equivalent parsed-model inputs across
standalone, helper/shared Sync, Worker transferable/shared, startup/runtime
fallback, warmup, reset and zero/positive delta. It compares actual Worker-owned
native transforms as well as published body results. Isolated animated Type 2
provides a constant native-position oracle while authored translation changes
through external mixer seeks and positive steps. Loops deliberately reset bodies;
tests check the resulting skeletal pose and native/output agreement. Type 0/1 regressions remain in the direct
Bullet oracle and scalar kinematic suites. `worker-physics` replays phase-boundary
tapes and injects stale dynamic staging slots; browser tests use the actual
bundled classic Worker, binary PMD/PMX modes 0/1/2, joints and collision masks in
both transferable and isolated SharedArrayBuffer contexts.

## Scope and rollback

The checked-in Ammo JS/WASM, Bullet commit
`d3afe76132fc76b0f9b2359cbaef47a3766e7fbb`, dependency versions, `unitStep=1/60`,
`maxStepNum=10`, substep calculation, ERP/solver, damping, gravity, contact masks,
linked collision policy and spring setup are unchanged. No new physics parameter,
transport contract, public option or feature flag is introduced. Historical
`updateBone` arguments remain accepted, but cannot enable dynamic alignment.
Internal legacy native-write code is removed. Revert the single Issue #92 change
commit to roll back this policy and its tests/docs; rebuild library/Examples.
That restores the old PMD behavior and its known divergence.

## Validation record

Validation on 2026-10-20 used `npm ci`, locked public dependencies, Node
`v24.12.0`, and Google Chrome `155.0.8059.85` (headless, WebGL/SwiftShader and
available WebGPU) on macOS.

| Actual check | Result |
| --- | --- |
| `npm run typecheck` | PASS: library, Examples, scripts/tests and TypeScript-only source check |
| `npm test` | PASS: 1,190 tests, default pinned real Bullet WASM |
| `npm run test:legacy` | PASS: 1,190 tests, existing compatibility Ammo WASM |
| `npm run build:examples` | PASS: library/declarations/classic Worker plus static site; verified public r171 Miku and pinned Gene Light assets, no generated model substitution |
| `MMD_EXAMPLE_SITE=dist/examples npm run test:browser` | PASS: 52 tests, zero failures/skips (697.86 s); real browser/Worker suite, locally served built Examples at `/three-mmd-loader/`, both real transports and both existing Ammo builds |
| `npm pack --dry-run --ignore-scripts` | PASS using the already compiled package; isolated consumer/install checks also passed in the unit suite |
| Local source Examples smoke | PASS: PMD Sync, PMX/Gene Light Sync and PMD Worker initialized WASM, loaded real models, advanced playback, and reported no new runtime errors; Worker completed sequence 63 in transferable mode |
| `git diff --check` | PASS |

[Local smoke evidence](physics-format-smoke.json) records exact loopback URLs,
browser identity, model/body counts, WASM/build identity, playback clocks and
runtime error list. The smoke waited for playback after startup warmup rather
than imposing a fixed wall-clock initialization time. The broad browser suite
also checks actual SharedArrayBuffer transport under cross-origin isolation and
Worker startup/runtime fallback. Source and static-site builds used these
worktree changes before the checkpoint commit; this is not evidence of a Pages
deployment or a published merge SHA.

Limits: synthetic joint/contact and short real-model playback checks establish
invariants, loading and execution only. No long-running visual PMD stability or
quality assessment was performed. No new engine/timestep parameter sweep was
used as acceptance evidence.

## Required post-merge verification

- **PENDING:** Inspect the latest attempt of the merge-triggered Pages workflow,
  confirm the merge SHA published successfully, and verify generated JS/WASM/
  Examples paths and version evidence (including deployment manifest and Bullet
  build identity). This node neither merges nor deploys.
- **PENDING:** Public-browser smoke of PMD, PMX/Gene Light and Worker Physics;
  record actual URLs, browser, WASM initialization, model loading, playback and
  runtime-error evidence. Local browser checks do not satisfy this requirement.
- Optional maintainer visual review at 60/120 FPS remains **UNVERIFIED** and is
  never a merge blocker or a claim that violent motion has stopped.
