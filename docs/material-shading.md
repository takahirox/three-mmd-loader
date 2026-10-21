# MMD material color and direct light

The default targets MikuMikuDance standard materials. It removes Three's
Lambert `1 / pi` and normalized/Fresnel specular terms. This is a compatibility
implementation with the limitations below, not a claim of exact native pixels.

## Evidence and decisions (Issue #96)

The primary format source is the Japanese
[PMX format definition](https://github.com/hirakuni45/glfw3_app/blob/master/glfw3_app/docs/PMX_spec.txt),
material-morph section, lines 421–465. It defines file fields and morph
arithmetic, **not** a runtime lighting shader.

The original shader evidence inspected is 舞力介入P's `Basic/full.fx` **v2.0**
in [MME sample effects v6](https://bowlroll.net/file/14262), published 2013-02-14.
The full.fx readme preserved with the
[ExcellentShadow derivative](https://mmd.uvlgoh.net/dist/full-20-es-fx) describes
approximately reproducing MMD's standard shader, with improved compatibility in v2.0. This is an author-provided
MME reproduction, not MMD's internal shader source or a native capture.
For reproducibility, the downloaded archive SHA-256 is
`7dbb5ced75799a2c3399d4c83f2cec8483c9c7a0c6c4d216ab476a4102dbf73a`;
the original `Basic/full.fx` bytes (CRLF/Shift-JIS) hash to
`eac5ced1b3133308ba5623d8257bcb19f3330c444cdadfd2ebd888aed23359c2`.
No sample shader or models are redistributed here.

| Subject | Evidence and scope | Previous behavior | Default decision |
| --- | --- | --- | --- |
| Material morph composition | PMX lines 454–460 keep multiply and add separately, then base × multiply + add | Each element edited the evolving value; later multiply scaled additions | Independent product/sum, composed once; see [material morphs](material-morphs.md) |
| Sampler RGBA | PMX lines 464–465 distinguish RGB blending from unchanged sampled alpha; `full.fx` `BufferShadow_PS`, lines 389/397 reconstructs RGB with control-alpha interpolation | One linear RGBA factor, including opacity | Source-space RGB reconstruction, separate multiply/add controls, unchanged sampled alpha |
| Direct diffuse scale | `full.fx` lines 31, 163–168, 351–356 use ordinary color products, without pi. The non-toon path also has N·L. Toon uses MME-provided ambient inputs. Those uniforms are runtime values, not necessarily raw PMX diffuse/ambient | Three Lambert BRDF divided direct diffuse by pi | Remove pi; keep existing toon modulation and raw-material/ambient separation. Exact native raw-parameter mapping remains unresolved |
| Specular | `full.fx` lines 33, 185–187, 379–381 use material × light specular RGB and an unnormalized half-vector power | Schlick Fresnel with white `f90`, normalized distribution and `0.25` | Authored RGB × light × power lobe. Zero RGB gives zero at all angles |
| Power zero | `full.fx` has no positive-power guard. Its power law has constant-one limit at p=0; shader `0^0`/zero half-vector are not portable | Three clamps power to `1e-4` | Explicit constant authored specular at p≤0; positive power uses the power law; opposing light/view gives zero lobe for p>0. Negative power is an extension clamped to the zero-power case |
| Toon and shadows | Explicitly deferred by #96 | Existing Three coordinate/ramp, shadow attenuation, ambient ramp averaging and shadow pass | Unchanged; only sampler RGB reconstruction and removal of control-alpha opacity are shared data-flow edits |

The sample's basic and self-shadow passes also differ: texture morph
reconstruction appears in `BufferShadow_PS`, while `Basic_PS` samples directly
and receives vertex-computed specular. This library uses the PMX sampler rules
and per-fragment specular in its existing common material path, independent of
shadow flags. Reproducing those historical pass differences would change the
deferred shadow policy; this issue does not do that. The sample does not expose
a separate toon morph uniform, so the format's common sampler rule supplies
that part of the implementation.

Secondary implementations were consulted as references, not as native oracles:

- [Saba `mmd.frag`](https://github.com/benikabocha/saba/blob/master/viewer/Saba/Viewer/resource/shader/mmd.frag)
  has ordinary diffuse/light multiplication, unscaled ambient, unnormalized
  specular and a positive-power guard. Its separate sampler helpers differ from
  `full.fx`'s combined interpolation; they were not copied.
- [nanoem `model_color.hlsl`](https://github.com/hkrn/nanoem/blob/main/emapp/resources/shaders/src/core/model_color.hlsl)
  likewise lacks pi/Fresnel specular normalization and disables nonpositive
  power. Its texture blend factors and alpha handling differ from PMX and the
  inspected MME sample; they were not adopted.
- [babylon-mmd's material guide](https://noname0310.github.io/babylon-mmd/docs/reference/loader/mmd-model-loader/mmd-standard-material/)
  documents ambient's `0.5` coefficient and its host material adaptations.
  Its diffuse clamps, ambient/light folding and specular/sphere order do not
  define MMD's shader. The existing `0.5` ambient convention is retained;
  independent confirmation of the native raw-PMX ambient mapping is missing.

## Implemented equation

For one direct light, in Three's linear working space:

```text
B = (D * L * V + 0.5 * A) * T * U * R + I
surface = B                         // no view-based sphere (includes SubTexture)
surface = B * S                     // sphere multiply
surface = B + S * R                 // sphere add
H = normalize(lightDirection + viewDirection)
specular = specularRGB * L * V * (p > 0 ? max(dot(N,H),0)^p : 1)
RGB = surface + specular + user emission
```

`D` is diffuse RGB, `A` dedicated ambient RGB, `L` light color/intensity,
`V` Three's existing shadow attenuation, and `R` the existing toon ramp.
`T`, `U`, `S`, and the sampled `R` use the source-space sampler reconstruction
in [material morphs](material-morphs.md). Missing layers contribute identity.
`I` is Three's existing indirect diffuse (including diffuse/base/SubTexture).
Specular is separate from base, sphere and toon textures. `specularMap` remains
a Three extension. A degenerate zero half-vector gives N·H=0. The explicit
zero-power result avoids GPU-dependent `0^0`; it has not been captured in MMD.

Material colors are converted from source sRGB after morph evaluation.
Texture reconstruction encodes the decoded sample back to source sRGB,
combines the raw PMX controls, then decodes the reconstructed RGB once. Color
products and lighting then use Three's linear space. Output color conversion,
tone mapping and fog belong to the renderer. Alpha is never gamma converted.
This color-management boundary, HDR instead of native saturation, indirect
light/AO and multiple lights remain intentional host extensions. MMD has one
global directional light. No native rendering run was performed here.

Ambient is added once regardless of direct-light count/intensity; with multiple
lights its ramp and sphere-add use the arithmetic mean of the existing ramps.
With no lights the ramp is identity. Three's unlit diffuse fallback remains.
`colorNode` overrides the normal diffuse/map path; ambient still uses the map.
User emission remains independent; existing sphere-multiply/SubTexture emission
modulation is preserved. Clones own independent colors and sampler controls.

## Deferred behavior and validation

The toon coordinate is still `normal dot light * 0.5 + 0.5`, with the same
`fwidth`, fallback smoothstep, rotated loader ramps and sampled UVs. No N·L term
has been added outside that ramp. Direct shadow attenuation still reaches the
same diffuse and specular light input. Ambient fill, ramp accumulation/averaging,
`finish()` surface/specular order and the shadow integration are unchanged.
The source shadow mask only stops multiplying sampler **control** alphas;
actual opacity, base sample alpha, SubTexture sample alpha, alphaMap.g and
alpha-test remain. Sphere modes 1/2 and toon retain their preexisting sampled
alpha policy. Binary depth shadows for partial opacity remain unchanged.

`tests/material-morph-reference.ts` derives fixture values from PMX product/sum
rules; the old arithmetic fails the revised numerical checks.
`tests/mmd-color-reference.ts` independently expresses source sampler blending
and the chosen scalar power law. Browser suites check actual linear-target
pixels and separately canvas sRGB output on mandatory WebGL2 and native WebGPU
when available. They cover texture colors, angles, zero/positive powers,
zero specular, ambient, multiply/add/SubTexture, actual opacity and resets.
These checks establish the documented implementation, not exact MMD fidelity.
See [the validation record](material-morphs.md#issue-96-validation).

Required **post-merge verification is PENDING**: inspect the latest attempts of
merge-triggered Tests and GitHub Pages runs against the actual merge SHA,
record their links/results, confirm that SHA's Pages publication and served
Examples assets, and smoke-test public PMD and Gene Light PMX material/animation
startup. Those checks belong after merge. Optional maintainer comparison with
native MMD is not a pre-merge or completion gate.
