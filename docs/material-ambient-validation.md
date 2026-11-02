# Material ambient composition validation — Issue #113

The shared PMD/PMX material path now uses full authored ambient, ordinary
scene-ambient color products without Lambert 1/pi, and the same toon stage for
scene and authored ambient. See [the evidence, derivation and compatibility
assumptions](material-shading.md). No Examples light settings changed. This is
not a native-pixel-parity or subjective visual-improvement claim.

## Controlled real-model comparison

Both versions were measured on 2026-11-02 with Node 26.12.1, Three 0.186.1 and
Chrome 156 / WebGL2 SwiftShader on macOS. The public pinned models, hashes,
rest pose, zero morphs, disabled animation/physics, camera, 256×256 target,
light positions/colors/intensities, texture controls and all 16 ablations are
identical. The baseline shader is from filing commit
`7b604fb1d76b26a2c46bced0cbeab2b8b5781c40`; the corrected shader is the worktree
version. The script temporarily transpiles only that pinned material source
into the served build for the baseline and restores the current module in
`finally`. It never changes source or commits. Run measurements sequentially,
without concurrent builds or browser checks:

```sh
npm ci
npm run build
npm run examples:assets
MMD_LIGHTING_MATERIAL_REF=7b604fb1d76b26a2c46bced0cbeab2b8b5781c40 MMD_LIGHTING_OUTPUT=docs/material-ambient-before.json node --import tsx scripts/measure-example-lighting.ts
MMD_LIGHTING_OUTPUT=docs/material-ambient-after.json node --import tsx scripts/measure-example-lighting.ts
```

[Before](material-ambient-before.json) and [after](material-ambient-after.json)
retain source and loaded material values, implementation hashes, browser
identity, every HDR/display histogram and isolated contribution. The historical
[#102 report](gene-light-overbrightness-investigation.md) and its JSON are
preserved. This rerun reproduces its pre-change means/peaks/clipping to reported
precision despite using Chrome 156 instead of 155.

The script's `current` label consistently means the **#102 comparison baseline**
AmbientLight 0xAAAAAA / DirectionalLight white, intensity 1 each, for both models.
`gray` consistently means 0x888888 / 0x888888 at 1/1. The shipped Gene demo uses
gray, while the Miku demo uses AAA/white. Keeping both controls avoids comparing
different lighting as if it were a material effect. Neither pair is asserted to
be native MMD's default light setup; both include an optional Three ambient
light in addition to the directional key light.

All linear figures are read from Float32 Linear-sRGB render targets before
tone mapping/display conversion. The actual sRGB8 canvas is measured separately.
Mask pixels have alpha >0.99; the model silhouette mask is unchanged across
shader versions. `>1` is an HDR-energy/clipping diagnostic, not an error or a
visual-quality score. D3D9 source-space primary saturation is deliberately not
implemented by this linear/HDR adapter.

| Model / light colors | Before mean linear RGB | After mean linear RGB | Peak before → after | HDR >1 pixels before → after | sRGB8 at 255 before → after |
| --- | --- | --- | --- | --- | --- |
| Gene PMX / white / white | (0.7301, 0.7358, 0.7283) | (1.1664, 1.1755, 1.1634) | 1.581913 → 2.527206 | 50.14% → 55.24% | 49.61% → 55.22% |
| Gene PMX / AAA / white | (0.6422, 0.6473, 0.6406) | (0.8904, 0.8974, 0.8881) | 1.391557 → 1.929184 | 44.67% → 53.90% | 43.97% → 53.37% |
| Gene PMX / 888 / 888 | (0.2714, 0.2736, 0.2708) | (0.4706, 0.4742, 0.4694) | 0.588173 → 1.019609 | 0.00% → 4.61% | 0.00% → 4.06% |
| Miku PMD / white / white | (0.1087, 0.3373, 0.3306) | (0.1658, 0.5181, 0.5075) | 0.922007 → 1.440651 | 0.00% → 10.69% | 0.00% → 9.41% |
| Miku PMD / AAA / white | (0.0954, 0.2926, 0.2867) | (0.1256, 0.3885, 0.3805) | 0.807065 → 1.079548 | 0.00% → 5.72% | 0.00% → 4.48% |
| Miku PMD / 888 / 888 | (0.0360, 0.1123, 0.1099) | (0.0593, 0.1861, 0.1819) | 0.307671 → 0.516034 | 0.00% → 0.00% | 0.00% → 0.00% |

| Isolated contribution (AAA / white) | Gene before → after mean RGB | Miku before → after mean RGB |
| --- | --- | --- |
| Scene ambient | (0.0591, 0.0595, 0.0589) → (0.1855, 0.1870, 0.1851) | (0.0089, 0.0300, 0.0295) → (0.0270, 0.0871, 0.0854) |
| Authored ambient | (0.1216, 0.1226, 0.1213) → (0.2433, 0.2452, 0.2427) | (0.0123, 0.0389, 0.0378) → (0.0245, 0.0777, 0.0756) |
| Directional diffuse | (0.4615, 0.4652, 0.4604) → (0.4615, 0.4652, 0.4604) | (0.0671, 0.2166, 0.2124) → (0.0671, 0.2166, 0.2124) |
| Direct specular | (0.0000, 0.0000, 0.0000) → (0.0000, 0.0000, 0.0000) | (0.0071, 0.0071, 0.0071) → (0.0071, 0.0071, 0.0071) |
| Both intensities zero | (0.1216, 0.1226, 0.1213) → (0.2433, 0.2452, 0.2427) | (0.0123, 0.0389, 0.0378) → (0.0245, 0.0777, 0.0756) |

Authored ambient doubles exactly in linear space, as expected from removing the
unsupported half coefficient. Gene's toon00 is white, so scene ambient grows by
pi while direct diffuse/specular remain unchanged. Miku's scene ambient also
moves under its nonwhite toon ramps: its change is not simply a pi multiplier.
Both intensities zero still retain authored ambient; that term is not multiplied
by light intensity. All source-to-loaded material values match between runs.

Gene continues to have zero authored specular and no actual sphere textures;
its toon ablation remains zero. The corrected composition **increases** Gene HDR
clipping on the unchanged AAA/white baseline. This is an expected measured
consequence, not evidence of a visual improvement or native-MMD parity. The
shipped gray-light control remains separately reported rather than retuned.
Miku remains a different authored-material/texture/toon case; no model-to-model
pixel correspondence or native reference exists. Native source-space mixing
and pretexture saturation could materially change these figures and remain
outside this scoped Three linear/HDR adaptation.

Repeated renders have zero maximum channel delta for both versions/models.
The after-run sum of the four isolated contributions agrees with the full render
within 1.79e-07 linear RGB. Peaks and clipping therefore arise before output conversion, from the material/scene sum; the
sRGB8 display histogram is a separate downstream observation.

## Numerical tests and checks

The scalar fixed-function oracle follows D3D9 slot semantics and Microsoft's
lighting equations separately from the library/reference composition helper.
Hand-computed dyadic fixtures establish its values. PMD and PMX browser cases
compare against it below saturation in explicit linear input space. Other
browser cases deliberately exercise HDR, multiple lights, scene light intensity
zero/black color, removed lights, black/white/color textures, colored toon,
base/sphere/SubTexture, separate specular and user emission. PMX morph tests
retain multiply/add/group changes and resets, alpha, outlines and shadow checks.
Native WebGPU means the actual WebGPU backend (not the WebGL fallback); WebGL2
is forced and checked independently.

| Check | Actual result |
| --- | --- |
| `npm ci` | PASS; lockfile installed, 0 audit findings |
| `npm run typecheck` | PASS; library, Examples, tools/tests and TypeScript source check |
| `npm test` | PASS; 1,204 tests, 0 failures, 0 skipped |
| `npm run build` | PASS; also run by the typecheck/test hooks |
| Material browser checks | PASS on actual WebGL2 and native WebGPU: per backend, 124 ambient/sphere/specular cases + 104 PMD/PMX D3D-oracle cases, 272 direct-light/sampler pixels, 330 PMX morph RGBA cases, plus emission/output/outline/shadow checks |
| Controlled real-model diagnostic | PASS; 2 models × 16 settings × 2 shader versions, matching masks/materials/scene hashes, zero repeat delta |
| Full `npm run test:browser` | PASS; 55 tests, 0 failures, 0 skipped; 644.25 seconds |
| Source Examples browser checks | PASS within the full suite; PMD fixture interaction pages and real pinned Gene, forced WebGL2 and native WebGPU. Separate diagnostics above use real source Miku/Gene. |
| `npm run build:examples` | PASS; public pinned assets verified |
| Built Examples at `/three-mmd-loader/` | PASS; 3 tests, 0 failures, 0 skipped; real Miku/Gene, forced WebGL2 and native WebGPU, navigation/resize/interactive controls and shader/texture startup; 277.00 seconds |
| `git diff --check` | PASS, including the final staged changes |

The built-site command (after `npm run build:examples`) was:

```sh
MMD_EXAMPLE_SITE=dist/examples node --import tsx --test --test-concurrency=1 tests/browser/examples.test.ts tests/browser/gene-light.test.ts
```

The first targeted ambient run exposed the old 8-bit test target's clamping at
RGB >1; it now reads Float32 values. Adding MMDLoader coverage initially omitted
its parser/addon import-map entries and timed out; those imports and explicit
module-error reporting were added, then the test passed. These were test-harness
failures, not native image comparisons. The initial typecheck also caught missing
Three context typings in the new override; the explicit context type was added.
No renderer or Examples lights were retuned in response to these checks.

Human visual judgment is not a gate. Native source/display color conventions,
pretexture saturation/quantization, exact toon/shadow behavior and native
visual/pixel comparison remain unverified. The scoped correction deliberately
retains Three color management, HDR, optional indirect lights/AO and the
existing multi-light/ramp policy, as documented in material-shading.md.

## Required post-merge work

**PENDING until performed:** verify the latest merge-triggered **Tests** and
**Deploy browser examples** Actions attempts against the actual merge SHA and
record attempt URLs/results. PR/local results do not establish deployment.

**PENDING until performed:** verify the deployed Examples manifest/commit and
startup of real PMD Miku and Gene PMX pages, including shader and texture loads,
errors and objective lighting diagnostics. No automatic demo-light retuning.

Optional maintainer comparison with native MMD remains an explicit follow-up;
none was performed here. This node does not push, open PRs, merge, deploy or
comment, so merge-SHA/publication verification cannot be completed here.
