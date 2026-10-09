# PMX bone morph playback

Direct PMX **type 2 bone morphs** require the public npm release
`mmd-parser 1.1.4` or newer. The parser reflects translation Z and quaternion
X/Y into right-handed space. MMDLoader retains these values without another
coordinate conversion, in `mesh.geometry.userData.MMD.boneMorphs`:

```ts
interface MMDBoneMorph {
  index: number; // existing morphTargetInfluences index
  name: string;
  elements: {
    index: number; // skeleton bone index
    position: number[]; // local translation offset, xyz
    rotation: number[]; // local rotation offset, xyzw
  }[];
}
```

The array contains only direct type 2 entries, in PMX file order. Their names,
dictionary indices and weight tracks remain compatible with vertex morphs.
They retain unchanged position targets so Three.js can bind the same morph
weight array. Skinning, rather than a vertex target offset, deforms the mesh.
The field is optional for compatibility with manually constructed older MMD
geometry. MMDLoader creates it for both formats (empty for PMD).

Use the existing helper even when there is no animation clip:

```js
const helper = new MMDAnimationHelper();
helper.add(mesh, { physics: false });
const index = mesh.morphTargetDictionary['open'];
mesh.morphTargetInfluences[index] = 0.5;
helper.update(0); // immediately refreshes bones; render normally afterward

helper.enable('boneMorph', false).update(0); // removes bone offsets
helper.enable('boneMorph', true).update(0);
```

VMD morph tracks use these same weights automatically. Continue calling
`helper.update(delta)` in the render loop. A paused action, a zero mixer time
scale or `helper.enable('animation', false)` freezes animation but still allows
interactive bone morph updates. To scrub, call
`helper.objects.get(mesh).mixer.setTime(seconds)`, then `helper.update(0)`.
Resetting/stopping an action restores its original animated properties and
morph weights through Three.js's normal mixer behavior.

## Composition and update order

Each frame restores the pose before the preceding procedural pass, evaluates
VMD bone and morph tracks, applies direct bone morphs **once**, solves IK and
grants, then updates physics. Both default and `pmxAnimation: true` paths use
this ordering. The PMX path keeps the existing transformation-class/index
order and recursive grant-parent updates. IK sees morph-adjusted targets and
links; grants inherit morph-adjusted rotations. Kinematic rigid bodies follow
those transforms; dynamic bodies continue to override their target bones.
Experimental shared physics captures the final pose after the shared step.

Translations add `weight * offset` in the bone's parent space. Rotations use
shortest-path spherical interpolation from identity to the normalized PMX
quaternion. Weighted offsets targeting a bone compose by Hamilton product
in morph file order and then element order. The resulting offset precedes
the authored VMD/VPD rotation:

```text
position = authoredPosition + sum(weight_i * translation_i)
offset   = slerp(identity, rotation_0, weight_0)
         * slerp(identity, rotation_1, weight_1) * ...
rotation = offset * authoredRotation
```

The morph-before-animation convention is also used by
[babylon-mmd's bone runtime](https://github.com/noname0310/babylon-mmd/blob/master/src/Runtime/mmdRuntimeBone.ts).
Noncommuting rotations are tested against a separate scalar quaternion
reference. The helper saves the authored and final procedural poses with
float64 precision. It restores properties that still match its previous
output, allowing absolute application edits to supply a new authored pose.
The helper observes mixer updates (including `setTime`) and restores the
procedural pose before evaluation, preserving a newly authored pose even
when it exactly equals the preceding morphed output. Do not add relative bone
edits to the already morphed output on every frame; supply an absolute authored
pose instead.
`helper.pose(mesh, vpd)` resets and applies a VPD before the morph pass;
`{ resetPose: false }` composes the VPD onto the preceding authored pose.
An empty VPD resets to rest while retaining selected morph weights. Set
weights to zero to remove the morphs too. This explicit pose API also handles
a reset when a morphed output happens to equal the rest transform.

Existing vertex morph evaluation remains before BDEF/SDEF skinning. SDEF
centers and radii are unchanged; both TSL backends use the resulting skeleton
palette for surfaces, normals, outlines and shadows.

## Scope and inherited limitations

[PMX group morphs](group-morphs.md) propagate direct vertex, bone, UV and material references.
[UV/additional-UV playback](uv-morphs.md) and
[material morph playback](material-morphs.md) are supported separately.
Real-model verification of the wire rope candidate remains optional.

This change preserves the helper's existing solver limitations: local grants
and position grants remain unimplemented, and the PMX helper is an approximation
rather than a complete implementation of PMX before/after-physics deformation
layers. Bone morphs use the existing single pass before physics. Regression
tests cover global rotation grants, IK, the unchanged local/position grant
behavior, physics overrides, warmup, loop reset and experimental shared physics.

## Optional local model inspection

The existing loopback viewer now includes bone morph controls:

1. Legitimately obtain a candidate from its creator:
   [ビニール傘 (Vinyl umbrella), 七篠権平衛](https://bowlroll.net/file/151308),
   or [ワイヤーロープ (wire rope), まりりん](https://bowlroll.net/file/69264).
   These are candidates based on the distribution descriptions, not validated
   fixtures. No model or license has been downloaded by this implementation.
2. Read the archive's actual README/license locally before use. Extract it
   under `examples/assets/private/bone-morph/`, preserving filenames, texture
   paths and subdirectories. Keep archives and licenses there as well.
3. Run `npm run dev:sdef`, open `http://127.0.0.1:8081/local-sdef/`, select
   **bone-morph/** and enter the original relative PMX path, for example
   `umbrella/ビニール傘.pmx`. Add `?webgl` to force WebGL2.
4. Click **Load PMX**. The actual MMDLoader geometry supplies the type 2 morph
   names, indices, weights, bone names/indices, translations and xyzw rotations.
   A PMX without type 2 entries shows a diagnostic and disables morph controls.
5. Select a morph and move **Weight** from 0 to 1. Selection preserves other
   morph weights so combinations can be inspected. **Reset pose** clears all
   weights and restores rest bones. **Compare using BDEF2** changes only SDEF
   vertices; existing BDEF vertices retain their skinning types.
6. Optionally load a compatible local VMD using a path relative to the model's
   selected private directory. Its morph weights appear in the diagnostics.
   Moving a weight slider stops motion; static inspection disables IK/grants
   to show the direct offsets. Motion playback enables IK/grants and keeps
   physics disabled. Existing YYB Miku bend controls remain available.

The server binds only to `127.0.0.1`. Model and texture routes enforce realpath
containment and an extension allowlist; archives and licenses are not served.
The ordinary public examples server rejects these private routes. The existing
Git ignore rule covers all `examples/assets/`; the explicit npm file allowlist
and static examples build exclude the private assets and `local-viewer/`.
Tests verify relative Unicode texture paths, traversal/symlink rejection, Git
ignore, npm packing and the Pages build manifest. Never expose the private
server via a public proxy or tunnel, or redistribute the files automatically.
Existing public examples, asset manifest, screenshots and Pages URLs are unchanged.

## Automated verification

Generated PMX fixtures contain mixed BDEF/SDEF skinning, vertex morphs, three
direct bone morphs, a group-to-bone link and a UV morph. They include asymmetric
nonzero translations/rotations on two bones, shared bone targets, a negative
quaternion sign and a near-identity rotation. CPU tests compare rest, full and
intermediate weights and composed poses against a scalar Hamilton-product and
axis/angle reference. They exercise VMD bone rotation/translation plus vertex
and bone morph tracks, repeated zero updates, pause, seeking, looping, VPD,
absolute bone edits, disabling/re-enabling and real Ammo integration.

Browser CI compares direct and group-driven positions/normals per backend using actual
MMDLoader geometry, VMD animations and both helper modes. WebGL2 is mandatory;
native WebGPU runs when Chrome supplies an adapter. The existing SDEF suite
also retains surface, outline and shadow regressions. The viewer test uses
only generated PMX/texture fixtures; missing private models never fail CI.
The isolated npm consumer checks the released parser, bone morph payloads,
weight application/stability, disabling and public TypeScript declarations.
Human visual approval, third-party downloads, login and post-merge verification
are not required to complete Issue #28.
