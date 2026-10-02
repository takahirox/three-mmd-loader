import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { buildExamples } from '../scripts/build-examples.js';

const manifest = JSON.parse( await readFile( new URL( '../examples/assets-manifest.json', import.meta.url ), 'utf8' ) );

test( 'static build includes checkout modules, runtime dependencies, all assets and notices', async () => {

	const temporary = await mkdtemp( join( tmpdir(), 'mmd-site-' ) );
	const assetDirectory = join( temporary, 'assets' );
	const outputDirectory = join( temporary, 'site' );
	try {

		for ( const { path } of manifest.files ) {

			await mkdir( dirname( join( assetDirectory, path ) ), { recursive: true } );
			await writeFile( join( assetDirectory, path ), path );

		}
		await mkdir( outputDirectory );
		await writeFile( join( outputDirectory, 'stale.html' ), 'old build' );
		await buildExamples( { assetDirectory, outputDirectory } );
		for ( const { path } of manifest.files ) {

			assert.equal( await readFile( join( outputDirectory, 'examples/assets/mmd', path ), 'utf8' ), path );

		}
		for ( const path of [
			'examples/index.html', 'examples/scene.js', 'examples/README.md',
			'src/loaders/MMDLoader.js', 'src/libs/mmdparser.module.js',
			'node_modules/three/build/three.module.js', 'node_modules/three/build/three.core.js',
			'node_modules/three/examples/jsm/controls/OrbitControls.js',
			'node_modules/three/examples/jsm/loaders/TGALoader.js',
			'node_modules/ammojs-typed/ammo/ammo.js',
			'node_modules/three/LICENSE', 'node_modules/ammojs-typed/LICENSE.md',
			'LICENSE', 'THIRD_PARTY_NOTICES.md'
		] ) {

			assert.deepEqual( await readFile( join( outputDirectory, path ) ), await readFile( new URL( '../' + path, import.meta.url ) ), path );

		}
		for ( const path of [ 'stale.html', 'package.json', 'tests', '.git', '.github', 'node_modules/three/package.json' ] ) {

			await assert.rejects( readFile( join( outputDirectory, path ) ), { code: 'ENOENT' }, path );

		}
		await rm( join( assetDirectory, 'vpds/readme.txt' ) );
		await assert.rejects( buildExamples( { assetDirectory, outputDirectory } ), { code: 'ENOENT' } );

	} finally {

		await rm( temporary, { recursive: true, force: true } );

	}

} );
