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

Multiply and add contributions are accumulated independently, as specified in
[the original Japanese PMX definition](https://github.com/hirakuni45/glfw3_app/blob/master/glfw3_app/docs/PMX_spec.txt)
(material-morph arithmetic, lines 454–465):

```text
M = product(1 + (multiplyOperand - 1) * effectiveWeight) // identity 1
A = sum(addOperand * effectiveWeight)                   // identity 0
materialValue = baseValue * M + A
```

Morph/element order therefore does not make a later multiplier scale an earlier
addition. Repeated multiply elements still multiply separately; repeated adds
sum separately. Finite negative/extrapolated weights retain this algebra (an
extension outside normal slider ranges, without a claim about native clamping).
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
sampler controls are evaluated in PMX source sRGB. Material RGB is then
converted to Three's linear working space; sampler RGB is reconstructed as below. Ambient updates the dedicated `material.ambient` color;
[the MMD shading path](material-shading.md) applies the documented `0.5`
coefficient and color texture, leaving user emission controls intact. The existing
outline convention retains raw edge RGB as working-space color and `edgeSize / 300` as hull thickness.
The PMX edge-enabled flag still governs visibility, including when a morph
raises an initially zero edge size.

Per-material `mmdTextureColor`, `mmdSphereColor`, and `mmdToonColor` Vector4
uniforms hold **raw source-space multiply controls**. Their independent
`mmdTextureColorAdd`, `mmdSphereColorAdd`, and `mmdToonColorAdd` uniforms hold
raw additive controls, defaulting to zero. Clones own all six controls.
For a sampled source RGB `t`, the effective RGB is:

```text
q = M.a + A.a
sampleRGB = neutral * (1 - q) + (t * M.rgb + A.rgb) * q
sampleAlpha = original sampled alpha
```

`neutral` is white for base, toon, sphere multiply and SubTexture, and black
for sphere add. Thus zero control alpha removes the texture's RGB contribution
by blending to its operation's neutral; it never makes a surface transparent.
The exact combined interpolation is verified in the original MME sample
`Basic/full.fx` v2.0, `BufferShadow_PS`, lines 389/397 (see the
[evidence table and provenance](material-shading.md#evidence-and-decisions-issue-96)).
The PMX format explicitly requires preserving texture alpha; the original
sample implements this by assigning only RGB. Its toon factor is not separately
exposed, so this library applies PMX's stated common rule to toon too. Controls
and interpolation are not clamped; extrapolation is supported.

The GPU converts a decoded texture RGB back to source sRGB for this operation,
then converts the reconstructed RGB to working space. Applying a converted RGB
factor directly to a linear sample is not equivalent, especially for nonzero
additions or partial alpha. Surface lighting itself remains linear.
Base texture RGB modulates diffuse and ambient, toon modulates their existing
ramp, and sphere/SubTexture modulates the existing surface composition before
specular. Only actual diffuse alpha, base texture alpha, SubTexture sample
alpha and alphaMap.g enter opacity; missing layers ignore their controls.
Sphere modes 1/2 and toon keep their existing sampled-alpha policy. No texture
image, sampler setting or shared texture contents change during playback.
`materialMorph` retains raw `base * M + A` channel diagnostics; for sampler
reconstruction inspect the separate public uniforms, since a combined RGBA
cannot represent the interpolation.

Every material with a valid morph that can change surface or edge alpha is
classified for transparency at load time, including both modes and all-material
targets. Sampler control alpha alone never triggers transparency classification. Those materials stay in the transparent pipeline, even at weight zero
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
A source-bound shadow mask includes actual material opacity, texture sample
alpha and alpha testing, so zero-alpha materials stop casting shadows and reset correctly.
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
textures, all channels, both arithmetic modes, `-1`, order-independent interactions,
duplicate elements/links, groups and invalid inputs. Independent explicit
equations verify runtime values at zero, half, full and extrapolated weights,
playback controls, feature toggles and helper transfers. Browser render-target
RGBA assertions cover diffuse, ambient, specular, base-map, toon, sphere
add/multiply, alpha, groups, outline width/color/alpha, reset, zero-alpha depth
and shadows on mandatory WebGL2 and native WebGPU when an adapter is available.
Generated fixtures also exercise the private viewer and isolated JS/TS package
consumers. Native-MMD visual comparison remains optional.

UV/additional-UV, bone/group playback, SDEF/BDEF, outlines and grant evaluation
remain on their existing paths. PMX 2.1 flip/impulse morphs remain separate work.

## Issue #96 validation

Validation results are recorded here before the implementation commit. Original
MME source was inspected; no native MMD binary/render comparison was performed.
Post-merge Tests/Pages verification remains **PENDING** and must use the actual
merge SHA and latest workflow attempts; see [material shading](material-shading.md).

Regression evidence against the unmodified upstream implementation:

- With fixture direct/group weights `w1=w4=0.5`, `w3=0.25`, diffuse red must be
  `0.8 * (1 - 0.5 * 0.6875) * (1 - 0.5 * 0.25)^2 + 0.2 * 0.25`,
  or `0.451953125`. The old evaluator returned approximately `0.44023438`,
  because it multiplied the addition too. The revised seek/playback tests
  failed numerically before the controller fix.
- An isolated archive of upstream, built with the new independent renderer
  oracle, returned direct-light RGBA `[17,14,13,255]` where unit-scale MMD
  lighting requires approximately `[43,28,18,255]` (linear target).
- Running the zero-control-alpha sampler case separately against upstream
  returned `[3,2,1,0]`, where white neutral RGB and preserved real opacity
  require `[51,51,51,102]`. No source shader was changed for these baseline
  checks; dummy zero additive properties only let the test assign its inputs.

The ambient and UV pixel fixtures now use light intensity `1` (or their authored
fractional intensity), instead of multiplying by pi to compensate for the old
Lambert normalization. SubTexture expectations now reconstruct source RGB and
preserve sample alpha. These expectation changes follow the evidence/equations
above; they are not captured images of the new implementation.

The expanded light fixture advances an animation frame between samples because
Three caches light uniforms per frame. Scalar checks also pin zero-power and
zero-angle limits, including tiny positive powers and an opposing half-vector.

Final local checks (2026-10-21, Chrome on macOS):

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed, including Examples/tools and isolated TypeScript consumer checks |
| `npm test` | 1,195 passed, 0 failed |
| `npm run test:legacy` | 1,195 passed, 0 failed |
| `npm run test:browser` | 54 passed, 0 failed, 0 skipped; WebGL2 and native WebGPU available |
| `npm run build` | Passed; JS and declarations built |
| `npm run build:examples` | Passed with pinned public assets |
| `MMD_EXAMPLE_SITE=dist/examples MMD_EXAMPLE_ASSETS=1 npm run test:examples` | 3 passed; built artifact served under a project prefix, PMD pages and real Gene Light PMX startup/material/animation controls checked with default and legacy runtimes |
| `npm pack --dry-run --json` | Passed, 61 package entries; isolated packed JS/TS consumers also passed in the unit/browser suites |
| `git diff --check` and staged diff check | Passed |

The first full browser run had four failures: the new light fixture sampled
cached per-frame light state without advancing frames, the UV fixture retained
its old pi-compensated light, one existing non-isolated physics transport check
failed, and one existing worker case hit its 45-second timeout while other
browser jobs were running. The first two fixtures were corrected against their
independent equations; the latter two passed isolated reruns. The final complete
run, without concurrent browser jobs, passed all 54 tests in approximately
680 seconds. No physics implementation or physics test was changed.

Per backend, the new direct-light/sampler suite checks 272 scalar-derived
pixels plus separate canvas sRGB conversion. Material morph coverage adds 330
surface RGBA assertions, direct/group/reset and nonfinite-weight checks,
outline pixels, and shadow opacity tests including zero RGB-control alpha.
The existing ambient suite adds 104 composition checks per backend.

Explicit non-goal review against the upstream source confirmed unchanged toon
coordinate, derivative width, fallback ramp, ramp accumulation/light-color flow,
`finish()` composition and shadow-override executable code. Loader ramp rotation,
UV selection and shadow integration files were not changed. Shared edits only
reconstruct sampler RGB and remove control A from opacity/classification/masks;
real opacity and alpha-test inputs retain their existing paths. The existing
sphere/toon sampled-alpha policy is documented in material shading.

Native MMD binary/capture comparison was not performed. The raw-PMX-to-MME
ambient mapping, exact native zero-power boundary and historical pass-specific
behavior remain limitations documented in the evidence table. Tests/Pages
workflow and public deployment checks remain **PENDING until after merge**;
local automated success is not a claim of exact MikuMikuDance visual fidelity.
