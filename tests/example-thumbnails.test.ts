import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { assetManifest } from '../scripts/assets-manifest.ts';
import { geneLightManifest } from '../scripts/gene-light-assets.ts';

const ids = [ 'webgl_loader_mmd', 'webgl_loader_mmd_audio', 'webgl_loader_mmd_pose', 'webgl_loader_mmd_worker', 'webgl_loader_mmd_pmx_gene' ];
const sha256 = ( bytes: Uint8Array ) => createHash( 'sha256' ).update( bytes ).digest( 'hex' );
const previousImages: Record<string, string> = {
	webgl_loader_mmd: '6acd677980a41dd35d5ffade7937dd35e57d0be98dcaecdec5dc2b69bc384ce8',
	webgl_loader_mmd_audio: '272395631a0018e41a0c0e8b131db99174007ed86d02f11159caf866c9c48d2c',
	webgl_loader_mmd_pose: '25b27f1face319f6d36ed356a8f7847ec874174bf76c8839d8382eb7287fdfda',
	webgl_loader_mmd_worker: 'ceb75de73236d773ad4140bba8fbc8cc634f1536a77883cdd6d3b501808b703f',
	webgl_loader_mmd_pmx_gene: 'b0ad142b8a7c7e640893a1e07205e9508484fe28c11ffc2382e6c1780ca6da48'
};

function jpegDimensions( bytes: Buffer ) {

	for ( let offset = 2; offset < bytes.length; ) {

		const marker = bytes.readUInt16BE( offset );
		if ( [ 0xffc0, 0xffc1, 0xffc2 ].includes( marker ) ) return [ bytes.readUInt16BE( offset + 7 ), bytes.readUInt16BE( offset + 5 ) ];
		assert.equal( marker & 0xff00, 0xff00, 'JPEG segment marker' );
		const length = bytes.readUInt16BE( offset + 2 );
		assert.ok( length >= 2, 'JPEG segment length' );
		offset += length + 2;

	}
	assert.fail( 'Missing JPEG frame dimensions' );

}

test( 'four brighter Miku previews and unchanged Gene preview have valid dimensions, hashes and per-mode provenance', async () => {

	const gallery = await readFile( new URL( '../examples/index.html', import.meta.url ), 'utf8' );
	const scene = await readFile( new URL( '../examples/scene.ts', import.meta.url ) );
	const manifest = JSON.parse( await readFile( new URL( '../examples/screenshots/manifest.json', import.meta.url ), 'utf8' ) );
	assert.equal( manifest.version, 2 );
	assert.equal( manifest.method, 'npm run examples:capture' );
	assert.equal( manifest.runtimeUpdate.issue, 82 );
	assert.equal( manifest.runtimeUpdate.sceneSha256, sha256( scene ), 'Review preview provenance after changing the scene' );
	assert.match( manifest.runtimeUpdate.note, /not evidence of WASM visual or motion parity/ );
	assert.equal( manifest.sceneSha256, '44b01befefa1f7182e763982f89080cd9da53757efe72d706c6269bf25c45422', 'Preserve the actual asm.js capture source hash' );
	assert.deepEqual( [ manifest.width, manifest.height, manifest.pixelRatio ], [ 400, 250, 1 ] );
	assert.deepEqual( manifest.sources, {
		miku: { repository: 'mrdoob/three.js', commit: assetManifest.commit },
		gene: { repository: geneLightManifest.repository, commit: geneLightManifest.commit }
	} );
	assert.deepEqual( manifest.entries.map( ( entry: { page: string } ) => entry.page ), ids );
	assert.equal( ( gallery.match( /class="card"/g ) || [] ).length, ids.length );
	for ( const entry of manifest.entries ) {

		const gene = entry.page.endsWith( '_pmx_gene' );
		assert.equal( entry.mode, gene ? 'gene' : entry.page.endsWith( '_audio' ) ? 'audio' : entry.page.endsWith( '_pose' ) ? 'pose' : 'animation' );
		assert.deepEqual( entry.lighting, gene ? { ambient: 1, directional: 1 } : { ambient: 2, directional: 3 } );
		assert.equal( entry.retained, gene );
		assert.ok( ! Number.isNaN( Date.parse( entry.capturedAt ) ) );
		assert.match( entry.userAgent, /HeadlessChrome/ );
		if ( gene ) {

			assert.equal( entry.sha256, previousImages[ entry.page ], 'Issue #66 must preserve the exact Gene JPEG' );
			assert.equal( entry.sceneSha256, 'c99bd2096f6e45a27af9cf9e6cfbb3bcba147b3ff366850d8735bf25fccbfd95', 'Retain Gene original capture provenance' );
			assert.equal( entry.capturedAt, '2026-10-14T09:29:07.294Z' );
			assert.equal( entry.checks.defaultLights, true, 'Original Gene capture used native defaults' );

		} else {

			assert.equal( entry.sceneSha256, manifest.sceneSha256 );
			assert.equal( entry.capturedAt, manifest.capturedAt );
			assert.equal( entry.previousSha256, previousImages[ entry.page ], 'Record the replaced 1/1 image' );
			assert.notEqual( entry.sha256, entry.previousSha256, 'Must refresh each Miku capture' );

		}
		assert.equal( entry.path, entry.page + '.jpg' );
		const card = gallery.split( `data-example="${entry.page}"` )[ 1 ].split( 'class="card"' )[ 0 ];
		assert.ok( card.includes( `href="./${entry.page}.html"` ), entry.page );
		assert.ok( card.includes( `src="./screenshots/${entry.path}" width="400" height="250"` ), entry.page );
		const image = await readFile( new URL( '../examples/screenshots/' + entry.path, import.meta.url ) );
		assert.equal( sha256( image ), entry.sha256, entry.page );
		assert.equal( image.readUInt16BE( 0 ), 0xffd8, 'JPEG header' );
		assert.equal( image.readUInt16BE( image.length - 2 ), 0xffd9, 'Complete JPEG' );
		assert.deepEqual( jpegDimensions( image ), [ 400, 250 ], entry.page );
		assert.equal( entry.physicsMode, entry.page.endsWith( '_pose' ) ? null : entry.page.endsWith( '_worker' ) ? 'worker' : 'sync' );
		assert.equal( entry.time, entry.page.endsWith( '_pose' ) ? 0 : 2 );
		assert.equal( entry.pose, entry.page.endsWith( '_pose' ) ? 1 : null );
		const checks = gene ? entry.verificationChecks : entry.checks;
		for ( const check of [ 'ready', 'realModel', 'lightIntensities', 'lightColors', 'lightDirection', 'camera', 'outlines', 'physics', 'render', 'noRuntimeErrors' ] ) assert.equal( checks[ check ], true, `${entry.page}: ${check}` );

	}
	assert.equal( new Set( manifest.entries.map( ( entry: { sha256: string } ) => entry.sha256 ) ).size, ids.length, 'Worker must have its own distinct capture' );
	// Browser checks exercise all modes; ensure Gene still uses native defaults.
	assert.match( scene.toString(), /new AmbientLight\( 0xffffff, mode === 'gene' \? undefined : 2 \)/ );
	assert.match( scene.toString(), /new DirectionalLight\( 0xffffff, mode === 'gene' \? undefined : 3 \)/ );

} );
