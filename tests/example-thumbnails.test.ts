import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { assetManifest } from '../scripts/assets-manifest.ts';
import { geneLightManifest } from '../scripts/gene-light-assets.ts';

const ids = [ 'webgl_loader_mmd', 'webgl_loader_mmd_audio', 'webgl_loader_mmd_pose', 'webgl_loader_mmd_worker', 'webgl_loader_mmd_pmx_gene' ];
const sha256 = ( bytes: Uint8Array ) => createHash( 'sha256' ).update( bytes ).digest( 'hex' );

test( 'all five gallery thumbnails are refreshed real-scene captures with current lighting and pinned provenance', async () => {

	const gallery = await readFile( new URL( '../examples/index.html', import.meta.url ), 'utf8' );
	const scene = await readFile( new URL( '../examples/scene.ts', import.meta.url ) );
	const manifest = JSON.parse( await readFile( new URL( '../examples/screenshots/manifest.json', import.meta.url ), 'utf8' ) );
	assert.equal( manifest.version, 1 );
	assert.equal( manifest.method, 'npm run examples:capture' );
	assert.equal( manifest.sceneSha256, sha256( scene ), 'Recapture after changing the rendered scene' );
	assert.deepEqual( [ manifest.width, manifest.height, manifest.pixelRatio ], [ 400, 250, 1 ] );
	assert.deepEqual( manifest.sources, {
		miku: { repository: 'mrdoob/three.js', commit: assetManifest.commit },
		gene: { repository: geneLightManifest.repository, commit: geneLightManifest.commit }
	} );
	assert.deepEqual( manifest.entries.map( ( entry: { page: string } ) => entry.page ), ids );
	assert.equal( ( gallery.match( /class="card"/g ) || [] ).length, ids.length );
	for ( const entry of manifest.entries ) {

		assert.equal( entry.path, entry.page + '.jpg' );
		const card = gallery.split( `data-example="${entry.page}"` )[ 1 ].split( 'class="card"' )[ 0 ];
		assert.ok( card.includes( `href="./${entry.page}.html"` ), entry.page );
		assert.ok( card.includes( `src="./screenshots/${entry.path}" width="400" height="250"` ), entry.page );
		const image = await readFile( new URL( '../examples/screenshots/' + entry.path, import.meta.url ) );
		assert.equal( sha256( image ), entry.sha256, entry.page );
		assert.notEqual( entry.sha256, entry.previousSha256, 'Must replace the previous brighter/older capture' );
		assert.equal( image.readUInt16BE( 0 ), 0xffd8, 'JPEG header' );
		assert.equal( image.readUInt16BE( image.length - 2 ), 0xffd9, 'Complete JPEG' );
		assert.equal( entry.physicsMode, entry.page.endsWith( '_pose' ) ? null : entry.page.endsWith( '_worker' ) ? 'worker' : 'sync' );
		assert.equal( entry.time, entry.page.endsWith( '_pose' ) ? 0 : 2 );
		assert.equal( entry.pose, entry.page.endsWith( '_pose' ) ? 1 : null );
		for ( const check of [ 'ready', 'realModel', 'defaultLights', 'lightColors', 'lightDirection', 'camera', 'outlines', 'physics', 'render', 'noRuntimeErrors' ] ) assert.equal( entry.checks[ check ], true, `${entry.page}: ${check}` );

	}
	// Runtime browser checks cover every mode; also prevent explicit intensity
	// arguments from hiding a future departure from native Three.js defaults.
	assert.match( scene.toString(), /const ambient = new AmbientLight\( 0xffffff \);/ );
	assert.match( scene.toString(), /const light = new DirectionalLight\( 0xffffff \);/ );

} );
