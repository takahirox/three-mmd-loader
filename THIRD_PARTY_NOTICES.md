# Third-party notices

## Three.js r171 MMD addons

The following files were restored from the
[Three.js r171 source](https://github.com/mrdoob/three.js/tree/r171/examples/jsm)
(commit `2898f5b1ba10b1e94174c0a62d072f5f7b80442c`):

- `src/animation/CCDIKSolver.js`
- `src/animation/MMDAnimationHelper.js`
- `src/animation/MMDPhysics.js`
- `src/exporters/MMDExporter.js`
- `src/libs/mmdparser.module.js`
- `src/loaders/MMDLoader.js`
- `src/shaders/MMDToonShader.js`

Their original paths are the same relative to `examples/jsm/` instead of `src/`.
Three.js is copyright © 2010-2024 three.js authors, licensed under the MIT
License reproduced in this package's [LICENSE](LICENSE).

Local changes route TGALoader through the external `three` package, remove
the obsolete r172 deprecation warnings, and use the external SkeletonUtils
clone in MMDExporter to avoid resetting the source skeleton when exporting.
The parser, CCDIK solver, and toon shader retain their r171 implementations.
Three.js itself and the Ammo.js physics runtime are not vendored.

## mmd-parser

`src/libs/mmdparser.module.js` contains
[mmd-parser](https://github.com/takahirox/mmd-parser), including its Shift_JIS
charset table. Its MIT license is reproduced below:

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
