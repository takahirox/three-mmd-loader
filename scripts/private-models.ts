// Explicit developer tools only. Never imported by a dependency lifecycle or public build.
import { Parser } from 'mmd-parser';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const privateRoot = fileURLToPath( new URL( '../examples/assets/private/', import.meta.url ) );
export const limits = { files: 4096, file: 64 * 1024 * 1024, total: 256 * 1024 * 1024, archive: 128 * 1024 * 1024, ratio: 200 };
export const categories = [ 'sdef', 'bone-morph', 'group-morph', 'material-morph', 'uv-morph', 'grant', 'physics-layers' ];
export interface SourceFile { path: string; sha: string; size: number }
export interface ModelSource { id: string; name: string; repository: string; commit: string; origin: string; reviewed: string; license: string; attribution: string; notices: string[]; files: SourceFile[]; inspection?: { parser: string; model: string; sha: string; features: Record<string, string> } }
export const sources = ( JSON.parse( await readFile( new URL( './model-sources.json', import.meta.url ), 'utf8' ) ) as { sources: ModelSource[] } ).sources;
export const gitHash = ( bytes: Uint8Array ) => createHash( 'sha1' ).update( `blob ${bytes.length}\0` ).update( bytes ).digest( 'hex' );

export function safePath( path: string ) {

	if ( ! path || path.length > 1024 || /[\\\x00-\x1f\x7f:?#]/.test( path ) || path.startsWith( '/' ) ) throw new Error( `Unsafe relative path: ${JSON.stringify( path )}` );
	const parts = path.split( '/' );
	if ( parts.length > 32 || parts.some( part => ! part || part === '.' || part === '..' || /[. ]$/.test( part ) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test( part ) ) ) throw new Error( `Unsafe relative path: ${JSON.stringify( path )}` );
	return path;

}
export function allowedFile( path: string, bytes?: Uint8Array ) {

	safePath( path );
	if ( ! /\.(?:pmx|pmd|vmd|vpd|png|jpe?g|bmp|gif|webp|tga|dds|sph|spa|txt|md)$/i.test( path ) && ! /(?:^|\/)(?:readme|licen[cs]e|copying|notice)$/i.test( path ) ) throw new Error( `Unsupported or executable content: ${path}. Import only models, textures, motions and text notices.` );
	if ( bytes ) {

		const b = Buffer.from( bytes );
		if ( b.subarray( 0, 2 ).toString() === 'MZ' || b.subarray( 0, 2 ).toString() === '#!' || b.subarray( 0, 4 ).equals( Buffer.from( [ 0x7f, 0x45, 0x4c, 0x46 ] ) ) || [ 'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca' ].includes( b.subarray( 0, 4 ).toString( 'hex' ) ) ) throw new Error( `Executable content: ${path}` );

	}

}
export function uniquePaths( paths: string[] ) {

	const seen = new Set<string>(), components = new Map<string, string>();
	for ( const path of paths ) {

		safePath( path ); const key = path.normalize( 'NFC' ).toLowerCase();
		const parts = path.split( '/' );
		for ( let i = 1; i <= parts.length; i ++ ) {

			const prefix = parts.slice( 0, i ).join( '/' ), normalized = prefix.normalize( 'NFC' ).toLowerCase();
			if ( components.has( normalized ) && components.get( normalized ) !== prefix ) throw new Error( `Case/Unicode directory collision: ${path}` );
			components.set( normalized, prefix );

		}
		if ( seen.has( key ) ) throw new Error( `Duplicate/case-colliding path: ${path}` );
		seen.add( key );

	}
	for ( const path of seen ) {

		let parent = dirname( path );
		while ( parent !== '.' ) { if ( seen.has( parent ) ) throw new Error( `File/directory collision: ${path}` ); parent = dirname( parent ); }

	}

}
export function validateSource( source: ModelSource ) {

	if ( ! /^[a-z0-9-]+$/.test( source.id ) || ! /^[\w-]+\/[\w.-]+$/.test( source.repository ) || ! /^[a-f0-9]{40}$/.test( source.commit ) || source.origin !== `https://github.com/${source.repository}` || ! source.license || ! source.attribution || ! source.reviewed ) throw new Error( 'Source must have reviewed provenance, terms and an exact GitHub commit.' );
	if ( ! source.files.length || source.files.length > limits.files || source.files.reduce( ( n, f ) => n + f.size, 0 ) > limits.total ) throw new Error( 'Source resource limit exceeded' );
	uniquePaths( source.files.map( f => f.path ) );
	for ( const f of source.files ) { allowedFile( f.path ); if ( ! /^[a-f0-9]{40}$/.test( f.sha ) || ! Number.isSafeInteger( f.size ) || f.size < 0 || f.size > limits.file ) throw new Error( `Invalid pinned file: ${f.path}` ); }
	if ( source.inspection && ! source.files.some( f => f.path === source.inspection!.model && f.sha === source.inspection!.sha ) ) throw new Error( 'Inspection must reference a pinned model hash' );
	if ( ! source.files.some( f => /\.pmx$/i.test( f.path ) ) || ! source.notices.length || source.notices.some( n => ! source.files.some( f => f.path === n ) ) ) throw new Error( 'Source requires PMX and pinned notices' );

}
for ( const source of sources ) validateSource( source );
export function selectSource( id: string ) {

	const source = sources.find( s => s.id === id );
	if ( ! source ) throw new Error( `Unsupported automatic source: ${id}. Only reviewed catalog IDs (${sources.map( s => s.id ).join( ', ' )}) are allowed; URLs/protected downloads are rejected. Acquire permitted models manually and use models:import. Generated fixtures remain available in dev:sdef.` );
	return source;

}

// Refuse links at every component inside an owned boundary before reading/writing.
export async function checkedPath( base: string, path: string, createParents = false ) {

	safePath( path );
	if ( ( await lstat( base ) ).isSymbolicLink() ) throw new Error( 'Symlink boundary rejected' );
	let current = base;
	const parts = path.split( '/' );
	for ( let i = 0; i < parts.length; i ++ ) {

		current = join( current, parts[ i ] );
		let stat = await lstat( current ).catch( ( error: NodeJS.ErrnoException ) => { if ( error.code === 'ENOENT' ) return null; throw error; } );
		if ( ! stat && createParents && i < parts.length - 1 ) { await mkdir( current ); stat = await lstat( current ); }
		if ( stat?.isSymbolicLink() || ( stat && i < parts.length - 1 && ! stat.isDirectory() ) ) throw new Error( `Symlink or non-directory boundary: ${path}` );

	}
	return current;

}
export async function prepareRoot( root: string ) {

	// Start at the existing parent; the default uses repository-local components.
	const parent = root === privateRoot ? resolve( privateRoot, '../../..' ) : dirname( root );
	const relative = root === privateRoot ? 'examples/assets/private' : root.slice( parent.length + 1 );
	await checkedPath( parent, relative + '/.boundary', true );

}
export async function walkFiles( root: string, strict = true ) {

	const files: string[] = []; let total = 0, entries = 0;
	if ( ( await lstat( root ) ).isSymbolicLink() ) throw new Error( 'Symlink source rejected' );
	async function walk( prefix: string ) {

		for ( const entry of await readdir( join( root, prefix ), { withFileTypes: true } ) ) {

			if ( ! strict && entry.name.startsWith( '.' ) ) continue;
			if ( ++ entries > limits.files ) throw new Error( 'Model entry limit exceeded' );
			const path = prefix ? prefix + '/' + entry.name : entry.name; safePath( path );
			const stat = await lstat( join( root, path ) );
			if ( stat.isSymbolicLink() ) { if ( strict ) throw new Error( `Symlink source rejected: ${path}` ); continue; }
			if ( stat.isDirectory() ) await walk( path );
			else if ( stat.isFile() ) {

				if ( stat.size > limits.file || ( total += stat.size ) > limits.total || files.length >= limits.files ) throw new Error( 'Model resource limit exceeded' );
				if ( strict ) { allowedFile( path ); if ( stat.mode & 0o111 ) throw new Error( `Executable source mode rejected: ${path}` ); } files.push( path );

			} else if ( strict ) throw new Error( `Special file rejected: ${path}` );

		}

	}
	await walk( '' ); uniquePaths( files ); return files.sort();

}
export function inspectPmx( bytes: Uint8Array ) {

	const buffer = Uint8Array.from( bytes ).buffer;
	const pmx = new Parser().parsePmx( buffer );
	const morphTypes = Array.from( { length: 9 }, ( _, type ) => pmx.morphs.filter( m => m.type === type ).length );
	const groupLinks: { group: number; target: number; type: number; ratio: number }[] = [];
	pmx.morphs.forEach( ( m, group ) => { if ( m.type === 0 ) for ( const e of m.elements ) { const target = pmx.morphs[ e.index ]; if ( target && Number.isFinite( e.ratio ) && [ 2, 3, 4, 5, 6, 7, 8 ].includes( target.type ) ) groupLinks.push( { group, target: e.index, type: target.type, ratio: e.ratio } ); } } );
	const sdef = pmx.vertices.filter( v => v.type === 3 ).length;
	const grants = pmx.bones.flatMap( ( b, index ) => b.grant ? [ { index, flag: b.flag, ...b.grant } ] : [] );
	const postPhysics = pmx.bones.filter( b => b.flag & 0x1000 ).length;
	const rigidBodyModes = [ 0, 1, 2 ].map( type => pmx.rigidBodies.filter( b => b.type === type ).length );
	const features = { sdef: sdef > 0, 'bone-morph': morphTypes[ 2 ] > 0, 'group-morph': groupLinks.length > 0, 'material-morph': morphTypes[ 8 ] > 0, 'uv-morph': morphTypes.slice( 3, 8 ).some( n => n > 0 ), grant: grants.length > 0, 'physics-layers': postPhysics > 0 && rigidBodyModes.slice( 1 ).some( n => n > 0 ) };
	return { name: pmx.metadata.modelName, sdef, morphTypes, groupLinks, additionalUVChannels: pmx.metadata.additionalUvNum, envFlag3: pmx.materials.filter( m => m.envFlag === 3 ).length, grants, prePhysicsBones: pmx.bones.length - postPhysics, postPhysicsBones: postPhysics, rigidBodyModes, features: Object.fromEntries( Object.entries( features ).map( ( [ key, present ] ) => [ key, present ? 'present (visual test not performed)' : 'not demonstrated' ] ) ), textures: pmx.textures };

}
export function decodeNotice( bytes: Uint8Array ) {

	const encoding = bytes[ 0 ] === 0xff && bytes[ 1 ] === 0xfe ? 'utf-16le' : bytes[ 0 ] === 0xfe && bytes[ 1 ] === 0xff ? 'utf-16be' : 'utf-8';
	try { return new TextDecoder( encoding, { fatal: true } ).decode( bytes ).replace( /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '' ); }
	catch { try { return new TextDecoder( 'shift_jis', { fatal: true } ).decode( bytes ).replace( /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '' ); } catch { return '[Text encoding unsupported; inspect the original notice locally.]'; } }

}
export async function inspectDirectory( root: string, onError?: ( message: string ) => void ) {

	const paths = await walkFiles( root, false );
	const models = [];
	const notices = paths.filter( p => /\.(?:txt|md)$/i.test( p ) || /(?:^|\/)(?:readme|licen[cs]e|copying|notice)$/i.test( p ) );
	for ( const path of paths.filter( p => /\.pmx$/i.test( p ) ) ) {

		try {

			let report;
			try { report = inspectPmx( await readFile( await checkedPath( root, path ) ) ); } catch ( error ) { throw new Error( `${path}: invalid/unsupported PMX: ${String( error )}` ); }
			for ( const texture of report.textures ) {

				if ( ! texture ) continue;
				const relative = texture.replaceAll( '\\', '/' );
				if ( /^[a-z]+:|^\//i.test( relative ) || /[\x00-\x1f?#]/.test( relative ) ) throw new Error( `${path}: unsafe texture ${texture}` );
				const dependency = join( dirname( path ), relative ).replaceAll( '\\', '/' ); safePath( dependency );
				if ( ! paths.includes( dependency ) ) throw new Error( `${path}: missing texture with exact case: ${texture}` );
				allowedFile( dependency );

			}
			models.push( { path, report, motions: paths.filter( p => /\.vmd$/i.test( p ) && ( dirname( path ) === '.' || p.startsWith( dirname( path ) + '/' ) ) ), notices: notices.filter( n => dirname( n ) === '.' || path.startsWith( dirname( n ) + '/' ) ) } );

		} catch ( error ) { if ( ! onError ) throw error; onError( String( error ) ); }

	}
	if ( ! models.length && ! onError ) throw new Error( 'No PMX found. Generated fixtures remain available in dev:sdef.' );
	return models;

}
// Installed bundles each passed the import/setup limits independently. Keep
// their discovery budgets and errors independent too, including nested paths.
export async function inspectInstalledBundles( root: string, onError: ( message: string ) => void ) {

	if ( ( await lstat( root ) ).isSymbolicLink() ) throw new Error( 'Symlink boundary rejected' );
	const models = [];
	for ( const entry of await readdir( root, { withFileTypes: true } ) ) {

		if ( entry.name.startsWith( '.' ) || ( ! entry.isDirectory() && ! entry.isSymbolicLink() ) ) continue;
		const reportError = ( message: string ) => onError( `${entry.name}: ${message}` );
		try {

			const bundle = await checkedPath( root, entry.name );
			for ( const model of await inspectDirectory( bundle, reportError ) ) {

				const prefix = ( path: string ) => entry.name + '/' + path;
				models.push( { ...model, path: prefix( model.path ), motions: model.motions.map( prefix ), notices: model.notices.map( prefix ) } );

			}

		} catch ( error ) { reportError( String( error ) ); }

	}
	return models;

}
export async function withModelLock<T>( root: string, action: () => Promise<T> ) {

	await prepareRoot( root );
	const lock = await checkedPath( root, '.models-lock' );
	await mkdir( lock ).catch( ( error: NodeJS.ErrnoException ) => { if ( error.code === 'EEXIST' ) throw new Error( 'Model setup/import already running (or stale .models-lock; inspect before removing).' ); throw error; } );
	try { return await action(); } finally { await rm( lock, { recursive: true, force: true } ); }

}
export async function installBundle( root: string, id: string, files: Map<string, Buffer> ) {

	if ( ! /^[a-z0-9-]+$/.test( id ) ) throw new Error( 'Invalid bundle ID' );
	await checkedPath( root, 'models/.boundary', true );
	const target = await checkedPath( root, 'models/' + id );
	const stage = await mkdtemp( join( root, 'models/.staging-' ) );
	let backup: string | undefined, installed = false;
	try {

		for ( const [ path, bytes ] of files ) { const file = await checkedPath( stage, path, true ); await writeFile( file, bytes, { flag: 'wx' } ); }
		const models = await inspectDirectory( stage );
		const existing = await lstat( target ).catch( ( e: NodeJS.ErrnoException ) => { if ( e.code === 'ENOENT' ) return null; throw e; } );
		if ( existing ) {

			const oldPaths = await walkFiles( target, false );
			if ( oldPaths.length === files.size && ( await Promise.all( oldPaths.map( async path => files.get( path )?.equals( await readFile( await checkedPath( target, path ) ) ) ) ) ).every( Boolean ) ) return { directory: target, models };
			backup = stage + '-previous'; await rename( target, backup );

		}
		try { await rename( stage, target ); installed = true; } catch ( error ) {

			if ( backup ) {

				try { await rename( backup, target ); backup = undefined; }
				catch { throw new Error( `Installation failed; previous assets preserved at ${backup}. Restore that directory before retrying. Cause: ${String( error )}` ); }

			}
			throw error;

		}
		return { directory: target, models };

	} finally { await rm( stage, { recursive: true, force: true } ); if ( backup && installed ) await rm( backup, { recursive: true, force: true } ); }

}

export async function setupSource( source: ModelSource, { root = privateRoot, offline = false, fetchFile = fetch, retries = 2 }: { root?: string; offline?: boolean; fetchFile?: typeof fetch; retries?: number } = {} ) {

	validateSource( source );
	return withModelLock( root, async () => {

		await checkedPath( root, '.cache/.boundary', true );
		const files = new Map<string, Buffer>();
		for ( const file of source.files ) {

			const cache = await checkedPath( root, '.cache/' + file.sha );
			const installed = await checkedPath( root, 'models/' + source.id + '/' + file.path );
			let bytes: Buffer | undefined;
			for ( const candidate of [ installed, cache ] ) {

				const stat = await lstat( candidate ).catch( ( e: NodeJS.ErrnoException ) => { if ( e.code === 'ENOENT' ) return null; throw e; } );
				if ( stat?.isFile() && stat.size === file.size ) { const content = await readFile( candidate ); if ( gitHash( content ) === file.sha ) { bytes = content; break; } }

			}
			if ( ! bytes && offline ) throw new Error( `${source.name}: ${file.path} has no verified local copy; run models:setup -- ${source.id} online. Generated fixtures remain available.` );
			if ( ! bytes ) {

				let failure: unknown;
				for ( let attempt = 0; attempt <= retries; attempt ++ ) {

					try {

						const url = `https://raw.githubusercontent.com/${source.repository}/${source.commit}/${file.path.split( '/' ).map( encodeURIComponent ).join( '/' )}`;
						const response = await fetchFile( url, { signal: AbortSignal.timeout( 30000 ), redirect: 'error', credentials: 'omit' } );
						if ( ! response.ok || ! response.body ) throw new Error( `HTTP ${response.status}` );
						const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
						try { while ( true ) { const { done, value } = await reader.read(); if ( done ) break; length += value.length; if ( length > file.size ) throw new Error( 'Response exceeds pinned size' ); chunks.push( value ); } } finally { await reader.cancel(); }
						const content = Buffer.concat( chunks );
						if ( content.length !== file.size || gitHash( content ) !== file.sha ) throw new Error( 'Integrity failure: size/Git blob checksum differs from pinned revision' );
						allowedFile( file.path, content ); bytes = content; break;

					} catch ( error ) { failure = error; }

				}
				if ( ! bytes ) throw new Error( `${source.name}: ${file.path}: ${String( failure )}. Source unavailable or unverified; existing assets preserved. Use generated fixtures; never substitute another source silently.` );

			}
			allowedFile( file.path, bytes );
			const cacheStat = await lstat( cache ).catch( () => null );
			const cacheBytes = cacheStat?.isFile() && cacheStat.size === bytes.length ? await readFile( cache ) : null;
			if ( ! cacheBytes?.equals( bytes ) ) { const temporary = cache + '.tmp'; await checkedPath( root, '.cache/' + file.sha + '.tmp' ); try { await writeFile( temporary, bytes, { flag: 'wx' } ); await rename( temporary, cache ); } finally { await rm( temporary, { force: true } ); } }
			files.set( file.path, bytes );

		}
		return installBundle( root, source.id, files );

	} );

}
