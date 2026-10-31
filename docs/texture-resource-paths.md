# PMD/PMX texture resource paths

Relative texture filenames resolve before the loader's texture cache, custom
LoadingManager handlers, TGA selection and requests. This applies to PMD
base/sphere/custom toon textures and PMX base/sphere/SubTexture/custom toon
textures. Built-in toon textures retain their embedded data URLs.

Windows, POSIX and mixed separators have one canonical URL. Repeated separators
and safe dot segments collapse before joining the resource base:

| Model filename | Resource base | Request/cache URL |
| --- | --- | --- |
| tex\hair.png | /models/uka/ | /models/uka/tex/hair.png |
| ./tex//part/../hair.png | /models/uka/ | /models/uka/tex/hair.png |
| tex/a b#c.png | /models/uka/ | /models/uka/tex/a%20b%23c.png |
| tex/a%20b%23c.png | /models/uka/ | /models/uka/tex/a%20b%23c.png |
| tex/%25FF.png | /models/uka/ | /models/uka/tex/%25FF.png |
| tex/100%25ab.png | /models/uka/ | /models/uka/tex/100%25ab.png |

Spaces and Unicode are encoded once. Existing escapes are decoded once and
re-encoded to give equivalent filenames the same cache key. A literal percent
must be escaped as %25; malformed percent escapes and invalid UTF-8 escapes
are rejected. Decoded literal percent bytes are not recursively interpreted as
the filename: %25FF.png names %FF.png, rather than an invalid UTF-8 byte.
Nested encodings are inspected separately to reject hidden separators,
controls and traversal.

Relative names cannot escape the resource directory. Empty names, Windows
drive/UNC paths, control characters, encoded separators and nested encoded dot
segments throw "THREE.MMDLoader: Unsafe relative texture path ..." before handler
selection or fetching. Safe tex/../image.png resolves inside the model's
resource directory. A root-relative reference resolves from the origin root.
Valid absolute, protocol-relative, data, blob and custom-handler URLs retain
their URL semantics; they are not joined to the model resource base.

Parsed filenames, material source-name metadata and original model/image bytes
are preserved independently of the request URL. Request/image-decode failures
retain the loader's error callbacks and LoadingManager behavior. Aliases of an
in-flight texture share its callbacks and cache entry; a cached failure reports
the canonical URL. A fresh model build/cache can retry a failed request.

This correction addresses resource path handling. It does not establish the
cause or resolution of downstream Android image-decoding failures. Desktop
Chrome tests do not constitute physical Android verification.

See [Issue #106](https://github.com/takahirox/three-mmd-loader/issues/106) and
the [validation record](texture-resource-path-validation.md).
