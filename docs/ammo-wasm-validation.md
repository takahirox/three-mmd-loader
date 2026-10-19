# Ammo WebAssembly validation

Issue [#82](https://github.com/takahirox/three-mmd-loader/issues/82) selects the
WebAssembly artifacts already supplied by `ammojs-typed@1.1.0` for the public
Examples and the real-Ammo physics baseline. This changes runtime loading,
not Bullet, physics parameters, animation scheduling, or solver tuning.
Compatible caller-initialized Ammo APIs and classic `workerPhysics.ammoURL`
scripts, including asm.js, remain supported.

## Runtime and deployment

The pages load `ammo/ammo.wasm.js`; `examples/ammo-runtime.ts` explicitly
fetches its sibling `ammo.wasm.wasm`, awaits a `WebAssembly.Instance`, and
checks that Ammo's native exports are exactly that instance's exports before
publishing the initialized global API. The pinned factory's early `this.Ammo`
write is isolated. HTTP, compilation, and a 10-second setup deadline reject
with the binary URL; setup stops without claiming an initialized runtime.

The classic Worker still uses `importScripts(ammoURL)`. Its factory receives
`locateFile(path)` based on the absolute glue URL, rather than the page or
Worker bundle directory, plus an abort diagnostic. The existing watchdog and
Worker-to-Sync recovery use the already initialized main-thread runtime.
The Examples do not substitute asm.js after a WASM failure.

The static build copies both WASM files and `LICENSE.md`. The deployment
manifest requires and hashes them; public verification checks every manifest
file and the binary's `application/wasm` MIME type. Existing pre-WASM manifests
remain eligible for verified backup and rollback only. Both local source serving and the built-site browser harness
serve `.wasm` as `application/wasm`. All assets remain on the same origin under
the Pages project prefix; no runtime CDN is required. See the
[consumer initialization and CSP guidance](../README.md#optional-worker-physics).

## Physics and browser coverage

`tests/ammo-runtime.ts` initializes the pinned WASM module and asserts native
export identity in every real-Ammo Node test. Existing numerical assertions
and tolerances are retained. The migrated suites cover PMD and PMX,
standalone Sync, shared Sync, Worker-owned worlds, constraints, YXZ body and
joint frames, collision masks, damping, type-2 bones, IK/grants, 60 Hz default
and explicit 65 Hz timekeeping, substep caps, reset and warmup.

The primary browser physics harnesses initialize the same WASM build. Both classic Worker
transports are exercised: transferable buffers without isolation and
SharedArrayBuffer with COOP/COEP. `ammo-wasm.test.ts` additionally observes the
actual Worker `WebAssembly.Instance` and export identity, with the glue and
binary served away from the Worker/page directories. It checks missing and
invalid binaries, initialization timeout diagnostics, working Sync fallback,
main-thread failure without a published partial API, and a small explicit
asm.js Worker compatibility case. The private local viewer deliberately retains
its pinned asm.js runtime as an additional Sync consumer compatibility
comparison; its physics browser test is labeled accordingly and checks the
script choice. It is not part of the claimed WASM baseline. Real Example tests check the WASM backend
marker and that Worker Physics stays in Worker mode.

The existing gallery JPEGs retain their actual asm.js capture provenance;
the manifest records this runtime migration separately. They are not WASM
motion or visual parity evidence.

## Reproducible backend comparison

Run `node --import tsx scripts/benchmark-ammo.ts`. It compares the unchanged
pinned asm.js and WASM builds in five fresh Node processes each, alternating
backend order on the same machine. Sixteen independent PMD/PMX worlds contain
32 bodies and 16 mixed-axis constraints with types 1/2. Identical sinusoidal
anchor input drives 120 warmup frames and 600 measured frames at `1/60`.
The timed stepping workload includes skeletal projection and trajectory
sampling. Initialization includes glue loading and local WASM read/compile/
instantiate, excluding process startup and model creation.

Raw measurements, machine information, file/gzip sizes, and trajectory
comparison are recorded in [ammo-wasm-benchmark.json](ammo-wasm-benchmark.json).
On Apple M4 Max / macOS arm64 / Node v24.12.0, the recorded median
initialization was **61.95 ms asm.js / 17.46 ms WASM**. The 9,600 measured
world updates took **166.95 ms asm.js / 82.95 ms WASM** (about 17.39 / 8.64
microseconds per world update). The 2,240 sampled trajectory scalars matched
exactly across builds; maximum absolute backend difference was 0. The maximum
change from the first sample was 0.796 across position/quaternion components. No significant solver outcome change
was observed in this synthetic trajectory. The comparison retains a 5e-4
reporting threshold and does not alter any regression test tolerance.

| Artifact | Raw bytes | gzip bytes at level 9 |
| --- | ---: | ---: |
| asm.js glue/runtime | 2,010,408 | 450,217 |
| WASM glue | 453,324 | 53,011 |
| WASM binary | 750,028 | 289,886 |
| WASM combined | 1,203,352 | 342,897 |

These local synthetic results do not establish real-model fidelity,
long-running stability, browser startup time, or a universal speed advantage.
Gzip sizes describe compressibility, not an observed network transfer.

## Local checks

The Node suite passes 847 tests after migration, including verified backup/
rollback of pre-WASM deployments and rejection of missing artifacts or incorrect
WASM MIME types. The full browser suite passes 35 tests with no skips, including
WebGL2 and WebGPU rendering in Chrome 155.0.8059.80 headless with the
repository's SwiftShader flags, plus both Worker transports. The newly
labeled private asm.js comparison also passes independently.

The built site is
served exclusively from `dist/examples` at `/three-mmd-loader/` by
`MMD_EXAMPLE_SITE=dist/examples npm run test:examples`, including PMD, Worker
Physics and the real Gene Light PMX controls and controlled physics updates.
This is distinct from sustained natural playback or subjective evaluation.

Final checks on 2026-10-19:

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass, including tools, Examples and TypeScript source policy |
| `npm test` | Pass, 847 tests, 0 skipped |
| `npm run test:browser` | Pass, 35 tests, 0 skipped |
| `npm run build` | Pass |
| `npm run build:examples` | Pass with the real pinned public assets |
| `MMD_EXAMPLE_SITE=dist/examples npm run test:examples` | Pass, 2 tests, 0 skipped; project prefix `/three-mmd-loader/` |
| `npm pack --dry-run` | Pass, 48 files; library remains consumer-supplied Ammo |
| `git diff --check` | Pass |

The separately labeled asm.js private-viewer compatibility test also passes
via `node --import tsx --test --test-name-pattern='retained asm.js compatibility' tests/browser/sdef-viewer.test.ts`.
Initial migration runs exposed harness setup errors, which were corrected;
the final full runs above passed. No requested local check was skipped.

## Post merge verification

**PENDING until merged:** inspect the latest attempt of the merge-triggered
Pages workflow. Record its URL, final result, deployed merge SHA/date, both
WASM artifacts and newly published content. A transient failed attempt does
not establish the final result; inspect subsequent attempts.

**PENDING until merged:** visit the public PMD, Worker Physics and Gene Light
PMX URLs in actual browsers:
[PMD](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd.html),
[Worker Physics](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd_worker.html),
[Gene Light PMX](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd_pmx_gene.html).
Record browser, transport, URLs and evidence of
the separate binary and active WASM backend, asset/animation loading, Worker
mode in supported configurations, and controlled physics updates.

Neither publication nor the maintainer's subjective real-model evaluation is
a pre-merge requirement. Sustained appearance, physics stability and the
retain/revert decision remain optional maintainer follow-up; these checks do
not resolve previously reported violent oscillation.
