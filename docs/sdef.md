# PMX SDEF

SDEF requires the npm-published **mmd-parser 1.1.3 or newer**. That release
preserves PMX skinning type `3` and original `skinC`, `skinR0`, `skinR1`, and
reflects their Z coordinates when parsing into Three's right-handed space.
The loader does not re-convert or pre-correct those vectors.

`GeometryBuilder` retains `mmdSkinningType` for every vertex (PMD uses BDEF2,
type `1`). Meshes containing SDEF also carry `mmdSdefC`, `mmdSdefR0`, and
`mmdSdefR1` as float vec3 attributes; entries for BDEF vertices are zero.
`skinIndex` and `skinWeight` keep their standard four-component layout.
These four attributes share one interleaved GPU vertex buffer to stay within
WebGPU’s default eight-buffer limit alongside normals, UVs and tangents.
The explicit type selects SDEF even when a center or corrected offset is zero.

## Algorithm and spaces

The reference is babylon-mmd's [PMX center correction](https://github.com/noname0310/babylon-mmd/blob/ccb750db2998ed1067017eaf67f3fc987cfba6f8/src/Loader/pmLoader.ts)
and [SDEF vertex deformation](https://github.com/noname0310/babylon-mmd/blob/ccb750db2998ed1067017eaf67f3fc987cfba6f8/src/Loader/Shaders/sdefVertex.ts).
The implementation expresses that algorithm in TSL for both backends; it
contains no custom GLSL or WGSL source and no CPU runtime skinning.

Given weights `w0 + w1 = 1`, bone palette matrices `M0`, `M1` (current bone
world transform times inverse rest transform), and morph-adjusted position `p`:

```text
Rw  = w0 R0 + w1 R1
CR0 = C + (R0 - Rw) / 2
CR1 = C + (R1 - Rw) / 2
q   = shortest-path slerp(rotation(M0), rotation(M1), w1)
p'  = rotate(q, p - C) + w0 transform(M0, CR0) + w1 transform(M1, CR1)
n'  = rotate(q, n)
```

Transform `p`, `C`, `R0`, and `R1` by the mesh's `bindMatrix` before applying
the formula, and transform the result by `bindMatrixInverse` afterward. Bind
translation cancels in vector differences. Normals and tangents use the 3×3
bind transforms around the quaternion rotation. Palette rotation extraction
normalizes its columns and uses all four matrix-to-quaternion branches; slerp
uses the closest quaternion sign and a normalized linear limit for nearly
identical rotations. PMX bone motion uses rigid transforms: nonuniform bone
scale/shear does not define an SDEF rotational deformation.

Identity palettes yield the original position because `w0 CR0 + w1 CR1 = C`.
Endpoint weights yield the corresponding single-bone transformation. The
rotation preserves spherical arcs that BDEF2's linear interpolation shrinks.
Morph offsets enter `p` before skinning; they do not change the SDEF centers.

## Three.js r186 integration

The toon and outline materials share `setupMMDPosition`: morph → skin →
displacement → optional application `positionNode`. Each mixed-mesh vertex
executes either SDEF or Three's standard BDEF skinning, exactly once. Meshes
without SDEF use the original NodeMaterial setup unchanged. Three's BDEF node
registers its skeleton update event during shader building regardless of the
GPU branch, retaining r186's frame-scoped palette updates across passes.
Palette access follows r186's uniform-buffer limit and bone-texture fallback;
object references allow materials to be shared by different skeletons.

r186's shadow pass builds an override NodeMaterial and does not inherit the
source material's `setupPosition`. For loader-created SDEF meshes,
`onBeforeShadow` temporarily installs the same setup on that override, and
`onAfterShadow` restores it. The original shadow pipeline still handles
alpha maps, side selection, depth and shadow filtering. Applications adding
shadow callbacks to these meshes must chain the loader's callbacks.
Outlines receive the same deformed normals before their hull expansion.

## Automated validation

`tests/sdef-reference.ts` is an independent CPU reference using Matrix4,
Quaternion.slerp and Vector3 operations; it is not part of the package runtime.
Generated PMX fixtures exercise the published parser and actual MMDLoader,
including mixed BDEF1/BDEF2/BDEF4/SDEF vertices and absolute vertex morphs.
CPU tests cover rest pose, endpoint weights, an analytical two-bone arc,
handedness conversion and bind transforms.

The browser test reads floating-point render targets from actual TSL execution
on mandatory `WebGPURenderer({forceWebGL:true})` and native WebGPU when an
adapter exists. It compares positions and normals against CPU results under
multiple bone poses, morphs and nonidentity bind transforms, then forces a
1,100-bone palette through the bone-texture path. A `5e-4` absolute tolerance
accounts for GPU floating-point and transcendental-operation precision. Raster tests compare
toon surfaces, outlines and shadow occluders with independently CPU-baked
geometry. Existing PMD, material, animation and example tests remain in place.

## Local YYB Miku viewing

Manually obtain **YYB式初音ミク 10th v1.02** only from the author's
[original distribution](https://bowlroll.net/file/146083), following its terms.
Read the archive's actual README/license locally before using the model.
No agent or CI job downloads it, logs into BowlRoll, or validates redistribution
permission. This repository includes no copy of the model or its license.

1. Extract the model under
   `examples/assets/private/yyb-miku-10th/`. Preserve its texture paths and
   subdirectories. Keep the archive and README/license there too. Either name
   the PMX `model.pmx`, or enter its original relative filename in the viewer.
2. Run `npm ci`, then `npm run dev:sdef`.
3. Open `http://127.0.0.1:8081/local-sdef/`. Use `?webgl` to force WebGL2;
   the default tries native WebGPU with Three's fallback.
4. Click **Load PMX**. The status displays the actual SDEF vertex count.
   Select an elbow or knee, choose its local bend axis, and move **Bend** to
   about 60–100°. Drag to orbit and scroll to zoom. **Reset pose** restores the
   rest transforms. Toggle **Compare using BDEF2** to use the same mesh and pose
   with SDEF vertices treated as BDEF2, including the outline.
5. Optionally place a legitimately obtained compatible VMD inside the same
   private directory and enter its relative path. **Play local motion** uses
   MMDLoader/MMDAnimationHelper with IK and grants and without physics.
   **Stop motion** restores the rest pose. No motion is bundled.

The directory is already Git-ignored by `examples/assets/`. The separate
server binds only to `127.0.0.1` and exposes model/texture/motion extensions,
not archives or README/license files. Never expose this server through a
public proxy or tunnel. The ordinary examples server denies the private asset
route. The viewer lives in `local-viewer/` and `scripts/serve-sdef.ts`, outside
`examples/` and `dist/`; its TypeScript is transformed only by the local server.
The static examples build uses its existing explicit asset list and does not
copy this viewer or private directory. The npm package's explicit file list
excludes the viewer, scripts and every example asset. Tests enforce those
boundaries; no private assets are uploaded as CI artifacts.

The existing public examples, assets, catalog and screenshots are unchanged.
A future public model replacement requires a separate issue and review of the
actual license. Manual real-model inspection is optional and informative,
not an acceptance or post-merge completion gate for Issue #26.
