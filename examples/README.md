# Browser examples

These scenes follow the model/animation, audio/camera, and VPD pose examples
from [Three.js r171](https://github.com/mrdoob/three.js/tree/r171/examples).
They import compiled MMD modules from this checkout's `dist/` directory through the
`@takahirox/three-mmd/` import map. Only retained Three.js utilities such as
OrbitControls and lil-gui come from `three/addons`. MMD shading uses TSL
`MMDToonMaterial` and per-material inverted hulls use `MMDOutlineEffect` from
this package. `WebGPURenderer` comes from `three/webgpu`. The
`mmd-parser` import map points to the installed dependency's native ESM build
at `../node_modules/mmd-parser/build/mmdparser.module.mjs`. The local server
serves this artifact, and the static build copies it and its license at the
same relative paths.

The pages use a full-viewport canvas, the standard Three.js `#info` overlay,
and lil-gui controls. Their shared `common.css` imports an unmodified copy of
the official `examples/main.css` (Git blob
`d496122b4cfb54f811495bd9f80ca48151beeb3b`) and applies the official MMD
examples' white background and blue links. On narrow screens, the standard
stylesheet moves the GUI to the bottom left so it remains usable.

The index is a small examples browser: categorized screenshot cards in a fixed
left panel load the chosen demo into the right viewer. Links such as
[`#webgl_loader_mmd_pose`](./#webgl_loader_mmd_pose) restore the selected demo;
browser Back/Forward restores earlier selections. Below 640px, the header's
menu button opens a sliding panel. Selecting a demo, the Close button, clicking
the scrim, or pressing Escape closes it. With no selection, the viewer explains
how to choose a demo and the mobile list opens initially.

`browser.css` adapts the relevant layout, typography, cards, spacing, and
light/dark colors from the Issue #14 references: Three.js `examples/index.html`
(blob `7b53cc789e644957e4b3bc8f9ca21b9ca81e5f06`) and `files/main.css`
(blob `eab4263a7a7570bb433cab3048d5735d4782f673`). It is separate from the demo
stylesheets. The four Miku previews in `screenshots/` replace the original
official r171 screenshots with local captures of this checkout's real
model/animation, audio/camera, pose, and Worker scenes with ambient color
`0xAAAAAA` and white directional light, both at intensity 1, updated for Issue #100.
Their model, texture, motion, camera, and pose sources are pinned to the same
Three.js commit as the assets below. They depict the credited Miku character
and retain the applicable character/asset terms; they are not MIT licensed
and do not relicense the models. The
Roboto Mono fonts in `fonts/` also come from that pinned commit and include
their Apache 2.0 license. All browser assets are local and copied to the static
build, so previews and typography need no external requests.

The public examples URL is **https://takahirox.github.io/three-mmd-loader/**.
Updates to `main` automatically build and publish these same scenes to GitHub
Pages and verify the public deployment. See [Deployment](#deployment) for the
workflow and its automated configuration.

## Local development

From the repository root, using Node.js 20 or newer:

```sh
npm ci
npm run examples:assets
npm run dev
```

Open **http://127.0.0.1:8080/** and choose a scene. Set `PORT=8081 npm run dev`
to use a different port. The server binds to loopback and serves the examples
and their dependencies. The `predev` hook compiles the package and browser
TypeScript; Three.js, mmd-parser, Ammo, and assets are served locally. After editing
TypeScript, run `npm run build` to refresh the served modules. Use the HTTP server rather than opening HTML
files directly. Stop it with Ctrl+C.

| Page | Demonstrates |
| --- | --- |
| [`webgl_loader_mmd_worker.html`](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd_worker.html) | **Worker Physics**: the same model, motion, camera, rendering, and controls as Model and animation, requesting Worker physics by default. |
| [`webgl_loader_mmd.html`](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd.html) | **Model and animation**: `MMDLoader.loadWithAnimation`, VMD bone/morph animation, IK, synchronous Ammo physics, outlines, and debug helpers. Toggle animation, IK, physics, and outlines independently. |
| [`webgl_loader_mmd_pmx_gene.html`](./webgl_loader_mmd_pmx_gene.html) | **PMX — Gene (Light)**: generated foot/torso/eye/arm animation, IK, grants, synchronous physics including type 2, vertex/group/UV/material morph sliders, outlines and debugging. |
| `webgl_loader_mmd_audio.html` | Model motion, `loadAnimation` camera motion, and `AudioLoader` music synchronized by `MMDAnimationHelper`. Wait for loading, then press Play to unlock audio. The music starts 160 frames (5.33 seconds) into the dance, matching the original example. |
| `webgl_loader_mmd_pose.html` | `loadVPD` and `MMDAnimationHelper.pose`, with eleven Shift_JIS poses and a rest pose. Disable IK for poses 9 and 10 as described by their author. |

## PMX — Gene (Light)

Select **PMX — Gene (Light)** in the gallery
([unique hash](./#webgl_loader_mmd_pmx_gene)) or open its standalone page.
This personal noncommercial technical showcase uses the author-published
`Gene_light.pmx` and exactly ten referenced light textures, pinned at
`c7eace43dffaccff6ad0597433ef85fa57c91e03` from
[mmdagent-ex/gene](https://github.com/mmdagent-ex/gene/tree/c7eace43dffaccff6ad0597433ef85fa57c91e03).

CG-CA Gene (c) 2023 by Nagoya Institute of Technology, Moonshot R&D Goal 1 Avatar Symbiotic Society

Model, textures, original notices, and the locally generated Gene scene preview
retain [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) rights, separately
from this package's MIT license. Source files are unchanged; the animation and
preview presentation are generated locally. No VMD is included.
The author separately retains trademark/design rights, permits academic and
personal noncommercial use, and asks for contact regarding other commercial
use. Do not infer unrestricted commercial permission. Preserve the usage
guidelines and disclaimer in the unchanged [English](./assets/gene-light/README.md)
and [Japanese](./assets/gene-light/README.ja.md) source notices.

The [provenance and inspection record](./gene-light.md) documents the pre-merge
rights review, exact asset selection, and measured lightweight PMX features.
Use the animation/IK/grant/physics/debug toggles and open **Morph weights** for
vertex, group, UV, and material sliders. The asset has no SDEF or bone morphs.
The Issue #102 preview is a rendering of this permitted scene, with
credit above;
it is separate from the four Miku previews and retains CC BY 4.0 attribution.

`npm run examples:assets` acquires and integrity-checks the public allowlist;
`npm run build:examples` rechecks every Gene model/texture/notice file. The
private full-Gene catalog is unchanged and remains excluded from Pages.
**Post-merge publication verification is PENDING**, tracked in
[the verification record](https://github.com/takahirox/three-mmd-loader/blob/main/docs/gene-light-validation.md); it never blocks
pre-merge checks.

## Worker Physics and comparison

Open [Worker Physics directly](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd_worker.html)
or select **Worker Physics** in the gallery
([direct gallery selection](https://takahirox.github.io/three-mmd-loader/examples/#webgl_loader_mmd_worker)).
No query parameter or interaction is needed to request Worker mode. The
[Model and animation page](https://takahirox.github.io/three-mmd-loader/examples/webgl_loader_mmd.html)
requests synchronous physics. Each page's entry point fixes its initial mode;
choose the corresponding gallery example to select sync or Worker execution.
There is no per-page mode selector, and stray `?physicsMode=...` parameters are
ignored. Both pages call the same shared scene setup, load the same Miku model
and WAVEFILE motion, and preserve animation,
IK, physics, outlines, and debug controls, including **show rigid bodies**.

The status waits for initialization, then shows the actual backend and transport:
`worker / shared` on supported isolated origins, or `worker / transferable` when
SharedArrayBuffer is unavailable. No COOP/COEP headers are required; GitHub Pages
can use transferable buffers. The bundled classic Worker loads Ammo from the
same local dependency URL. Main-thread Ammo is initialized for the existing
fallback contract: Worker loading, initialization, or runtime failures terminate
the Worker and rebuild synchronous physics. The status then shows `sync` with a
persistent **Worker fallback** diagnostic, rather than claiming Worker is active.
If fallback itself cannot initialize, the page reports an error.

Compare the two pages on the same device, renderer backend, scene, and settings.
Allow assets, shaders, and physics to warm up first. The status measures mean
main-thread `helper.update` time over each reporting interval. Worker computation,
rendering, and end-to-end latency are outside that measurement; a lower helper
update time is **not an FPS guarantee**. No manual performance gain is claimed.

Drag to orbit and scroll to zoom in the animation and pose scenes. The audio
scene uses its animated camera. Failed asset requests are reported on the page
with the setup command. Scenes select WebGPU when available and fall back to
WebGL2 through the same TSL backend architecture. Append `?backend=webgl` to
any scene URL to exercise WebGL2 explicitly. Loading requires WebGPU or WebGL2;
audio playback also needs browser audio support.

## Assets and credits

### Gallery thumbnail capture

All five gallery cards use local **400×250 JPEG** captures from their real
example pages. Issue #102 selects `new AmbientLight( 0x888888, 1 )` and
`new DirectionalLight( 0x888888, 1 )` explicitly for `mode === 'gene'`.
These are 24-bit RGB grays, decoded by Three into linear working colors.
All four Miku PMD pages retain Issue #100's ambient `0xAAAAAA` and white
directional `0xffffff`, both at intensity **1**. Directional position/target,
cameras and other scene settings are unchanged. Only Gene's preview is refreshed;
the Miku JPEGs and their original capture entries remain unchanged.

This is a demo light-color trial. The [material and rendered contribution
investigation](https://github.com/takahirox/three-mmd-loader/blob/main/docs/gene-light-overbrightness-investigation.md) records measured
causes and remaining uncertainty. It does not establish native MMD parity or
claim that changing lights repairs library shading. The maintainer will judge
the published visual result; no aesthetic sign-off is a pre-merge gate.

| Page / mode | Ambient color / intensity | Directional color / intensity | Preview |
| --- | --- | --- | --- |
| Model and animation / `animation` | `0xAAAAAA` / 1 | `0xffffff` / 1 | Retained from #100 |
| Worker Physics / `animation` | `0xAAAAAA` / 1 | `0xffffff` / 1 | Retained from #100 |
| Audio and camera / `audio` | `0xAAAAAA` / 1 | `0xffffff` / 1 | Retained from #100 |
| Poses / `pose` | `0xAAAAAA` / 1 | `0xffffff` / 1 | Retained from #100 |
| PMX — Gene (Light) / `gene` | `0x888888` / 1 | `0x888888` / 1 | Refreshed for #102 |

Camera positions, lighting direction, materials, outlines, and renderer tone
mapping remain those of the examples. The corrected MMD material/shading
implementation is unchanged. These captures do not establish visual
equivalence to MikuMikuDance.

From the repository root with dependencies and Chrome installed:

```sh
npm run examples:capture -- --gene
```

Set `CHROME_BIN` if Chrome is outside the platform's usual install path. The
`--gene` command refreshes only Gene (omit the option to recapture all five). It
compiles the checkout, obtains the pinned real assets using
`examples:assets`, and runs `scripts/capture-example-thumbnails.ts` against a
temporary loopback server. It verifies every Miku Git blob and every Gene
hash before loading; `MMD_EXAMPLE_FIXTURES=1` is rejected. No fixture or private
model is used. Nothing is downloaded from a different source on failure.

The browser uses WebGL2 through Chrome SwiftShader, a 400×250 viewport, pixel
ratio 1, and JPEG quality 0.9. It stops the live render loop, resets the motion
and physics, then samples two seconds at 1/60-second steps with IK, physics,
and outlines enabled. Worker steps are awaited and sync fallback fails capture.
Audio/camera uses its authored VMD camera and dance at two seconds, before the
music's 5.33-second delay; Poses selects KEITEL's **Pose 1** with IK enabled.
Gene uses its locally authored demonstration animation at two seconds.
Only the canvas is encoded, so controls and text are outside the image.
All captures must pass readiness, model, light, camera, rendering, backend,
and runtime-error checks before any image is replaced.

[`screenshots/manifest.json`](./screenshots/manifest.json) records the capture
date, browser, asset source commits, current scene source hash, per-mode light
colors and intensities, frame/pose state, checks, and image SHA-256s. Each entry
records its own capture date, browser and scene hash. Retained Miku entries keep
those original values; `retainedSceneReview` identifies the current source and
explains the Gene-only change. Tests prove the old and current source differ only
in the two Gene color selections. Gene records the replaced #100 image hash;
Miku retains its original replaced white-ambient hashes.
The method reproduces the scene state; JPEG bytes can vary with browser/platform
versions. Automated tests verify all five gallery references, image hashes,
current scene provenance, and decoded 400×250 dimensions in the browser. The static build
copies the images and manifest; the npm package excludes example assets.

Miku images derive from the credited Three.js r171 MMD assets below: model
and eye texture from MMD / Yu Higuchi, character © Crypton Future Media;
WAVEFILE motion by hino; the audio card's camera by doramata, customized by
Takahiro; and Pose 1 by KEITEL. The audio example also uses LamazeP's music,
which is not embedded in the JPEG. These captures replace upstream-derived
previews and preserve the character guidelines and individual asset terms,
separately from the repository's MIT code license. Gene's rendering
is a derivative presentation of the unchanged CC BY 4.0 Gene Light model and
textures, with the credit and separate usage conditions above. Neither image
set asserts author endorsement or grants additional character/asset rights.

Issue #100's required post-merge Tests/Pages workflow and deployed-scene verification is
**PENDING**; see [the validation record](https://github.com/takahirox/three-mmd-loader/blob/main/docs/examples-gray-ambient-validation.md).
It is not a pre-merge gate.

### Miku asset sources

The Miku PMD/VMD/audio/pose assets described in this section are **not covered by this repository's MIT license** and are
not committed or included in the npm package. Consult the upstream
[asset license summary](https://github.com/mrdoob/three.js/blob/r171/examples/models/mmd/Readme.txt)
and each author's original archive and terms before using them. The setup
command retrieves the original r171 example copies for local use, together
with all their license/readme files. It does not grant redistribution or
commercial-use rights.

The download is pinned to Three.js commit
`2898f5b1ba10b1e94174c0a62d072f5f7b80442c`. The manifest records Git blob hashes;
the script verifies each file, reuses matching local files, and reports HTTP
or integrity failures. The setup writes only Git-ignored `examples/assets/mmd/`
and the separate public `examples/assets/gene-light/` allowlist described above. Downloading needs network access; afterward, the examples
can run offline.

For manual setup, obtain the
[r171 archive](https://github.com/mrdoob/three.js/archive/2898f5b1ba10b1e94174c0a62d072f5f7b80442c.zip)
and copy its complete `examples/models/mmd/` directory, including notices, to
this repository's `examples/assets/mmd/`. The required layout is:

```text
examples/assets/mmd/
  LICENSE, Readme.txt
  miku/miku_v2.pmd, eyeM2.bmp, readme*.txt
  vmds/wavefile_v2.vmd, wavefile_camera.vmd, readme*.txt
  audios/wavefile_short.mp3, readme.txt
  vpds/01.vpd ... 11.vpd, readme.txt
```

| Asset | Source/credit | Local notices |
| --- | --- | --- |
| Miku v2 PMD and eye texture | Bundled MikuMikuDance model; [MMD / Yu Higuchi](https://sites.google.com/view/evpvp/), character © Crypton Future Media | `miku/readme.txt`, `miku/readme_miku_v2.txt` |
| WAVEFILE dance | [hino](https://www.nicovideo.jp/watch/sm13147122) | `vmds/readme_wavefile.txt` |
| WAVEFILE camera | [doramata](https://www.nicovideo.jp/watch/sm19168559), customized by Takahiro | `vmds/readme.txt`, `vmds/readme_wavefile_camera.txt` |
| WAVEFILE short music | [LamazeP](https://www.nicovideo.jp/watch/sm11938255) | `audios/readme.txt` |
| Eleven shooting poses | [KEITEL](https://seiga.nicovideo.jp/seiga/im5162984) | `vpds/readme.txt` (Shift_JIS) |

Preserve the downloaded notices. These assets have individual usage conditions;
the upstream summary also links to the character guidelines. The examples use
the pinned official Bullet WASM build in `vendor/bullet/` by default. The static
site ships its `ammo.js`, `ammo.wasm`, manifest and all license notices unchanged.
The same optional assets ship in the npm package at `dist/vendor/bullet/`.
`ammojs-typed@1.1.0` and its license remain on the Examples site solely for
explicit rollback with `?bullet=legacy`. Pages and the local server serve
the selected binary on the same origin, including under `/three-mmd-loader/`.
`ammo-runtime.ts` awaits explicit WASM instantiation before creating physics,
checks that Ammo uses that instance's exports, and reports HTTP, compile or
10-second timeout failures. Worker factory binary URLs resolve relative to
the supplied glue URL. A Worker failure falls back to the initialized main-thread
WASM runtime; a main-thread initialization failure displays an error and stops
setup. There is no asm.js fallback in the Examples.

Changing the default backend does not establish improved stability,
visual fidelity or universal speed. All five gallery JPEGs are captured
with the default WASM runtime; these captures do not establish WASM/asm.js
visual or motion parity.
See [consumer initialization and CSP](https://github.com/takahirox/three-mmd-loader/blob/main/README.md#optional-worker-physics) and
[current validation evidence](https://github.com/takahirox/three-mmd-loader/blob/main/docs/bullet-default.md).

## Deployment

The workflow is [`.github/workflows/examples-pages.yml`](https://github.com/takahirox/three-mmd-loader/blob/main/.github/workflows/examples-pages.yml).
It uses GitHub Actions to build a static site and GitHub Pages to host it.
Bootstrap the repository with the agent/integration's existing repository
authorization, before the workflow first runs on `main`:

```sh
GITHUB_REPOSITORY=takahirox/three-mmd-loader npm run setup:pages
```

The script reuses `GH_TOKEN`, `GITHUB_TOKEN`, or the authenticated GitHub CLI
credential in memory. It enables Pages with the Actions source, configures the
workflow-owned `github-pages` environment to allow only `main`, removes required
reviewers, wait timers, and custom approval rules, and reads back the settings.
It is idempotent, including recovery from interrupted setup. No credential is
printed or copied into a repository secret. This repository has been configured
using the available CLI authorization; no separate secret provisioning or human
confirmation is required. Bootstrap requires repository administration access
(classic OAuth `repo` scope, or Pages and Administration write permissions).
See the [Pages API permissions](https://docs.github.com/en/rest/pages/pages#create-a-github-pages-site)
and [environment API permissions](https://docs.github.com/en/rest/deployments/environments#create-or-update-an-environment).

On every `main` deployment, the `setup` job runs `node --import tsx scripts/setup-pages.ts --check`
with the automatic `GITHUB_TOKEN` and read permissions for Pages, Actions, and
Deployments. It verifies configuration before entering the environment, without
administration writes or a setup secret. Configuration drift fails before
publication and produces JSON evidence; the bootstrap command can reconcile it
using the existing repository authorization. Normal publication and all rollback
paths use only the workflow token's Pages write and OIDC permissions.

For every push to `main`, the workflow installs the lockfile dependencies with
`npm ci`, runs `npm test`, and runs `npm run build:examples`. That build command
downloads and verifies the pinned assets using the existing asset manifest,
then copies the existing pages, compiled `dist/` modules, Three.js, mmd-parser, and Ammo
runtime dependencies, and all asset/license notices to `dist/examples/`.
It does not bundle or build a second implementation of the scenes. The static
site uses relative URLs so it works under the repository's Pages path. A
`deployment-manifest.json` records the full checkout commit and SHA-256 hashes
of every published file, including pages, addon/runtime modules, and assets.

Headless Chrome then tests the **built artifact** at `/three-mmd-loader/`,
including rendering, animation, physics, audio, and poses. Only after all these
steps succeed is the site uploaded and the dependent deployment job run.
A failed dependency install, asset download/integrity check, build, or test
prevents deployment and leaves the currently published site in place.
Before publishing, `scripts/verify-pages.ts` downloads and checks every file of
the current public site against its manifest, including the root and examples
landing URLs. It packages this verified snapshot as a rollback Pages artifact.
An unavailable, incomplete, or unrecognised existing site blocks publication
instead of proceeding without a usable backup. A workflow Pages site may
start without a backup only when Pages status and the complete Actions
deployment/status history show no prior publication or active deployment.
This also lets a later run recover when initial setup was interrupted after
Pages creation. Unknown history and prior successful or inactive deployments
cannot bypass the backup requirement. Legacy Pages settings do not authorize
an empty-site retry.

After `deploy-pages` reports success (it polls the Pages deployment status),
the workflow checks the public manifest against the exact candidate commit
and manifest, then checks HTTP 200 responses and hashes for every file and both
landing URLs. These are the same bytes that passed the browser checks before
publication. Checks bypass caches and retry CDN propagation six times with
ten-second delays. A deployment error or failed public validation restores the
snapshot automatically and verifies its public contents and previous commit.
A failed first publication restores a minimal recovery artifact whose root,
examples landing URL, and scene URLs return HTTP 404. Its manifest marks the
site as `unpublished`; verification checks the recovery files' hashes and the
404 responses. This avoids requiring administration permission to delete Pages.
Later runs can back up this verified recovery site and retry publication.
A rejected
candidate leaves the workflow failed even if rollback succeeds. Restoration
also depends on GitHub Pages and its API being available; any rollback failure
is reported as a failed workflow with evidence.

Download `pages-setup-evidence` and `pages-deployment-evidence` from the Actions
run for JSON configuration, backup, deployment, and rollback results. Public
verification records the action result, public URL, expected commit, workflow
run ID, HTTP/hash checks, attempts, and errors. This automated evidence is the
completion check; no human browser verification is required.
Deployments are serialized without cancelling an in-progress run.
Pull requests targeting `main` run the same build and validation without
deploying. The workflow also supports **Actions → Deploy browser examples →
Run workflow**; select `main` to redeploy. Other branches cannot deploy.
The deployment job reports the published URL in the `github-pages` environment.

To reproduce the deployment build and validation locally:

```sh
npm ci
npm test
npm run build:examples
MMD_EXAMPLE_SITE=dist/examples npm run test:examples
```

The last command requires Chrome and supports `CHROME_BIN`. Serve
`dist/examples/` with any static HTTP server to preview the site. Its root
redirects to `examples/`; no Node.js server is needed by the hosted site.
The build output and downloaded assets are Git-ignored, and the npm package
continues to contain only the standalone addon and its notices.
The deployed assets retain their individual terms described above; deployment
does not relicense them. The site includes the
[asset license summary](assets/mmd/Readme.txt), all author readmes, and runtime
licenses.

## Automated validation

### Default official Bullet WASM

All physics scenes use official Bullet commit
`d3afe76132fc76b0f9b2359cbaef47a3766e7fbb` without a query parameter,
including PMD Sync, Worker, audio and Gene Light PMX. The engine selector has
been removed. `?bullet=legacy` explicitly restores `ammojs-typed@1.1.0` WASM;
remove it to return to the default. Existing `?bullet=master` and
`?bullet=default` links also use the new build. Physics parameters and
animation code are unchanged. Initialization failures stop setup with a
diagnostic; Worker recovery retains the selected main-thread engine.

After `npm ci && npm run dev`, open
`http://127.0.0.1:8080/examples/webgl_loader_mmd.html`,
`http://127.0.0.1:8080/examples/webgl_loader_mmd_worker.html`, or
`http://127.0.0.1:8080/examples/webgl_loader_mmd_pmx_gene.html`.
Check `Ammo.bulletCommit`, `Ammo.getWasmExports()` and
`document.body.dataset.bulletBackend` in DevTools.
[Verification, rollback and pending hosted checks](https://github.com/takahirox/three-mmd-loader/blob/main/docs/bullet-default.md)
are documented separately. Rebuild with `npm run build:bullet` (Docker and Git
required); [source/toolchain pins and historical measurements](https://github.com/takahirox/three-mmd-loader/blob/main/docs/bullet-experiment.md)
remain available. Trajectories differ from old Bullet; intermittent 120 FPS
oscillation has not been reproduced or shown fixed.

```sh
npm test
npm run test:browser
```

`npm test` checks the reference stylesheet's Git blob hash and shared stylesheet
links, and verifies that the static build includes the pages, both stylesheets,
and the bundled lil-gui module. The browser checks run on pull requests through
the existing Tests and examples build workflows; the latter checks the built
artifact before any deployment. All presentation checks can run before merge,
without a deployed site or human visual confirmation.

The browser suite requires Google Chrome, with the same `CHROME_BIN` override
as the TSL rendering suite. `npm run test:examples` runs the examples and Gene Light checks. It serves the actual pages and repository modules in headless Chrome,
checks the index and scene DOM, computed typography/colors/spacing, overlay
positioning, link behavior, per-mode light colors and intensities, desktop/mobile GUI
placement, viewport canvas sizing,
and resizing from desktop to mobile and back. It exercises WebGL2 and automatic backend selection (native WebGPU when
available), exercises animation/IK/physics/outline
controls, advances model and camera animation, starts decoded audio through
Play, applies/resets VPD poses, and verifies loading/runtime error status and
disabled controls. Generated PMD/VMD/VPD and silent WAV fixtures
keep the existing PMD behavior checks deterministic. The new Gene PMX checks
use the licensed pinned assets: missing caches are acquired with hashes verified,
so first-run network access is required. Later runs verify and reuse the cache. The audio autoplay flag is used only by tests; the normal page requires
a Play click.

The index checks cover wide and extra-wide panel/viewer geometry, all five
decoded preview images, card aspect ratios, selection and iframe scene loading,
URL hashes and Back/Forward, direct links to every demo, repeated selection,
empty/unknown hashes, and mobile open/close behavior at the 640px breakpoint.
They also check light/dark colors, keyboard closing, accessibility state, and
resizing back to desktop. The same checks run on the local build under the
repository hosting prefix before merge; no public deployment or human browser
confirmation is needed.

After downloading the original assets, also run:

```sh
MMD_EXAMPLE_ASSETS=1 npm run test:examples
```

This exercises the same pages with the original Miku model, texture, dance,
camera, music, and poses. The normal fixture test checks audio playback state;
listening to the music is an optional manual check. The existing Tests workflow
validates local examples with fixtures; the deployment workflow additionally
validates the built site with the pinned original assets before publication.


The browser tests verify the separate sync and Worker entry points, including
conflicting `?physicsMode` parameters, absence of a mode selector, retained
controls, actual backend/transport and measured helper-update time. Startup and
runtime Worker failures are checked for continued sync physics and persistent
on-page diagnostics. Gallery navigation and direct hash selection exercise both
page roles. See the root README for the library's lifecycle and latency details.

The Gene browser check loads the real PMX with the released parser and compares
its inspection report, verifies every public asset URL, tests IK/grant effects
at the same animation time, steps physics, changes/resets vertex/group/UV/material
morphs, renders rigid-body/IK debug mode, exercises mobile controls and orbit,
and checks missing model/texture errors and shader-failure controls. It runs
without COOP/COEP. The examples gallery tests select all five demos and restore
them through Back/Forward and direct hashes. The Pages workflow runs both suites
against the compiled artifact under `/three-mmd-loader/` before deployment.
