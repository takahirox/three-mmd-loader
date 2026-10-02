import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test( 'shared example stylesheet preserves the official Three.js reference blob', async () => {

	const css = await readFile( new URL( '../examples/main.css', import.meta.url ) );
	const hash = createHash( 'sha1' ).update( `blob ${css.length}\0` ).update( css ).digest( 'hex' );
	assert.equal( hash, 'd496122b4cfb54f811495bd9f80ca48151beeb3b' );
	const shared = await readFile( new URL( '../examples/common.css', import.meta.url ), 'utf8' );
	assert.match( shared, /@import url\('\.\/main\.css'\);/ );
	for ( const name of [ 'index', 'webgl_loader_mmd', 'webgl_loader_mmd_audio', 'webgl_loader_mmd_pose' ] ) {

		const html = await readFile( new URL( `../examples/${name}.html`, import.meta.url ), 'utf8' );
		assert.match( html, /<link rel="stylesheet" href="\.\/common\.css">/, name );
		assert.doesNotMatch( html, /<style\b|\bstyle=|class="panel"|<fieldset\b/, name );

	}

} );
