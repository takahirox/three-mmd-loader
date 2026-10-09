# PMX grant / append bone deformation

`MMDLoader` retains the released `mmd-parser ^1.1.4` grant metadata and original
PMX bone `flag`. `MMDAnimationHelper` applies rotation and position independently,
including combined flags, signed ratios, upstream chains and branching grants.
No extra API or parser version is required.

## Reference and spaces

The reference is the [PMX specification's bone deformation section](https://github.com/hirakuni45/glfw3_app/blob/master/glfw3_app/docs/PMX_spec.txt),
cross-checked against the [PMXEditor author's 0216/0216b description](https://kkhk22.seesaa.net/article/312703073.html).
The latter corrects the earlier specification note about ignoring local grants
in chains: **local grants take priority**, including when the source has a grant.
This is PMXEditor behavior; the author's original announcement describes it as
an editor extension awaiting MMD adoption. Compatibility with every MMD binary
version is not implied. The historical name “local” does not mean local axes.

Using Three.js column-vector quaternion notation, with `A` the source's motion
rotation including morphs, grants and already executed IK, and `B` the target's
motion rotation including morphs, the result is `B * power(A, ratio)`. This is
the column-vector conversion of the specification's row-vector ordering.
It preserves the original ordinary rotation grant behavior. Morph rotation
precedes animation rotation, as documented in [bone-morphs.md](bone-morphs.md).

| Grant | Source rotation | Source displacement |
| --- | --- | --- |
| Ordinary (`isLocal=false`) | Current source bone quaternion | Source parent-relative position minus its bind offset |
| Local (`isLocal=true`) | Source accumulated model-space rotation | Source accumulated model-space position minus its initial model-space position |

Rotation and displacement are independent. A local translation includes the
source's orbit around its parents and grandparents, even with no direct source
translation. Mesh/scene transforms are excluded. The ratio-scaled displacement
is added to the target's **parent-relative** position. The local quaternion is
appended to the target's parent-relative quaternion. These PMX rules deliberately
allow skeletal-parent motion to be counted again when source and target share a
parent; they are not a world-space constraint that cancels the target's parents.
Neither local-axis definitions nor source-to-target parent frame conversions
are part of grant deformation. PMX bind rotations are identity and scales one.
Animated nonuniform bone scales and external-parent deformation remain outside
the PMX rigid-bone deformation supported here.

`power` uses the shortest quaternion arc and supports zero, fractional, negative
and greater-than-one ratios without clamping. Translation scales linearly. Bind
positions never become ordinary grant displacements; rest pose stays at rest.
Invalid indices, self references, grant cycles, local references to a skeletal
descendant, invalid source poses and nonfinite/overflowing ratios/results skip
the affected grant without recursing or corrupting independent bones. All PMX
metadata remains inspectable, including invalid grant references.

## Order, animation and physics

For PMX, both default and `pmxAnimation: true` use the same order:

1. Restore the preceding procedural pass; evaluate VMD animation.
2. Apply direct and group bone morph contributions once.
3. Process before-physics bones by transformation class, then file index:
   append grant, update matrices, solve that bone's IK.
4. Update kinematic bodies, simulate physics, copy dynamic body poses to bones.
5. Process after-physics (`flag & 0x1000`) grants/IK in class/index order.
6. Update model matrices and capture the result for the next restoration.

PMD retains its existing IK/grant behavior. `pmxAnimation` remains accepted for
compatibility, but no longer selects divergent PMX grant ordering. Grant sources
are read at the target's ordered turn; there is no recursive source update that
moves a later IK/class before an earlier target. Authors must order multi-stage
chains and parent-dependent local grants accordingly. Single-stage ordinary
grants may read authored motion before the source's turn. Already executed IK
is visible; IK executed later does not retroactively alter an earlier grant.

Restoration uses the existing morph controller for grant-only models too. It
preserves absolute direct edits, repeated `update(0)`, paused playback, seek,
loops, action restarts, VPD reset, feature toggles and helper transfer. The grant
solver adds no Three.js private API dependencies. Existing mixer observation
for restoring procedural bone poses still depends on r186 mixer internals,
as described in the bone morph documentation. Standalone solver `updateOne`
is an additive operation; helper restoration defines frame boundaries.

Before-physics kinematic bodies see grants in the same frame. Dynamic bodies
remain authoritative over before-physics target transforms. Ordinary grants retain the authored/grant/IK
source snapshot across physics, so simulation displacement is inherited only
by local grants. After-physics local
grants on non-dynamic targets can follow a dynamic source's rotation/translation
in the same frame, including experimental shared physics. Skinning, SDEF,
normal deformation, outlines and shadows consume those final bone transforms.

### Explicit inherited deformation-layer limitations

This helper does not stage authored animation separately for every deformation
layer: all VMD/morph values are set before the physics step. As a result,
after-physics authored motion on a **kinematic body target** reaches simulation
before its after-physics grant is evaluated. The body's same-step pose therefore
lacks that grant; the rendered bone includes it. Updating the body a second time
would not re-run contacts/constraints and would falsely imply complete support.
`tests/grant.test.ts` contains an executable “after-physics kinematic bodies”
reproducer asserting this exact one-unit difference.

After-physics grants on **dynamic body targets** are skipped while physics is
active, preserving the authoritative physics pose rather than overwriting it.
They run normally with physics disabled and for `pose()` without simulation.
The tests assert this boundary. Full authored/grant/IK layering for after-physics
kinematic and dynamic targets needs a separate deformation-layer implementation;
these cases are not claimed supported by this change. External parents and
nonuniform skeletal scale also remain outside scope. No post-merge verification
is required for Issue #37.

## Private inspection

Run `npm run dev:sdef` and open the printed loopback URL. Select `grant/` and a
relative PMX path, or click **Generated Grant fixture**. The fixture is generated
locally and parsed by the actual `MMDLoader`, requiring no external assets.
Enable **Apply PMX grants**, select a source bone and change its translation or
bend rotation. Affected targets are highlighted in the metadata report, with
indices/names, flags, ratios, classes, physics phases and calculated transforms.
Counts explicitly report absent local/position cases; this is inspection, not a
visual-pass assertion. Reset restores the pose; local VMD playback is optional.
Physics is disabled in the private viewer.

Manually obtained, legitimately licensed PMX/texture/VMD files may be placed in
`examples/assets/private/grant/`. Review the original archive's README/license
locally first. Archives, model README, screenshots and all private assets remain
Git-ignored and excluded from npm packs, static builds, Pages and CI artifacts.
No third-party files were obtained, modified, inspected or redistributed for
this implementation. DONburi Room's PMX autogroove model and PAC's clock tower
remain optional human-led candidates; the unmodified clock tower's local flag
is not verified. Deferred real-model Issue #30 is unchanged.

## Automated validation

Generated PMX fixtures cover all flag combinations, combined flags, multiple
classes, a post-physics target, signed ratios and asymmetric parent branches.
Scalar quaternion/rigid-transform reference tests cover bind pose, parent and
grandparent motion, chains, branching, exact displacements and mesh skinning.
Regression tests cover animation, morphs, IK timing, lifecycle and real Ammo.
Mandatory WebGL2 and native WebGPU when available compare GPU positions/normals
and actual toon/outline/shadow rasterization to independently CPU-baked geometry.
The private viewer and package/static-build isolation have automated guardrails.
The full check sequence is `npm run typecheck`, `npm test`,
`npm run test:browser`, `MMD_EXAMPLE_FIXTURES=1 npm run build:examples`, and
`npm run test:examples`. Package tests install isolated JS/TS consumers.
