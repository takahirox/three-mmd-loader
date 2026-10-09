import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowedFile, categories, checkedPath, decodeNotice, installBundle, limits, privateRoot, walkFiles, withModelLock } from './private-models.ts';
import { readModelZip } from './safe-model-zip.ts';

export async function importModels( input: string, { root = privateRoot, category = 'sdef' }: { root?: string; category?: string } = {} ) {

	if ( ! categories.includes( category ) ) throw new Error( `Unknown category: ${category}. Choose ${categories.join( ', ' )}` );
	if ( /^[a-z][a-z\d+.-]*:\/\//i.test( input ) ) throw new Error( 'Local paths only. URLs/protected downloads are never acquired by the importer.' );
	const path = resolve( input ), stat = await lstat( path );
	if ( stat.isSymbolicLink() ) throw new Error( 'Symlink source rejected' );
	let files: Map<string, Buffer>;
	if ( stat.isDirectory() ) {

		files = new Map();
		for ( const relative of await walkFiles( path ) ) {

			const bytes = await readFile( await checkedPath( path, relative ) ); allowedFile( relative, bytes ); files.set( relative, bytes );

		}

	} else if ( stat.isFile() && extname( path ).toLowerCase() === '.zip' ) {

		if ( stat.size > limits.archive ) throw new Error( 'ZIP archive size limit exceeded' );
		files = readModelZip( await readFile( path ) );

	} else throw new Error( 'Supply a local directory or ZIP archive containing PMX and textures.' );
	const hash = createHash( 'sha256' );
	for ( const [ relative, bytes ] of [ ...files ].sort( ( a, b ) => a[ 0 ] < b[ 0 ] ? -1 : a[ 0 ] > b[ 0 ] ? 1 : 0 ) ) { hash.update( `${Buffer.byteLength( relative )}:${relative}:${bytes.length}:` ).update( bytes ); }
	const id = 'import-' + category + '-' + hash.digest( 'hex' ).slice( 0, 16 );
	return withModelLock( root, () => installBundle( root, id, files ) );

}
if ( process.argv[ 1 ] && resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {

	try {

		const [ input, ...args ] = process.argv.slice( 2 );
		if ( ! input || ( args.length && ( args.length !== 2 || args[ 0 ] !== '--category' ) ) ) throw new Error( 'Usage: npm run models:import -- /path/to/model.zip-or-directory [--category sdef]' );
		const result = await importModels( input, { category: args[ 1 ] } );
		console.log( JSON.stringify( result, null, 2 ) );
		for ( const notice of [ ...new Set( result.models.flatMap( m => m.notices ) ) ].slice( 0, 16 ) ) console.log( `\nReview local terms ${notice}:\n` + decodeNotice( ( await readFile( await checkedPath( result.directory, notice ) ) ).subarray( 0, 65536 ) ) );
		console.log( 'Notice excerpts are limited to 16 text files/64 KiB each; inspect all original files listed in the report locally. Imported for local inspection only; no license is inferred. Review every upstream notice before use. Run npm run dev:sdef and choose the model in Installed models.' );

	} catch ( error ) { console.error( String( error ) ); process.exitCode = 1; }

}
