# Issue #59 branch verification

Validation on 2026-10-14, with Node.js 24.12.0, Three.js 0.186.1 and Chrome's
headless WebGL2/SwiftShader and available native WebGPU backends.

- `npm run typecheck`: passed (library, examples, tools and TypeScript source checks).
- `npm test`: passed, 323 tests, no failures or skips.
- `npm run test:browser`: passed, 25 tests, no failures or skips. Both WebGL2
  and WebGPU ran: 104 ambient/base/toon/sphere/specular comparisons and 330
  material-morph RGBA comparisons per backend, plus the existing outline,
  shadow, UV/SubTexture, PMD example and actual Gene Light regressions.
- `npm run build`: passed.
- `npm run build:examples`: passed using the real pinned example assets.
- Production artifact integrity: all 598 files match `deployment-manifest.json`.
- `MMD_EXAMPLE_SITE=dist/examples npm run test:examples`: the actual Gene Light
  artifact test passed every runtime/asset, morph, reset and failure check. The
  gallery test initially timed out on history Back after visiting Gene Light.
  An unmodified rerun with `MMD_EXAMPLE_SITE=dist/examples node --import tsx
  --test tests/browser/examples.test.ts` passed the complete gallery, history,
  direct-page, mobile/control and error checks (183 seconds). This initial
  navigation timeout is recorded as a test stability limitation; no gallery
  code or timeout thresholds were changed for this shading patch.
- `scripts/inspect-gene-light.ts`: passed against the pinned Gene Light manifest;
  28,646 vertices, 13 materials, 10 textures, 6,384,644 allowlisted asset bytes,
  upstream commit `c7eace43dffaccff6ad0597433ef85fa57c91e03`.
- `git diff --check` and `git diff --cached --check`: passed.

The [shading document](material-shading.md) records the equation, references,
linear-color choice and intentional differences from Saba and babylon-mmd.
Numerical expectations come from independent CPU equations and authored PMX
fixture values, rather than the previous ambient-to-emissive reduction.

Post-merge verification is **pending**: the merge-triggered Pages workflow run,
deployed commit/date, and published Gene Light/PMD example runtime and asset
checks must be recorded after merge. No merge, push, deployment, public-site
visual comparison or screenshot-based diagnosis was performed for this change.
These deployment checks and any optional maintainer visual comparison do not
gate the branch checks.
