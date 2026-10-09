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
		await mkdir( join( assetDirectory, 'private/material-morph' ), { recursive: true } );
		await writeFile( join( assetDirectory, 'private/material-morph/model.pmx' ), 'private material sentinel' );
		await writeFile( join( assetDirectory, 'private/material-morph/README.txt' ), 'local only' );
		await mkdir( join( assetDirectory, 'private/uv-morph' ), { recursive: true } );
		await writeFile( join( assetDirectory, 'private/uv-morph/model.pmx' ), 'private UV sentinel' );
		for ( const name of [ 'generated-subtexture.pmx', 'generated-subtexture.png' ] ) await writeFile( join( assetDirectory, 'private/uv-morph', name ), 'private SubTexture sentinel' );
		await mkdir( join( assetDirectory, 'private/grant' ), { recursive: true } );
		for ( const name of [ 'model.pmx', 'motion.vmd', 'archive.zip', 'README.txt', 'screenshot.png' ] ) await writeFile( join( assetDirectory, 'private/grant', name ), 'private grant sentinel' );
		await mkdir( join( assetDirectory, 'private/physics-layers' ), { recursive: true } );
		for ( const name of [ 'model.pmx', 'motion.vmd', 'texture.png', 'README.txt', 'screenshot.png' ] ) await writeFile( join( assetDirectory, 'private/physics-layers', name ), 'private physics sentinel' );
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
		for ( const path of [ 'local-sdef/generated-subtexture.pmx', 'local-sdef/generated-subtexture.png', 'examples/assets/mmd/private/uv-morph/generated-subtexture.pmx', 'examples/assets/mmd/private/uv-morph/generated-subtexture.png', 'src/libs/mmdparser.module.js', 'node_modules/mmd-parser/build/mmdparser.js', 'stale.html', 'local-sdef', 'local-viewer', 'scripts/serve-sdef.ts', 'examples/assets/private', 'examples/assets/mmd/private/physics-layers/model.pmx', 'examples/assets/mmd/private/physics-layers/motion.vmd', 'examples/assets/mmd/private/physics-layers/texture.png', 'examples/assets/mmd/private/physics-layers/README.txt', 'local-sdef/generated-physics-layers.pmx', 'examples/assets/mmd/private/bone-morph/model.pmx', 'examples/assets/mmd/private/group-morph/model.pmx', 'examples/assets/mmd/private/group-morph/README.txt', 'package.json', 'tests', '.git', '.github', 'node_modules/three/package.json' ] ) {

			await assert.rejects( readFile( join( outputDirectory, path ) ), { code: 'ENOENT' }, path );

		}
		await rm( join( assetDirectory, 'vpds/readme.txt' ) );
		await assert.rejects( buildExamples( { assetDirectory, outputDirectory } ), { code: 'ENOENT' } );

	} finally {

		await rm( temporary, { recursive: true, force: true } );

	}

} );

// Actions publishes only the already allowlisted static build and sanitized
// deployment records, never the worktree or locally licensed viewer assets.
test( 'Actions artifact uploads exclude private model/viewer sources', async () => {

	const workflow = await readFile( new URL( '../.github/workflows/examples-pages.yml', import.meta.url ), 'utf8' );
	const uploads = workflow.split( /uses: actions\/upload-(?:pages-)?artifact@/ ).slice( 1 );
	assert.ok( uploads.length > 0 );
	for ( const upload of uploads ) {

		const block = upload.split( /\n\s+- (?:uses:|name:)/ )[ 0 ];
		const path = /\n\s+path: ([^\n]+)/.exec( block )?.[ 1 ].trim();
		assert.ok( path && /^(?:dist\/(?:examples|rollback)|deployment-evidence)$/.test( path ), `artifact path ${path}` );

	}

} );
