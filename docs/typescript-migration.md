# TypeScript migration (Issues #16 and #18)

The maintained modules in `src/` use strict TypeScript. `npm run typecheck`
builds the package and examples first, then checks the package source, browser
examples, scripts, and tests using separate strict configurations. `npm run build` emits native ES
modules and declarations into `dist/`; Three.js remains an external peer.
Package exports retain the root and all documented `.js` subpaths, with
`types` conditions pointing to the corresponding declarations.

The vendored `src/libs/mmdparser.module.js` remains unchanged. It contains
11,530 lines of prototype-based JavaScript, including a large Shift_JIS table.
Its parsers incrementally construct format-dependent objects. Converting the
implementation with useful checking would require restructuring those object
builders and the vendor's binary reader, beyond this source migration. A
rename with checking disabled or placeholder types would provide little value.
The adjacent declaration file describes the parser, charset encoder, model,
motion, and pose APIs used by the maintained modules. The build copies both
vendor files into `dist/libs/`; runtime parser and export tests continue to
exercise the unchanged implementation.

Browser examples keep their `/src/` URLs: the development server maps them to
compiled `dist/` modules, and the static build copies those modules to the
site's `src/` directory. Issue #18 also migrates examples, scripts, and tests
to strict TypeScript. Browser modules compile into `dist/example-modules/`
and keep the same `.js` URLs in development and in the static site. Node 20+
runs repository scripts and tests with the pinned `tsx` loader. The Pages
setup and deployment jobs install development tooling before executing these scripts.
The npm file allowlist excludes the static example site from package tarballs.

Validation before merge:

- `npm run typecheck` checks all maintained implementations with `strict` and
  runs `check:typescript`. That check rejects repository JavaScript outside
  `src/libs/mmdparser.module.js` and generated `dist/` output; it considers
  tracked files and new files, ignoring removed paths during migration.
- `npm test` builds the package, runs runtime and example-build checks, guards
  the required TypeScript sources, and installs a tarball into an isolated
  JavaScript/TypeScript consumer. The consumer imports every public subpath
  and verifies both valid calls and rejection of invalid calls.
- `npm run test:browser` builds and runs the shader and example-page checks
  against compiled modules in headless Chrome.
- `npm run build:examples` builds the package and the site with the actual
  example assets. This downloads the asset manifest's fixtures when needed.

Strict checking also exposed misspelled camera/audio cleanup calls and audio
elapsed-time state, and invalid accesses in the experimental shared-physics
path, plus a grant hierarchy lookup through the wrong object. Those accesses now use the helper's typed state and the physics methods
already present in the implementation.

No post-merge verification is required by Issue #16. When preparing a PR,
include the parser exception rationale above and the executed check results.
