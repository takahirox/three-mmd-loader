import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { assetManifest } from '../scripts/assets-manifest.ts';
import { geneLightManifest } from '../scripts/gene-light-assets.ts';

const ids = [ 'webgl_loader_mmd', 'webgl_loader_mmd_audio', 'webgl_loader_mmd_pose', 'webgl_loader_mmd_worker', 'webgl_loader_mmd_pmx_gene' ];
const sha256 = ( bytes: Uint8Array ) => createHash( 'sha256' ).update( bytes ).digest( 'hex' );
// Miku retains replaced white-ambient hashes from #100; Gene replaces #100 gray/white.
const previousImages: Record<string, string> = {
	webgl_loader_mmd: 'd7966b61e8e16643aec1e5a164805cad57dd32d0b03227cf3bab088afab9dd9c',
	webgl_loader_mmd_audio: 'e09d2c05f7a53a5104a84fa51ab2e12dcd9eb3b67a5df0888dd6f6f6b480d683',
	webgl_loader_mmd_pose: 'b76a680af57ccc2073315387896c0644e71363270017f99f1e2c9a6202fef36e',
	webgl_loader_mmd_worker: '57d15431ae755eca501ab5b66b64cef7bed121e91218cfbc3157c3f315eb6f13',
	webgl_loader_mmd_pmx_gene: '6e7c9e9527cdc72e5bea0a10d9ceafe2a9fbd5b8601394a1b17d19e5d712525f'
};

interface SceneProvenance {
	sceneSha256: string;
	runtimeUpdate?: { issue: number; sceneSha256: string; note: string };
}

function assertSceneProvenance( manifest: SceneProvenance, sceneSha256: string ) {

	if ( manifest.runtimeUpdate === undefined ) {

		// Fresh captures record the source used by examples:capture directly.
		assert.equal( manifest.sceneSha256, sceneSha256, 'Capture must use the current scene source' );

	} else {

		// The retained asm.js previews describe the runtime change separately;
		// their original capture source must never be relabeled as WASM.
		assert.equal( manifest.runtimeUpdate.issue, 82 );
		assert.equal( manifest.runtimeUpdate.sceneSha256, sceneSha256, 'Review preview provenance after changing the scene' );
		assert.match( manifest.runtimeUpdate.note, /not evidence of WASM visual or motion parity/ );
		assert.equal( manifest.sceneSha256, '44b01befefa1f7182e763982f89080cd9da53757efe72d706c6269bf25c45422', 'Preserve the actual asm.js capture source hash' );

	}

}

test( 'fresh thumbnail provenance accepts the capture generator output without a legacy runtime note', async () => {

	const sceneSha256 = sha256( await readFile( new URL( '../examples/scene.ts', import.meta.url ) ) );
	assertSceneProvenance( { sceneSha256 }, sceneSha256 );
	assert.throws( () => assertSceneProvenance( {
		sceneSha256: '44b01befefa1f7182e763982f89080cd9da53757efe72d706c6269bf25c45422'
	}, sceneSha256 ), /Capture must use the current scene source/ );

} );

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

test( 'Gene gray/gray and retained Miku gray/white previews have valid dimensions, hashes and per-mode provenance', async () => {

	const gallery = await readFile( new URL( '../examples/index.html', import.meta.url ), 'utf8' );
	const scene = await readFile( new URL( '../examples/scene.ts', import.meta.url ) );
	const manifest = JSON.parse( await readFile( new URL( '../examples/screenshots/manifest.json', import.meta.url ), 'utf8' ) );
	assert.equal( manifest.version, 2 );
	assert.equal( manifest.method, 'npm run examples:capture' );
	assertSceneProvenance( manifest, sha256( scene ) );
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
		assert.deepEqual( entry.lighting, { ambient: 1, directional: 1, ambientColor: gene ? '0x888888' : '0xAAAAAA', directionalColor: gene ? '0x888888' : '0xffffff' } );
		assert.equal( entry.retained, false );
		assert.ok( ! Number.isNaN( Date.parse( entry.capturedAt ) ) );
		assert.match( entry.userAgent, /HeadlessChrome/ );
		if ( gene || ! manifest.retainedSceneReview ) {
			assert.equal( entry.sceneSha256, manifest.sceneSha256 );
			assert.equal( entry.capturedAt, manifest.capturedAt );
			assert.equal( entry.userAgent, manifest.userAgent );
		} else {
			assert.equal( manifest.retainedSceneReview.issue, 102 );
			assert.equal( manifest.retainedSceneReview.sceneSha256, sha256( scene ) );
			assert.equal( entry.sceneSha256, manifest.retainedSceneReview.previousSceneSha256 );
			// Prove the old PMD scene source differs only in Gene's two colors.
			assert.ok( [ sha256( scene ), sha256( Buffer.from( scene.toString().replace( "mode === 'gene' ? 0x888888 : 0xAAAAAA", '0xAAAAAA' ).replace( "mode === 'gene' ? 0x888888 : 0xffffff", '0xffffff' ) ) ) ].includes( entry.sceneSha256 ) );
		}
		assert.equal( entry.previousSha256, previousImages[ entry.page ], 'Record the replaced image' );
		assert.notEqual( entry.sha256, entry.previousSha256, 'Must preserve the replaced capture hash' );

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
		const checks = entry.checks;
		for ( const check of [ 'ready', 'realModel', 'lightIntensities', 'lightColors', 'lightDirection', 'camera', 'outlines', 'physics', 'render', 'noRuntimeErrors' ] ) assert.equal( checks[ check ], true, `${entry.page}: ${check}` );

	}
	assert.equal( new Set( manifest.entries.map( ( entry: { sha256: string } ) => entry.sha256 ) ).size, ids.length, 'Worker must have its own distinct capture' );
	// Browser checks exercise all modes; Gene alone selects gray/gray at 1/1.
	assert.match( scene.toString(), /new AmbientLight\( mode === 'gene' \? 0x888888 : 0xAAAAAA, 1 \)/ );
	assert.match( scene.toString(), /new DirectionalLight\( mode === 'gene' \? 0x888888 : 0xffffff, 1 \)/ );

} );
