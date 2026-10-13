# Fixed example physics modes — Issue #51

The shared scene now takes its requested physics mode only from the entry point.
Model and animation explicitly requests `sync`; Worker Physics explicitly
requests `worker`. The reload selector and physics-mode query override are
removed. Renderer queries such as `?backend=webgl` and gallery hash navigation
retain their existing behavior.

The public library API, SAB/Transferable selection, lifecycle and automatic
Worker fallback are unchanged. Both pages retain animation, IK, physics,
outline, IK debug and rigid-body debug controls. Status continues to report the
actual backend/transport, measured main-thread helper-update time and persistent
startup/runtime fallback diagnostics.

## Local validation

Validation date: 2026-10-13, using Node.js 24.12.0 and headless Chrome with
SwiftShader. All required local checks passed:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed: package, examples, tools and TypeScript-source policy. |
| `npm test` | Passed: all 243 tests. |
| `npm run test:browser` | Passed: all 21 tests, no skips; 264.93 s. |
| `npm run build` | Passed, including the bundled classic Worker and both entry modules. |
| `npm run build:examples` | Passed with verified pinned original r171 MMD assets. |
| `node --import tsx --test tests/browser/worker-physics.test.ts` | Passed: all four focused Worker/example checks. |
| `git diff --check` | Passed. |

The initial browser run passed 20/21 tests. The new query test's status assertion
misread its em dash because the test harness omitted a UTF-8 declaration. Adding
that declaration fixed the harness; the focused tests and full browser suite
then passed. Production status formatting was unchanged. Builds ran after the
browser suite to avoid regenerating modules while they were under test.

Unit coverage checks the explicit entry-point requests and absence of the old
query/GUI selection. Browser coverage loads both pages normally and with
conflicting physics queries, checks renderer-query and hash preservation,
reported backend/transport and timing, and exercises controls during normal
Worker operation and startup/runtime sync fallback. The gallery checks retain
card, direct-hash and Back/Forward navigation and verify the page mode requests.

## Required post-merge verification — pending

Local checks do not verify published behavior. These checks require the merge
deployment and have not been performed:

- **Pending:** verify the merge-triggered [Pages workflow](https://github.com/takahirox/three-mmd-loader/actions/workflows/examples-pages.yml)
  succeeds. Record the merge commit, workflow run URL and deployment date.
- **Pending:** load the published [Model and animation page](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd.html)
  and [Worker Physics page](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd_worker.html),
  both directly and through the [gallery](https://takahirox.github.io/three-mmd-loader/examples/).
  Confirm neither exposes a physics mode selector; the standard page requests
  sync and the Worker page requests Worker. Check actual backend/transport (or
  clear sync fallback), retained controls and helper-update timing. Record
  verification date, URLs, backend/transport and results.
Verification date, published-page results and merge workflow run: **pending**.
