# PMX material morph playback

PMX type 8 material morphs run with `mmd-parser ^1.1.4`, using the original
`morphTargetDictionary` indices and `morphTargetInfluences`. VMD named tracks,
direct sliders and direct type 0 group links share these weights:

```ts
const helper = new MMDAnimationHelper();
helper.add(mesh, { physics: false });
mesh.morphTargetInfluences[mesh.morphTargetDictionary['material-effect']] = 0.5;
helper.update(0);
helper.enable('materialMorph', false).update(0); // restore PMX material bases
```

The feature is enabled by default. Each update starts from an immutable copy
of the raw PMX material parameters, independent of previously rendered values.
Mixer pause, stop/restart, seek, loop, pose reset and helper transfer therefore
cannot accumulate material changes. Disabling animation freezes VMD weights;
material evaluation still runs, allowing sliders during paused playback.
Disabling `materialMorph` restores bases without changing public weights;
reenabling it reapplies them. Removing a mesh from a helper restores its bases.
Pose operations evaluate current weights; clearing weights followed by
`helper.update(0)` restores materials. Both ordinary and `pmxAnimation: true`
helper modes use the same evaluator. The controller owns these parameters during helper updates, including base
restoration while disabled. Remove the mesh from the helper before customizing
controlled parameters yourself.

## Weights, order and invalid inputs

For each type 8 target, effective weight is its direct weight plus every direct
group reference's `groupWeight * ratio`. Duplicate references and multiple
groups add; effective weights are never written back to the public array.
Negative weights/ratios and weights above one are valid extrapolation and are
not clamped. Zero weights do nothing. Nonfinite direct/group weights and
nonfinite contributions are ignored; an overflowing sum is ignored as well.
For meshes with material morphs, surface, outline and shadow draws also replace
nonfinite public weights with zero in a temporary array for vertex rendering. This
keeps Three's base-influence sum and placeholder targets finite. The original
public array, indices and values are restored after each draw; helper updates
and VMD tracks retain their original weights. Finite vertex/group weights still
reach Three unchanged.
Group-to-group links (including cycles) remain ignored. Vertex and bone links
continue through their existing implementations exactly once.

Targets are applied in PMX morph order, then element order. Multiplication
uses `value *= 1 + (coefficient - 1) * weight`; addition uses
`value += delta * weight`. Thus an addition followed by multiplication differs
from multiplication followed by addition. Repeated elements apply separately.
Material index `-1` addresses every material; other negative, noninteger,
nonfinite and out-of-range indices are ignored. Modes other than 0 (multiply)
and 1 (add) are ignored. Nonfinite channel inputs/results leave that component
unchanged, preventing invalid uniforms. Extrapolation can produce negative
colors, alpha or edge sizes: only rendering's usual color/alpha bounds apply,
and nonpositive edge size/alpha disables the outline.

`mesh.geometry.userData.MMD.materialMorphs` retains type 8 names, original
indices and all parsed element fields. Element `type` is the calculation mode,
not the morph type. `material.userData.MMD.materialBase` holds frozen source
values; `material.userData.MMD.materialMorph` exposes the latest evaluated
values for diagnostics. These are raw PMX values, without spatial flips.

## TSL, transparency and outlines

Diffuse RGBA, specular RGB, shininess, ambient RGB, edge RGBA/size and
texture/sphere/toon RGBA all participate in the arithmetic. Surface colors and
sampler factors are evaluated in PMX source sRGB, then converted to Three's
linear working space. Ambient becomes emissive, retaining the loader's 0.2
factor when a diffuse map is present. The existing outline convention retains
raw edge RGB as working-space color and `edgeSize / 300` as hull thickness.
The PMX edge-enabled flag still governs visibility, including when a morph
raises an initially zero edge size.

Per-material `mmdTextureColor`, `mmdSphereColor`, and `mmdToonColor` Vector4
values are TSL uniforms. Base-map RGB/alpha affects diffuse; toon RGB tints
direct diffuse and Phong specular irradiance; sphere RGB affects the existing
add/multiply output operation. Sampler alpha factors multiply surface opacity
once. Missing samplers ignore their factors. Existing sphere texture alpha
semantics remain unchanged. No texture images, sampling settings or shared
texture contents are changed by playback. Clones have independent factors.

Every material with a valid morph that can change surface or edge alpha is
classified for transparency at load time, including both modes and all-material
targets. Those materials stay in the transparent pipeline, even at weight zero
and opacity one; this preserves blending and avoids recompilation per frame.
They use DoubleSide, consistent with the loader's translucent PMX handling,
while retaining its custom blending and depth-write settings. Diffuse texture
alpha classification still applies asynchronously. Zero surface alpha discards
fragments so it cannot leave invisible depth occluders. Outline color, alpha,
thickness and visibility update through the cached hull's uniforms.

Three sorts transparent objects/material groups, not individual intersecting
triangles. Transparent PMX meshes retain the existing depth-write behavior;
intersecting translucent surfaces can still require application-specific draw
order/depth settings. The hull renders adjacent to its surface and is not a
separately sorted object. Edge alpha is independent of diffuse alpha, as in
PMX: hiding the surface alone does not hide an authored nonzero edge.

The r186 default shadow pass uses binary depth shadows for partial opacity;
this feature does not implement physically transmitted translucent shadows.
A source-bound shadow mask includes morph opacity/sampler factors and alpha
testing, so zero-alpha materials stop casting shadows and reset correctly.
Outlines do not cast an additional hull shadow. Applications can replace
`maskShadowNode` if they supply their own shadow policy.

## Private viewer and automated checks

`npm run dev:sdef` serves the viewer at
`http://127.0.0.1:8081/local-sdef/` (`?webgl` forces WebGL2). Select
**material-morph/** and enter a relative PMX path. The viewer lists actual
parsed type 8 names/indices, targeted materials, calculation modes, all
payloads, current parameters and outline diagnostics. Direct and group sliders
can vary these weights independently. A PMX without type 8 payloads shows a
warning. Existing SDEF, bone and group controls remain available.

For optional human inspection only, legitimately obtain a model and review its
actual archive README/license before placing it under Git-ignored
`examples/assets/private/material-morph/`. No particular candidate's morphs or
license have been verified here. There are no automatic private downloads.
Realpath containment and extension checks reject traversal, external symlinks,
archives and licenses. The viewer/private assets are absent from npm packs,
public builds and Pages URLs. Public example assets are unchanged.

Generated PMX bytes parsed by the published parser exercise shared/missing
textures, all channels, both arithmetic modes, `-1`, ordered interactions,
duplicate elements/links, groups and invalid inputs. Independent explicit
equations verify runtime values at zero, half, full and extrapolated weights,
playback controls, feature toggles and helper transfers. Browser render-target
RGBA assertions cover diffuse, emissive, specular, base-map, toon, sphere
add/multiply, alpha, groups, outline width/color/alpha, reset, zero-alpha depth
and shadows on mandatory WebGL2 and native WebGPU when an adapter is available.
Generated fixtures also exercise the private viewer and isolated JS/TS package
consumers. No human review, licensed asset or post-merge check is required to
complete Issue #33.

UV/additional-UV morphs, PMX 2.1 flip/impulse morphs, sphere envFlag 3 and full
Grant support remain separate work.
