# Gene Light PMX showcase validation — Issue #57

Checked on 2026-10-14 in the implementation worktree, before merge.
Environment: Node.js 24.12.0, Google Chrome 155.0.8059.79 on macOS. Browser
checks use the repository's isolated headless Chrome profiles, real Ammo,
compiled package modules, and WebGL2 / available WebGPU backends.

## Rights, provenance, and asset evidence

The [rights review and feature record](../examples/gene-light.md) records the
maintainer's confirmed personal noncommercial scope, both pinned source READMEs,
CC BY 4.0 attribution/changes requirements, separate trademark/design conditions,
and original usage guidelines. No unrestricted commercial permission, author
endorsement, additional permission, or formal legal opinion is claimed.
This review preceded acquisition for the public example.

Upstream: `mmdagent-ex/gene`, commit
`c7eace43dffaccff6ad0597433ef85fa57c91e03`.
The [public manifest](../scripts/gene-light-manifest.json) records exact paths,
sizes, Git blob SHA-1s and SHA-256s for 13 unchanged files (6,384,644 bytes):
`Gene_light.pmx`, ten actually referenced `light/` PNGs, and both original
READMEs. No VMD, `tex/`, full `Gene.pmx`, private catalog, or archive is shipped.
The generated animation uses the model's own named bones; the JPEG preview
is a local rendering of this permitted scene, with credit and changes identified.

`node --import tsx scripts/inspect-gene-light.ts` verifies every asset and notice,
checks exact case-sensitive texture references and hierarchy, and parses the
actual lightweight PMX with released mmd-parser 1.1.4. Its output matches
[the committed inspection](../examples/gene-light-inspection.json), independently
of the private full-Gene inspection. Detected features include 6 IK chains,
11 grants, before/after-physics flags, 87 bodies (53 source type 2), 92 joints,
and vertex/group/UV/material morphs. SDEF, bone morphs, and extra UV channels
are absent; they are not claimed for this asset.

## Mandatory pre-merge results

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS, all package/example/tool projects and TypeScript source checks |
| `npm test` | PASS, 320 tests, 0 skipped |
| `npm run test:browser` | PASS, 24 tests, 0 skipped |
| `npm run build` | PASS |
| `npm run build:examples` | PASS, pinned assets and all Gene notices verified |
| `git diff --check` | PASS |
| Deployment artifact integrity | PASS, 598 files match deployment SHA-256s; exactly 13 public Gene files; no private models/viewers |
| Real project-prefixed artifact browser checks | PASS, 2 tests, 0 skipped; command below |

The actual static-artifact browser command was:

```sh
MMD_EXAMPLE_SITE=dist/examples node --import tsx --test --test-concurrency=1 \
  tests/browser/examples.test.ts tests/browser/gene-light.test.ts
```

`MMD_EXAMPLE_SITE=dist/examples npm run test:examples` runs the same suites
with the package build hook. The server mounts only the artifact at
`/three-mmd-loader/`, so origin-root imports cannot fall back to the source
checkout. No COOP/COEP headers are provided. All 13 public Gene URLs respond
with expected sizes, including the PMX, textures, and unchanged source notices.

The real-asset Gene check renders with MMDLoader/MMDAnimationHelper and outlines;
verifies the actual IK/grant/phase/body/morph data; compares IK and grant effects
at the same authored time; steps synchronous physics; changes vertex/group/UV/
material morph weights and resets UV/material state; renders IK and rigid-body
debugging; and exercises feature toggles, orbit, mobile controls, missing-model/
texture errors, shader-failure status, and disabled controls. No runtime errors
occur in normal operation. Gallery checks cover all five cards, correct preview
images, desktop/mobile selection, direct hashes, repeated selection, Back/Forward,
unknown/empty hashes, and existing PMD/audio/pose/Worker behavior.

The expanded gallery exposed an old test assumption that every restored iframe
fires `load`. Cached document restoration can omit that event. The harness now
waits for the actual selected document, URL hash, complete document, and scene
ready promise; it continues to assert the full navigation and rendering results.
The final full browser rerun passes all 24 checks (about 341 seconds). The real
prefixed suites pass both checks (about 205 seconds). These timings describe
validation runs, not performance or appearance improvements.

## Synthetic CI artifact coverage

The generated fixture build was also reproduced in `dist/fixture-examples`,
keeping the real `dist/examples` artifact intact. The updated Tests workflow
explicitly marks its fixture-only validation with `MMD_EXAMPLE_FIXTURES=1`.

```sh
MMD_EXAMPLE_FIXTURES=1 MMD_EXAMPLE_SITE=dist/fixture-examples \
  node --import tsx --test --test-concurrency=1 \
  tests/browser/examples.test.ts tests/browser/gene-light.test.ts
```

PASS: the fixture gallery/scene check, with the real-asset Gene-specific test
explicitly skipped for this synthetic artifact. This does not substitute for
the unskipped licensed-asset checks above. The Pages build uses the real pinned
assets and runs both suites without the fixture flag before deployment.

## Required post-merge publication verification — PENDING

This section does not block merge. No deployment, push, PR, merge, or GitHub
comment was performed by this implementation task.

After merge, record:

1. Successful merge-triggered Pages workflow and its deployment commit/date/URL.
2. Published gallery links to **PMX — Gene (Light)** and its unique hash works.
3. All public PMX, ten texture, and both original-notice URLs load and match the
   deployment manifest; existing runtime/Worker/Ammo imports remain available.
4. The published demo starts and its controls work without runtime errors.

Expected site: <https://takahirox.github.io/three-mmd-loader/>.
Deployment commit/date/results: **PENDING**. The workflow's expanded required
manifest and existing deployment integrity verifier cover the new public files.
If publication fails, record it as a follow-up rather than changing pre-merge
results retroactively. Optional visual inspection of hair/clothing, IK, grants,
and expressions may produce focused follow-up Issues; it is not a merge gate.
