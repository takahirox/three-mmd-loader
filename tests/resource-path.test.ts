import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pmdBuffer, pmxBuffer } from './fixtures.ts';
import { AddOperation, DataTexture, LoadingManager, MultiplyOperation, Texture } from 'three';
import { Parser } from 'mmd-parser';
import { MMDLoader } from '../src/loaders/MMDLoader.ts';
import { resolveMMDResourcePath as resolve } from '../src/loaders/MMDResourcePath.ts';

test('portable resource names, safe relative segments and URL encoding', () => {
  for (const path of ['tex\\hair_s01.png', 'tex/hair_s01.png', 'tex\\/hair_s01.png', './tex//part/../hair_s01.png', 'tex/%2e/hair_s01.png'])
    assert.equal(resolve('/mmd-gltf/uka/', path), '/mmd-gltf/uka/tex/hair_s01.png');
  assert.equal(resolve('https://example.com/models/uka///', 'tex\\hair_s01.png'), 'https://example.com/models/uka/tex/hair_s01.png');
  assert.equal(resolve('/models/uka', 'tex\\日本 語😀.png'), '/models/uka/tex/%E6%97%A5%E6%9C%AC%20%E8%AA%9E%F0%9F%98%80.png');
  assert.equal(resolve('/uka/', 'tex/a%20b%23c.png'), '/uka/tex/a%20b%23c.png');
  assert.equal(resolve('/uka/', 'tex/a b#c?.png'), '/uka/tex/a%20b%23c%3F.png');
  assert.equal(resolve(undefined, 'tex\\a.png'), 'tex/a.png');
  assert.equal(resolve('/uka/', 'tex/a.png/..//b.png'), '/uka/tex/b.png');
  assert.equal(resolve('/uka/', 'tex/%e6%97%a5.png'), resolve('/uka/', 'tex/日.png'));
  for (const url of ['https://example.com/日本%20語.png?q=1#x', '//example.com/a.png', '/textures/a.png', 'file:///tmp/a.png', 'custom-texture://host/image', 'data:image/png;base64,AAAA', 'data:image/svg+xml,<svg>\\</svg>', 'blob:https://example.com/id'])
    assert.equal(resolve('/uka/', url), url);
});

test('encoded literal-percent filenames remain escaped without reinterpreting their UTF-8', () => {
  for (const name of ['%25FF.png', '100%25ab.png', '%2525FF.png', '%25literal.png', '%25FF%2520name.png']) {
    assert.equal(resolve('/uka/', `tex/${name}`), `/uka/tex/${name}`);
    assert.equal(resolve('/uka/', `tex\\${name}`), `/uka/tex/${name}`);
  }
});

test('unsafe resource names fail before fetching, including encoded traversal', () => {
  for (const path of ['', '.', '..\\hair.png', 'tex\\..\\..\\hair.png', '../hair.png', 'tex/%2e%2e/%2e%2e/hair.png', '%252e%252e/hair.png', 'tex/%2f..%2fimage.png', 'tex/%5c..%5cimage.png', 'tex/%255cimage.png', 'C:\\tex\\hair.png', '\\\\host\\share.png', 'tex/bad%zz.png', 'tex/\u0000hair.png', 'tex/\nhair.png'])
    assert.throws(() => resolve('/uka/', path), /Unsafe relative texture path/, path);
  for (const path of ['tex/%FF.png', 'tex/%ab.png', 'tex/%25FF%252fescape.png', 'tex/%25FF%255cescape.png', 'tex/%25FF%2500.png', '%25252e%25252e/hair.png'])
    assert.throws(() => resolve('/uka/', path), /Unsafe relative texture path/, path);
});

test('cache/handler lookup, TGA selection, default toon and failure callbacks use resolved paths', () => {
  const manager = new LoadingManager(), loader = new MMDLoader(manager);
  const builder = loader.meshBuilder.materialBuilder.setResourcePath('/uka/');
  const paths: string[] = [], handlers: string[] = [];
  let fail: ((error: unknown) => void) | undefined;
  builder.textureLoader.load = (path, _loaded, _progress, onError) => { paths.push(path); fail = onError; return new Texture(); };
  manager.getHandler = path => { handlers.push(path); return null; };
  const textures = {};
  const first = builder._loadTexture('tex\\hair.png', textures);
  assert.equal(builder._loadTexture('./tex/hair.png', textures), first);
  assert.deepEqual(paths, ['/uka/tex/hair.png']);
  assert.deepEqual(handlers, paths);
  const failures: unknown[] = [];
  builder._loadTexture('tex/hair.png', textures, {}, undefined, error => failures.push(error));
  const error = new Error('image decode failed'); fail!(error);
  assert.equal(failures[0], error);
  builder._loadTexture('tex\\hair.png', textures, {}, undefined, error => failures.push(error));
  assert.match(String(failures[1]), /\/uka\/tex\/hair.png/);
  builder._loadTexture('toon01.bmp', textures, { isDefaultToonTexture: true });
  assert.match(paths.at(-1)!, /^data:image\/png;base64,/);
  const tgaPaths: string[] = [];
  builder._getTGALoader().load = path => { paths.push(path); tgaPaths.push(path); return new DataTexture(); };
  builder._loadTexture('tex\\sphere.TGA', textures);
  assert.equal(paths.at(-1), '/uka/tex/sphere.TGA');
  builder._loadTexture('tex\\alternate.TGA/.', textures);
  assert.equal(paths.at(-1), '/uka/tex/alternate.TGA');
  assert.deepEqual(tgaPaths, ['/uka/tex/sphere.TGA', '/uka/tex/alternate.TGA']);
  const count = paths.length;
  assert.throws(() => builder._loadTexture('..\\escape.png', textures), /Unsafe/);
  assert.equal(paths.length, count);
  assert.equal(handlers.length, count);
  assert.equal(builder.resourcePath, '/uka/');
});

test('invalid path diagnostics and URL pathname TGA selection precede loading', () => {
  const manager = new LoadingManager(), builder = new MMDLoader(manager).meshBuilder.materialBuilder;
  builder.setResourcePath('/uka/');
  const seen: string[] = [];
  manager.getHandler = path => { seen.push(path); return null; };
  builder.textureLoader.load = path => { seen.push('image:' + path); return new Texture(); };
  builder._getTGALoader().load = path => { seen.push('tga:' + path); return new DataTexture(); };
  for (const name of ['C:relative.png', 'tex/\ud800.png', 'tex/%00.png', 'tex/%1f.png', 'tex/%7f.png', 'tex/%252500.png']) {
    assert.throws(() => builder._loadTexture(name, {}), /Unsafe relative texture path/);
  }
  assert.deepEqual(seen, []);
  builder._loadTexture('https://example.com/a.TGA?v=1#map', {});
  builder._loadTexture('https://example.com/a.png?name=.tga', {});
  builder._loadTexture('tex/sphere%2etga', {});
  assert.deepEqual(seen, [
    'https://example.com/a.TGA?v=1#map', 'tga:https://example.com/a.TGA?v=1#map',
    'https://example.com/a.png?name=.tga', 'image:https://example.com/a.png?name=.tga',
    '/uka/tex/sphere.tga', 'tga:/uka/tex/sphere.tga'
  ]);
});

test('every PMX texture family rejects unsafe paths before its handler lookup', () => {
  for (const index of [0, 1, 2]) {
    const textureNames: [ string, string, string ] = ['tex/base.png', 'tex/sphere.png', 'tex/toon.png'];
    textureNames[index] = '..\\escape.png';
    const bytes = pmxBuffer({ textureNames, envFlag: 3 }), data = new Parser().parsePmx(bytes, true);
    const manager = new LoadingManager(), loader = new MMDLoader(manager), seen: string[] = [];
    manager.getHandler = path => { seen.push(path); return null; };
    loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
    assert.throws(() => loader.meshBuilder.build(data, '/uka/'), /Unsafe relative texture path/);
    assert.equal(seen.length, index);
    assert.ok(seen.every(path => path.startsWith('/uka/tex/')));
    assert.deepEqual(data.textures, textureNames);
  }
});

test('PMD classifies canonical sphere paths while retaining the base map and source names', () => {
  for (const extension of ['sph', 'spa']) {
    for (const sphereName of [`t/s.${extension}`, `t/s%2e${extension}`, `t/s.${extension}/.`, `t\\s.${extension}`, `t/s.${extension.toUpperCase()}`]) {
      for (const sphereFirst of [false, true]) {
        const fileName = (sphereFirst ? [sphereName, 't/b.png'] : ['t/b.png', sphereName]).join('*');
        const bytes = pmdBuffer({ textureFileName: fileName, toonFileName: 't/toon.png' });
        const originalBytes = bytes.slice(0);
        const data = new Parser().parsePmd(bytes, true), original = structuredClone(data);
        assert.equal(data.materials[0].fileName, fileName);
        const loader = new MMDLoader(), loaded = new Map<string, Texture>();
        loader.meshBuilder.materialBuilder.textureLoader.load = path => {
          const texture = new Texture<HTMLImageElement>();
          loaded.set(path, texture);
          return texture;
        };
        const mesh = loader.meshBuilder.build(data, '/models/'), material = mesh.material[0];
        const spherePath = `/models/t/s.${sphereName.endsWith(extension.toUpperCase()) ? extension.toUpperCase() : extension}`;
        assert.equal(loaded.size, 3, fileName);
        assert.ok(loaded.has('/models/t/b.png'), fileName);
        assert.ok(loaded.has(spherePath), fileName);
        assert.equal(material.map, loaded.get('/models/t/b.png'), fileName);
        assert.equal(material.matcap, loaded.get(spherePath), fileName);
        assert.equal(material.matcapCombine, extension === 'sph' ? MultiplyOperation : AddOperation, fileName);
        assert.deepEqual(data, original);
        assert.deepEqual(bytes, originalBytes);
      }
    }
  }
});

test('PMX base, sphere/subtexture and custom toon share resolution while preserving source names', () => {
  for (const envFlag of [1, 2, 3]) {
    const textureNames: [ string, string, string ] = ['tex\\hair.png', 'tex/./sphere.png', 'tex\\custom/toon.png'];
    const fixture = pmxBuffer({ textureNames, envFlag });
    const bytes = Buffer.from(fixture);
    const data = new Parser().parsePmx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), true);
    const before = structuredClone(data), loader = new MMDLoader(), paths: string[] = [];
    loader.meshBuilder.materialBuilder.textureLoader.load = path => { paths.push(path); return new Texture(); };
    const mesh = loader.meshBuilder.build(data, '/uka/');
    assert.deepEqual(paths, ['/uka/tex/hair.png', '/uka/tex/sphere.png', '/uka/tex/custom/toon.png']);
    assert.equal(mesh.material[0].userData.MMD.mapFileName, 'tex\\hair.png');
    assert.equal(mesh.material[0].userData.MMD.matcapFileName, 'tex/./sphere.png');
    assert.deepEqual(data.textures, before.textures);
    assert.deepEqual(data.materials, before.materials);
    assert.deepEqual(bytes, Buffer.from(pmxBuffer({ textureNames, envFlag })));
    // PMD's base*sphere and custom toon use the same MaterialBuilder entry point.
    const pmdBytes = pmdBuffer({ textureFileName: 't\\b.png*t\\s.sph', toonFileName: 't\\toon.png' });
    const originalBytes = pmdBytes.slice(0);
    const pmd = new Parser().parsePmd(pmdBytes, true), originalPmd = structuredClone(pmd);
    paths.length = 0;
    loader.meshBuilder.build(pmd, '/uka/');
    assert.deepEqual(paths, ['/uka/t/b.png', '/uka/t/s.sph', '/uka/t/toon.png']);
    assert.deepEqual(pmd.materials, originalPmd.materials);
    assert.deepEqual(pmd.toonTextures, originalPmd.toonTextures);
    assert.deepEqual(pmdBytes, originalBytes);
  }
});
