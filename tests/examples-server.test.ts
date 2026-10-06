import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExamplesServer } from '../scripts/serve-examples.ts';

test( 'example server serves local modules with MIME types and limits file access', async () => {

	const server = createExamplesServer();
	await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
	const base = `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}`;
	try {

		for ( const [ path, type ] of [
			[ '/', 'text/html' ],
			[ '/examples/webgl_loader_mmd_audio.html', 'text/html' ],
			[ '/examples/scene.js', 'text/javascript' ],
			[ '/examples/browser.js', 'text/javascript' ],
			[ '/examples/browser.css', 'text/css' ],
			[ '/examples/screenshots/webgl_loader_mmd.jpg', 'image/jpeg' ],
			[ '/examples/fonts/RobotoMono-Regular.woff2', 'font/woff2' ],
			[ '/node_modules/mmd-parser/build/mmdparser.module.mjs', 'text/javascript' ],
			[ '/src/loaders/MMDLoader.js', 'text/javascript' ],
			[ '/node_modules/three/build/three.module.js', 'text/javascript' ],
			[ '/node_modules/ammojs-typed/ammo/ammo.js', 'text/javascript' ]
		] ) {

			const response = await fetch( base + path );
			assert.equal( response.status, 200, path );
			if ( path === '/' ) assert.equal( new URL( response.url ).pathname, '/examples/' );
			assert.ok( response.headers.get( 'content-type' )?.startsWith( type ), path );
			assert.ok( ( await response.arrayBuffer() ).byteLength > 0, path );

		}
		for ( const path of [ '/src/libs/mmdparser.module.js', '/package.json', '/.git/config', '/examples/missing.js', '/examples/%2e%2e%2fpackage.json' ] ) {

			const response = await fetch( base + path );
			assert.equal( response.status, 404, path );
			await response.text();

		}
		const head = await fetch( base + '/examples/common.css', { method: 'HEAD' } );
		assert.equal( head.status, 200 );
		assert.equal( await head.text(), '' );
		const post = await fetch( base + '/', { method: 'POST' } );
		assert.equal( post.status, 405 );
		await post.text();

	} finally {

		await new Promise( resolve => server.close( resolve ) );

	}

} );
