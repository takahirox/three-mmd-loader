# Standalone Worker Physics example — Issue #49

The fourth gallery card opens `examples/webgl_loader_mmd_worker.html` directly.
Its small TypeScript entry requests Worker mode by default through the same
`scene.ts` setup used by Model and animation, which continues to default to sync.
The Miku model, WAVEFILE motion, camera, rendering, GUI, and preview attribution
are shared. No core physics behavior or third-party assets were changed.

The scene awaits physics initialization before displaying the actual backend.
It shows `worker / shared` or `worker / transferable` and measured mean
main-thread helper-update time. Startup/runtime failure diagnostics persist in
the `sync` fallback readout; fallback initialization errors stop the scene.
Page teardown removes the helper's mesh (disposing its Worker) and releases
controls/rendering resources. Pages entering the Back/Forward cache retain
their scene so restoring a cached page keeps working.

New static builds require the Worker HTML in their deployment manifest. The
backup and explicit `verify-rollback` paths accept the previous three-page
manifest while still verifying every listed file and hash. This permits the
first deployment of the fourth page to back up and restore the existing site;
new candidate verification does not accept the old page set.

## Automated validation

Validation date: 2026-10-13. Local Node.js 24.12.0 and headless Chrome with
SwiftShader; browser timings are test execution times, not hardware benchmarks.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed (package, examples, tools, and TypeScript-source policy). |
| `npm test` | Passed: 242 tests. |
| `npm run test:browser` | Passed: all 21 browser tests, including four Worker integration tests. |
| `npm run build` | Passed; includes the classic Worker bundle and new example entry. |
| `npm run build:examples` | Passed with the verified pinned MMD assets. |
| Final focused browser checks | Passed: all five gallery/Worker tests, including cached-page retention and normal Worker cleanup. |
| Built artifact at `/three-mmd-loader/` | Passed using the real pinned Miku/model, motion, audio, and pose assets; 141.42 s total (138.36 s light session, 300 s budget). |

Build commands were run serially after an initial concurrent rebuild interfered
with unit imports. An initial gallery navigation wait was corrected and the
full browser suite rerun successfully. After the final cache-preservation
change, the five affected gallery/Worker tests and the built-site test were
rerun successfully. The real-asset build exceeded the old navigation/session limits. Built-site
checks now allow 30 s per navigation and 300 s per light session, while fixture
checks retain the 8 s / 45 s limits. Resize waits have a bounded parent-timer
path for throttled iframe animation callbacks; actual viewport/layout assertions
remain in place. The completed project-prefix run verified the Worker HTML,
entry module, bundled Worker, Ammo, imports, and asset URLs without isolation.

Coverage includes four cards and named Worker navigation, all four direct hash
selections, Back/Forward, iframe rendering/resizing, narrow-screen navigation,
original audio/pose controls, and Worker IK/rigid-body controls. Worker integration
uses the real bundled classic Worker and Ammo, verifies shared/transferable
transport selection, and exercises the standalone page without isolation or a
physics query parameter. A test-only server injects failed Worker startup and
runtime error events to verify continued synchronous physics, visible persistent
diagnostics, and cleanup. Production pages have no failure-injection flag.

## Required post-merge verification — pending

These checks depend on publishing the merge commit and have **not** been run.

- **Pending:** confirm the [Pages workflow](https://github.com/takahirox/three-mmd-loader/actions/workflows/examples-pages.yml)
  succeeds for the merge commit and its public
  [deployment manifest](https://takahirox.github.io/three-mmd-loader/deployment-manifest.json)
  includes `examples/webgl_loader_mmd_worker.html`. Record commit, run URL,
  deployment date, and result.
- **Pending:** open the [published gallery](https://takahirox.github.io/three-mmd-loader/examples/)
  and launch **Worker Physics**. Also open the
  [direct Worker URL](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd_worker.html)
  and [default sync URL](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd.html).
  Record date, URLs, actual backend/transport, and the non-isolated transferable
  result. Keep these pending until checked against the published merge commit.

Compare the same scene/device/settings after warmup. Main-thread helper-update
time excludes Worker computation, rendering, and end-to-end latency and does not
guarantee higher FPS. No manual performance gains or subjective hair/clothing
latency improvements are claimed; optional hardware benchmarks are not required.
