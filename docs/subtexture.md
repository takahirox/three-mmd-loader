# PMX SubTexture (sphere mode 3)

`MMDLoader` loads `envFlag === 3` using the existing sphere texture slot and
path/cache conventions. `material.matcapMode === 'subtexture'` selects a second
RGBA texture layer sampled at **`mmdAdditionalUV(1).xy`**. The original flag is
retained in `material.userData.MMD.envFlag`, including invalid texture references;
`matcapFileName` retains valid paths. PMD and sphere modes 0, 1 and 2 keep their
existing behavior. `matcapCombine` still controls view-based sphere modes and
is ignored by SubTexture.

The composition is **multiplication of RGB and alpha**, before specular lighting:

```text
surface diffuse RGB *= sample.rgb * mmdSphereColor.rgb
ambient/emissive RGB *= sample.rgb * mmdSphereColor.rgb
surface alpha       *= sample.a   * mmdSphereColor.a
```

Sphere alpha factors are applied once. Specular is not tinted by this layer.
Texture RGB uses Three's working color space; alpha remains linear. The base
color texture, opacity, alpha map and toon factors still participate normally.
This is not additive composition, alpha-over decals, or the existing mode-1
output operation (which uses matcap coordinates and leaves texture alpha out).

The coordinate rule comes from the [PMX format reference](https://gist.github.com/felixjones/f8a06bd48f9da9a4539f#material).
The RGBA multiplication and placement before specular follow Nanoem's explicit
[`isSphereTextureAsSubTexture()` branch](https://github.com/hkrn/nanoem/blob/30acffaa29f5d2eb9e997d69418f2e4b97b5894f/emapp/resources/shaders/src/core/model_color.hlsl#L51).
Its [coverage-alpha path](https://github.com/hkrn/nanoem/blob/main/emapp/resources/shaders/include/nanoem/model.hlsl#L103)
also multiplies SubTexture alpha. Nanoem is used here as a composition reference;
its core shader's view-based coordinate assignment is not copied. The PMX UV1
rule is implemented with the existing TSL accessor. Tests use an independent
CPU coordinate/RGBA oracle and actual GPU readbacks, rather than the material's
shader graph as the expected result.

## UVs, fallback and draw behavior

The accessor consumes the existing absolute UV evaluator. Declared UV1 base
values, direct type-4 morphs, direct group links and named VMD tracks all update
the same attribute. There is no additional shader-side morph application.
Changing weights updates buffers and uniforms without invalidating the material.
Additional UV1 Z/W do not affect sampling. UV0 and view normals do not choose
SubTexture texels.

When UV1 is **undeclared**, the accessor returns `vec4(0)` and SubTexture samples
**(0, 0)**, before texture transforms. No attribute is fabricated or accessed out
of bounds. Missing per-vertex UV1 components are zero; nonfinite components and
malformed additional-UV counts use the UV evaluator's finite/absent fallback.
An invalid index, absent/empty path, absent map, or failed image load disables
that layer and ignores its sampler factors. A failed shared image detaches each
SubTexture consumer; source flags and valid filenames remain available.

The standard Three texture sampler applies matrices, repeat/clamp, filtering and
origins. Loader textures have `flipY = false`, repeat wrapping and sRGB RGB.
No extra V inversion is applied. Loader SubTexture materials are conservatively
transparent from creation because UV morphs/transforms can reach any alpha texel.
Zero-alpha surfaces discard depth. Alpha tests run after SubTexture alpha;
the shadow mask samples the same UV1 and alpha/factors. r186 shadows remain
binary for partial opacity. Outlines retain the independent PMX edge color/alpha
and do not use texture alpha, as in the existing outline path.

For a standalone material, set `matcap`, `matcapMode: 'subtexture'` and enable
`transparent` when texture alpha can vary. Provide `mmdAdditionalUV1` as a vec4
attribute, or use a loader mesh. Set `needsUpdate = true` after changing sampler
presence or `matcapMode`, as for other shader configuration. Clones preserve the
mode/texture and have independent material morph factors.

## Private fixture and validation

`npm run dev:sdef` exposes **Generated SubTexture fixture** on loopback only.
It parses an authored PMX with sphere modes 0–3, distinct UV0/UV1, a generated
asymmetric RGBA PNG, a type-4 morph, a group link and a sphere-color material morph.
The mode-3 panel uses the existing direct/group controls (0 → 0.5 → 1 → 0), reset
and optional local VMD playback. No third-party model is needed.

The generated PMX/PNG are served from memory only by the private viewer. Tests,
viewer and private assets are excluded by npm's file allowlist and public example
builds/Pages; public example files and asset manifests are unchanged. Optional
local models belong in Git-ignored `examples/assets/private/uv-morph/`; inspect
the creator's actual README/license before loading. They are not CI inputs.

Run `npm run typecheck`, `npm test`, `npm run test:browser`,
`MMD_EXAMPLE_FIXTURES=1 npm run build:examples`, and `npm run test:examples`.
Package tests install isolated JavaScript/TypeScript consumers. GPU tests require
actual WebGL2 output and also exercise native WebGPU when an adapter is available.
There is no mandatory post-merge verification.
