# PMX IK limits and numerical compatibility (#55)

## Format and runtime audit

The [PMX specification, IK link section](https://github.com/hirakuni45/glfw3_app/blob/master/glfw3_app/docs/PMX_spec.txt) stores a loop count, a per-loop rotation cap in radians, ordered link bone indices, and optional XYZ lower/upper bounds in radians. Its PMD angle parameter differs by a factor of four. These are file parameters; they do not prescribe a complete CCD implementation, Euler branch selection, or behavior at a singularity. The separate PMX fixed-axis bone flag is not an IK link bound; this change concerns IK link limits, not a new implementation of that flag.

Sources audited on 2026-10-14:

| Behavior | Previous solver / [Three.js r171](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/animation/CCDIKSolver.js) | [Saba, revision 29b8efa](https://github.com/benikabocha/saba/blob/29b8efa8b31c8e746f9a88020fb0ad9dcdcf3332/src/Saba/Model/MMD/MMDIkSolver.cpp) | [babylon-mmd, revision ccb750d](https://github.com/noname0310/babylon-mmd/blob/ccb750db2998ed1067017eaf67f3fc987cfba6f8/src/Runtime/ikSolver.ts) |
| --- | --- | --- | --- |
| Iterations / step | Link order; fixed cap per link. This repository already caps iterations at 1024. | Fixed step cap; saves/restores the best iteration. | Caps iterations at 256; step cap multiplied by link ordinal. |
| Limited rotation | Post-multiply CCD increment into total quaternion; clamp `bone.rotation` components in its current order (normally XYZ). | Compose accumulated IK and animated rotation; decompose XYZ with previous-angle continuity; clamp total rotation and component changes; remove animated rotation to save IK. | Compose IK and authored rotation before clamping; remove authored rotation afterward. Select YXZ, ZYX or XZY from bounds; restrict the middle angle near singularity. |
| One-axis / fixed links | Generic CCD followed by component clamps. PMD knee uses a separate positive-X quaternion heuristic. | Special X/Y/Z solver, cumulative signed plane angle, first-pass sign selection. Zero-range links use the general clamp. | Classify X/Y/Z-only links and choose their signed parent-frame axis; all-zero fixed links are skipped. |
| Degenerate / out-of-range | Exact antiparallel cross product is zero and skipped; principal angles wrap at pi. | Special-case target equal to link; previous-angle decomposition and first-pass hinge sign policy. | Small cross products are skipped; early iterations may reflect angles at a bound. |

Saba and Babylon have distinct codebases but Babylon credits Saba; this is not evidence of two independently derived MMD algorithms. The audit distinguishes their policies from file-format semantics. It does not establish byte-for-byte MikuMikuDance equivalence. This implementation deliberately retains the repository's constant per-link angle cap, iteration cap and PMD knee heuristic. It does not copy Babylon's ordinal multiplier, early bound reflection or 88-degree singularity clamp, or Saba's first-pass sign heuristic.

## Demonstrated failures

The first eleven synthetic fixtures in `tests/ik.test.ts` were executed against the original solver before implementation: **3 passed, 8 failed**. Expectations came from scalar Rodrigues rotations in `tests/ik-fixtures.ts`, not from the changed solver.

- Exact unconstrained reversal `(0,1,0)` to `(0,-1,0)` retained error 2 although a half-turn reaches it.
- A hinge with an unchanged axial component of length 2 and a unit transverse component requires a 1.1-radian rotation in its permitted plane. With a 0.2-radian step budget, generic CCD plus clamping yielded only 0.071360 (X), 0.085524 (Y), or 0.070812 (Z) radians. The analytically optimal allowed step is 0.2. Tests also check eventual reachability.
- The Y hinge approaching a half-turn retained error 1.434712, despite a reachable target and an allowed rotation range.
- Authored hinge rotation 3.12 targeting 3.16 in `[0.01,3.5]` produced error about 1.99998 and an orientation flip. The actual required change is only 0.04 radians. Both positive and negative pi crossings are now covered.
- A multi-axis authored YXZ pose `(0.2,3.12,0.3)` targeting the nearby `(0.2,3.16,0.3)` violated its allowed Y range `[2.8,3.5]` under the old XYZ clamp.
- Building twice from one parsed PMX object changed the input arrays and gave opposite X/Y constraints on the second mesh.

Review regressions additionally reproduced two defects in the initial constrained implementation:

- A legal XZY authored pose `(2,2,pi/2)` in bounds `(1.8,1.9,1.5)` to `(2.2,2.3,1.65)` moved an already reached effector by 0.091751 scene units with a 0.01-radian cap; nearby poses at `pi/2 +/- 0.0001` also failed. Principal/alternative decompositions alone miss the coupled feasible representations at a singularity.
- Full-turn X/Y/Z hinges in `[-pi,pi]`, starting at `pi-0.01` and targeting `pi+0.01`, stopped at pi with 0.0099999583 residual error instead of taking the legal 0.02-radian step.

Five additional tests cover these cases, both singularity/endpoint signs, singular constraint corners with either quaternion sign, a nearby singular target, shifted full-turn intervals, and shorter intervals that must retain their barriers. Three new regression tests failed before the fixes; the corner regression also caught roundoff when intersecting the singular solution with an interval endpoint.

Additional tests cover all selected Euler orders, an analytical two-link knee, fixed/locked ranges, unreachable hinges, zero-length vectors, exact and near singular poses, repeated updates, invalid metadata/poses, disabled links, PMD behavior, and constrained helper seek/loop/toggle restoration in both phases. Reachability tests check effector error **and** rotation ranges. Unreachable tests check feasibility, stability and non-increasing error rather than asserting zero error.

## Selected constrained solve

Ordinary unconstrained CCD stays on the existing quaternion path. A deterministic perpendicular axis resolves exact antiparallel directions. A PMD knee uses its permitted axis only when perpendicular; a direction along that locked axis remains unreachable.

For links with component bounds, the solver represents **total local bone rotation**, including authored/morph/grant input, as Euler factors. Following Babylon's order selection, X strictly inside `(-pi/2,pi/2)` selects YXZ; otherwise Y inside that interval selects ZYX; otherwise XZY. Both equivalent decompositions and whole-turn lifts are considered before clipping to the box. This avoids mistaking a legal angle beyond pi for the opposite boundary. Decomposition uses `atan2` with the middle angle's cosine magnitude to preserve outer angles near singularities. At an exact singularity (cosine magnitude below `1e-12`), the outer angles satisfy `first - sign(middle)*last = combined`, modulo a full turn; intersecting that line with the component box supplies a feasible representation without changing a legal authored orientation. A numerical tolerance on the whole-turn intersection includes box corners, with final components still clipped to the exact bounds. Angles persist through iterations of one solve, with no cross-frame cache to invalidate on seek/reset. The helper continues to supply the current composed input and restore authored layers.

Each Euler coordinate changes around the corresponding axis transformed by preceding factors in the parent rotation frame. For unit effector direction `e`, target direction `t` and unit axis `u`, the rotated dot product is

```
A cos(d) + B sin(d) + C
A = e.t - (e.u)(t.u)
B = u.(e cross t)
C = (e.u)(t.u)
```

The solver checks `atan2(B,A)` and its whole-turn equivalents, the allowed interval ends, and zero. It chooses an improving rotation within both the component interval and the remaining step budget. The sum of absolute coordinate steps is at most the per-link cap, so the quaternion angular displacement is also at most that cap. An ordinary hinge has one active coordinate: this reduces to the exact projected-plane solution. Both signs are evaluated at antiparallel geometry; a locked axis cannot acquire an invalid rotation. Multi-axis coordinate descent maintains feasibility and decreases that link's effector error without arbitrary singularity clipping. As with CCD generally, it is a local solver, not a guarantee of globally solving every reachable constrained chain.

A component interval covering at least a full turn admits every orientation of that Euler factor. Its solve uses the entire remaining step budget across equivalent endpoints, then lifts the resulting angle back into the allowed numeric interval. Only the actual small rotation consumes the budget; the equivalent full-turn representation change does not. Intervals shorter than a full turn keep their endpoint barriers.

A finite authored pose outside its total-rotation box is first projected into the box when a nondegenerate constrained solve runs. That initial feasibility correction can exceed the step cap; subsequent feasible steps obey the cap. A range and a cap cannot both be met in one update from arbitrarily distant invalid authored input. Zero-length directions are skipped. Missing single-sided API bounds default to `[-pi,pi]`; PMX supplies both. The generic API's minimum-angle floor remains on unconstrained CCD; PMX has no such parameter.

Validation rejects the entire chain before rotation for missing/fractional indices, nonfinite or inverted bounds, invalid caps/counts, non-unit quaternions or singular/nonfinite transforms. Positive excessive counts are bounded at 1024. Additional arithmetic checks prevent invalid direction/decomposition results from becoming bone rotations. Unrelated valid IK chains continue. Disabled links retain the existing stop-at-first-disabled behavior. The inherited world rotation calculation supports normal rigid/uniform-scale bone hierarchies; this change does not introduce support for sheared or nonuniformly scaled joint frames.

PMX import reflects Z positions through `mmd-parser`; axial rotation X/Y therefore change sign. The loader creates new vectors with `min=(-upperX,-upperY,lowerZ)` and `max=(-lowerX,-lowerY,upperZ)`, leaving parser arrays untouched. Inverted/malformed source constraints stay invalid and fail safely in the solver; they are not silently repaired into different constraints.

## Executable oracles and reference reproduction

`tests/ik-fixtures.ts` constructs public synthetic skeletons and computes target positions with scalar sin/cos rotations independent of Three's quaternion decomposition. Range, step-cap, monotonic-error, stability and singularity assertions test different invariants, not just snapshots. Typical position tolerance is `2e-5` scene units, angle tolerance `1e-6` radians; the two-link knee uses `3e-5`. The rotated scene test includes translation, rotation and uniform scale.

`tests/ik-reference-fixtures.json` contains six outputs from **the actual pinned Babylon IkSolver**, bundled without editing its solver, with `@babylonjs/core@9.30.0`. The minimal bone adapter evaluates hierarchical rotation matrices and implements the matrix/translation access used by the solver; it does not emulate grants or physics. Cases use unit-length planar X/Y/Z hinges targeting 0.7 radians, from identity and authored 0.25 radians, 80 iterations and a 0.2-radian cap. Inputs/outputs reflect Z positions and negate quaternion X/Y between handedness systems. Tests compare their total rotations and effector positions with both this solver and the independent analytical 0.7-radian oracle. Position agreement tolerance is `1e-6`, accounting for Babylon float matrices. Saved results make ordinary verification network-independent.

To regenerate those public reference fixtures (optional; no private models):

```sh
reference_dir=$(mktemp -d)
npm install --prefix "$reference_dir" --ignore-scripts --no-audit --no-fund @babylonjs/core@9.30.0
curl -fsSL https://raw.githubusercontent.com/noname0310/babylon-mmd/ccb750db2998ed1067017eaf67f3fc987cfba6f8/src/Runtime/ikSolver.ts -o "$reference_dir/ikSolver.ts"
curl -fsSL https://raw.githubusercontent.com/noname0310/babylon-mmd/ccb750db2998ed1067017eaf67f3fc987cfba6f8/src/Runtime/ikChainInfo.ts -o "$reference_dir/ikChainInfo.ts"
node --import tsx scripts/compare-ik-reference.ts "$reference_dir"
```

Saba was source-audited; its full native runtime was not executed here (no native GLM/runtime build in this worktree). No Saba output or private-model/manual visual result is claimed. The executable analytical oracles cover intentionally different off-plane, antiparallel and angle-wrapping policies where matching another runtime is not the criterion.

## Integration and verification

No animation-helper orchestration, Bullet stepping, Worker transport or Type-2 body semantics change. Existing grant, phase/class, Type 0/1/2 authority, physics disabling, warmup/reset, seek and loop suites remain executable. The delayed Worker comparison now additionally runs bounded planar links in both phases; the real browser Worker comparison also imports bounded pre/post links and checks synchronous parity. Both adapters continue calling the same main-thread solver.

Final sequential verification after the review corrections in this worktree on 2026-10-14:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed, including examples/tools and TypeScript source verification. |
| `npm test` | 314 passed, 0 failed, 0 skipped, including five additional review regressions. |
| `npm run test:browser` | 23 passed, 0 failed, 0 skipped; WebGL2/WebGPU rendering and real Ammo Workers using both transferable and shared-memory transports. |
| `npm run build` | Passed. |
| `git diff --check` | Passed. |
| Pinned reference fixtures | Six previously regenerated Babylon solver cases checked against analytical geometry by the unit suite after the corrections. |

During the initial implementation, an intermediate browser run failed to fetch an example module while a concurrent package rebuild temporarily removed `dist`. The final checks above ran sequentially, with no rebuild during browser execution; the example-page test and the full suite passed. No repository build/server change was needed.

No post-merge verification is required; visual inspection of legitimate models is optional and has not been claimed.
