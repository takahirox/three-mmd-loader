import { readFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath( new URL( '../', import.meta.url ) );
const types: Record<string, string> = {
	'.mjs': 'text/javascript; charset=utf-8',
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8', '.json': 'application/json',
	'.txt': 'text/plain', '.md': 'text/plain; charset=utf-8',
	'.bmp': 'image/bmp', '.png': 'image/png', '.jpg': 'image/jpeg',
	'.tga': 'application/octet-stream', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
	'.woff2': 'font/woff2'
};

// Serve only example files and their dependencies, including when used by tests.
export function createExamplesServer( { assetRoot = resolve( root, 'examples/assets/mmd' ) } = {} ) {

	const mounts: [ string, string ][] = [
		[ '/examples/assets/mmd/', assetRoot ],
		[ '/examples/', resolve( root, 'examples' ) ],
		[ '/src/', resolve( root, 'dist' ) ],
		[ '/node_modules/mmd-parser/build/', resolve( root, 'node_modules/mmd-parser/build' ) ],
		[ '/node_modules/three/', resolve( root, 'node_modules/three' ) ],
		[ '/node_modules/ammojs-typed/ammo/', resolve( root, 'node_modules/ammojs-typed/ammo' ) ]
	];
	return createServer( async ( request, response ) => {

		if ( request.method !== 'GET' && request.method !== 'HEAD' ) {

			response.writeHead( 405, { Allow: 'GET, HEAD' } ).end();
			return;

		}
		try {

			let path = decodeURIComponent( new URL( request.url || '/', 'http://localhost' ).pathname );
			if ( path === '/' ) {

				response.writeHead( 302, { Location: '/examples/' } ).end();
				return;

			}
			if ( path.endsWith( '/' ) ) path += 'index.html';
			const mount = mounts.find( ( [ prefix ] ) => path.startsWith( prefix ) );
			if ( ! mount ) throw new Error( 'Not served' );
			let [ prefix, directory ] = mount;
			if ( prefix === '/examples/' && path.endsWith( '.js' ) ) directory = resolve( root, 'dist/example-modules' );
			const base = await realpath( directory );
			const file = await realpath( resolve( directory, path.slice( prefix.length ) ) );
			if ( ! file.startsWith( base + sep ) ) throw new Error( 'Outside served directory' );
			const content = await readFile( file );
			response.writeHead( 200, {
				'Content-Type': types[ extname( file ).toLowerCase() ] || 'application/octet-stream',
				'Content-Length': content.length, 'Cache-Control': 'no-store'
			} );
			response.end( request.method === 'HEAD' ? undefined : content );

		} catch {

			response.writeHead( 404, { 'Content-Type': 'text/plain' } ).end( 'File not found' );

		}

	} );

}

if ( process.argv[ 1 ] && resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {

	const port = Number( process.env.PORT || 8080 );
	const server = createExamplesServer();
	server.on( 'error', error => { console.error( error.message ); process.exitCode = 1; } );
	server.listen( port, '127.0.0.1', () => {

		console.log( `MMD examples: http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/` );

	} );

}
