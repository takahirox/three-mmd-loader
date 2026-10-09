# PMX UV morphs

`MMDLoader` supports type 3 (UV0) and types 4–7 (additional UV1–4).
Names, file indices, `morphTargetDictionary` and `morphTargetInfluences`
retain their original order, including unsupported morph types. Public
`mmd-parser@1.1.4` parses the fixtures; no parser changes are required.

```ts
import { mmdAdditionalUV, updateMMDUVs } from 'three-mmd-loader';

mesh.morphTargetInfluences[mesh.morphTargetDictionary['uv-name']] = 0.5;
helper.update(0); // immediately updates attributes for inspection
// Without a helper, updateMMDUVs(mesh) updates attributes immediately too.
// Render callbacks also evaluate changed weights automatically.
material.fragmentNode = mmdAdditionalUV(1); // Node<'vec4'>, all xyzw components
```

The accessor is also available at `three-mmd-loader/materials/MMDUV.js`.
The TSL attribute names are `mmdAdditionalUV1` through `mmdAdditionalUV4`.
They contain **morphed vec4 values**, rather than unmodified bases. The accessor
returns `vec4(0)` when a channel was not declared. Missing-channel morphs retain
their payload and index but have no runtime attribute and no deformation.
Applications should use the accessor for this safe fallback; raw TSL
`attribute()` requests require the attribute to exist.

The standard material samples UV0 via Three's `uv()` / `uv` attribute, including
color-map alpha, alpha maps, displacement and the shadow alpha mask. Sphere
mapping still uses view coordinates; toon shading still uses lighting
coordinates. Default MMD materials do not consume additional UV channels.
The accessor lets application NodeMaterials consume them without custom GLSL
or WGSL. The standard UV attribute is vec2: UV0 offset z/w are retained in
`geometry.userData.MMD.uvMorphs`, but are unused for ordinary sampling.

## Arithmetic and lifecycle

Each channel starts from its immutable flattened vec4 baseline in
`geometry.userData.MMD.uvBases`. UV0's baseline z/w are zero. Payloads are
copied from the parser, so changing parser arrays cannot change the runtime.
For a target, evaluation uses its direct public weight plus every valid
**direct** group weight × link ratio. Duplicates and shared targets sum;
negative, fractional and over-one values are allowed without clamping.
Nested groups, invalid vertex/target indices and nonfinite operands are
ignored. Individual overflowing results are ignored, including values that
would overflow GPU float32. Nonfinite public weights behave like zero in UV
and Three's position draw uniforms, without replacing the public weights
outside a draw. UVs never enter Three's built-in morph attributes, preventing
application twice. Existing vertex, bone and material group links still use
their respective evaluators.

Evaluation is absolute on the CPU into reusable GPU attributes. The offsets
are **not** interpreted as positions. The same values are consumed by TSL in
both WebGL2 and native WebGPU. `helper.update(0)` is useful for immediate CPU
inspection, but is not required for standalone rendering of changed weights:
loader-installed surface and shadow callbacks also evaluate them. Helpers
apply after the mixer, in both default and `pmxAnimation: true` modes. Pausing,
stopping, seeking and looping do not accumulate deltas. Clearing weights and
updating restores the baseline. `helper.enable('uvMorph', false).update(0)`
restores and holds the baseline, independently of `animation`, `boneMorph`
and `materialMorph`. Removing a mesh restores its UV baseline; adding it to a
new helper evaluates the current public weights on that helper's next update.
A removed mesh keeps UV evaluation disabled until `updateMMDUVs(mesh)` or a
new helper update, so removal cannot leave a stale deformation in a draw.

## Coordinates, textures and buffers

The parser's handedness conversion leaves base UV and all four UV-offset
components unchanged. Values are added with their original signs and channel
order. Loader textures use `flipY = false` and repeat wrapping; UV V therefore
addresses rows in the loaded image's order. For DataTextures, `flipY = false`
addresses row zero at V=0; setting `flipY = true` reverses rows. No separate
V-negation is applied to morphs. Texture matrices, wrapping, clamp and filters
remain Three's sampling behavior. Configure the texture's sampler before
first use. Browser tests use fresh textures per sampler configuration and
verify both origins and repeat/clamp against an asymmetric RGBA image.

Textured materials with UV0 morphs are conservatively transparent, because a
morph can reach an alpha texel outside its base triangle. Their zero-alpha
samples discard depth in the MMD surface path. The shadow mask samples the
same morphed UV and map/alpha-map factors, with the material's alpha test;
r186 shadows remain binary for partial opacity. Alpha maps explicitly use green
in both passes. Changing sampler presence and setting `material.needsUpdate = true`
also refreshes the default shadow mask; application-supplied masks are preserved.

UV0, every declared extra channel, and SDEF parameters share one interleaved
vertex buffer. SDEF parameters remain unchanged by UV evaluation. Only
consumed attributes enter a TSL shader. A full SDEF shader consuming normal,
tangent, edge, UV0 and all four extra channels uses 15 locations and 7 vertex
buffers; browser tests add one clip-position probe to reach the minimum
16-location / 8-buffer limits, while actually drawing mixed SDEF/BDEF and
position morphs. No per-frame arrays or buffers are allocated. Effective
weights are checked on each helper update/draw; unchanged weights skip
vertex writes and GPU uploads. Changed weights cost O(vertices × declared
channels + active UV elements + group links), and upload the shared buffer,
including its unchanged SDEF data. The loader also retains its existing dense
position placeholders for every morph index, so that inherited memory cost grows
with vertex count × total morph count. Large meshes with constantly changing UV
weights can be CPU/upload bound. Geometry and its mutable attributes should
not be shared by meshes needing different UV weights; clone the geometry.

## Private inspection and validation

`npm run dev:sdef` serves the loopback-only viewer. Use the generated UV fixture
button and asymmetric checker without any external assets. The fixture has
mixed SDEF/BDEF, a vertex morph, type 3–7 UV morphs and direct groups. The
viewer lists original indices/names, channel, nonzero element counts, vertex
IDs, xyzw offsets, direct group ratios, and base/current values, with bounded
payload excerpts. Independent direct/group sliders support 0 → 0.5 → 1 → 0;
reset clears weights. Optional local VMD playback uses the same named tracks.
The checker visualizes UV0; additional UV values are diagnosed separately.

Locally supplied models go in Git-ignored `examples/assets/private/uv-morph/`
or the existing private bone/group/material directories. Read the actual
README/license **before** loading them. The viewer does not download assets,
serve license/archives, or include private assets in npm or public builds.
Issue #30 and optional human real-model inspection remain independent.
Flip/impulse morphs, MME effects, sphere mode 3 and Grant fixes are excluded.

Automated checks: `npm run typecheck`, `npm test`, `npm run test:browser`,
`MMD_EXAMPLE_FIXTURES=1 npm run build:examples`, and `npm run test:examples`.
The opt-in environment variable bypasses the example asset downloader and
builds from temporary generated assets, leaving public source assets and
manifests untouched. This fixture artifact is for validation only and must
not be deployed as the public examples. To also test the built artifact, use
`MMD_EXAMPLE_SITE=dist/examples npm run test:examples`.
Unit/package tests exercise isolated JS and TS npm consumers. Browser tests
compare all four additional components, actual color/alpha/depth/shadow
pixels and reset behavior on mandatory WebGL2 and native WebGPU if available.
