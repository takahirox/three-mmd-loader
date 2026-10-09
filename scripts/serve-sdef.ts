import { grantPmxBuffer, sdefPmxBuffer } from '../tests/fixtures.ts';
import { readFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { createExamplesServer } from './serve-examples.ts';

const root = fileURLToPath( new URL( '../', import.meta.url ) );
const assetRoot = resolve( root, 'examples/assets/private/yyb-miku-10th' );
const groupMorphRoot = resolve( root, 'examples/assets/private/group-morph' );
const materialMorphRoot = resolve( root, 'examples/assets/private/material-morph' );
const grantRoot = resolve( root, 'examples/assets/private/grant' );
const uvMorphRoot = resolve( root, 'examples/assets/private/uv-morph' );
const boneMorphRoot = resolve( root, 'examples/assets/private/bone-morph' );
const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.bmp': 'image/bmp', '.gif': 'image/gif', '.webp': 'image/webp', '.pmx': 'application/octet-stream', '.vmd': 'application/octet-stream', '.tga': 'application/octet-stream', '.sph': 'image/bmp', '.spa': 'image/bmp' };

// A separate loopback-only entry. Public builds copy neither scripts nor
// local-viewer/, and npm's file allowlist excludes both and all example assets.
export function createSdefServer( { privateDirectory = assetRoot, boneMorphDirectory = boneMorphRoot, groupMorphDirectory = groupMorphRoot, materialMorphDirectory = materialMorphRoot, uvMorphDirectory = uvMorphRoot, grantDirectory = grantRoot }: { privateDirectory?: string; boneMorphDirectory?: string; groupMorphDirectory?: string; materialMorphDirectory?: string; uvMorphDirectory?: string; grantDirectory?: string } = {} ) {

	const directories: Record<string, string> = { 'yyb-miku-10th': privateDirectory, 'bone-morph': boneMorphDirectory, 'group-morph': groupMorphDirectory, 'material-morph': materialMorphDirectory, 'uv-morph': uvMorphDirectory, 'grant': grantDirectory };

	const dependencies = createExamplesServer();
	return createServer( async ( request, response ) => {

		if ( request.method !== 'GET' && request.method !== 'HEAD' ) { response.writeHead( 405 ).end(); return; }
		try {

			const path = decodeURIComponent( new URL( request.url || '/', 'http://localhost' ).pathname );
			if ( path.startsWith( '/src/' ) || path.startsWith( '/node_modules/' ) ) {

				dependencies.emit( 'request', request, response ); return;

			}
			let content: Buffer | string;
			let type: string;
			if ( path === '/' || path === '/local-sdef/' ) {

				content = await readFile( resolve( root, 'local-viewer/index.html' ) ); type = 'text/html; charset=utf-8';

			} else if ( path === '/local-sdef/generated-grant.pmx' ) {

				content = Buffer.from( grantPmxBuffer() ); type = 'application/octet-stream';

			} else if ( path === '/local-sdef/generated-uv.pmx' ) {

				content = Buffer.from( sdefPmxBuffer( { uvMorphs: true } ) ); type = 'application/octet-stream';

			} else if ( path === '/local-sdef/viewer.js' ) {

				content = ( await transform( await readFile( resolve( root, 'local-viewer/viewer.ts' ), 'utf8' ), { loader: 'ts', target: 'es2022', format: 'esm' } ) ).code;
				type = 'text/javascript; charset=utf-8';

			} else if ( path.startsWith( '/private-assets/' ) ) {

				const match = /^\/private-assets\/([^/]+)\/(.+)$/.exec( path );
				if ( ! match || ! directories[ match[ 1 ] ] ) throw new Error( 'Not a private directory' );
				const base = await realpath( directories[ match[ 1 ] ] );
				const file = await realpath( resolve( base, match[ 2 ] ) );
				if ( ! file.startsWith( base + sep ) || ! types[ extname( file ).toLowerCase() ] ) throw new Error( 'Not a local model asset' );
				content = await readFile( file ); type = types[ extname( file ).toLowerCase() ];

			} else throw new Error( 'Not served' );
			response.writeHead( 200, { 'Content-Type': type, 'Cache-Control': 'no-store' } );
			response.end( request.method === 'HEAD' ? undefined : content );

		} catch { response.writeHead( 404 ).end( 'File not found' ); }

	} );

}
if ( process.argv[ 1 ] && resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {

	const server = createSdefServer();
	server.on( 'error', error => { console.error( error.message ); process.exitCode = 1; } );
	server.listen( Number( process.env.PORT || 8081 ), '127.0.0.1', () => {

		console.log( `Private SDEF viewer: http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/local-sdef/` );

	} );

}
