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

1. Restore authored input, then evaluate VMD/VPD motion. Capture authored pose.
2. Apply direct/group bone morphs once and capture the separate morphed pose.
3. Stage post-phase bones at rest. Process pre-phase grants and IK in
   transformation-class/file-index order; capture the pre-physics result.
4. Consume pre-phase kinematic inputs and previously deferred post-phase inputs.
   Step Ammo once, then project body modes 1/2 onto the skeleton.
5. Publish post-phase authored motion/morphs. Compose mode-1 post displacement
   onto the body-derived parent-space position, and append authored rotation to
   body-derived rotation. Mode 2 retains authored position and simulated rotation.
6. Process post grants/IK in class/index order. Reproject dynamic bones as their
   parents move, retaining skeletal contributions. Capture the final pose.
7. Save complete post kinematic/mode-2 follow inputs for the next positive step.
   Publish matrices to skinning, SDEF, surface, outline and shadow consumers.

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

Before-physics kinematic bodies see pre-phase grants in the same frame. Dynamic
bodies remain authoritative over pre-phase authored transforms. Ordinary grants
inherit procedural source motion, excluding the Bullet baseline. This includes
already evaluated post grants/IK on a dynamic source; local grants read its
accumulated simulated-plus-procedural model pose. There is no recursive source
solve or retroactive reordering across classes.

### Explicit body and layer semantics (Issue #39)

The earlier kinematic/dynamic reproducers remain in `tests/grant.test.ts`, now
with positive next-step and dynamic-layer assertions. `poseLayers` on the helper
mesh state contains distinct `rest`, `authored`, `morphed`, `beforePhysics`,
`physics`, `postPhysicsBase` and `final` snapshots: seven float64 values per bone
(parent-space position xyz and quaternion xyzw). Rest is copied from PMX bind
metadata and is never captured from an animated skeleton.

For mode 1, post position is `bodyLocalPosition + authoredPosition - restPosition`,
and rotation is `bodyLocalQuaternion * authoredQuaternion`, followed by grant/IK.
Mode 2 uses the authored position and the same rotation composition. PMX bind
rotations are identity. This policy keeps legal post motion/morph/grant/IK visible
without writing rendered offsets or IK rotation into a dynamic body's trajectory.
When a skeletal parent subsequently moves, the raw body transform is re-expressed
in the new parent frame, retaining the explicit skeletal offset. A pre-phase
physical child of a post-phase parent also retains its world body authority.
Publishing authored state at the post boundary lets an earlier IK controller
operate on a later-class link without that link's turn erasing the solved pose.

Mode-0 bodies controlled by a post bone **or any post ancestor** consume the
preceding completed final transform at the next positive simulation update.
The initial input is the initialized/rest phase pose. The body remains at the
pose used for the completed step; the final rendered bone may differ. There is
no post-step teleport and no assertion that contacts or constraints saw a future
pose. A changing post source therefore has an explicit one-step delay in
simulation, including shared worlds. Calls at zero delta can evaluate a new
final pose/deferred input but neither advance Ammo nor consume that input.
Pre-phase kinematics retain same-step synchronization.

A post mode-2 body's position alignment is likewise deferred: the next step
consumes the final controlling-bone/body-offset position while retaining the
body's simulated rotation. Mode-1 post transforms never become next-step body
inputs. Pre-phase mode-2 alignment retains the existing adapter behavior after positive
steps. `physics.bodyResults` stores the actual Bullet output **before** alignment,
separately from current body/adapter and next-input poses; the viewer reports all
three. Zero-time evaluation performs no position alignment or body writes.

Both helper modes use these semantics. Shared worlds stage every mesh before
one world step and finish every post phase afterward. Warmup settles physics at
fixed authored time through the full PMX pipeline, including direct
`physics.warmup()` on a helper-owned adapter. Reset uses the pre-physics baseline
for dynamic bodies, clears velocity/forces/interpolation and stale contacts,
and seeds deferred follow inputs from the current pose. Removing a helper mesh
removes its bodies/constraints from a shared world. PMD keeps its existing phase
and warmup path.

This is a defined compatibility policy for the PMX motion → physics → post
ordering described by the [PMXEditor specification](https://gist.github.com/FlandreDaisuki/90ae5abf3138a15994526b6bfec73c2c)
and the [creator's ordering explanation](https://unlimitedboneworks.blogspot.com/2025/02/blog-post_16.html).
Those references describe phases; they do not specify the complete feedback
policy for post-phase physical targets. Byte-for-byte equivalence to a specific
MMD binary/solver is not asserted. Existing local-grant PMXEditor compatibility
choices above are preserved. External parents, animated nonuniform skeletal
scale, impulse/flip morphs and unrelated motion sections remain outside scope.

Missing/self/cyclic skeletal-parent edges are detached before Three builds the
hierarchy. Invalid pose components fall back to that bone's rest components and
are excluded as grant sources for that frame. Missing IK references, nonfinite
limits/iterations and degenerate axes are ignored; iteration count is bounded.
Finite nonunit quaternions are normalized, and coordinates/grant results outside
the supported finite range (absolute component below 1e15) are rejected.
Unrelated valid bones continue to evaluate. Parser body positions are copied
before conversion to offsets, so repeated builds cannot subtract rest twice.
Joint-converted mode-2 targets compose using the effective mode-1 authority;
`originalType` retains the original PMX body mode for private inspection.

## Private inspection

Run `npm run dev:sdef` and open the printed loopback URL. Select `grant/` and a
relative PMX path, or click **Generated Grant fixture**. The fixture is generated
locally and parsed by the actual `MMDLoader`, requiring no external assets.
Enable **Apply PMX grants**, select a source bone and change its translation or
bend rotation. Affected targets are highlighted in the metadata report, with
indices/names, flags, ratios, classes, physics phases and calculated transforms.
Counts explicitly report absent local/position cases; this is inspection, not a
visual-pass assertion. Reset restores the pose; local VMD playback is optional.
The other private inspection views retain their existing controls. Select
**physics-layers/** or **Generated Physics layers fixture** to initialize real
Ammo. Physics on/off, step (1/60 s), pause/resume and reset controls expose
authored/pre/physics/final bone snapshots and the actual body pose used by the
completed step. Counts identify post kinematic, mode-1 and mode-2 targets; absent
required categories are reported explicitly. VMD playback and bone sliders give
reproducible authored inputs. The fixed-step simulation starts paused.

Manually obtained, legitimately licensed PMX/texture/VMD files may be placed in
`examples/assets/private/grant/` or `examples/assets/private/physics-layers/`. Review the original archive's README/license
locally first. Archives, model README, screenshots and all private assets remain
Git-ignored and excluded from npm packs, static builds, Pages and CI artifacts.
The loopback server rejects traversal, all descendant symlinks and disallowed
file extensions. No third-party files were obtained, modified, inspected or
redistributed for this implementation. The creator confirms post-phase cape/hair
usage in the optional Riyon candidate, but its PMX bytes, target/body combinations
and license remain uninspected. PAC's clock tower is also optional; its unmodified
flags are unverified and any permitted modifications must remain private.
The existing DONburi Room grant candidate remains available for manual inspection. Deferred real-model Issue #30 is unchanged.

## Automated validation

Generated PMX fixtures cover all flag combinations, combined flags, multiple
classes, a post-physics target, signed ratios and asymmetric parent branches.
Scalar quaternion/rigid-transform reference tests cover bind pose, parent and
grandparent motion, chains, branching, exact displacements and mesh skinning.
Regression tests cover animation, morphs, IK timing, lifecycle and real Ammo.
`tests/physics-layers.test.ts` adds a binary PMX/VMD fixture with post motion,
direct/group morphs, pre/post IK, all three body modes, a contact probe and a
constrained pair. A scalar pose oracle and a separate Bullet world driven by
independently calculated prior-final inputs check 90 frames in both helper modes
and shared/nonshared worlds. Pose tolerance is 1e-4 (including VMD interpolation
bisection); body-reference tolerance is 5e-4. Constraint anchor error is bounded
below 0.2 during the seeded pose jump and 0.08 after frame 30, while isolated
dynamic targets stay at rest within 1e-4. Lifecycle tests exercise warmup, reset,
zero-time pause, seek/loop, toggles and helper transfer. The browser fixture
checks frames 1/3/12 and GPU position/normal error below 5e-4, plus independently
baked toon/outline/shadow rasterization on WebGL2 and available native WebGPU.
Mandatory WebGL2 and native WebGPU when available compare GPU positions/normals
and actual toon/outline/shadow rasterization to independently CPU-baked geometry.
The private viewer and package/static-build isolation have automated guardrails.
The full check sequence is `npm run typecheck`, `npm test`,
`npm run test:browser`, `MMD_EXAMPLE_FIXTURES=1 npm run build:examples`, and
`npm run test:examples`. Package tests install isolated JS/TS consumers.
