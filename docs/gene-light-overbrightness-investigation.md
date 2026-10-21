# Gene Light gray-light trial and overbrightness — Issue #102

Only `examples/scene.ts`'s two light colors change at runtime: explicit
`mode === 'gene'` selects ambient **0x888888** and directional **0x888888**,
intensity **1** each. All four Miku PMD pages (including Worker Physics) keep
ambient **0xAAAAAA** and directional **0xffffff**, intensity **1** each.
The directional light remains at (-1, 2, 1), targeting (0, 0, 0). Camera,
animation, physics, library material/loader, toon/shadows and color management
are unchanged. This is a demo trial, with no claim of subjective improvement
or native MMD equivalence.

## Reproduce the evidence

```sh
npm ci
npm run build
npm run examples:assets
node --import tsx scripts/inspect-gene-light.ts > examples/gene-light-inspection.json
node --import tsx scripts/measure-example-lighting.ts
npm run examples:capture -- --gene
```

Chrome is required (`CHROME_BIN` overrides its path). Do not rebuild concurrently
with browser checks: the package build replaces the served compiled modules.
The measurement script writes [raw numeric evidence](gene-light-lighting-measurements.json),
including every source material, loaded linear parameters, texture/toon ranges,
per-case linear and display histograms, repeat/isolation errors and browser
identity. It verifies the existing public Gene allowlist hashes and Miku model
Git blob; the capture workflow additionally verifies every Miku asset. No
private model, synthetic material values or native-MMD reference render is used.

Gene source: `mmdagent-ex/gene` commit
`c7eace43dffaccff6ad0597433ef85fa57c91e03`; exact PMX SHA-256 is in the
[inspection record](../examples/gene-light-inspection.json).
Miku source: Three.js r171 commit
`2898f5b1ba10b1e94174c0a62d072f5f7b80442c`, `miku/miku_v2.pmd`.
Both are parsed using released `mmd-parser 1.1.4`. Values below are source-space
RGB, rounded only for readability; JSON preserves parsed float precision.

## Actual authored parameters

All **13** Gene materials have specular **(0,0,0)** and power **5**. All have
`toonFlag=0`, `toonIndex=-1`, resolved by the unchanged loader to built-in
**toon00.bmp**. Every sphere index is **-1**, so no sphere map is loaded;
material 12 has sphere mode 1 but no sphere reference. Every row has a base map:

| Index / material | Diffuse RGB / alpha | Ambient RGB | Base map under `light/` |
| --- | --- | --- | --- |
| 0 髪 | (1,1,1) / 1 | (0.752941,0.752941,0.752941) | hair2.png |
| 1 手肌 | (1,1,1) / 1 | same | arm.png |
| 2 アンダー | (1,1,1) / 1 | same | bottoms.png |
| 3 顔 | (1,1,1) / 1 | same | face.png |
| 4 目 | (1,1,1) / 1 | same | eye.png |
| 5 星目 | (1,1,1) / 1 | same | extra.png |
| 6 ぐるぐる目 | (1,1,1) / 1 | same | eye2.png |
| 7 トップス | (1,1,1) / 1 | same | top.png |
| 8 頬薄赤 | (1,1,1) / 1 | (0.753,0.753,0.753) | extra.png |
| 9 青ざめ | (1,1,1) / **0** | (0.752941,0.752941,0.752941) | pale.png |
| 10 頬斜線 | (1,1,1) / 1 | same as 9 | extra.png |
| 11 頬照り | (1,1,1) / 1 | same as 9 | extra.png |
| 12 イライラ | (0.333333,0.505882,0.580392) / **0** | same as diffuse | iraira.png |

The three material morphs (`青ざめ`, `どんより`, `いらいら`) all default
to weight **0** in the demo (`demoDefaultWeight` describes the Examples, not
a weight stored in the PMX file). They add **alpha +1** to material 9, 9 and 12
respectively; diffuse RGB, ambient, specular, power and sampler additions are
zero. They do not add a default specular lobe. The generated animation has only
bone tracks; all morph influences are explicitly zero for the measurements.
Group/UV controls are also initially zero; source group links and full material
morph elements are recorded in the inspection JSON. Texture alpha hides some
expression overlays even where authored material alpha is 1.

Miku has **17** PMD materials. Representative records (all alpha 1):

| Index / representative region | Diffuse RGB | Ambient RGB | Specular RGB / power | Maps / toon |
| --- | --- | --- | --- | --- |
| 0 turquoise | (0.133,0.616,0.710) | (0.0665,0.308,0.355) | (0,0,0) / 5 | no base/sphere; toon01 |
| 1 teal | (0,0.568,0.568) | (0,0.355,0.355) | (0.25,0.25,0.25) / 10 | no base/sphere; toon03 |
| 2 warm beige | (0.800,0.712,0.624) | (0.500,0.445,0.390) | (0.15,0.15,0.15) / 6 | no base/sphere; toon02 |
| 3 dark gray | (0.160,0.160,0.160) | (0.100,0.100,0.100) | (0.40,0.40,0.40) / 15 | no base/sphere; toon03 |
| 6 eye | (0.654,0.654,0.654) | (0.400,0.400,0.400) | (0,0,0) / 5 | eyeM2.bmp; toon01 |
| 15 white | (0.800,0.800,0.800) | (0.500,0.500,0.500) | (0.18,0.18,0.18) / 5 | no base/sphere; toon01 |

These region labels describe colors/typical use, not names stored in PMD.
Only Miku record 6 has a base texture; none has a sphere reference. Miku's PMD
morphs are vertex morphs, not material morphs. Thus the models differ substantially
in authored base/ambient levels and texture/toon controls despite sharing a shader.

## Controlled rendered measurements

The diagnostic loads the actual example pages with WebGL2 / Chrome SwiftShader,
stops animation and physics, resets to the skeleton rest pose and zero morphs,
and retains the example camera (0,12,35), looking at (0,10,0), at 256×256.
It hides the grid/debug helpers and renders the mesh against transparent black
without outlines. This makes model-only measurements reproducible; the gallery
thumbnail separately uses the normal two-second animated/physics scene with
outlines at 400×250.

Each case is read from a **Float32 RGBA, Linear-sRGB render target** before
output conversion, then from the actual **sRGB8 canvas** with NoToneMapping.
The mask is fixed from current-light pixels with alpha >0.99; background and
partial-alpha silhouette pixels are excluded. Canvas rows are flipped to match
WebGL readback. Linear histograms use boundaries 0.1, 0.25, 0.5, 1 and 2;
display histograms use 32, 64, 128, 192 and 255. Clipping counts mean at least
one channel >1 linear or at 255 display. Means are unweighted RGB over mask pixels.

Intensity-zero lights remain present so the directional toon ramp and lit shader
path stay fixed. This avoids confusing Three's no-lights diffuse fallback with
material ambient. Isolation sets unwanted diffuse, authored ambient or specular
RGB to zero while retaining texture alpha, geometry and original power. A neutral
base-texture control replaces RGB with white through sampler controls while
preserving sampled alpha. A neutral toon control supplies a white ramp.
Each changed setting waits for the iframe's next animation frame so Three's
frame-cached light uniforms refresh before readback. The script checks
source-to-loaded RGB conversion, power and alpha, repeats the
current render, and checks that the four isolated terms sum to the full current
render within float precision. These are checks of this implementation, not an
independent MMD visual oracle.

Chrome 155 on macOS; the Gene mask has 5,319 pixels, Miku 10,303. The same
mask is used in every case for a model (different silhouettes are not a
pixel-correspondence comparison). “Current” means #100's ambient AAA / white;
“gray” means 888 / 888, including the hypothetical Miku gray control.

| Model / light colors | Mean linear RGB | Peak linear channel | Pixels >1 linear | Pixels at 255 canvas |
| --- | --- | --- | --- | --- |
| Gene / white, white | (0.7301,0.7358,0.7283) | 1.581913 | 50.14% | 49.61% |
| Gene / AAA, white | (0.6422,0.6473,0.6406) | 1.391557 | 44.67% | 43.97% |
| Gene / 888, 888 | (0.2714,0.2736,0.2708) | 0.588173 | 0% | 0% |
| Miku / white, white | (0.1087,0.3373,0.3306) | 0.922007 | 0% | 0% |
| Miku / AAA, white | (0.0954,0.2926,0.2867) | 0.807065 | 0% | 0% |
| Miku / 888, 888 | (0.0360,0.1123,0.1099) | 0.307671 | 0% | 0% |

Isolations use current light colors, with unwanted intensities/terms zeroed:

| Enabled term / control | Gene mean RGB / peak | Miku mean RGB / peak |
| --- | --- | --- |
| Scene ambient only | (0.0591,0.0595,0.0589) / 0.127953 | (0.0089,0.0300,0.0295) / 0.077262 |
| Authored material ambient only | (0.1216,0.1226,0.1213) / 0.263604 | (0.0123,0.0389,0.0378) / 0.107021 |
| Directional diffuse only | (0.4615,0.4652,0.4604) / 1.000000 | (0.0671,0.2166,0.2124) / 0.603827 |
| Direct specular only, authored powers | (0,0,0) / 0 | (0.0071,0.0071,0.0071) / 0.132813 |
| Direct specular only, force power 0 | (0,0,0) / 0 | (0.0633,0.0633,0.0633) / 0.132868 |
| Both scene light intensities 0 | (0.1216,0.1226,0.1213) / 0.263604 | (0.0123,0.0389,0.0378) / 0.107021 |
| Directional intensity 0, material + scene ambient retained | (0.1807,0.1821,0.1802) / 0.391557 | (0.0212,0.0689,0.0673) / 0.184282 |
| Ambient scene intensity 0, directional + authored ambient retained | (0.5832,0.5878,0.5817) / 1.263603 | (0.0864,0.2626,0.2573) / 0.729803 |

Removing authored ambient still leaves **29.10%** of Gene mask pixels >1
(peak **1.127953**); removing scene ambient still leaves **38.94%** >1
(peak **1.263603**). Neither ambient term alone explains all clipping.
No isolated Gene term exceeds 1; their **sum** does. Gene's specular and sphere
ablations have exactly zero delta. Neutralizing its toon ramp also has zero
delta. Neutralizing base texture RGB while preserving alpha raises all sampled
Gene pixels above 1: textures generally attenuate, rather than create, that
energy. For Miku, neutralizing toon changes individual linear channels by up to
**0.276877**; specular removal changes them by up to **0.132813**.

Summed-isolation maximum channel errors are **1.19e-7** (Gene) and **6.27e-8**
(Miku); repeated current renders have **zero** difference for both. Every
loaded diffuse/ambient/specular component matches the source sRGB-to-linear
conversion within 1e-6, and source power/alpha match exactly.
Canvas clipping fractions differ slightly from the HDR target because the
canvas uses antialiasing and 8-bit quantization; values already exceed 1 in the
linear target before any sRGB display mapping.

## Verified causes and unresolved questions

**Verified in the shipped models and this renderer:**

- **Authored base and ambient levels differ.** Most Gene diffuse channels are 1,
  whereas Miku's largest authored diffuse channel is 0.8 (linear 0.603827).
  Gene's typical ambient 0.752941 decodes to about 0.527115, contributing
  0.263558 after the retained 0.5 coefficient, versus Miku white's 0.107021.
  A white Gene texel with current lights reaches approximately
  `1 + 0.127953 + 0.263558 = 1.391511`. The slight measured peak difference
  comes from record 8's ambient 0.753.
- **Scene ambient is additive to material ambient.** It contributes the measured
  Three indirect diffuse term (`D*T*ambientLight/pi` here). The two ambient
  concepts are distinct. Lower scene ambient reduces energy but cannot remove
  authored ambient; both-lights-zero renders retain the latter. This host
  extension applies equally to PMD and PMX.
- **The direct-diffuse normalization change matters.** Reconstructing only the
  old `directDiffuse/pi` scale from measured isolated pixels, retaining all other
  current terms, gives Gene peak **0.709867**, zero >1 pixels (Miku **0.395442**).
  Removing that divisor increases the direct term by pi in both models. This
  explains why Gene's near-white authored inputs now exceed display range more
  readily. The counterfactual isolates scale; it neither reproduces all old
  shaders nor establishes which normalization matches native MMD.
- **Texture/toon controls differ.** Gene's loaded toon00 is solid white
  (all RGB texels 255); Miku's toon01 spans 205–255 gray, toon03 154–255 gray,
  and toon02 (245,225,225)–(255,255,255). There is no separate N·L factor outside
  the ramp in the current shader, so Gene's white ramp supplies no normal-based
  direct-diffuse contrast. That is a plausible contributor to the perceived
  flatness, supported by the zero-delta white-ramp ablation. Gene's arm/face
  maps have bright RGB texels, while its clothes/hair maps also contain dark
  texels. PMD mostly uses lower authored colors instead of painted base maps.
- **Specular is excluded as Gene's cause.** All 13 shipped records have zero RGB
  and positive power 5; even forcing power 0 produces zero pixels. Miku has
  nonzero authored specular, but all its powers are positive (5/6/10/15).
  Forcing zero power on Miku demonstrates the constant-lobe extension's larger
  mean contribution; that counterfactual is not active in either shipped scene.
  Neither model has an active sphere map, and no nonzero default material morph
  supplies extra brightness.
- **Output conversion is downstream.** HDR values exceed 1 before conversion.
  Both canvases use the same sRGB output and NoToneMapping; their different
  clipping is not evidence of a PMX-only conversion path. Linear 888 gray is
  about **0.246201**, compared with AAA **0.401978** and white **1**. The trial
  therefore reduces both incident-light terms substantially while leaving
  authored ambient. Existing scalar/material browser checks separately verify
  linear-target pixels and output conversion on WebGL2 and WebGPU.

**Remaining uncertainty:** these isolate why the current implementation produces
more energy/clipping for this particular Gene model. They do not determine
whether native MMD folds, clamps or interprets these parameters differently.
No native render or independently validated raw-PMX lighting oracle was available.
The contribution of those differences to the maintainer's subjective judgment
remains unmeasured.

No confirmed library-level defect has been established by these measurements.
The evidence supports model-specific energy levels and their composition under
the current shader, not a PMX-format defect. No renderer/loader/shader changes
are bundled and no independent bug issue is filed. A future confirmed bug should
have a separate issue with pinned assets, native/reference evidence, a clearly
isolated incorrect behavior, and regression expectations on both TSL backends.

Native MMD's mapping of raw diffuse/ambient parameters, zero-power specular,
intermediate saturation, toon/shadow policy and source/display color conventions
remain unverified (see [material shading](material-shading.md)). This fixed rest
pose does not quantify every animated camera/pose, screen or artistic preference.
The maintainer's visual decision after publication remains separate from shader
correctness.

## Validation and publication

Validated on 2026-10-21 with Node.js 24.12.0 and Chrome 155 on macOS.

| Check | Result |
| --- | --- |
| `npm ci` | PASS; lockfile dependencies installed, no audit findings |
| `npm run typecheck` | PASS, including Examples/tools and TypeScript source checks |
| `npm test` | PASS; 1,195 tests, 0 skipped |
| Source Examples browser checks | PASS; 3 tests, 0 skipped; all five modes, forced WebGL2 and native WebGPU |
| Targeted material/Worker browser checks | PASS; 23 tests, 0 skipped; both TSL backends for material tests |
| `npm run build:examples` | PASS; public pinned real assets verified |
| Built Examples checks at `/three-mmd-loader/` | PASS; 3 tests, 0 skipped; real Miku/Gene, native WebGPU and forced WebGL2 |
| Gene thumbnail capture | PASS; readiness, lighting, model, render, physics, camera, runtime checks |
| Rendered contribution diagnostic | PASS; two real models, 16 settings each, source/loaded values, repeat and isolation assertions |
| Thumbnail hashes/dimensions/provenance | PASS; four Miku JPEGs and original capture records unchanged |
| `git diff --check` | PASS |

Exact browser commands (run after building, without concurrent rebuilds):

```sh
node --import tsx --test --test-concurrency=1 tests/browser/examples.test.ts tests/browser/gene-light.test.ts
MMD_EXAMPLE_SITE=dist/examples node --import tsx --test --test-concurrency=1 tests/browser/examples.test.ts tests/browser/gene-light.test.ts
node --import tsx --test --test-concurrency=1 tests/browser/ambient.test.ts tests/browser/native-material.test.ts tests/browser/material-morph.test.ts tests/browser/worker-physics.test.ts
```

The source checks use existing deterministic Miku fixtures and real Gene; built
checks use both original models. They cover model readiness, animation, IK,
physics, Worker transport/fallback, audio, poses, morphs and error handling.
Built-site checks additionally retain real-asset mobile/desktop resizing; its
resize synchronization budget is 15 seconds (fixtures remain 5 seconds) because
real-model SwiftShader rendering can delay resize events. All geometric assertions
remain required. The full unrelated browser suite was not run.

Earlier attempts exposed validation-harness issues: concurrent rebuilds removed
served modules; the expanded real-model WebGPU path exceeded the old five-second
resize budget; and an unsynchronized diagnostic reused frame-cached light
uniforms. Those results were discarded, the harness issues addressed, and the
checks above rerun successfully. The initial 400×400 diagnostic also exceeded
its bounded runtime; the final repeatable measurements use 256×256 and avoid
unnecessary shader recompilation for uniform-only changes.

**Required post-merge verification — PENDING:** record the latest Tests and Pages
workflow run links/results for the actual merge SHA; verify the published
`deployment-manifest.json` and assets identify that SHA. Smoke-test the public
Gene, Miku animation/audio/pose and Worker pages, including Worker startup; inspect
both deployed light colors and intensities. These operations cannot be completed
for an unmerged local checkpoint. Nothing was pushed, published or commented.

**Maintainer follow-up — PENDING:** visually compare the published Gene demo and
decide whether to keep 0x888888 or adjust it. No subjective outcome or manual
sign-off is claimed or required before merge.
