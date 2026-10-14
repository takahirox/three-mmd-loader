# Gene Light post-merge verification — Issue #61

Required publication and example-loading checks: **COMPLETED** on 2026-10-14 UTC.

## Merge and deployment

- Source Issue #61 was freshly read and confirmed open immediately before the
  merge attempt. PR #62 was open, mergeable, and clean, with successful CI.
- The merge used GitHub's `merge` method and expected head SHA
  `6fc23b52e0e7f833570db8caf7df763ad4f27cde`, without bypassing checks or reviews.
- [PR #62](https://github.com/takahirox/three-mmd-loader/pull/62) merged at
  `2026-10-14T08:21:22Z` as `5a2263cfe0eb883f0b5651e56659d1dc176e4f53`.
- The merge-triggered [Pages workflow run](https://github.com/takahirox/three-mmd-loader/actions/runs/38534523401)
  succeeded; build, setup, and deploy all passed. Deployment completed at
  `2026-10-14T08:24:35Z`.
- Its `pages-deployment-evidence` artifact (ID `11878799566`) reports successful
  deployment and public verification at `2026-10-14T08:24:22.461Z`, with 601
  successful content checks and no failed checks.
- The public [deployment manifest](https://takahirox.github.io/three-mmd-loader/deployment-manifest.json)
  independently returned the merged commit SHA and 598 file entries.

## Published examples

An isolated headless Google Chrome session with SwiftShader, disabled cache,
default renderer selection, and audio autoplay enabled checked the public pages
starting at `2026-10-14T08:24:39.870Z`. Each page's exported `ready` promise
resolved; each had a canvas, populated model geometry, and state `ready` after
two additional seconds of rendering. Network failures, HTTP errors, runtime
exceptions, and console errors were collected during each page load.

| Published example | Load/render | Ambient / directional intensity | Scene asset errors | Runtime / console errors |
| --- | --- | --- | --- | --- |
| [Gene Light PMX](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd_pmx_gene.html) | PASS | 1 / 1 | 0 | 0 / 0 |
| [PMD](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd.html) | PASS | 2 / 3 | 0 | 0 / 0 |
| [Worker Physics](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd_worker.html) | PASS | 2 / 3 | 0 | 0 / 0 |
| [Audio](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd_audio.html) | PASS | 2 / 3 | 0 | 0 / 0 |
| [Pose](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd_pose.html) | PASS | 2 / 3 | 0 | 0 / 0 |

The browser's automatic request for `https://takahirox.github.io/favicon.ico`
returned HTTP 404 on the first navigation. The strict probe command exited 1
because it counted every HTTP error, including that site-root favicon request.
All five example-loading, rendering, geometry, and lighting checks passed;
there were no failed example scene assets or runtime/console errors. The favicon
observation is retained here rather than reporting the strict probe as passing.

This verifies publication and example operation. It does not establish exact
MMD shading parity or a visually confirmed fix for the washed-out appearance.
Optional maintainer visual comparison remains separate.
