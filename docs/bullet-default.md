# Default Bullet WASM runtime (#86)

Normal public Examples and primary real-Ammo regressions now use the pinned
Ammo-compatible WASM build of official Bullet commit
`d3afe76132fc76b0f9b2359cbaef47a3766e7fbb`. No Bullet query is needed. This
covers PMD animation Sync, shared Sync, Worker Physics, audio and Gene Light
PMX. The pose page does not initialize physics.

## Provenance

Implementation started at worktree HEAD
`862aed16c71cfbe53e0c3a03f81d9bd8d9023cf7`. Its tracked files are identical to
PR #85's merge commit `1f50cba6c0cede6edcfb3e88540bf5e4862bdd4b`
(`git diff --name-only 1f50cba6 HEAD` was empty). GitHub Issue #86 and merged
PR #85 were read during implementation. The source, recipe and generated
artifacts from that PR are reused unchanged; a new upstream revision is not
needed for this default switch.

`experiments/bullet/source.json` pins official Bullet, Emscripten 4.0.10 and
container digest
`sha256:90b757eb11fa9a0e3ce4d2d9f76d932a56018e4accc37b5a28b2783751e60eb7`.
There are no Bullet patches. The build recipe, licenses, prior byte-identical
clean rebuild and historical trajectory differences are documented in
[bullet-experiment.md](bullet-experiment.md). No new native rebuild is claimed
for this switch. Manifest/recipe/license hashes are checked by the tests.
The unchanged WASM SHA-256 is
`e1bd8fe1da2c3da1e169305e753bd4def39e1127d724b80996cb2b0e98f6810f`.

The static site retains `examples/vendor/bullet/ammo.js`, `ammo.wasm`,
`manifest.json` and all adjacent licenses. The npm package now also includes
that exact directory as optional `dist/vendor/bullet/` assets; its installed
tarball test checks all manifest hashes. Consumers still initialize their own
global Ammo. No library API or consumer backend requirement changes.

## Confirm the running engine

Run `npm ci && npm run dev`, then open these URLs without a query:

- `http://127.0.0.1:8080/examples/webgl_loader_mmd.html`
- `http://127.0.0.1:8080/examples/webgl_loader_mmd_pmx_gene.html`
- `http://127.0.0.1:8080/examples/webgl_loader_mmd_worker.html`

In the Example frame's DevTools console, after startup:

```js
Ammo.bulletCommit
// 'd3afe76132fc76b0f9b2359cbaef47a3766e7fbb'
document.body.dataset.bulletBackend
// 'master-d3afe76132fc'
const exports = Ammo.getWasmExports();
typeof exports.emscripten_bind_btDiscreteDynamicsWorld_stepSimulation_3
// 'function'
typeof exports.emscripten_bind_btGeneric6DofSpringConstraint_setParam_3
// 'function'
```

The bootstrap observes a real `WebAssembly.Instance`, verifies exact equality
between its exports and Ammo's exports, checks the native stepping/constraint
exports, pinned commit and required API before publishing success. Network
requests must show `vendor/bullet/ammo.js` and `vendor/bullet/ammo.wasm`
(`application/wasm`), with no request for the legacy runtime. Inspect
`examples/vendor/bullet/manifest.json` and compare downloaded bytes to its
hashes. In a Worker DevTools execution context, check the same `Ammo` fields;
its binary resolves beside the supplied `ammoURL`. Browser tests independently
observe real Worker instances/exports and source identity, including relocated
glue and both transferable and isolated shared-memory transport.

## Explicit rollback

Append `?bullet=legacy` (or `&bullet=legacy` when other parameters exist) and
reload to use `ammojs-typed@1.1.0` WASM for diagnostics. Its identity is
`document.body.dataset.bulletBackend === 'ammojs-typed-1.1.0'`; it does not
claim the pinned new commit. The static Examples build keeps the legacy glue,
binary and MIT notice for this purpose. Remove the parameter to return to the
new default. Existing `?bullet=master` and `?bullet=default` links also select
the new build; there is no engine-selection UI.

To roll back the repository's no-query default, revert this Issue #86 commit,
then rebuild and redeploy through the normal workflow. That restores PR #85's
old-default selection without modifying any physics parameters. Consumers can
continue to supply their previously used compatible Ammo runtime.

Glue/binary load failures, compilation errors, identity/API mismatches and
timeouts stop Example setup explicitly. They never select legacy implicitly.
Worker startup/runtime failures may recover to Sync using the already
initialized selected engine and retain a visible fallback reason.

## Physics behavior and validation

The adapter and simulation code are unchanged: `unitStep=1/60`,
`maxStepNum=10`, ERP, damping, constraint frames, collision masks and
60/120 Hz timekeeping retain their previous settings and behavior.
Trajectory changes from old Bullet are expected (see the recorded historical
comparison). There is no solver tuning or new timestep, and this change does
not claim a reproduced or fixed intermittent 120 FPS instability.

Commands and results for this worktree are recorded in
[bullet-default-validation.json](bullet-default-validation.json). Coverage
includes PMD/PMX, constraints, mode-2 bodies, standalone/shared Sync, Worker
transferable/shared memory, and explicit recovery and initialization errors.

## Required post-merge checks

**PENDING until performed:** inspect the latest attempt of the merge-triggered
Pages deployment, record its deployed SHA and verify hosted glue/WASM/manifest
hashes, binary paths and MIME. Confirm no-query public Examples instantiate
the new runtime. Local build checks do not establish hosted deployment state.

**PENDING until performed:** smoke-test public PMD, Gene Light PMX and Worker
pages in a real browser. Record URLs, browser/version, UTC time, active Bullet
commit and actual WASM export evidence, successful initialization, model startup
and controlled physics steps. These post-merge checks do not block pre-merge
approval and are not claimed complete by this implementation.

Optional maintainer follow-up: sustained real-model visuals and 60/120 Hz
stability after publication. Keep any rare oscillation investigation separate
until reproduction and evidence support a conclusion.
