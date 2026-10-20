# Initial animation pose warmup (#90)

Startup now introduces the animation's influence gradually at its **fixed
initial authored time**. The default 60 physics cycles contain 30 ramp stages
(`weight = (i + 1) / 30`) followed by 30 full-pose settling cycles. `warmup: N`
remains the total number of cycles: when N is below 30, all N cycles form the
ramp and the last reaches full influence. Each cycle still supplies `1/60`
seconds to physics. Bullet, its `unitStep=1/60`, substep limit, gravity, damping,
collision masks and joint settings have not changed.

The base is the model's authored local pose before initial mixer evaluation.
The target is the authored local pose after evaluating the mixer once at its
initial time, before bone morphs, IK, grants or physics. Local positions use
linear interpolation and quaternions use shortest-arc interpolation. Morph
influences scale from zero to their authored target values; group contributions
are resolved by the existing morph controllers. Each stage runs the existing
morph, IK/grant, before-physics, physics and after-physics pipeline. PMX post
bones retain their existing deferred kinematic-input schedule. The ramp never
samples a preceding dynamic-body pose or advances the animation clock.

The final stage copies the full authored target, including its quaternion
representation. Temporary blends do not change mixer action weights, original
bindings or clips. Morph influences retain the current stage while Worker
startup is displayed, so vertex, bone, material and UV morphs agree. Full authored
weights are restored at completion or removal. Authored restoration retains the full
target so untracked bones and procedural offsets cannot accumulate. Pose-only
PMX models use their current authored pose and ramp any morph influence;
unanimated PMD models keep ordinary physics-only settling.

Each model owns one startup transition. A shared-world warmup advances all
participants' physics through both pose phases while holding their respective
authored times. Only the model whose startup is being warmed advances its ramp;
already-running participants are not reset or blended back to their start pose.
Later explicit `physics.warmup(N)` calls settle at the current authored time
without creating another startup ramp. Ordinary updates, seeks and loops do
not create ramps.

Worker startup uses the same snapshots and stages. The helper holds mesh,
camera and audio playback clocks together while warmup is queued or in flight,
including delayed model readiness. Each accepted
result completes its pose phases before the next stage is submitted. Both
transferable and shared buffers use this path. Warmup calls made during startup
append cycles; they do not restart the ramp. Worker fallback rebuilds the world
as before, continues the remaining stages, and replays an unaccepted in-flight
stage on the rebuilt world. `physics.ready` means initialization or fallback
has completed; queued warmup may still remain. `workerStatus` reports remaining
cycles and in-flight work.

Disabling physics during Worker startup cancels its queued transition and
releases the full authored pose so animation can play. Re-enabling physics
resets the cancelled participant at its current pre-physics pose; it does not
resume the old start-time ramp. Results rejected by buffer validation replay
their unaccepted warmup stage on synchronous fallback.

## Opt out or revert

`animationWarmup: false` disables the startup animation transition and retains
the existing opt-out path. `warmup: 0` disables warmup steps while evaluating
the full initial animation pose.

For immediate full-pose initialization followed by the previous 60-cycle
settling policy, use the existing options and adapter method:

```ts
helper.add(mesh, { animation, warmup: 0 });
helper.objects.get(mesh)!.physics!.warmup(60);
```

This also works with Worker options on `add()`. It does not add cycles to the
default budget or change Bullet settings. Reverting the Issue #90 implementation
commit and rebuilding restores the earlier default policy without a comparison
UI or another Bullet change.

## Automated evidence

`tests/animation-warmup.test.ts` runs real pinned WASM Bullet with binary PMD and
PMX fixtures. The PMD fixture has a kinematic anchor and constrained dynamic
body. The PMX fixture has pre/post IK, ordered grants, bone/group morphs and all
body modes. Tests inspect input positions, short-arc rotations, weights,
authored/morphed layers, fixed mixer/action time, exact native step arguments,
final full-pose equivalence, finite transforms and deterministic first playback
across repeated Sync and Worker startup. Coverage includes 0/1/7/30/default 60
cycles, standalone/shared worlds, delayed readiness, queued warmup, joining a
world during an in-flight final stage, and fallback during the ramp. Existing
layer, seek/reset/loop, morph and body regressions remain in place.

`tests/browser/animation-warmup.test.ts` runs actual bundled Workers in Chrome
with native Bullet instrumentation. Both nonisolated transferable buffers and
isolated shared buffers exercise PMD/PMX, standalone/shared startup and actual
Ammo-loading failure with synchronous fallback. It checks 60 native calls with
the original step arguments and 30 ramp + 30 full-pose inputs, then normal
playback. Existing browser suites and local Examples smoke tests exercise the
actual rendered PMD, Gene Light PMX and Worker pages.

These checks establish initialization behavior and publication readiness.
They do not establish an improvement in hair/clothing motion or rare physics
breakage. Command results and local smoke evidence are recorded in
[the validation record](animation-warmup-validation.json).

## Required post-merge verification — pending

- **PENDING:** Inspect the latest attempt of the merge-triggered
  `examples-pages.yml` run for the merge commit. Record run ID, attempt number,
  status/conclusion and any retry/failure. Confirm the published
  `deployment-manifest.json` commit matches that SHA, and check hashes/loading
  paths for `src/animation/MMDAnimationHelper.js`,
  `src/animation/InitialAnimationPose.js`, `src/animation/MMDPhysicsWorker.js`,
  `examples/ammo-runtime.js`, `examples/vendor/bullet/ammo.js` and `ammo.wasm`.
- **PENDING:** Open the public PMD, Gene Light PMX and Worker Examples at
  `https://takahirox.github.io/three-mmd-loader/examples/` with their respective
  `webgl_loader_mmd.html`, `webgl_loader_mmd_pmx_gene.html` and
  `webgl_loader_mmd_worker.html` paths. Record URLs, browser/version and evidence
  that assets load, physics initializes, warmup ends, playback advances and no
  runtime errors occur. Confirm the Worker and WASM loading paths in the
  browser. This is a publication/startup check.
- **UNVERIFIED, optional:** The maintainer may later inspect actual-model motion
  and rare severe 120 FPS behavior. No appearance or stability result is claimed
  by this change or its automated tests.

Post-merge checks do not gate pre-merge approval. No public-site check has been
performed for this unmerged worktree.
