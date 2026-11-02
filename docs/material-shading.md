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
| Direct diffuse scale | `full.fx` lines 31, 163–168, 351–356 use ordinary color products, without pi. The non-toon path also has N·L. Toon uses MME-provided ambient inputs. Those uniforms are runtime values, not necessarily raw PMX diffuse/ambient | Three Lambert BRDF divided direct diffuse by pi | Remove pi; #112 subsequently maps the toon scene-light term to D3DLIGHT9.Ambient, retaining raw-material separation |
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
  define MMD's shader. Issue #96 retained its `0.5` ambient convention. The raw-field audit below
  supersedes that decision for #112; that host coefficient is not native evidence.

## Implemented equation

For one direct light, in Three's linear working space:

```text
E = D * L + A                       // reconstructed standard-toon input
B = (D * L * V + A) * T * U * R + I  // implemented Three shadow adaptation
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
This color-management boundary, HDR instead of native saturation, independent
indirect light/AO and multiple lights remain intentional host extensions. MMD has one
global directional light. No native rendering run was performed here.

Ambient is added once regardless of direct-light count/intensity; with multiple
lights its ramp and sphere-add use the arithmetic mean of the existing ramps.
With no lights the ramp is identity and the lit material emits only its authored
ambient (plus user emission); `lights=false` explicitly retains Three's unlit
diffuse fallback as a consumer override.
`colorNode` overrides the normal diffuse/map path; ambient still uses the map.
User emission remains independent; existing sphere-multiply/SubTexture emission
modulation is preserved. Clones own independent colors and sampler controls.

## Deferred behavior and validation

The toon coordinate is still `normal dot light * 0.5 + 0.5`, with the same
`fwidth`, fallback smoothstep, rotated loader ramps and sampled UVs. No N·L term
has been added outside that ramp. Direct shadow attenuation still reaches the
same diffuse and specular light input. The authored ambient coefficient is now unity, derived from the input mapping
below. Ramp accumulation/averaging, `finish()` surface/specular order and shadow
integration are unchanged.
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


## Issue #112 evidence audit

Target: native **MikuMikuDanceE v9.32 x64**, with MMEffect v0.37 x64
where applicable. Source audit performed 2026-11-02 against MikuDanceStudio
[`fa8914a4dbb69d5cdbb1666105925c817325ae23`](https://github.com/jstzwj/MikuDanceStudio/tree/fa8914a4dbb69d5cdbb1666105925c817325ae23).
Source text was read for this audit. No executable, build script,
dependency or native rendering from that repository was run.

Its [reconstruction record](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/docs/X64_RECONSTRUCTION.md#二进制身份)
identifies the executable SHA-256 as
`07516fd3bf1e6b1339836b6773a156f61bdd6f848eeb621fdda012375df313a1`
and IDA image base `0x7FF7CB420000`. These are **the reconstructor's records**;
we did not independently disassemble or run that executable. Reported native
A/B results in that document are evidence leads, not a pixel-parity certification
for this library. Decompiler names, reconstructed C++ and resource provenance
claims are not original author source.

| Stage | Audited source / address annotation | Meaning and strength |
| --- | --- | --- |
| PMD raw fields | [pmd_load.cpp L281–288](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/model/pmd_load.cpp#L281) | Reads diffuse RGBA, copies it into `diffuseMirror`, then specular RGB, power and ambient RGB; reconstruction implementation, not a shader equation |
| PMX raw fields | [pmx_load.cpp L613–620](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/model/pmx_load.cpp#L613) | Same working-record mapping; material morph pools preserve separate authored channels |
| D3D material | [subrecord_layout.hpp L224–231](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/include/mikudancestudio/subrecord_layout.hpp#L224), [model_renderers.cpp L825](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/render/model_renderers.cpp#L825) | First 68 bytes copied to `D3DMATERIAL9`: Diffuse=D, Ambient=diffuseMirror=D, Specular=K, Emissive=A, Power=p. Layout plus copy is explicit implementation evidence; exact native layout remains the reconstruction's assertion |
| Default light | [runtime_state.cpp L8–19](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/app/runtime_state.cpp#L8), [mmd_app.hpp L397](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/include/mikudancestudio/mmd_app.hpp#L397) | Zero-initialized directional light; Ambient=Specular=0.602, Diffuse=0, direction=(-0.5,-1,0.5). Annotation identifies immediate `0x3F1A1CAC` and x64 RVA `0x745FB..0x7468D`; this audit did not verify machine bytes |
| User light changes | [ui_hscroll.cpp L166–199](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/window/ui_hscroll.cpp#L166), [mmd_app.hpp L392–413](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/include/mikudancestudio/mmd_app.hpp#L392), [timeline_advance.cpp L159](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/app/timeline_advance.cpp#L159) | Slider RGB uses position/256; live RGB aliases SceneLight.Ambient (annotated original app+0x9F070). `ApplyTimelineLightState` synchronizes Ambient, Specular and direction for slider/track updates, leaving Diffuse zero. Implementation evidence; do not substitute 0.602 for user RGB |
| Fixed-function cascade | [model_renderers.cpp L414–583](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/render/model_renderers.cpp#L414) | Annotated sub_4912F0 / x64 sub_7FF7CB4D6D70, with TCI call sites 0x4D70C9, 0x4D7283, 0x4D75E4, 0x4D795C: toon/base MODULATE, sphere MODULATE/ADD or additional-UV SubTexture. Annotations are specific executable evidence leads; the C++ branching is reconstruction |
| Standard effect upload | [model_renderers.cpp L685–750](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/render/model_renderers.cpp#L685) | `EgColor=D*SceneLight.Ambient+A`; `SpcColor=K*SceneLight.Specular`, power zero replaced by 0.1. `MatAmbColor` here is the D3D material Ambient=D, **not raw authored A** |
| Standard effect/shadow | [skin_effect_sm3.fx](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/res/assets/skin_effect_sm3.fx), [frame dispatch L1434](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/render/model_renderers.cpp#L1434) | Toon `BufferShadow*` uses EgColor with base/sphere, then a lit/shadow toon blend, plus separate specular. Non-toon `DiffuseBS*` additionally uses N·L × DifColor. Frame selects fixed vs effect based on effect availability and toonFlag. Source is claimed recovered resource 117/118 by the reconstruction record; that extraction is not independently verified here |
| MME material semantics | [material_bind.cpp L171](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/third_party/mmeffect/src/mmeffect/material_bind.cpp#L171), [L1505](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/third_party/mmeffect/src/mmeffect/material_bind.cpp#L1505) | Geometry Ambient/Emissive select D3D material slices; fallback EgColor folds material Ambient × light Ambient + Emissive. MME uniform names alone cannot identify raw PMX fields |

The independent API contract is Microsoft's
[D3D9 ambient-light equation](https://learn.microsoft.com/en-us/windows/win32/direct3d9/ambient-lighting):
material Ambient multiplies scene/global and per-light Ambient. Material
Emissive is a separate additive lighting input. Given the reconstructed mapping,
this yields **D × scene Ambient + A**, without a half coefficient. The standard
toon effect corroborates that combination rather than adding a second D × light
Diffuse term. Fixed function and programmable/MME passes still differ in
saturation, toon/shadow sampling and specular evaluation; their whole pipelines
must not be equated from that common input mapping. The audited
[InitRenderStates](https://github.com/jstzwj/MikuDanceStudio/blob/fa8914a4dbb69d5cdbb1666105925c817325ae23/src/render/render_states.cpp#L49)
enables light 0, lighting and specular, sets texture/current cascade arguments
and filtering; it does not explicitly enable sRGB sampling/output or set a
second global ambient term. D3D default global ambient is zero; effects can
change state, so arbitrary MME state inheritance is not proven by this audit.

### MME cross-check and source limitations

The original `Basic/full.fx` v2 archive/hash and line references inspected for
#96 remain above. Re-fetching its public BowlRoll download in this audit returned
HTTP 403, so **the original bytes/hash were not reverified here**. We cross-checked
the recorded #96 analysis against the accessible
[full_2.0_ES derivative](https://mmd.uvlgoh.net/dist/full-20-es-fx), archive SHA-256
`53086bfdbd998070dd17d9af4a7d94e698c2357cec896027e7dc4891aedc883e`.
It declares Geometry Diffuse/Ambient/Emissive and Light Diffuse/Ambient/Specular,
then builds `AmbientColor = MaterialAmbient * LightAmbient + MaterialEmmisive`
(lines 74–87), uses it alone for toon and adds N·L × DiffuseColor only without
toon (Basic_VS lines 216–222; BufferShadow_VS lines 418–424). This is corroborating
**derivative** evidence, not a replacement claim about original file identity.
Combining those semantic inputs with the reconstructed host mapping gives E;
reading `AmbientColor` as raw PMX A would be incorrect. MME retrieval also
depends on draw type: `MmeComposeMaterialColor` uses live GetMaterial for
fixed/shadow draws, zeroed edge material for outlines, and exported material
records for other draws. Standard effect frames may leave a stale device
material because that path does not call SetMaterial (annotated x64
sub_7FF7CB4D87C0 in model_renderers.cpp L902–912). Snapshot parameters and
semantic Geometry queries therefore must not be assumed interchangeable in
all passes. The default here follows the supported standard-toon input mapping,
not arbitrary effect-host state quirks.

The #96 original sample analysis establishes texture RGB morph interpolation
and separate specular order, but not native raw ambient scaling on its own.
Base texture multiplies E once; sphere multiply scales surface, sphere add adds
before toon; SubTexture is an additional RGBA layer. Specular follows surface,
without base/toon/sphere tint. Standard reconstructed shadow passes blend lit
surface with its toon-colored shadow and attenuate specular. The existing TSL
path instead attenuates the directional D×L/specular input with Three shadows
while leaving A under the ramp. No new shadow algorithm or toon UV fallback is
claimed or introduced by #112. Existing PR #97 power-zero semantics are retained
explicitly, despite the reconstruction's host-side 0.1 substitution.

### Default decision and host extensions

The strongest supported common input equation is `E = D*Ls + A` for one toon
scene directional light, `Ls = D3DLIGHT9.Ambient`, with `K*Lspec` for specular.
In this material Three's directional color/intensity supplies Ls and Lspec.
The native reset value 0.602 is **scene state**, never a material multiplier.
No light is created implicitly, no model-specific coefficient is used, and no
Example light is changed. One directional light with no independent ambient
light is the MMD compatibility setup. Consumers choose their scene light color;
this library does not silently replace it with native reset state.

Three AmbientLight/HemisphereLight/light maps/AO retain their indirect path I:
for AmbientLight, `I = D*T*U*ambientIrradiance/pi` (then AO), outside the toon
ramp but before view-sphere composition. An AmbientLight added to reproduce the
**same** native scene light would duplicate D×scene illumination; it is only an
intentional *additional* host fill. There is no hidden native AmbientLight or
implicit 0.602 term. The old `0.5*A + I` did not by itself double-count raw A
(I multiplies D); it underweighted A and left the scene-light interpretation
ambiguous. Adding a second native scene Ambient through I would double-count
scene illumination, both before and after this fix.

Multiple Three lights sum D×L×R while A uses the mean ramp once. No directional
light means A with identity ramp; zero-intensity directional light leaves A
under that light's ramp. Independent user emission remains separate, with the
existing SubTexture/sphere-multiply modulation. No loader or morph color is
rescaled: PMD/PMX raw metadata, linear converted values, sampler controls and
consumer emission retain their previous meaning. Root and material subpath
exports still expose the same class.

Source material/morph controls are interpreted as sRGB, converted after morph
composition; decoded texture samples are re-encoded only for source RGB morph
arithmetic and decoded once afterward. Lighting products occur in Three linear
space, then renderer tone mapping/output transfer occurs. Native D3D9 resource
sampling/saturation and display transfer are not independently matched. In
particular, `decode(D*Ls+A)` and `decode(D)*decode(Ls)+decode(A)` differ. We keep
the established Three color-management boundary and unclamped HDR, not a claim
of native shader arithmetic or native pixel equivalence. There are no native
captures from this audit; fixed-function state inheritance, arbitrary MME
effects and precise self-shadow/ramp behavior remain outside verified parity.

### Regression fixtures and controlled real-model diagnostics

`tests/mmd-lighting-fixtures.ts` contains hand-calculated numeric D3D9 input
term examples, including E=(0.3,0.45,0.25), A/D/Ls zero and changed-light cases,
and an HDR case. They are derived from the mapping above, not copied from TSL
constants. CPU tests exercise those literal outputs, texture/specular separation,
no-directional and additional indirect terms. GPU tests read a float linear
render target for the same fixtures (including >1), plus UNORM texture, toon,
sphere and alpha cases, independent emission and representative morph updates.
These are equation regressions; they cannot establish native pixel parity.

Run the actual old material and new material in identical current scenes:

```sh
npm run build
npm run examples:assets
node --import tsx scripts/measure-example-lighting.ts --material-ref=7b604fb1d76b26a2c46bced0cbeab2b8b5781c40 --output=docs/issue-112-lighting-before.json
node --import tsx scripts/measure-example-lighting.ts --output=docs/issue-112-lighting-after.json
```

The script reads only the named revision's material source via `git show`,
transpiles it and serves that module; it does not check out or run old scripts.
Reports retain pinned real Gene Light PMX and Miku PMD provenance, raw/loaded
material comparisons, cameras, light settings, zero morphs/rest pose, isolated
terms, linear float HDR peaks/counts and final canvas sRGB clipping. The
historical #102 report is preserved. This is a controlled regression diagnostic,
not a PMX-format defect diagnosis or subjective/native appearance comparison.

The saved [before](issue-112-lighting-before.json) and
[after](issue-112-lighting-after.json) reports use 256×256 WebGL2/SwiftShader
readbacks. `current` is the inherited diagnostic case name for the **common**
AmbientLight 0xAAAAAA / directional 0xffffff, intensity 1/1 setup, not Gene's
current demo preset. `gray` uses 0x888888 for both lights, unchanged between runs.
The old report label `sceneAmbientOnly` isolates the **additional Three indirect**
term; `directionalDiffuseOnly` isolates D×Ls, the mapped native scene-ambient
term. These historical labels do not redefine the native D3D channel mapping.

| Model / identical settings | Linear mean RGB before → after | HDR peak before → after | Pixels with any linear channel >1 before → after | Display pixels with a channel >254 before → after |
| --- | --- | --- | --- | --- |
| Gene PMX / common lights | (0.642244,0.647288,0.640628) → (0.763888,0.769887,0.761965) | 1.391557 → 1.655160 | 44.670051% → 51.287836% | 43.974431% → 51.062230% |
| Miku PMD / common lights | (0.095365,0.292629,0.286747) → (0.107628,0.331484,0.324547) | 0.807065 → 0.914085 | 0% → 0% | 0% → 0% |
| Gene PMX / gray lights | (0.271447,0.273579,0.270764) → (0.393091,0.396178,0.392101) | 0.588173 → 0.851776 | 0% → 0% | 0% → 0% |
| Miku PMD / gray lights | (0.035997,0.112332,0.109884) → (0.048260,0.151187,0.147684) | 0.307671 → 0.414692 | 0% → 0% | 0% → 0% |

The opaque model masks have 5,319 Gene / 10,303 Miku pixels. Authored-ambient-only
peaks change 0.263604→0.527207 (Gene), 0.107021→0.214041 (Miku); isolated
directional scene-light, additional indirect and specular measurements are
unchanged. After-run isolated-term sum error is at most 1.20e-7 (Gene) / 5.97e-8
(Miku); repeated frame error is zero for both. Raw/loaded parameter checks pass
for all materials. The increased HDR/clipping is an explicit consequence, not
evidence of improved native resemblance or a PMX defect.

### Issue #112 validation (2026-11-02)

macOS arm64, Three 0.186.1, headless Chrome 156.0.8078.74; WebGL2 uses
SwiftShader and the shader suites also exercised the native WebGPU backend.

| Executed check | Result |
| --- | --- |
| `npm run typecheck` | PASS, library/Examples/tools and TypeScript source checks |
| `npm test` | PASS, 1,204 tests, 0 skipped; 5.19 s test phase (build is a lifecycle prerequisite) |
| `npm run test:browser` | PASS, 55 tests, 0 skipped, 632.24 s; includes Examples and real Gene, packaged consumers, material/morph/alpha/shadow, SDEF/UV and both Bullet Worker variants |
| `npm run build` | PASS, JavaScript, declarations, Worker and runtime artifacts |
| `npm run build:examples` | PASS with the pinned public MMD/Gene assets; no synthetic-only asset flag |
| Examples browser coverage | PASS within `test:browser`: PMD animation/audio/pose/Worker on WebGL2 and native WebGPU, real Gene PMX on both renderers and both Bullet variants. The separate `test:examples` command was not redundantly rerun |
| Before/after commands above | PASS for both pinned real models; actual old material source, not a screenshot or inferred counterfactual |
| Report cross-check | PASS: model provenance, raw/loaded material values, camera pose/projection, model matrix, light configuration, output settings and masks match; unaffected isolated terms are equal; material-source/script hashes match the executed sources |
| `git diff --check` | PASS |

The expanded ambient suite checks 144 numerical combinations plus user emission
per backend; native-material tests check 272 angle/sampler combinations plus
six independent float-target term/HDR fixtures and the no-directional case per
backend. The material-morph suite checks 330 surface RGBA cases per backend,
nonfinite/reset controls, outlines and shadow masks. New fixtures detect the
old half-ambient term, a second directional diffuse contribution, missing
ambient with no light, or a lost/duplicated indirect extension. The existing
full suite supplies the surrounding UV, alpha, surface/outline, worker and
physics regression checks.

An initial targeted ambient browser run timed out at 110 s during concurrent
validation; its companion material-morph and native-material suites passed.
The expanded suite's browser deadline was raised to 230 s (test deadline 240 s);
the final full-suite ambient run completed in 46.92 s on both backends. No
full-suite failures or capability skips occurred. `npm run test:legacy` was not
separately run: physics code is unchanged and the browser regression suite
already exercised both runtime variants. No untrusted native execution or
subjective human appearance check was performed or required.
Post-merge **Tests**, **Deploy browser examples**, exact merge-SHA Pages serving,
and live PMD Miku/Gene PMX/Worker startup verification remain **PENDING**; this
worktree commit cannot provide merge or public deployment evidence. No npm
release/version changes or publication are included.
