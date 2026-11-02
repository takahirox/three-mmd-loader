# MMD material color and scene light

The default targets MikuMikuDance standard materials. It removes Three's
Lambert `1 / pi` and normalized/Fresnel specular terms. This is a compatibility
implementation with the limitations below, not a claim of exact native pixels.

## Native-derived ambient evidence (Issue #113)

The ambient correction uses a **slot-level derivation**, not a replacement
brightness constant. All MikuDanceStudio links below are pinned to source
commit `fa8914a4dbb69d5cdbb1666105925c817325ae23`, inspected as text only.
No executable, build product or native MMD process was downloaded or run.
Its [evidence standard](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/docs/X64_RECONSTRUCTION.md#如何判定一致)
targets MikuMikuDanceE v9.32 x64 and MMEffect v0.37 and distinguishes static
transcription, independent tests and original-binary A/B observations. These
are **reports from an independent reconstruction**, not the proprietary source
or our own inspection/capture of the binary. They are stronger evidence than
an unrelated renderer's visual convention, but remain fallible.

| Producer / consumer | Verifiable mapping |
| --- | --- |
| [PMX loading, lines 616–620](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/model/pmx_load.cpp#L616) and [PMD loading, lines 284–288](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/model/pmd_load.cpp#L284) | Read diffuse, mirror diffuse, and read authored ambient separately, with no half coefficient. |
| [Material layout, lines 224–231](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/include/mikudancestudio/subrecord_layout.hpp#L224) | Byte 0 diffuse RGBA, byte 16 mirrored diffuse RGBA, byte 32 specular RGB/padding, byte 48 authored ambient RGB/padding, byte 64 power. In the actual [D3DMATERIAL9 layout](https://learn.microsoft.com/en-us/windows/win32/direct3d9/d3dmaterial9), these slots are **Diffuse, Ambient, Specular, Emissive, Power**. Authored ambient occupies Emissive, not Ambient. |
| [Fixed-function draw, lines 826–885](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/render/model_renderers.cpp#L826) | Copy the record's first `sizeof(D3DMATERIAL9)` bytes, then call `SetMaterial` before actual draws. This is evidence of consumed slots, not merely suggestive field names. |
| [Light reset, lines 8–19](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/app/runtime_state.cpp#L8) | Zero the light, select directional, set Ambient and Specular RGB to 0.602. **Diffuse stays zero**. The comment identifies the original immediate `0x3F1A1CAC`. This number is a scene default, never a material multiplier. |
| [Live color and timeline update, lines 391–413](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/include/mikudancestudio/mmd_app.hpp#L391), [key application / interpolation](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/app/timeline_advance.cpp#L154) | LightColor aliases SceneLight.Ambient; updates mirror it to Specular, retain zero Diffuse, and submit `SetLight(0, ...)` (also lines 441–447). Thus the native light's ambient is the directional key light's color, not a second independent global fill. |
| [Texture states, lines 65–69](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/render/render_states.cpp#L65), [material stages, lines 443–561](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/render/model_renderers.cpp#L443) | Stage 0 modulates primary lit color with toon; following stages modulate base, then multiply/add sphere or SubTexture. Authored emission is part of primary color and is therefore textured/toon-modulated. |
| [Separate effect setup, lines 688–703](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/render/model_renderers.cpp#L688) | EgColor is mirrored diffuse × SceneLight.Ambient + authored ambient. MatAmbColor receives mirrored diffuse; MatEmsColor receives authored ambient. This does not alone prove a final-pixel equation. |
| [MME semantic producer, lines 125–189](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/third_party/mmeffect/src/mmeffect/material_bind.cpp#L125), [named uniform producer, lines 1499–1551](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/third_party/mmeffect/src/mmeffect/material_bind.cpp#L1499) | Material AMBIENT resolves the D3D Ambient slot (authored diffuse), EMISSIVE resolves authored ambient. Named EgColor can come from an effect snapshot or live GetMaterial/GetLight synthesis; model EgColor is light ambient × material diffuse + material emissive. DifColor uses **light Diffuse**, normally zero. |

The non-device MME material branch calls the host export;
[ExpGetPmdMaterial lines 185–199](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/exports/effect_api.cpp#L185)
copies exactly 0x44 bytes from the same material record. Thus both the export
and fixed-function consumers resolve the observed slot layout, rather than a
hypothesized mapping inferred from uniform names.

The fixed-function and MME paths must remain distinct: the reconstruction
[explicitly reports no SetMaterial in the effect-frame loop](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/render/model_renderers.cpp#L902).
The live MME branch may read a material retained from an earlier fixed-function
frame. It is not proof that every effect uniform always contains the current
raw PMX value. Accessories, outlines, non-toon and self-shadow paths also differ.

Microsoft's [ambient equation](https://learn.microsoft.com/en-us/windows/win32/direct3d9/ambient-lighting)
is material Ambient × (global ambient + per-light ambient).
Its [emissive equation](https://learn.microsoft.com/en-us/windows/win32/direct3d9/emissive-lighting)
is simply material Emissive, independent of light intensity. Its
[diffuse equation and saturation](https://learn.microsoft.com/en-us/windows/win32/direct3d9/diffuse-lighting)
use material Diffuse × light Diffuse × N·L, then clamp the combined primary
ambient/diffuse/emissive signal before texturing. There is no Lambert 1/pi.
Substituting the observed slots and the default zero light Diffuse gives this
**native-derived fixed-function candidate**, for one directional key light:

```text
primary = saturate(D_source * L_nativeAmbient + A_source)  // global ambient = 0
surface = primary * R_source * T_source * U_source
```

An additional D3D global ambient, if supplied, contributes `D_source * G`
inside primary, exactly once. The inspected light reset does not establish a
nonzero global ambient. This derivation establishes material/light roles and
stage order, not the whole native image: exact texture decoding, native sRGB
states, interpolation, shadows, specular and saturation across all passes have
not been validated here. The candidate's numeric source signals must not be
silently equated with linear Three colors.

## MME cross-check and earlier direct-light decisions (Issue #96)

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
| Direct diffuse scale | `full.fx` lines 31, 163–168, 351–356 use ordinary color products, without pi. The non-toon path also has N·L. Toon uses MME-provided ambient inputs. Those uniforms are runtime values, not necessarily raw PMX diffuse/ambient | Three Lambert BRDF divided direct diffuse by pi | Remove pi; #113 additionally resolves material Ambient/Emissive slot roles and scene ambient composition, subject to the working-space assumptions below |
| Specular | `full.fx` lines 33, 185–187, 379–381 use material × light specular RGB and an unnormalized half-vector power | Schlick Fresnel with white `f90`, normalized distribution and `0.25` | Authored RGB × light × power lobe. Zero RGB gives zero at all angles |
| Power zero | `full.fx` has no positive-power guard. Its power law has constant-one limit at p=0; shader `0^0`/zero half-vector are not portable | Three clamps power to `1e-4` | Explicit constant authored specular at p≤0; positive power uses the power law; opposing light/view gives zero lobe for p>0. Negative power is an extension clamped to the zero-power case |
| Toon and shadows | Coordinate/shadow algorithms deferred by #96 and #113 | Existing Three coordinate/ramp, shadow attenuation, ambient ramp averaging and shadow pass | Coordinate/shadow algorithms unchanged; #113 moves scene ambient under the existing ramp. Sampler RGB/alpha rules from #96 remain unchanged |

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
  Its host adaptations do not define MMD's shader. The old `0.5` convention
  is superseded by the slot-level derivation above; it has no support in the
  inspected native-derived material producers or D3D9 equations.

The previously inspected original `Basic/full.fx` v2 has
`AmbientColor = MaterialAmbient * LightAmbient + MaterialEmmisive` (line 32),
sets vertex primary color from that for toon, and adds diffuse N·L only for
non-toon. The MME producers above resolve the otherwise misleading names:
MaterialAmbient is **authored diffuse**, MaterialEmmisive is **authored ambient**.
This explains why reading the shader's AmbientColor as raw PMX ambient was
insufficient. It agrees with the native-derived slot equation, not A × 0.5.
For an additional source-only cross-check, the linked ExcellentShadow derivative
was inspected in its three-text-file archive: `full_2.0_ES.fx` lines 73–86
preserve those semantics/products, lines 217–222 and 419–424 saturate primary,
and lines 469–487 texture both lit and shadow colors. Those are derivative line
numbers, not the original full.fx line numbers; its changed shadows are not
an oracle for native shadows. The original archive/hash provenance above is
retained, and no redistributed shader is included in this repository.

## Implemented Three.js compatibility equation

#112 / PR #114 already removed the unsupported half coefficient and clarified
the directional light mapping. #113 retains that correction, removes Three
Phong's Lambert 1/pi from indirect diffuse, and puts scene
ambient under the same toon stage as authored ambient and diffuse. This is a
scoped **linear/HDR adaptation** of the native-derived composition, not an
implementation of all native D3D9 quantization and saturation. For one direct
light, in Three's linear working space:

```text
B = (D * L * V + D * E * AO + A) * T * U * R
surface = B                         // no view-based sphere (includes SubTexture)
surface = B * S                     // sphere multiply
surface = B + S * R                 // sphere add
H = normalize(lightDirection + viewDirection)
specular = specularRGB * L * V * (p > 0 ? max(dot(N,H),0)^p : 1)
RGB = surface + specular + user emission
```

`D` is authored diffuse RGB, `A` authored ambient RGB, and `L` is the
directional light color/intensity mapped to native scene-light Ambient/Specular,
`V` Three's existing shadow attenuation, and `R` the existing toon ramp.
`E` is Three's accumulated indirect irradiance (AmbientLight color × intensity,
HemisphereLight, light maps/probes where supplied); `AO` is Three's existing
ambient occlusion applied only to that indirect contribution. This material
uses ordinary color multiplication for E, not Lambert E/pi. These optional
host lights are additional illumination, not an automatically supplied second
copy of the native scene color. For the supported standard-MMD case use **one
DirectionalLight** to supply the native Ambient/Specular RGB and direction,
with no AmbientLight added merely to represent that same light. The native
0.602 default is not injected by the library; Examples light colors remain
unchanged. A Three AmbientLight intentionally supplied by an application is an
extra global ambient term D×E. With both supplied, both contribute, by choice.

`T`, `U`, `S`, and the sampled `R` use the source-space sampler reconstruction
in [material morphs](material-morphs.md). Missing layers contribute identity.
The fixed-function stage ordering above would add a sphere texel after toon,
whereas this existing MME-like sphere-add policy uses `S * R`. That preexisting
pass difference is retained for this ambient-only change; neither sphere/shadow
path is claimed to have native pixel parity. Multiply/SubTexture products commute
with toon in this unclamped linear adapter. Specular is separate from base,
sphere and toon textures. `specularMap` remains
a Three extension. A degenerate zero half-vector gives N·H=0. The explicit
zero-power result avoids GPU-dependent `0^0`; it has not been captured in MMD.

Material colors are converted from source sRGB after morph evaluation.
Texture reconstruction encodes the decoded sample back to source sRGB,
combines the raw PMX controls, then decodes the reconstructed RGB once. Color
products and lighting then use Three's linear space. Output color conversion,
tone mapping and fog belong to the renderer. Alpha is never gamma converted.
Source PMD/PMX RGB is decoded independently before these products; this does
**not** reproduce source-signal addition followed by decode. In particular,
`decode(D_source * L_source + A_source)` generally differs from the implemented
`decode(D_source) * decode(L_source) + decode(A_source)`. Native sRGB/working
space remains unverified. Retaining this public Three color boundary avoids
silently changing loader/morph semantics. HDR instead of native pretexture
saturation, indirect light/AO and multiple lights remain intentional host
extensions. A white texture with D=L=A=1 can therefore yield linear RGB 2;
the native-derived saturated primary candidate yields 1. This known difference
is not concealed by the tests or presented as native parity. MMD has one
global directional light. No native rendering run was performed here.

Ambient is added once regardless of direct-light count/intensity; with multiple
lights its ramp and sphere-add use the arithmetic mean of the existing ramps.
With no direct lights the ramp is identity. With no scene lights and
`lights=true`, only authored ambient survives; Three's default outgoing light
is zero. `lights=false` retains the explicit unlit diffuse extension.
`colorNode` overrides the normal diffuse/map path; ambient still uses the map.
User emission remains independent; existing sphere-multiply/SubTexture emission
modulation is preserved. Clones own independent colors and sampler controls.

## Deferred behavior and validation

The toon coordinate is still `normal dot light * 0.5 + 0.5`, with the same
`fwidth`, fallback smoothstep, rotated loader ramps and sampled UVs. No N·L term
has been added outside that ramp. Direct shadow attenuation still reaches the
same diffuse and specular light input. Ramp accumulation/averaging, sphere/specular order and shadow integration
are unchanged. Scene ambient now joins authored ambient under the existing ramp.
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

## Gene Light demo investigation (Issue #102)

The [pinned-model and rendered contribution report](gene-light-overbrightness-investigation.md)
compares all 13 shipped Gene materials with Miku PMD, isolates scene ambient,
authored ambient, direct diffuse/specular and texture/toon effects, and separates
linear HDR values from canvas sRGB clipping. Gene's two demo lights now use
`0x888888` at intensity 1; Miku retains `0xAAAAAA`/`0xffffff` at 1/1. This trial
changes no library material, loader or renderer code. Native MMD parity remains
unverified; publication and maintainer visual follow-up remain pending.


## #113 audit and validation

At #113 filing, the equation was `(D*L*V + 0.5*A)*T*U*R + (D*E/pi)*T*U*AO`.
`MMDLoader.MaterialBuilder` already shares PMD and PMX color ingestion:
diffuse → `color` (with a historical `diffuse` alias), authored ambient →
`ambient`, specular → `specular`, power unchanged, diffuse alpha → opacity.
These Color values are decoded with `SRGBColorSpace`; all loader color textures,
including rotated toon maps, are tagged sRGB. There is no ambient-to-user-emissive
folding. PMX immutable material bases retain raw source arrays. The material morph
controller evaluates base × independent multiply products + independent add sums
(including direct and group weights) in source space, then decodes colors once
per update. Its ambient write still reaches the material's dynamic `ambient`
reference; no cached combined-light color is introduced.

Three r186.1 AmbientLightNode adds color × intensity to irradiance;
PhongLightingModel normally applies `BRDF_Lambert = diffuse/pi` and AO there.
The MMD override now removes that normalization and moves indirect diffuse
under the ramp in `finish()`. Direct callbacks already use ordinary diffuse
products, toon and shadowed light color; they are unchanged. Multiple direct
lights still sum their individually ramped diffuse/specular contributions;
ambient (authored and indirect) uses their arithmetic mean ramp and is added
once regardless of count/intensity. A zero-intensity light still supplies a
ramp, as before. The no-light path supplies authored ambient with identity ramp.
This multiple-light policy is a documented Three extension, not native MMD.

Base and SubTexture still modulate both diffuse and authored ambient; sphere
multiply/add stays before separate specular; toon and sampler morph controls
retain their source-space reconstruction and unchanged sampled alpha. User
emission, custom nodes, transparency, alpha test/shadow mask, outline metadata,
clone ownership and morph reset are unchanged. With a custom `colorNode`, Three's
indirect/direct diffuse use that override; authored ambient still uses the map.
The change contains no Examples light edits, toon UV/ramp selection edits,
shadow algorithm edits, physics or IK changes.

`tests/native-light-reference.ts` is a separate scalar D3D9 material-slot and
fixed-function-lighting/texture-cascade oracle. Hand-calculated dyadic fixtures
in `tests/native-material.test.ts` check its output, and compare the library's
linear adaptation below saturation. The browser ambient suite uses that oracle
independently of `referenceMMDColor`: PMD and PMX loader paths, isolated/combined
scene and authored ambient, zero/nonzero light colors, black/white/color textures,
white/color toon and removed lights. Its other matrix covers direct/multiple/
indirect lights, multiply/add/SubTexture, specular and emission in Float32
Linear-sRGB targets before output conversion. Existing PMX browser tests cover
ambient morph multiply/add/group/seek/reset, opacity, outlines and shadows;
separate direct-light tests verify sRGB output conversion. These are objective
numerical checks, not native captured pixels or subjective visual judgments.

See [the #113 validation and controlled model report](material-ambient-validation.md)
for actual command results, before/after measurements and remaining limitations.
Required merge-SHA Actions/Pages and deployed Examples verification remains
**PENDING until performed after merge**. Optional native visual comparison has
not been performed and is not an approval gate.

## Reconciliation with #112 / PR #114

The [#112 evidence audit and original validation](https://github.com/takahirox/three-mmd-loader/blob/a2a6fd1a0cf94fa774e0caa2277c1d6e3cbbc6ca/docs/material-shading.md#issue-112-evidence-audit)
remain available at the merged main commit. Its saved
[before](issue-112-lighting-before.json) and [after](issue-112-lighting-after.json)
measurements are historical: that implementation retained indirect irradiance/pi
outside the toon ramp. The #113 equation above supersedes that indirect policy;
[the #113 report](material-ambient-validation.md) describes the resulting
measurements and limitations. Neither set of archived reports is relabeled as a
measurement of this merge resolution.

Both suites are retained: #112's literal term/HDR fixtures and no-light checks,
and #113's independent D3D9 slot/stage oracle, PMD/PMX ingestion and combined
indirect/toon cases. Zero-intensity and multiple-light cases share the corrected
reference equation. The measurement script uses #114's per-request served-module
override, with both CLI flags and #113's environment variables supported; it no
longer temporarily rewrites the built module. Example light settings are unchanged.
