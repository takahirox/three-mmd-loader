# Opt-in local MMD models

After `npm ci`, install the permitted original Gene model with one explicit command:

```sh
npm run models:setup -- gene
npm run dev:sdef
```

Open `http://127.0.0.1:8081/local-sdef/` (add `?webgl` for WebGL2). Choose
**Gene** in **Installed models**, review **Selected model notices**, then click
**Load PMX**. **Refresh local models** discovers newly installed files without
restarting the server or editing HTML/TypeScript. The picker fills both the PMX
and an available VMD path; **Play local motion** uses the selected local motion.
SDEF, bone, group, material, UV, grant and physics controls remain available.
Turn on **Ammo physics** to inspect bodies, then step/pause/reset as needed.
A model's parsed feature presence is not a visual correctness result.

Existing manually arranged private directories and relative path inputs still
work. Already installed PMX assets from `npm run examples:assets` also appear
under **Already installed examples/**, without downloading or copying them.
Their existing terms apply separately. The viewer only listens on loopback.

## Automatic source catalog

```sh
npm run models:setup -- --list
npm run models:setup -- gene --offline
```

Only catalog IDs are accepted. Arbitrary URLs, credentials, mutable revisions
and protected sources have no automatic download route. Nothing in install,
test, public builds, Actions or Pages invokes these commands.

| Source | Reviewed origin/revision | Terms | Parsed feature categories |
| --- | --- | --- | --- |
| `gene` — CG-CA Gene | [Author repository](https://github.com/mmdagent-ex/gene), commit [`c7eace43dffaccff6ad0597433ef85fa57c91e03`](https://github.com/mmdagent-ex/gene/commit/c7eace43dffaccff6ad0597433ef85fa57c91e03), reviewed 2026-10-09 | CC BY 4.0 for files; additional trademark/design rights and upstream usage guidelines apply | Material morph, UV0 morph, grants, physics layers present; SDEF, bone morph and group→bone/material/UV links not demonstrated |

The [private source manifest](../scripts/model-sources.json) pins `Gene.pmx`,
all 12 original `tex/` files, English/Japanese READMEs and 40 sample VMDs
(55 files, 63,911,451 bytes total). Each path has its exact case, size and Git
blob SHA-1. The downloader uses commit-specific `raw.githubusercontent.com`
URLs, refuses redirects, bounds each response and verifies size and Git blob
hash before caching or installing. The full original model directory and
notices remain intact. No light model or unrelated substitute is downloaded.

The pinned author's [README](https://github.com/mmdagent-ex/gene/blob/c7eace43dffaccff6ad0597433ef85fa57c91e03/README.md)
requires Gene attribution to Nagoya Institute of Technology and Moonshot R&D
Goal 1 Avatar Symbiotic Society. The exact credit is printed during setup and
preserved in the downloaded README. Academic and personal non-commercial use
of the trademark/design is permitted; other commercial use requires author
contact. The upstream usage guidelines also apply. These notices do not grant
rights to other models or imply unrestricted commercial use of Gene.

Inspection of the verified Gene PMX with released `mmd-parser 1.1.4` found:

- SDEF: 0 vertices; morph type counts 0–8: `[3,177,0,1,0,0,0,0,3]`.
- No group→bone/material/UV links; no additional UV channels or `envFlag=3` materials.
- 11 grants; 186 pre-physics and 38 post-physics bones.
- Rigid body modes 0–2: `[25,9,53]`; 40 VMD candidates in the same source bundle.

Setup and the picker re-inspect the actual PMX. Reports include raw grant flags,
group link types/ratios, all morph counts and absent categories explicitly marked
**not demonstrated**. Gene does not replace the specialized YYB or other visual
check candidates. No maintainer visual approval is claimed; Issue #30 remains
separate and open.

## Manual acquisition and safe local import

YYB式初音ミク 10th, DONburi Room cardboard box/autogroove, vinyl umbrella,
wire rope, PAC clock tower and 天月りよん distributed via BowlRoll or other
restricted/passworded destinations are **manual-only**. Follow the creator's
original distribution instructions and terms. BowlRoll's [rules](https://bowlroll.net/about/rules)
prohibit automated collection without permission. There is no scraper, login
bot, cookie/password handling, CAPTCHA workaround or direct-endpoint bypass.

After permitted manual acquisition, import a local ZIP or extracted directory:

```sh
npm run models:import -- /path/to/model.zip --category sdef
npm run models:import -- /path/to/model-directory --category group-morph
```

Categories: `sdef`, `bone-morph`, `group-morph`, `material-morph`, `uv-morph`,
`grant`, `physics-layers`. A category is an organizational label, never a claim
that the model contains that feature. The importer preserves nested texture
paths, Unicode filenames, case and original text notices, finds all PMX files,
checks parsing and texture dependencies, and prints notices for local review.
The installed model picker displays terms relevant to the model's directory.
No license is inferred if terms are absent. Nothing is uploaded or rehosted.

ZIP supports stored/deflate data, UTF-8 and legacy Japanese CP932 filenames,
including Windows separators. It rejects traversal, absolute paths, symlinks,
special files, executable permissions/content, duplicate or case/Unicode
collisions, malformed/overlapping boundaries, CRC errors, encrypted/multi-volume
archives and ZIP64. Directory imports reject links and executable files too.
Allowed content is PMX/PMD, VMD/VPD, raster textures/sphere maps and text notices;
HTML, scripts, executables and nested archives are rejected. If an archive also
includes unsupported extras, use a local directory containing only the model,
its required textures/motions and text notices, preserving their relative layout.

Limits: 4,096 entries, 64 MiB per file, 256 MiB total expanded data, 128 MiB ZIP
input, expansion ratio 200:1 and path depth 32. Bounds and integrity checks run
before extraction; installation is staged and rolls back a failed replacement.
Invalid PMX, missing textures or unsafe imports leave existing bundles intact.

## Storage, reruns and troubleshooting

Installed bundles live at `examples/assets/private/models/gene/` or a deterministic
`import-<category>-<content-hash>/`. The verified hash cache is
`examples/assets/private/.cache/`. Identical installs preserve files and their
modification times; an offline rerun can reconstruct a deleted install from
verified cache, or repair cache from a verified installed copy. Cached bytes are
always checked again. Commands serialize through `.models-lock`; after a crash,
confirm no command is running before removing a stale lock/staging directory.

Source-specific network/integrity errors stop installation without silently
substituting another PMX. Retry explicitly online, or use `--offline` if the
pinned bytes are available. If the source is unavailable/unverifiable, use the
viewer's **Generated UV**, **Generated Grant**, or **Generated Physics layers**
fixtures. They work offline and require no third-party download.

All assets/cache/staging files are Git-ignored. npm's package file allowlist and
the public example/Pages manifest exclude this entire private area, its archives,
notices, screenshots and viewer. CI artifacts contain only existing allowlisted
outputs. The public asset manifest, models, motions and URLs are unchanged.

To refresh a source, explicitly review the author's pinned revision, permission,
terms, Git tree and model/texture dependencies; update every size/hash and notice
path in the private manifest, fetch and inspect that exact revision, and update
the catalog evidence/tests. Never refresh from mutable `main` implicitly. New
automatic entries require clear creator authorization and an expressly permitted
programmatic source. Passworded/approval-gated destinations remain manual-only.
