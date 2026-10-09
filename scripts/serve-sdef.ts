import { checkedPath, decodeNotice, inspectDirectory, inspectInstalledBundles, privateRoot as managedRoot } from './private-models.ts';
import { grantPmxBuffer, physicsLayersPmxBuffer, sdefPmxBuffer, subtexturePmxBuffer, subtexturePngBuffer } from '../tests/fixtures.ts';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { createExamplesServer } from './serve-examples.ts';

const root = fileURLToPath( new URL( '../', import.meta.url ) );
const assetRoot = resolve( root, 'examples/assets/private/yyb-miku-10th' );
const groupMorphRoot = resolve( root, 'examples/assets/private/group-morph' );
const materialMorphRoot = resolve( root, 'examples/assets/private/material-morph' );
const physicsLayersRoot = resolve( root, 'examples/assets/private/physics-layers' );
const grantRoot = resolve( root, 'examples/assets/private/grant' );
const uvMorphRoot = resolve( root, 'examples/assets/private/uv-morph' );
const boneMorphRoot = resolve( root, 'examples/assets/private/bone-morph' );
const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.bmp': 'image/bmp', '.gif': 'image/gif', '.webp': 'image/webp', '.pmx': 'application/octet-stream', '.vmd': 'application/octet-stream', '.dds': 'application/octet-stream', '.tga': 'application/octet-stream', '.sph': 'image/bmp', '.spa': 'image/bmp' };

// A separate loopback-only entry. Public builds copy neither scripts nor
// local-viewer/, and npm's file allowlist excludes both and all example assets.
export function createSdefServer( { privateDirectory = assetRoot, boneMorphDirectory = boneMorphRoot, groupMorphDirectory = groupMorphRoot, materialMorphDirectory = materialMorphRoot, uvMorphDirectory = uvMorphRoot, grantDirectory = grantRoot, physicsLayersDirectory = physicsLayersRoot, modelsDirectory = resolve( managedRoot, 'models' ), installedExamplesDirectory = resolve( root, 'examples/assets/mmd' ) }: { privateDirectory?: string; boneMorphDirectory?: string; groupMorphDirectory?: string; materialMorphDirectory?: string; uvMorphDirectory?: string; grantDirectory?: string; physicsLayersDirectory?: string; modelsDirectory?: string; installedExamplesDirectory?: string } = {} ) {

	const directories: Record<string, string> = { 'yyb-miku-10th': privateDirectory, 'bone-morph': boneMorphDirectory, 'group-morph': groupMorphDirectory, 'material-morph': materialMorphDirectory, 'uv-morph': uvMorphDirectory, 'grant': grantDirectory, 'physics-layers': physicsLayersDirectory, 'models': modelsDirectory, 'installed-examples': installedExamplesDirectory };

	const dependencies = createExamplesServer();
	return createServer( async ( request, response ) => {

		if ( ! [ '127.0.0.1', '::1', '::ffff:127.0.0.1' ].includes( request.socket.remoteAddress ?? '' ) ) { response.writeHead( 403 ).end(); return; }
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

			} else if ( path === '/local-sdef/models.json' ) {

				const models = [], errors = [];
				for ( const [ directory, base ] of Object.entries( directories ) ) {

					try {

						const inspect = directory === 'models' ? inspectInstalledBundles : inspectDirectory;
						for ( const model of await inspect( base, message => errors.push( { directory, message: message.replaceAll( base, '[local directory]' ) } ) ) ) {

							const notices = [];
							for ( const notice of model.notices.slice( 0, 16 ) ) {

								const file = await checkedPath( base, notice );
								if ( ( await lstat( file ) ).size <= 65536 ) notices.push( { path: notice, text: decodeNotice( await readFile( file ) ) } );

							}
							models.push( { directory, ...model, noticePaths: model.notices, notices } );

						}

					} catch ( error ) {

						if ( ( error as NodeJS.ErrnoException ).code !== 'ENOENT' ) errors.push( { directory, message: String( error ).replaceAll( base, '[local directory]' ) } );

					}

				}
				content = JSON.stringify( { models, errors } ); type = 'application/json; charset=utf-8';

			} else if ( path === '/local-sdef/generated-physics-layers.pmx' ) {

				content = Buffer.from( physicsLayersPmxBuffer() ); type = 'application/octet-stream';

			} else if ( path === '/local-sdef/generated-grant.pmx' ) {

				content = Buffer.from( grantPmxBuffer() ); type = 'application/octet-stream';

			} else if ( path === '/local-sdef/generated-subtexture.pmx' ) {

				content = Buffer.from( subtexturePmxBuffer() ); type = 'application/octet-stream';

			} else if ( path === '/local-sdef/generated-subtexture.png' ) {

				content = subtexturePngBuffer(); type = 'image/png';

			} else if ( path === '/local-sdef/generated-uv.pmx' ) {

				content = Buffer.from( sdefPmxBuffer( { uvMorphs: true } ) ); type = 'application/octet-stream';

			} else if ( path === '/local-sdef/viewer.js' ) {

				content = ( await transform( await readFile( resolve( root, 'local-viewer/viewer.ts' ), 'utf8' ), { loader: 'ts', target: 'es2022', format: 'esm' } ) ).code;
				type = 'text/javascript; charset=utf-8';

			} else if ( path.startsWith( '/private-assets/' ) ) {

				const match = /^\/private-assets\/([^/]+)\/(.+)$/.exec( path );
				if ( ! match || ! directories[ match[ 1 ] ] ) throw new Error( 'Not a private directory' );
				if ( ( await lstat( directories[ match[ 1 ] ] ) ).isSymbolicLink() ) throw new Error( 'Private symlink root is not served' );
				const base = await realpath( directories[ match[ 1 ] ] );
				const parts = match[ 2 ].split( '/' );
				if ( parts.some( part => ! part || part.startsWith( '.' ) || part.includes( '\\' ) ) ) throw new Error( 'Invalid private path' );
				let candidate = base;
				for ( const part of parts ) {

					candidate = resolve( candidate, part );
					if ( ( await lstat( candidate ) ).isSymbolicLink() ) throw new Error( 'Private symlinks are not served' );

				}
				const file = await realpath( candidate );
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
