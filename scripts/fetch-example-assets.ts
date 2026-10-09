import { assetManifest as manifest } from './assets-manifest.ts';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';


const destination = new URL( '../examples/assets/mmd/', import.meta.url );

function gitHash( bytes: Uint8Array ) {

	return createHash( 'sha1' ).update( `blob ${bytes.length}\0` ).update( bytes ).digest( 'hex' );

}

if ( process.env.MMD_EXAMPLE_FIXTURES === '1' ) {

	console.log( 'Generated fixture build selected; no assets will be downloaded.' );

} else {
	console.log( 'Downloading the r171 MMD example assets for local use. See examples/README.md for asset terms and credits.' );
	for ( const { path, sha } of manifest.files ) {

		const target = new URL( path, destination );
		const existing = await readFile( target ).catch( () => null );
		if ( existing && gitHash( existing ) === sha ) continue;
		const url = `https://raw.githubusercontent.com/mrdoob/three.js/${manifest.commit}/examples/models/mmd/${path}`;
		const response = await fetch( url, { signal: AbortSignal.timeout( 30000 ) } );
		if ( ! response.ok ) throw new Error( `${path}: HTTP ${response.status}` );
		const bytes = Buffer.from( await response.arrayBuffer() );
		if ( gitHash( bytes ) !== sha ) throw new Error( `${path}: downloaded content does not match r171` );
		await mkdir( dirname( fileURLToPath( target ) ), { recursive: true } );
		await writeFile( target, bytes );
		console.log( path );

	}
	console.log( 'Assets ready. Run npm run dev and open http://127.0.0.1:8080/.' );

}
