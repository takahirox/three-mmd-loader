# PMX group morph playback

PMX type 0 groups support direct **type 1 vertex**, **type 2 bone** and **type 8 material** targets
with the released `mmd-parser ^1.1.4`. The loader keeps every original morph
name/index in `morphTargetDictionary` and `morphTargetInfluences`, including
unsupported types. VMD name lookup and interactive sliders use those same
public weights.

```ts
const helper = new MMDAnimationHelper();
helper.add(mesh, { physics: false });
mesh.morphTargetInfluences[mesh.morphTargetDictionary['fold-all']] = 0.5;
helper.update(0);
```

Each direct target's effective weight is its own weight plus the sum of
`group weight × element ratio` from all direct group links. Repeated links
and shared targets add; contributions are not clamped. Bone target offsets
compose in original target morph order, then element order, using the existing
[bone morph rotation convention](bone-morphs.md). Effective bone weights are
computed fresh for every helper pass and never overwrite the public weights.
The existing controller applies them once after animation and before IK,
grants and physics, in ordinary and `pmxAnimation: true` modes. Disabling
`boneMorph` removes both direct and group bone offsets while vertex morphs
continue to work. Keep calling `helper.update(0)` for static slider changes.

Vertex links retain the loader's baked group position target: it contains
only the sum of direct vertex offsets multiplied by their ratios. Three.js
adds that target at the original group weight, alongside direct vertex targets,
before BDEF/SDEF skinning. The bone controller never replays these vertex links
or changes their weights, so each displacement applies exactly once, including
when no helper is attached. SDEF centers/radii remain unchanged.

## Compatibility and unsupported references

Group-to-group references are **ignored**, including self-references and
cycles. A nested group can still be activated by its own public weight; a
parent does not activate it. Other valid direct links in the same parent still
apply. This follows the MMD compatibility policy in
[babylon-mmd's group evaluator](https://github.com/noname0310/babylon-mmd/blob/master/src/Runtime/mmdMorphControllerBase.ts)
and its [0.45.0 changelog](https://github.com/noname0310/babylon-mmd/blob/main/CHANGELOG.md).
No recursive traversal occurs. Negative, noninteger and out-of-range morph
indices and nonfinite ratios are ignored. UV (type 3) and additional UV (4–7)
use the [UV evaluator](uv-morphs.md) and its independent `uvMorph` toggle.
Type 8 targets use the [material morph evaluator](material-morphs.md)
and its independent `materialMorph` feature toggle. Other unimplemented targets remain unsupported.

The loader exposes original group references for diagnostics, without removing
ignored links, in `mesh.geometry.userData.MMD.groupMorphs`:

```ts
interface MMDGroupMorph {
  index: number;
  name: string;
  elements: {
    index: number;
    ratio: number;
    type: number | null; // null for an invalid target index
    name: string | null;
  }[];
}
```

## Optional private real-model viewer

Run `npm run dev:sdef` and open `http://127.0.0.1:8081/local-sdef/` (add
`?webgl` to force WebGL2). The existing SDEF and direct bone views remain
available. For groups:

1. Obtain a PMX legitimately and review its actual archive README/license
   locally. Extract it under Git-ignored `examples/assets/private/group-morph/`,
   keeping relative texture filenames and subdirectories.
2. Select **group-morph/**, enter its relative PMX path and click **Load PMX**.
   Diagnostics list actual parsed group names/indices, reference target
   names/indices/types and ratios. Bone links are highlighted and list target
   bones. A model without group-to-bone links shows an explicit diagnostic.
3. Select a group and move **Group weight** through 0 → 0.5 → 1 → 0. Select a
   **Direct group target** and adjust its weight separately for comparison.
   Selection preserves weights; **Reset pose** clears all weights and restores
   rest bones. The separate direct bone controls and SDEF comparison still work.
4. Optionally enter a compatible private VMD relative to the selected directory.
   Playback updates the same group weights. Moving a slider stops playback;
   **Stop motion** resets pose and weights. Static inspection disables IK, with grants off by default;
   **Apply PMX grants** enables grant inspection. Playback enables IK/grants,
   with physics disabled.

The creator's [DONburi Room cardboard box ver.1.1a distribution description](https://donburiroom.blog8.fc2.com/blog-entry-153.html)
identifies `たたむ全` as a group combining folding and lid/bottom bone morphs.
The viewer selects that name when present. This description is a candidate,
not verification of the actual PMX bytes. No third-party model, textures,
archive, README/license, screenshot or motion was acquired for this change.
A future optional inspection must record the observed group/target types and
names and review the actual license; modification/use permission does not
establish redistribution permission.

The server remains loopback-only, checks realpath containment and permitted
extensions, and refuses archives/licenses and paths outside the selected
private directory. Private assets and the viewer are excluded from npm packs,
public builds and Pages manifests/routes. Existing public models, motions,
screenshots, asset manifest and URLs are unchanged.

## Automated checks

Generated PMX bytes parsed by the installed release include nonzero asymmetric
vertex/bone data, fractional/negative ratios, repeated/shared targets, nested
and cyclic groups, invalid links and UV targets with absent extra channels (UV targets are supported by Issue #35). Explicit
CPU equations and scalar quaternion calculations compare direct, group,
combined and multiple-group weights at 0, 0.5, 1 and reset, including actual
bones and BDEF positions. Playback checks cover VMD, static changes, repeated
zero updates, pause/stop/restart, seeking, looping, pose reset, feature toggles
and helper transfers in both helper modes. Ammo checks include group-driven
kinematic bodies and dynamic overrides. Browser rendering compares actual
BDEF/SDEF positions and normals with the independent CPU reference on WebGL2
and native WebGPU when an adapter is available; existing outline/shadow
regressions remain. Viewer checks use generated PMX, textures and VMD only.

Missing private models cannot fail CI. Human visual approval, licensed-model
acquisition and post-merge verification are not required for Issue #31.
Issue #30 remains a separate optional follow-up.
