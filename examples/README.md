# Browser examples

These scenes follow the model/animation, audio/camera, and VPD pose examples
from [Three.js r171](https://github.com/mrdoob/three.js/tree/r171/examples).
They import MMD modules from this checkout's `src/` directory through the
`three-mmd-loader/` import map. Only retained Three.js utilities such as
OrbitControls and OutlineEffect come from `three/addons`.

The public examples URL is **https://takahirox.github.io/three-mmd-loader/**.
Updates to `main` automatically build and publish these same scenes to GitHub
Pages. See [Deployment](#deployment) for the initial hosting setup.

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
Before the first deployment, a repository administrator must set
**Settings → Pages → Build and deployment → Source → GitHub Actions**, as
described in the [GitHub Pages setup guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site#publishing-with-a-custom-github-actions-workflow).
Allow `main` in the `github-pages` environment's deployment branch rules and
leave required reviewers unset for unattended deployment. This is a one-time
hosting setup; subsequent updates to `main` deploy automatically.

For every push to `main`, the workflow installs the lockfile dependencies with
`npm ci`, runs `npm test`, and runs `npm run build:examples`. That build command
downloads and verifies the pinned assets using the existing asset manifest,
then copies the existing pages, checkout's `src/` modules, Three.js and Ammo
runtime dependencies, and all asset/license notices to `dist/examples/`.
It does not bundle or build a second implementation of the scenes. The static
site uses relative URLs so it works under the repository's Pages path.

Headless Chrome then tests the **built artifact** at `/three-mmd-loader/`,
including rendering, animation, physics, audio, and poses. Only after all these
steps succeed is the site uploaded and the dependent deployment job run.
A failed dependency install, asset download/integrity check, build, or test
prevents deployment and leaves the currently published site in place.
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
