# Browser examples

These scenes follow the model/animation, audio/camera, and VPD pose examples
from [Three.js r171](https://github.com/mrdoob/three.js/tree/r171/examples).
They import MMD modules from this checkout's `src/` directory through the
`three-mmd-loader/` import map. Only retained Three.js utilities such as
OrbitControls and OutlineEffect come from `three/addons`.

The public examples URL is **https://takahirox.github.io/three-mmd-loader/**.
Updates to `main` automatically build and publish these same scenes to GitHub
Pages and verify the public deployment. See [Deployment](#deployment) for the
workflow and its configuration credential.

## Local development

From the repository root, using Node.js 20 or newer:

```sh
npm ci
npm run examples:assets
npm run dev
```

Open **http://127.0.0.1:8080/** and choose a scene. Set `PORT=8081 npm run dev`
to use a different port. The server binds to loopback and serves the examples
and their dependencies. There is no build step; all scripts, Three.js, Ammo,
and assets are served locally. Use the HTTP server rather than opening HTML
files directly. Stop it with Ctrl+C.

| Page | Demonstrates |
| --- | --- |
| `webgl_loader_mmd.html` | `MMDLoader.loadWithAnimation`, VMD bone/morph animation, IK, Ammo physics, outlines, and debug helpers. Toggle animation, IK, physics, and outlines independently. |
| `webgl_loader_mmd_audio.html` | Model motion, `loadAnimation` camera motion, and `AudioLoader` music synchronized by `MMDAnimationHelper`. Wait for loading, then press Play to unlock audio. The music starts 160 frames (5.33 seconds) into the dance, matching the original example. |
| `webgl_loader_mmd_pose.html` | `loadVPD` and `MMDAnimationHelper.pose`, with eleven Shift_JIS poses and a rest pose. Disable IK for poses 9 and 10 as described by their author. |

Drag to orbit and scroll to zoom in the animation and pose scenes. The audio
scene uses its animated camera. Failed asset requests are reported on the page
with the setup command. Loading the scenes requires a browser with WebGL;
audio playback also needs browser audio support.

## Assets and credits

The MMD assets are **not covered by this repository's MIT license** and are
not committed or included in the npm package. Consult the upstream
[asset license summary](https://github.com/mrdoob/three.js/blob/r171/examples/models/mmd/Readme.txt)
and each author's original archive and terms before using them. The setup
command retrieves the original r171 example copies for local use, together
with all their license/readme files. It does not grant redistribution or
commercial-use rights.

The download is pinned to Three.js commit
`2898f5b1ba10b1e94174c0a62d072f5f7b80442c`. The manifest records Git blob hashes;
the script verifies each file, reuses matching local files, and reports HTTP
or integrity failures. It makes no changes outside `examples/assets/mmd/`,
which Git ignores. Downloading needs network access; afterward, the examples
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
the already installed `ammojs-typed` development dependency for physics; its
runtime is not bundled into the standalone MMD package.

## Deployment

The workflow is [`.github/workflows/examples-pages.yml`](https://github.com/takahirox/three-mmd-loader/blob/main/.github/workflows/examples-pages.yml).
It uses GitHub Actions to build a static site and GitHub Pages to host it.
The `setup` job uses `scripts/setup-pages.js` to enable Pages with the Actions
source, configure the workflow-owned `github-pages` environment to allow only
the `main` branch, remove required reviewers, wait timers, and custom approval
rules, and read back the settings to verify them. It runs before the deployment
job enters that environment, so an existing reviewer rule cannot block setup.
Setup is idempotent and runs after a successful build on every `main` deployment.
No manual Pages settings, environment changes, or browser confirmation are
part of the deployment procedure.

Configuration requires the repository-level Actions secret `PAGES_SETUP_TOKEN`:
a repository-scoped fine-grained token (or a GitHub App installation token)
with **Pages: write**, **Administration: write**, and **Actions: read**. The
credential must be provisioned by the repository's credential management;
the workflow cannot grant itself administration access. GitHub's default
`GITHUB_TOKEN` cannot enable Pages or configure environment rules. Missing or
insufficient credentials fail setup explicitly, before publication, and produce
machine-readable evidence. See the [Pages API permissions](https://docs.github.com/en/rest/pages/pages#create-a-github-pages-site)
and [environment API permissions](https://docs.github.com/en/rest/deployments/environments#create-or-update-an-environment).
The setup credential is used only on `main`; normal publication and rollback
use the workflow's `GITHUB_TOKEN` with Pages write and OIDC permissions.

For every push to `main`, the workflow installs the lockfile dependencies with
`npm ci`, runs `npm test`, and runs `npm run build:examples`. That build command
downloads and verifies the pinned assets using the existing asset manifest,
then copies the existing pages, checkout's `src/` modules, Three.js and Ammo
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
Before publishing, `scripts/verify-pages.js` downloads and checks every file of
the current public site against its manifest, including the root and examples
landing URLs. It packages this verified snapshot as a rollback Pages artifact.
An unavailable, incomplete, or unrecognised existing site blocks publication
instead of proceeding without a usable backup. Only a newly enabled Pages
site may start without a previous publication.

After `deploy-pages` reports success (it polls the Pages deployment status),
the workflow checks the public manifest against the exact candidate commit
and manifest, then checks HTTP 200 responses and hashes for every file and both
landing URLs. These are the same bytes that passed the browser checks before
publication. Checks bypass caches and retry CDN propagation six times with
ten-second delays. A deployment error or failed public validation restores the
snapshot automatically and verifies its public contents and previous commit.
A failed first publication removes the newly enabled Pages site. A rejected
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

```sh
npm test
npm run test:browser
```

The browser suite requires Google Chrome, with the same `CHROME_BIN` override
as the existing shader suite. `npm run test:examples` runs only the examples
check. It serves the actual pages and repository modules in headless Chrome,
renders and checks shader links, exercises animation/IK/physics/outline
controls, advances model and camera animation, starts decoded audio through
Play, and applies/resets VPD poses. Generated PMD/VMD/VPD and silent WAV fixtures
make this check independent of downloaded third-party assets and network
access. The audio autoplay flag is used only by tests; the normal page requires
a Play click.

After downloading the original assets, also run:

```sh
MMD_EXAMPLE_ASSETS=1 npm run test:examples
```

This exercises the same pages with the original Miku model, texture, dance,
camera, music, and poses. The normal fixture test checks audio playback state;
listening to the music is an optional manual check. The existing Tests workflow
validates local examples with fixtures; the deployment workflow additionally
validates the built site with the pinned original assets before publication.
