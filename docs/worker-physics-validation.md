# Worker physics validation — Issue #47

The selector/reload coverage below records the original implementation.
[Issue #51](example-physics-mode-validation.md) replaces that example UX with
separate sync and Worker pages; the public library API remains unchanged.

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

Required post-merge verification is **pending** because the public animation
example changes and this node does not merge or publish:

1. Confirm `.github/workflows/examples-pages.yml` succeeds for the merged commit,
   including its project-prefix artifact validation and Pages deployment.
2. Load the published [Model and animation page](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd.html)
   and [Worker Physics page](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd_worker.html).
   Confirm sync and Worker requests respectively, absence of a physics mode
   selector, and the actual backend/transport and timing display.
3. Confirm the published worker and Ammo assets load correctly without requiring
   isolation headers. Exercise a failed Worker/Ammo request (for example by
   blocking the Ammo script request in browser developer tools after the
   main-thread Ammo initialization) and verify a clear diagnostic and sync
   fallback. Keep successful main-thread Ammo available for that fallback.
4. Record the workflow/deployment URL, merged revision, demo URLs, transport,
   fallback evidence and verification date. Keep this status pending until those
   checks have actually run.

Optional representative desktop/mobile profiling remains unperformed. It should
report main-thread CPU time, visual latency and transport, rather than infer
performance from the headless test runner.
