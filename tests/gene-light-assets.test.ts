import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fetchGeneLightAssets, geneLightManifest, verifyGeneLightFile } from '../scripts/gene-light-assets.ts';

// Corrupt cached/downloaded bytes and missing notices must not silently enter
// the public site. No upstream traffic is needed for these failure tests.
test( 'public Gene manifest is a minimal immutable allowlist with notices, separate from private models', () => {

	assert.match( geneLightManifest.commit, /^[a-f0-9]{40}$/ );
	assert.equal( geneLightManifest.repository, 'mmdagent-ex/gene' );
	assert.equal( geneLightManifest.files.length, 13 );
	assert.equal( new Set( geneLightManifest.files.map( file => file.path ) ).size, 13 );
	for ( const file of geneLightManifest.files ) {

		assert.match( file.path, /^(?:Gene_light\.pmx|README(?:\.ja)?\.md|light\/[a-z0-9]+\.png)$/ );
		assert.match( file.sha, /^[a-f0-9]{40}$/ );
		assert.match( file.sha256, /^[a-f0-9]{64}$/ );
		assert.ok( file.size > 0 );
		assert.throws( () => verifyGeneLightFile( file, new Uint8Array( file.size ) ), /integrity mismatch/ );

	}

} );

test( 'Gene downloader pins requests and rejects corrupt cache, changed downloads and missing upstream files', async () => {

	const directory = await mkdtemp( join( tmpdir(), 'gene-integrity-' ) );
	try {

		await mkdir( directory, { recursive: true } );
		await writeFile( join( directory, 'Gene_light.pmx' ), 'bad cache' );
		let calls = 0;
		const changed: typeof fetch = async url => {

			calls ++;
			assert.equal( String( url ), `https://raw.githubusercontent.com/mmdagent-ex/gene/${geneLightManifest.commit}/Gene_light.pmx` );
			return new Response( 'changed bytes' );

		};
		await assert.rejects( fetchGeneLightAssets( directory, changed ), /Gene Light integrity mismatch: Gene_light.pmx/ );
		assert.equal( calls, 1 );
		assert.equal( await readFile( join( directory, 'Gene_light.pmx' ), 'utf8' ), 'bad cache' );
		await assert.rejects( fetchGeneLightAssets( directory, async () => new Response( '', { status: 404 } ) ), /Gene Light Gene_light.pmx: HTTP 404/ );

	} finally { await rm( directory, { recursive: true, force: true } ); }

} );
