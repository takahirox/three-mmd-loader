import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface DeploymentFile { path: string; sha256: string }
export interface DeploymentManifest { version: 1; commit: string; state?: 'unpublished'; files: DeploymentFile[] }

export const manifestName = 'deployment-manifest.json';
export const requiredPages = [
	'index.html', 'examples/index.html',
	'examples/webgl_loader_mmd.html', 'examples/webgl_loader_mmd_audio.html',
	'examples/webgl_loader_mmd_pose.html', 'src/loaders/MMDLoader.js'
];
export const sha256 = ( bytes: string | Uint8Array ) => createHash( 'sha256' ).update( bytes ).digest( 'hex' );

export function validateManifest( value: unknown ): DeploymentManifest {

	if ( ! value || typeof value !== 'object' ) throw new Error( 'Invalid deployment commit' );
	const manifest = value as Partial<DeploymentManifest>;

	if ( manifest.version !== 1 || typeof manifest.commit !== 'string' || ! /^[a-f0-9]{40}$/.test( manifest.commit ) ) throw new Error( 'Invalid deployment commit' );
	if ( manifest.state !== undefined && manifest.state !== 'unpublished' ) throw new Error( 'Invalid deployment state' );
	if ( ! Array.isArray( manifest.files ) || manifest.files.length === 0 ) throw new Error( 'Empty deployment manifest' );
	const paths = new Set<string>();
	for ( const entry of manifest.files ) {

		if ( ! entry || typeof entry !== 'object' ) throw new Error( 'Invalid deployment file entry' );
		const { path, sha256: hash } = entry;

		// Manifest paths also become local backup paths: reject traversal and URL escapes.
		if ( typeof path !== 'string' || ! /^[a-zA-Z0-9_./-]+$/.test( path ) || path.startsWith( '/' ) ||
			path.split( '/' ).some( part => ! part || part === '.' || part === '..' ) ||
			path === manifestName || paths.has( path ) || typeof hash !== 'string' || ! /^[a-f0-9]{64}$/.test( hash ) ) {

			throw new Error( 'Invalid deployment file entry' );

		}
		paths.add( path );

	}
	const required = manifest.state === 'unpublished' ? [ '404.html' ] : requiredPages;
	for ( const path of required ) if ( ! paths.has( path ) ) throw new Error( `Missing example content: ${path}` );
	if ( manifest.state === 'unpublished' && paths.size !== required.length ) throw new Error( 'Unpublished recovery site must not contain examples' );
	return manifest as DeploymentManifest;

}

export async function writeUnpublishedSite( directory: string, commit: string ) {

	// First publication has no working site to restore. Restore HTTP 404 pages
	// using the same Pages/OIDC permission as ordinary rollback, without admin.
	await mkdir( directory, { recursive: true } );
	const content = {
		'404.html': '<!doctype html><html lang="en"><meta charset="utf-8"><title>Examples unavailable</title><p>The examples have not been published successfully yet.</p></html>\n'
	};
	const files: DeploymentFile[] = [];
	for ( const [ path, bytes ] of Object.entries( content ) ) {

		await writeFile( join( directory, path ), bytes );
		files.push( { path, sha256: sha256( bytes ) } );

	}
	const manifest = validateManifest( { version: 1, state: 'unpublished', commit, files } );
	await writeFile( join( directory, manifestName ), JSON.stringify( manifest, null, 2 ) + '\n' );
	return manifest;

}

export async function writeManifest( directory: string, commit: string ) {

	const files: DeploymentFile[] = [];
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
