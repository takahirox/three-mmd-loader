# Official Bullet WASM provenance and historical comparison

Issue [#84](https://github.com/takahirox/three-mmd-loader/issues/84) and PR #85
introduced this pinned Ammo-compatible WASM build as opt-in. Issue #86 promotes
**the same unchanged build to the default** for Examples and primary tests.
See [current default verification and rollback](bullet-default.md). The engine
labels and measurements in the historical comparison below describe PR #85's
old-default/new-opt-in configuration, not current selection behavior.

Latest Bullet passes the existing physics regressions but produces different
synthetic trajectories. Both engines finish the controlled tapes with finite
transforms. The intermittent violent oscillation at 120 FPS was not reproduced,
so neither the comparison nor this default switch establishes a confirmed fix.

The reproducible pass/fail outcome is **unchanged**: both engines pass the
same regressions and remain finite on these tapes. Trajectories and costs
change, with no overall basis for classifying latest Bullet as better or worse
for the reported intermittent instability.

## Source and reproducible build

GitHub's official release and commit APIs were checked on **2026-10-20**:

| Input | Pinned value |
| --- | --- |
| Official repository | `https://github.com/bulletphysics/bullet3.git` |
| Latest release tag | [`3.25`](https://github.com/bulletphysics/bullet3/releases/tag/3.25), published 2022-04-24T23:54:27Z |
| Chosen master revision | [`d3afe76132fc76b0f9b2359cbaef47a3766e7fbb`](https://github.com/bulletphysics/bullet3/commit/d3afe76132fc76b0f9b2359cbaef47a3766e7fbb), committed 2026-10-09T21:51:41Z |
| Emscripten | `4.0.10` |
| Build container | `emscripten/emsdk@sha256:90b757eb11fa9a0e3ce4d2d9f76d932a56018e4accc37b5a28b2783751e60eb7`, Linux amd64 |
| Bullet patches | None |

This builds the chosen master revision, with no release fallback. It does not
use `ammojs3` or another prebuilt third-party Ammo runtime. `source.json` fixes
the checkout and container; normal testing and Examples serving need neither
Docker nor an upstream checkout because the generated artifacts are committed.

From the repository root, with Node, Git and Docker available:

```sh
npm ci
npm run build:bullet
node --import tsx --test tests/bullet-build.test.ts
```

The command obtains official sources in ignored `.cache/bullet-experiment/source`,
checks out the exact commit, rejects a different or dirty checkout, and runs
`experiments/bullet/build.py` in the pinned container with networking disabled.
The first Docker image pull and Git checkout need network access. For a clean
rebuild, remove only `.cache/bullet-experiment/build`, then repeat the command.
Compare `examples/vendor/bullet/manifest.json` before and after rebuilding.
The generation path is fixed at `/work` inside the container.
The [recorded clean rebuild](../experiments/bullet/reproducibility.json)
produced identical glue, WASM, license and manifest bytes on Linux amd64
inside this container (host macOS arm64).

The recipe compiles `src/BulletCollision`, `src/BulletDynamics` and
`src/LinearMath` into a static archive, then links only the referenced native
code and `bindings.idl` WebIDL wrappers. `bindings.cpp` supplies the nested
construction-info typedef expected by Ammo callers. Const/reference annotations
match native ownership; borrowed transforms/vectors are not destroyed by the
adapter. Emscripten's generated `destroy` manages native owned objects.
`getWasmExports()` exposes the actual instance exports for verification and
`bulletCommit` identifies the source. These are compatibility bindings, with
no engine, interpolation or solver patches.

Both archive and bindings use `-O3 -DNDEBUG -fno-exceptions -fno-rtti`, default
single-precision Bullet, no pthreads or SIMD flags. Link settings are
`MODULARIZE=1`, `EXPORT_NAME=Ammo`, `ENVIRONMENT=web,worker,node`,
`ALLOW_MEMORY_GROWTH=1`, `INITIAL_MEMORY=33554432`, `FILESYSTEM=0`,
`ASSERTIONS=1`, `EXPORTED_FUNCTIONS=["_malloc","_free"]`,
`EXPORTED_RUNTIME_METHODS=["HEAP8","HEAPU8"]`, `WASM_ASYNC_COMPILATION=1`,
`SINGLE_FILE=0`. The manifest records the compiler version, exact flags and
SHA-256s of the recipe, bindings, glue, WASM and license files.

Bullet retains its zlib license and individual source author notices.
Emscripten retains MIT/NCSA terms; adjacent files preserve musl, compiler-rt,
libc++, libc++abi and dlmalloc notices supplied by the pinned toolchain.
No Extras, Bullet examples, Python/OpenCL runtime, or third-party Ammo binary
is redistributed. The same runtime artifacts and notices now also ship in the
npm package at `dist/vendor/bullet/` for optional self-hosting.

## Selection and compatibility

Run `npm run dev` and open any physics Example with no query to use this
pinned build. `?bullet=legacy` explicitly restores the old diagnostic runtime;
remove it to restore the new default. `?bullet=master` and `?bullet=default`
also select the new default. There is no engine-selection UI.

No physics parameters are changed. Default fixed step is still `1/60`,
`maxStepNum=10`; gravity, STOP_ERP, damping, collision policy, poses,
animation/IK and kinematic control remain in the existing implementation.
The retained Gene JPEG predates the default switch; Issue #98 recaptures the
four Miku JPEGs with the default runtime at 1/1 lighting. See the
[lighting validation record](examples-lighting-validation.md).

The WebIDL surface covers the structural APIs in `src/ammo.ts`, native worlds,
motion states, sphere/box/capsule shapes, additional damping construction fields,
collision group/mask arguments, spring constraints including `setParam` and
STOP_ERP, reset/interpolation methods, removal and destruction. Native contact
inspection and damping getters also support existing regression oracles.
The Examples validate constructors/methods and source identity after verifying
an actual `WebAssembly.Instance` and exact export identity. Missing glue,
missing/corrupt WASM, incompatible APIs and wrong source identity produce
actionable errors; they never masquerade as a successful latest-Bullet setup.

Classic Workers use the same selected glue URL, `importScripts`, glue-relative
`locateFile`, initialization messages and error handling as before. A Worker
failure can fall back to Sync **using the already initialized selected engine**.
Consumer-supplied Ammo, including classic asm.js, retains its documented support;
no library source or public API has changed.

## Controlled comparison

```sh
npm run benchmark:bullet
```

[`bullet-comparison.json`](bullet-comparison.json) records three fresh processes
per backend in alternating order, initialization costs, elapsed-time tapes and
their hash, native step counts/timings, total update costs, sampled body/bone
trajectories, engine differences, frame-rate differences and repeatability.
Trajectories are retained for the first run of each engine; repeat runs retain
costs/counts and are checked for exact trajectory equality. Position distance
and quaternion angular distance accompany raw scalar differences; angular
distance accounts for equivalent quaternion signs.

Each process runs 36 six-second cases: PMD/PMX, body modes 1/2, standalone
Sync, two separated shared-Sync models and sequenced Worker runtime, each at
60/120/144 FPS. An analytically animated kinematic anchor drives an asymmetric
dynamic box through the same mixed-axis spring joint. Both engines receive
identical metadata, starting transforms, gravity and solver settings.
The joint permits linear motion of ±0.25 model units and angular motion of
±0.4 radians; linear spring stiffness is `[10,15,20]` and angular stiffness is
`[5,7,9]` in both engines. Every frame is checked for finite body/bone transforms.
Samples at each half-second permit comparisons at common elapsed times. Returned
native substep counts are clamped to the supplied cap to count executed steps;
simulated time is counted steps times `1/60`.

The tapes execute 359 or 360 steps (5.9833 or 6 seconds), depending on
single-precision accumulator boundaries. Samples remain finite and repeats
match exactly. The engines' trajectories diverge; differences between frame
rates remain with the existing kinematic sampling and interpolation.
This is changed reproducible behavior with no demonstrated
improvement in stability. Native costs and complete update costs have different
boundaries; consult the raw measurements instead of inferring a speed or
stability gain from one average. The deterministic Worker workload measures
its simulation/clone path, not browser thread scheduling or real transfer latency.

The recorded Apple M4 Max / macOS arm64 / Node v24.12.0 runs have the following
medians across three fresh processes. Stepping totals cover all 36 cases;
initialization includes glue loading and local WASM read/compile/instantiate.

| Measurement | Default Bullet WASM | Latest master WASM |
| --- | ---: | ---: |
| Initialization | 16.954 ms | 4.330 ms |
| Native stepping total | 80.156 ms | 51.472 ms |
| Complete update total | 443.199 ms | 699.376 ms |
| Largest body position difference from 60 FPS, at 120/144 FPS | 3.922 model units | 3.565 model units |
| Largest body rotation difference from 60 FPS, at 120/144 FPS | 3.124 rad | 3.092 rad |

Latest master has lower native stepping cost here but higher complete update
cost; frame-rate differences are mixed. Neither backend is uniformly better.
The maximum position difference between engines at matching timestamps is
3.470 model units and the maximum rotation difference is 3.138 rad. These
synthetic type-2/joint trajectories are deliberately sensitive to anchor
sampling. The comparison also changes compiler and binding generation, so
cost differences cannot be attributed solely to the Bullet source revision.

## Historical PR #85 validation

The then-default and experimental Node suites each pass **851 tests**. All **48**
browser cases have passing results across the full run and two focused reruns;
the original-assets built site passes its Examples and both Gene backend checks.
The full browser invocation initially had an ambient timeout (passed unchanged
on rerun) and a stale result-count assertion after adding two Example groups
(corrected from six to eight; source and built reruns passed).
[The validation record](bullet-validation.json) preserves these outcomes.

The default and experimental Node suites retain the existing numerical
assertions and tolerances. Coverage includes PMD/PMX bodies and all three shapes,
additional damping, linked collisions and masks, spring constraints and joint
frames, type-2 pre/post-physics behavior, animation/IK/grants, standalone/shared
Sync, Worker protocol/transport, initialization, fallback, disposal and reset.
Browser loading checks observe actual Worker instances and exports, binaries
beside relocated glue, correct WASM MIME, missing/invalid binaries, deadlines,
API/source mismatches, and main-thread failure without a published runtime.
The real Worker integration runs both engines with transferable and isolated
shared-memory transport. Real animation pages exercise reversible selection
and Worker recovery. Gene tests exercise both backends on the pinned real PMX.

Reproduction commands:

```sh
npm run typecheck
npm test
npm run test:legacy
npm run test:browser
npm run build:examples
MMD_EXAMPLE_SITE=dist/examples npm run test:examples
```

## Post merge verification

**PENDING until run:** Inspect the latest attempt of the merge-triggered Pages
workflow, record its deployed commit, and verify the published manifest,
new glue/WASM bytes, MIME types and paths. The deployment validator includes
the default runtime and all license files, while verified old sites
remain valid rollback candidates.

**PENDING until run:** Smoke-test the actual public Sync and Worker examples
with no Bullet query (PMD, Gene Light PMX and Worker); record browser, URLs,
active build identity, initialization, controlled steps, UTC timestamps and
failures. Local source and built-site checks do not substitute for these checks.

Optional maintainer follow-up: long-running natural 120 Hz motion on real
PMD/PMX hair/skirt models. Visual observations alone should not be reported
as reproducing and resolving the intermittent oscillation.
