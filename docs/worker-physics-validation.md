# Worker physics validation — Issue #47

Implemented setup-time `physicsMode: 'sync' | 'worker'` (sync default),
Worker-owned Ammo initialization/worlds, transferable and atomic SAB mailboxes,
PMX pose projection, coordinated shared-world stepping, lifecycle invalidation,
and documented synchronous fallback. Simulation and body rules reuse
`MMDPhysics` through a worker-side skeleton adapter; scene objects and native
Ammo objects are never transferred.

Validation performed on 2026-10-13 in the assigned GitWeave worktree, using
Node.js 24.12.0 and the repository's headless Chrome runner:

| Check | Result |
| --- | --- |
| `npm ci` | Passed; locked dependencies installed |
| `npm run typecheck` | Passed, including examples/tools and TypeScript source checks |
| `npm test` | Passed: 241 tests, including 17 deterministic worker tests |
| `npm run test:browser` | Passed: 20 tests, including isolated SAB, non-isolated transferable, and actual demo reload/timing checks |
| `node --import tsx --test tests/browser/worker-physics.test.ts` | Passed: all 3 worker/demo integration tests rerun after the final zero-time scheduling adjustment |
| `npm run build` | Passed; includes the bundled classic worker and declarations |
| `npm run build:examples` | Passed with downloaded public example assets and notices |
| `git diff --check` | Passed |

Deterministic tests exercise default/explicit mode selection, existing sync
semantics, worker operation without main-thread Ammo, bounded frame submission,
transfer ownership, stale/out-of-order/duplicate notifications, elapsed-time
coalescing, zero-time evaluation, fixed-time asynchronous warmup while rendering,
gravity, reset/disable/remove/disposal races, watchdog/startup/decode/runtime
fallback, unavailable SAB, and incomplete atomic publication. Real Ammo
comparisons replay changing PMX inputs with modes 0/1/2, constraints and post IK,
check delayed pose-layer projection and zero-time stability, exercise PMD
minimum steps, and compare interacting models in one shared Bullet world.

Browser tests load the packaged classic worker and Ammo script, check both
transports on separate non-isolated/isolated servers, shared results, dynamic
post IK, reset/removal and a failing Ammo URL. The real animation page is loaded
with generated fixture assets; its selector reloads between worker and sync and
its status reports measured main-thread helper-update time. Existing WebGL2 and
WebGPU rendering regressions also passed under the runner's software graphics
configuration. No hardware performance or universal FPS improvement is claimed.

Required post-merge verification **passed** on 2026-10-13 for merge commit
`751c0c66b429bc46ff1ce68d273a76db743f2dfd`:

1. [Deployment workflow](https://github.com/takahirox/three-mmd-loader/actions/runs/38356422510)
   completed successfully, including build, setup and deployment. The public
   deployment manifest identifies the merge commit.
2. The [published animation demo](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd.html)
   loaded in isolated headless Chrome with software graphics. Sync was the
   default; the **Physics mode (reload)** selector loaded worker mode with
   completed simulation results, transferable transport and the measured
   main-thread helper-update display. `crossOriginIsolated` was false. The
   selector successfully reloaded the demo back to sync.
3. A verification-only Worker wrapper replaced the Worker's initialization
   Ammo URL with an intentionally missing same-origin URL. Main-thread Ammo
   remained initialized. The published demo logged a clear fallback diagnostic
   and continued rendering with synchronous physics, without an initialization
   error.
4. URLs, revision, verification date, observed modes, transport, timing displays
   and the fallback diagnostic are recorded in
   [worker-physics-post-merge.json](worker-physics-post-merge.json). Timing samples
   verify the display only; they do not establish a performance improvement.

Optional representative desktop/mobile profiling remains unperformed. It should
report main-thread CPU time, visual latency and transport, rather than infer
performance from the headless test runner.
