import { assetManifest as manifest } from '../scripts/assets-manifest.ts';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { buildExamples } from '../scripts/build-examples.ts';
import { manifestName, sha256 } from '../scripts/pages-manifest.ts';



test( 'static build includes checkout modules, runtime dependencies, all assets and notices', async () => {

	const temporary = await mkdtemp( join( tmpdir(), 'mmd-site-' ) );
	const assetDirectory = join( temporary, 'assets' );
	const outputDirectory = join( temporary, 'site' );
	try {

		for ( const { path } of manifest.files ) {

			await mkdir( dirname( join( assetDirectory, path ) ), { recursive: true } );
			await writeFile( join( assetDirectory, path ), path );

		}
		// A private-model sentinel beside public assets must never reach Pages.
		await mkdir( join( assetDirectory, 'private/bone-morph' ), { recursive: true } );
		await writeFile( join( assetDirectory, 'private/bone-morph/model.pmx' ), 'private model sentinel' );
		await writeFile( join( assetDirectory, 'private/bone-morph/LICENSE.txt' ), 'local only' );
		await mkdir( join( assetDirectory, 'private/group-morph' ), { recursive: true } );
		await writeFile( join( assetDirectory, 'private/group-morph/model.pmx' ), 'private group sentinel' );
		await writeFile( join( assetDirectory, 'private/group-morph/README.txt' ), 'local only' );
		await mkdir( outputDirectory );
		await writeFile( join( outputDirectory, 'stale.html' ), 'old build' );
		const commit = 'c'.repeat( 40 );
		await buildExamples( { assetDirectory, outputDirectory, commit } );
		const deployment: import( '../scripts/pages-manifest.ts' ).DeploymentManifest = JSON.parse( await readFile( join( outputDirectory, manifestName ), 'utf8' ) );
		assert.equal( deployment.commit, commit );
		assert.ok( deployment.files.every( file => ! /private|local-viewer|local-sdef|serve-sdef/.test( file.path ) ) );
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
			'src/loaders/MMDLoader.js',
			'node_modules/mmd-parser/build/mmdparser.module.mjs', 'node_modules/mmd-parser/LICENSE',
			'node_modules/three/build/three.module.js', 'node_modules/three/build/three.core.js',
			'node_modules/three/build/three.webgpu.js', 'node_modules/three/build/three.tsl.js',
			'src/skinning/MMDSdef.js', 'src/materials/MMDToonMaterial.js', 'src/effects/MMDOutlineEffect.js',
			'node_modules/three/examples/jsm/controls/OrbitControls.js',
			'node_modules/three/examples/jsm/loaders/TGALoader.js',
			'node_modules/three/examples/jsm/libs/lil-gui.module.min.js',
			'node_modules/ammojs-typed/ammo/ammo.js',
			'node_modules/three/LICENSE', 'node_modules/ammojs-typed/LICENSE.md',
			'LICENSE', 'THIRD_PARTY_NOTICES.md'
		] ) {

			assert.deepEqual( await readFile( join( outputDirectory, path ) ), await readFile( new URL( '../' + path.replace( /^src\//, 'dist/' ).replace( /^examples\/(.+\.js)$/, 'dist/example-modules/$1' ), import.meta.url ) ), path );

		}
		for ( const path of [ 'src/libs/mmdparser.module.js', 'node_modules/mmd-parser/build/mmdparser.js', 'stale.html', 'local-sdef', 'local-viewer', 'scripts/serve-sdef.ts', 'examples/assets/private', 'examples/assets/mmd/private/bone-morph/model.pmx', 'examples/assets/mmd/private/group-morph/model.pmx', 'examples/assets/mmd/private/group-morph/README.txt', 'package.json', 'tests', '.git', '.github', 'node_modules/three/package.json' ] ) {

			await assert.rejects( readFile( join( outputDirectory, path ) ), { code: 'ENOENT' }, path );

		}
		await rm( join( assetDirectory, 'vpds/readme.txt' ) );
		await assert.rejects( buildExamples( { assetDirectory, outputDirectory } ), { code: 'ENOENT' } );

	} finally {

		await rm( temporary, { recursive: true, force: true } );

	}

} );
