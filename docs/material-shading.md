# MMD ambient and texture composition

`MMDToonMaterial.ambient` is a dedicated `Color` in Three's linear working
space, defaulting to black. PMD and PMX loaders retain the full source ambient
value, converting sRGB to the working space just like diffuse and specular.
Material morphs evaluate the original PMX channels in source space before that
conversion. Neither the loader nor morph evaluation writes ambient to
`emissive`, or reduces it according to whether a map is present.

For one direct light, the linear RGB equation is:

```text
B = (D * L * V / pi + 0.5 * A) * T * U * R + I
surface = B                         // no view-based sphere (includes SubTexture)
surface = B * S                     // sphere multiply
surface = B + S * R                 // sphere add
RGB = surface + specular + user emission
```

Here `D` is material diffuse RGB, `A` is ambient RGB, `T` is the color texture
times its material morph RGB factor, `U` is the optional SubTexture RGB times
its sphere morph factor, `L` is direct light color/intensity, `V` is Three's
shadow attenuation, `R` is the existing toon ramp including its RGB morph
factor, `I` is Three's indirect diffuse contribution (already including
`D * T * U`), and `S` is the view-based sphere texture times its RGB morph
factor. Missing textures/factors contribute identity. SubTexture uses additional
UV1 and is already included in `U`. For the direct contribution, these equations
are algebraically equivalent to sphere composition before the toon ramp.
Specular is added separately: the base map, SubTexture, toon ramp and sphere
texture do not tint it.

Indirect light is included before sphere composition, without toon modulation.
For multiple direct lights, diffuse light sums normally; ambient and sphere-add
use the arithmetic mean of their toon ramps. This is an explicit Three
extension: MMD has one global directional light. Ambient is added once
regardless of light count or intensity. With no direct light, its ramp is
identity, including scenes without any lights. Three's `lights = false` retains
its unlit diffuse fallback, with ambient added.

The GPU implementation distributes multiplication over addition: Three's
normal diffuse path already samples `T` and `U`, while the dedicated ambient
path samples the same layers separately. Each contribution receives each
factor once. There is no final base-map multiply of the entire output and no
division by diffuse color or texels (which would fail for black channels).
Custom `colorNode` retains Three's override semantics for diffuse; ambient
continues to use the material's color map independently of that override.

The composition follows [Saba's `mmd.frag`](https://github.com/benikabocha/saba/blob/master/viewer/Saba/Viewer/resource/shader/mmd.frag):
ambient participates before the base texture, sphere before toon, and specular
after these layers. The ambient coefficient comes from
[babylon-mmd's material documentation](https://github.com/noname0310/babylon-mmd/blob/main/docs/docs/reference/loader/mmd-model-loader/mmd-standard-material/index.md),
which documents a factor of `0.5` for MMD ambient. Saba's fragment shader itself
uses an unscaled ambient uniform; its equation alone does not justify an
empirical map-dependent brightness reduction.

This is a reference-grounded adaptation, not a claim of exact MikuMikuDance
equivalence. Intentional differences are:

- All RGB arithmetic uses Three's linear working space. Loader textures remain
  `SRGBColorSpace`; the GPU decodes RGB once. The coefficient is applied after
  decoding ambient, not as an sRGB source edit. Alpha is linear and unchanged.
- Three's irradiance normalization (`1 / pi`), indirect light/AO, HDR output,
  tone mapping and fog remain available. Unlike Saba's base clamp and Babylon's
  diffuse clamps, this material leaves HDR values to Three's output pipeline.
- The existing Three toon coordinate (`normal dot light * 0.5 + 0.5`), rotated
  loader ramps and smooth `0.7`/`1` fallback remain. Direct shadows attenuate
  diffuse and specular light; ambient remains fill and is only toon-modulated.
  Saba and Babylon instead feed shadow visibility into the toon coordinate.
- Specular keeps Three's normalized Blinn-Phong/Fresnel implementation, without
  toon modulation. Saba's unnormalized highlight and Babylon's implementation
  are not copied. The existing view-based sphere coordinates remain.
- Babylon folds ambient into diffuse before applying light color and puts
  sphere composition after specular; this implementation follows Saba's
  separated ambient and specular placement instead, using Babylon's documented
  ambient coefficient.
- PMX material-morph factor arithmetic and alpha semantics remain as previously
  supported by this library; Saba/Babylon's separate texture-add/multiply-factor
  algorithms are not introduced here.

User `emissive`, `emissiveIntensity`, `emissiveMap` and `emissiveNode` remain
independent Three controls. Existing SubTexture and sphere-multiply modulation
of user emission is preserved; emission is not toon-modulated. Material morphs
change dedicated ambient, leaving these user emission controls intact. Clones
copy ambient into an independent `Color`. Applications that previously edited
`emissive` or `emissiveIntensity` to compensate for MMD ambient should now edit
`ambient`; emission intensity no longer scales the model's ambient contribution.

Opacity, alpha test/maps, zero-alpha discard, shadow masks, outlines, UV morphs
and their sampler alpha factors use the existing paths. Shadows retain Three's
binary caster behavior for partial alpha.

## Branch validation and deployment follow-up

`tests/mmd-color-reference.ts` is an independent CPU oracle for the documented
adaptation. `tests/ambient.test.ts` checks PMD/PMX source conversion, texture
presence, independent cloning and user emission across morph evaluation.
`tests/browser/ambient.test.ts` compares real linear render-target pixels for
map-free, white, colored, dark and black textures; direct/indirect/multiple/no
lights; toon ramps; sphere multiply/add/SubTexture; and separate specular and
user emission. WebGL2 is mandatory and native WebGPU runs when available.
The material-morph browser suite also checks the new ambient equation across
direct/group weights, reset and extrapolation; unit tests cover seeks,
pause/restart, helper transfer and zero-time reevaluation.

Run `npm run typecheck`, `npm test`, `npm run test:browser`, `npm run build`,
`npm run build:examples`, and `git diff --check`. Browser example checks exercise
the actual pinned Gene Light asset and the PMD pages locally and in the built
artifact, without requiring a published site or subjective image comparison.

Post-merge Pages verification for Issue #59 is **pending**: record the
merge-triggered workflow run, deployed commit/date, and published Gene Light
and existing example runtime/asset results after merge. These are follow-up
checks, not branch acceptance gates. A visual comparison by a maintainer is
optional. No screenshot-based diagnosis of the published Gene page is claimed.
