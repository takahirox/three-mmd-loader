# Third-party notices

## Three.js r171 MMD addons

The following files were restored from the
[Three.js r171 source](https://github.com/mrdoob/three.js/tree/r171/examples/jsm)
(commit `2898f5b1ba10b1e94174c0a62d072f5f7b80442c`):

- `src/animation/CCDIKSolver.ts`
- `src/animation/MMDAnimationHelper.ts`
- `src/animation/MMDPhysics.ts`
- `src/exporters/MMDExporter.ts`
- `src/loaders/MMDLoader.ts`

Their original paths use `.js` relative to `examples/jsm/` instead of `src/`;
the maintained copies have since been migrated to TypeScript.
Three.js is copyright © 2010-2024 three.js authors, licensed under the MIT
License reproduced in this package's [LICENSE](LICENSE).

Local changes route TGALoader through the external `three` package, remove
the obsolete r172 deprecation warnings, and use the external SkeletonUtils
clone in MMDExporter to avoid resetting the source skeleton when exporting.
The CCDIK solver retains its r171 behavior. The loader and
exporter now import the external `mmd-parser` dependency. Three.js itself,
`mmd-parser`, and the Ammo.js physics runtime are not vendored.

## Three.js r186 node material and outlines

`src/materials/MMDToonMaterial.ts` adapts the direct-light toon irradiance and
Blinn-Phong expressions from Three.js r186 `ToonLightingModel` and
`PhongLightingModel`, composing Three's `MeshPhongNodeMaterial`, lighting and
TSL utilities. `src/effects/MMDOutlineEffect.ts` adapts r186
`src/nodes/display/ToonOutlinePassNode.js` (expanded back-facing hull and
render-object callback), adding MMD per-material parameters, vertex edge ratios,
resource cleanup and renderer-state restoration. The package uses external
Three.js `0.186.1`; these implementations replace the former r171 GLSL toon
shader and WebGL `OutlineEffect` integration. Three.js is copyright © 2010-2026
three.js authors, under the MIT license reproduced in [LICENSE](LICENSE).

## Three.js example stylesheet

`examples/main.css` is an unmodified copy of the official Three.js
`examples/main.css`, pinned to Git blob
`d496122b4cfb54f811495bd9f80ca48151beeb3b` (the reference for Issue #10).
It is copyright © three.js authors and uses the MIT license reproduced in
[LICENSE](LICENSE). `examples/common.css` shares the light background and blue
links used by the official MMD examples, plus canvas and status handling.

`examples/browser.css` adapts the examples-browser styles from Three.js
`files/main.css` (Git blob `eab4263a7a7570bb433cab3048d5735d4782f673`), and
`examples/index.html` follows its examples index (Git blob
`7b53cc789e644957e4b3bc8f9ca21b9ca81e5f06`). These references are copyright
© three.js authors under the same MIT license.

The three JPEG previews in `examples/screenshots/` are copied from
[`examples/screenshots/` at Three.js r171](https://github.com/mrdoob/three.js/tree/2898f5b1ba10b1e94174c0a62d072f5f7b80442c/examples/screenshots).
They depict the MMD examples and the Miku character © Crypton Future Media.
The character and MMD assets retain their individual terms and author credits,
documented in [examples/README.md](examples/README.md#assets-and-credits).

The Roboto Mono Regular and Medium WOFF2 files in `examples/fonts/` come from
[`files/` at the same Three.js commit](https://github.com/mrdoob/three.js/tree/2898f5b1ba10b1e94174c0a62d072f5f7b80442c/files).
Roboto Mono is copyright © 2015 Google Inc. All Rights Reserved. These font
files identify the Apache License, Version 2.0 in their metadata; the full
license is included in `examples/fonts/LICENSE.txt`. Previews and fonts are
examples-site assets and are not included in the npm package.

## mmd-parser

[mmd-parser](https://github.com/takahirox/mmd-parser) (`^1.1.1`) is an external
runtime dependency for parsing MMD resources and Shift_JIS encoding. Its public
TypeScript types describe the raw parser results consumed by this package.
The browser examples use the installed `build/mmdparser.module.mjs` artifact;
the static site copies that artifact and the dependency's `LICENSE`. Its MIT
license is reproduced below:

MIT License

Copyright (c) 2016 Takahiro

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
