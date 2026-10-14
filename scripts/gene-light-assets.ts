import manifest from './gene-light-manifest.json' with { type: 'json' };
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const geneLightManifest = manifest;
export const geneLightDirectory = fileURLToPath( new URL( '../examples/assets/gene-light/', import.meta.url ) );

export function verifyGeneLightFile( file: typeof manifest.files[number], bytes: Uint8Array ) {

	const hash = createHash( 'sha256' ).update( bytes ).digest( 'hex' );
	const blob = createHash( 'sha1' ).update( `blob ${bytes.length}\0` ).update( bytes ).digest( 'hex' );
	if ( bytes.length !== file.size || hash !== file.sha256 || blob !== file.sha ) {

		throw new Error( `Gene Light integrity mismatch: ${file.path} (expected ${file.size} bytes at ${manifest.commit}). Run npm run examples:assets.` );

	}

}

/** Public allowlist only; never reads the private model catalog. */
export async function fetchGeneLightAssets( directory = geneLightDirectory, fetcher: typeof fetch = fetch ) {

	for ( const file of manifest.files ) {

		const target = join( directory, file.path );
		const existing = await readFile( target ).catch( () => null );
		if ( existing ) {

			try { verifyGeneLightFile( file, existing ); continue; } catch { /* Replace a corrupt cache with verified upstream bytes. */ }

		}
		const url = `https://raw.githubusercontent.com/${manifest.repository}/${manifest.commit}/${file.path}`;
		const response = await fetcher( url, { signal: AbortSignal.timeout( 30000 ) } );
		if ( ! response.ok ) throw new Error( `Gene Light ${file.path}: HTTP ${response.status}` );
		const bytes = new Uint8Array( await response.arrayBuffer() );
		verifyGeneLightFile( file, bytes );
		await mkdir( dirname( target ), { recursive: true } );
		await writeFile( target, bytes );

	}

}
