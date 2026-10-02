import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const manifestName = 'deployment-manifest.json';
export const requiredPages = [
	'index.html', 'examples/index.html',
	'examples/webgl_loader_mmd.html', 'examples/webgl_loader_mmd_audio.html',
	'examples/webgl_loader_mmd_pose.html', 'src/loaders/MMDLoader.js'
];
export const sha256 = bytes => createHash( 'sha256' ).update( bytes ).digest( 'hex' );

export function validateManifest( manifest ) {

	if ( manifest.version !== 1 || ! /^[a-f0-9]{40}$/.test( manifest.commit ) ) throw new Error( 'Invalid deployment commit' );
	if ( ! Array.isArray( manifest.files ) || manifest.files.length === 0 ) throw new Error( 'Empty deployment manifest' );
	const paths = new Set();
	for ( const { path, sha256: hash } of manifest.files ) {

		// Manifest paths also become local backup paths: reject traversal and URL escapes.
		if ( typeof path !== 'string' || ! /^[a-zA-Z0-9_./-]+$/.test( path ) || path.startsWith( '/' ) ||
			path.split( '/' ).some( part => ! part || part === '.' || part === '..' ) ||
			path === manifestName || paths.has( path ) || ! /^[a-f0-9]{64}$/.test( hash ) ) {

			throw new Error( 'Invalid deployment file entry' );

		}
		paths.add( path );

	}
	for ( const path of requiredPages ) if ( ! paths.has( path ) ) throw new Error( `Missing example content: ${path}` );
	return manifest;

}

export async function writeManifest( directory, commit ) {

	const files = [];
	async function walk( prefix = '' ) {

		for ( const entry of await readdir( join( directory, prefix ), { withFileTypes: true } ) ) {

			const path = prefix + entry.name;
			if ( path === manifestName ) continue;
			if ( entry.isDirectory() ) await walk( path + '/' );
			else if ( entry.isFile() && path !== manifestName ) files.push( { path, sha256: sha256( await readFile( join( directory, path ) ) ) } );
			else throw new Error( `Unexpected site entry: ${path}` );

		}

	}
	await walk();
	files.sort( ( a, b ) => a.path.localeCompare( b.path ) );
	const manifest = validateManifest( { version: 1, commit, files } );
	await writeFile( join( directory, manifestName ), JSON.stringify( manifest, null, 2 ) + '\n' );
	return manifest;

}
