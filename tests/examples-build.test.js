import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { buildExamples } from '../scripts/build-examples.js';
import { manifestName, sha256 } from '../scripts/pages-manifest.js';

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
		const commit = 'c'.repeat( 40 );
		await buildExamples( { assetDirectory, outputDirectory, commit } );
		const deployment = JSON.parse( await readFile( join( outputDirectory, manifestName ) ) );
		assert.equal( deployment.commit, commit );
		for ( const { path, sha256: expected } of deployment.files ) {

			assert.equal( sha256( await readFile( join( outputDirectory, path ) ) ), expected, path );

		}
		for ( const { path } of manifest.files ) {

			assert.equal( await readFile( join( outputDirectory, 'examples/assets/mmd', path ), 'utf8' ), path );

		}
		for ( const path of [
			'examples/index.html', 'examples/scene.js', 'examples/README.md',
			'examples/common.css', 'examples/main.css',
			'examples/browser.css', 'examples/browser.js',
			'examples/screenshots/webgl_loader_mmd.jpg',
			'examples/screenshots/webgl_loader_mmd_audio.jpg',
			'examples/screenshots/webgl_loader_mmd_pose.jpg',
			'examples/fonts/RobotoMono-Regular.woff2', 'examples/fonts/RobotoMono-Medium.woff2',
			'examples/fonts/LICENSE.txt',
			'examples/webgl_loader_mmd.html', 'examples/webgl_loader_mmd_audio.html',
			'examples/webgl_loader_mmd_pose.html',
			'src/loaders/MMDLoader.js', 'src/libs/mmdparser.module.js',
			'node_modules/three/build/three.module.js', 'node_modules/three/build/three.core.js',
			'node_modules/three/examples/jsm/controls/OrbitControls.js',
			'node_modules/three/examples/jsm/loaders/TGALoader.js',
			'node_modules/three/examples/jsm/libs/lil-gui.module.min.js',
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
