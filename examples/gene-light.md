# Gene Light public showcase provenance

Rights review: 2026-10-14, for Issue #57, before adding public assets.

The selected source is [mmdagent-ex/gene at
c7eace43dffaccff6ad0597433ef85fa57c91e03](https://github.com/mmdagent-ex/gene/tree/c7eace43dffaccff6ad0597433ef85fa57c91e03).
Both original [English README](https://github.com/mmdagent-ex/gene/blob/c7eace43dffaccff6ad0597433ef85fa57c91e03/README.md)
and [Japanese README](https://github.com/mmdagent-ex/gene/blob/c7eace43dffaccff6ad0597433ef85fa57c91e03/README.ja.md)
were reviewed, including their License, Usage Guideline, and disclaimer sections.
They license all repository files under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
which permits attributed redistribution and adaptation with changes identified.
The author separately retains trademark and design rights, permits academic
and personal noncommercial use, and requests contact for other commercial use
(the Japanese notice also requests contact for other uses outside those categories).
This is not unconditional commercial permission and these assets are not MIT licensed.

The [maintainer's scope confirmation](https://github.com/takahirox/three-mmd-loader/issues/57#issuecomment-6160526383)
identifies this personally maintained open-source Pages showcase as a personal,
noncommercial technical demonstration. On that stated basis the selected public
use fits the published permission category. No additional permission or legal
opinion is asserted. A different use category requires a new review before
publication. Preserve the original guidelines: no harmful, deceptive,
rights-infringing, or unauthorized redistributions; no implication of author
endorsement. The complete guidelines and disclaimer remain in both original
READMEs, copied unchanged with the assets.

Required attribution:

CG-CA Gene (c) 2023 by Nagoya Institute of Technology, Moonshot R&D Goal 1 Avatar Symbiotic Society

Only `Gene_light.pmx`, its referenced `light/` PNGs, and both source READMEs
will be acquired for the public showcase. The public manifest is independent
of `scripts/model-sources.json`; no full Gene model, `tex/`, private catalog,
archives, or unrelated motion files are copied into Pages. Downloaded files
are unchanged. The demonstration animation and generated scene preview are
changes in presentation, not modifications of the source files.

## Verified public files

The exact allowlist, byte sizes, Git blob SHA-1s, and SHA-256s are recorded in
[`scripts/gene-light-manifest.json`](https://github.com/takahirox/three-mmd-loader/blob/main/scripts/gene-light-manifest.json).
`examples:assets` verifies cached/downloaded bytes; `build:examples` rechecks
all Gene files before copying them. Missing or changed model, texture, or
notice files fail clearly. Public paths are `examples/assets/gene-light/`.
The 13 files total **6,384,644 bytes** (~6.09 MiB):

- `Gene_light.pmx` (2,814,276 bytes).
- `light/arm.png`, `bottoms.png`, `extra.png`, `eye.png`, `eye2.png`, `face.png`,
  `hair2.png`, `iraira.png`, `pale.png`, `top.png` (ten unchanged PNGs).
- `README.md` and `README.ja.md` (unchanged source notices).

The PMX texture table references exactly those ten `light/` paths, with the
same spelling and case. Materials use indices 0–9; there are no external toon
or sphere texture files. The unused `light/eye_msk.png` and `light/eye_red.png`
are excluded. No VMD is shipped: the original TypeScript animation drives this
model's named bones through an `AnimationClip` and `MMDAnimationHelper`.
The original animation code is MIT licensed; the model and derived preview
retain Gene's separate rights and credit.

## Lightweight PMX inspection

Reproduce after `npm run examples:assets`:

```sh
node --import tsx scripts/inspect-gene-light.ts
```

This reads and verifies `Gene_light.pmx` itself with the released **mmd-parser
1.1.4** (`parsePmx(..., true)`), checks the hierarchy and exact texture allowlist,
and reports the [machine-readable inspection](./gene-light-inspection.json).
The browser test compares its output with the committed report. This is
independent of the previous full-Gene inspection in `docs/local-models.md`.

| Feature | Detected in the pinned lightweight PMX |
| --- | --- |
| Mesh | 28,646 vertices; 47,106 triangles; 13 materials |
| Bone hierarchy | 224 bones; 1 root; maximum depth 16; no invalid parents or cycles |
| IK | 6 chains, 8 links; knee and cloak angle limits present |
| Grants | 11 global rotation grants; 0 local/position grants |
| Physics phases | 186 before-physics bones; 38 after-physics bones; transformation classes 0/1/2 |
| Post-physics IK/grants | 0/0; post-physics flags are on hair/clothing/earring end bones |
| Bodies | 87: 25 type 0, 9 type 1, 53 type 2 (source modes) |
| Joints | 92 |
| Morphs | 184: 3 group, 177 vertex, 1 standard UV, 3 material, 0 bone, 0 additional-UV |
| Group links | 4 direct links, all to vertex morphs; no nested or bone-morph links |
| Skinning | BDEF1: 13,552; BDEF2: 10,178; BDEF4: 4,916; SDEF: 0 |
| Additional UV channels | 0 |

The runtime may apply the loader's existing joint compatibility conversion to
body modes; debug geometry and physics use the runtime's actual body parameters.
The page exercises both before/after-physics ordering through the existing
helper, without inventing post-physics IK/grants absent from the asset. No SDEF,
bone morph, additional UV, or nested-group support is claimed for this model.

## Using the demonstration

[Open the page](./webgl_loader_mmd_pmx_gene.html) or choose **PMX — Gene (Light)**
in the gallery (`#webgl_loader_mmd_pmx_gene`). The generated four-second motion
lifts the left foot target (IK), rotates `両目` and `左腕捩` (eye and arm grants),
and sways the torso (hair/clothing physics). Toggle animation, IK, grants,
physics, and outlines independently; show IK bones or rigid bodies to inspect
constraints and body modes. Drag to orbit and scroll to zoom. Open **Morph
weights** for Blink, Smile, Mouth A, Shout (group), Hide hair highlights (UV),
and Pale (material), each adjustable from 0 to 1 independently. The folder
starts closed to keep mobile controls compact; open controls scroll within the
standard mobile GUI.

`examples/screenshots/webgl_loader_mmd_pmx_gene.jpg` is a locally rendered
400×250 preview of this exact permitted scene. It retains the model credit
above and in the gallery's linked terms. To regenerate after building:

```sh
GENE_CAPTURE_PREVIEW=1 node --import tsx --test tests/browser/gene-light.test.ts
```

This changes the camera/framing for the preview and captures the rendered
canvas; it does not use an unrelated image or modify the downloaded assets.

## Verification status

Pre-merge validation runs locally on the worktree and project-prefixed static
artifact. It needs no deployment, isolation headers, or manual visual sign-off.
See `docs/gene-light-validation.md` for the recorded check results.

**Required post-merge publication verification: PENDING.** After merge, record
successful Pages workflow, deployment URL/commit/date, gallery link, all public
PMX/texture/notices URLs, and error-free startup. Publication failures are
follow-ups; this record is not a pre-merge gate. Optional maintainer visual
inspection is also a follow-up, not a merge requirement.
