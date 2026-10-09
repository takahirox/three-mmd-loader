import { inflateRawSync } from 'node:zlib';
import { allowedFile, limits, safePath, uniquePaths } from './private-models.ts';

export function crc32( bytes: Uint8Array ) {

	let crc = 0xffffffff;
	for ( const byte of bytes ) { crc ^= byte; for ( let bit = 0; bit < 8; bit ++ ) crc = ( crc >>> 1 ) ^ ( ( crc & 1 ) ? 0xedb88320 : 0 ); }
	return ( crc ^ 0xffffffff ) >>> 0;

}
// ZIP only: stored/deflate, UTF-8 or legacy Japanese CP932 names. No external
// extractor, shell, credentials, ZIP64, encryption, links, or special files.
export function readModelZip( zip: Buffer ) {

	if ( zip.length > limits.archive || zip.length < 22 ) throw new Error( 'ZIP archive size limit/invalid archive' );
	let end = -1;
	for ( let i = zip.length - 22; i >= Math.max( 0, zip.length - 65557 ); i -- ) {

		if ( zip.readUInt32LE( i ) === 0x06054b50 && i + 22 + zip.readUInt16LE( i + 20 ) === zip.length ) { end = i; break; }

	}
	if ( end < 0 ) throw new Error( 'Invalid ZIP end record' );
	const count = zip.readUInt16LE( end + 10 ), size = zip.readUInt32LE( end + 12 ), offset = zip.readUInt32LE( end + 16 );
	if ( zip.readUInt16LE( end + 4 ) || zip.readUInt16LE( end + 6 ) || zip.readUInt16LE( end + 8 ) !== count || count > limits.files || count === 65535 || offset + size !== end ) throw new Error( 'ZIP boundaries, multi-volume/ZIP64 or entry limit rejected' );
	const entries: { path: string; data: number; compressed: number; expanded: number; method: number; crc: number; directory: boolean }[] = [];
	const ranges: [ number, number ][] = []; let cursor = offset, total = 0;
	for ( let i = 0; i < count; i ++ ) {

		if ( cursor + 46 > end || zip.readUInt32LE( cursor ) !== 0x02014b50 ) throw new Error( 'Invalid ZIP central directory' );
		const flags = zip.readUInt16LE( cursor + 8 ), method = zip.readUInt16LE( cursor + 10 ), crc = zip.readUInt32LE( cursor + 16 );
		const compressed = zip.readUInt32LE( cursor + 20 ), expanded = zip.readUInt32LE( cursor + 24 );
		const nameLength = zip.readUInt16LE( cursor + 28 ), extraLength = zip.readUInt16LE( cursor + 30 ), commentLength = zip.readUInt16LE( cursor + 32 );
		const attributes = zip.readUInt32LE( cursor + 38 ), local = zip.readUInt32LE( cursor + 42 );
		if ( flags & ~0x080e || ! [ 0, 8 ].includes( method ) || zip.readUInt16LE( cursor + 34 ) || cursor + 46 + nameLength + extraLength + commentLength > end ) throw new Error( 'Encrypted/unsupported ZIP or invalid entry boundary' );
		const nameBytes = zip.subarray( cursor + 46, cursor + 46 + nameLength );
		let path = new TextDecoder( flags & 0x800 ? 'utf-8' : 'shift_jis', { fatal: true } ).decode( nameBytes );
		// Backslashes are separators in many MMD archives, including Windows exports.
		path = path.replaceAll( '\\', '/' ); const directory = path.endsWith( '/' ); if ( directory ) path = path.slice( 0, -1 ); safePath( path );
		const mode = attributes >>> 16, kind = mode & 0xf000;
		if ( ( kind && kind !== ( directory ? 0x4000 : 0x8000 ) ) || ( ! directory && ( mode & 0x49 ) ) ) throw new Error( `ZIP symlink/special/executable mode rejected: ${path}` );
		if ( ! directory ) allowedFile( path );
		if ( expanded > limits.file || ( total += expanded ) > limits.total || ( expanded > 0 && ( compressed === 0 || expanded / compressed > limits.ratio ) ) || ( directory && expanded ) ) throw new Error( 'ZIP resource/compression ratio limit exceeded' );
		if ( local + 30 > offset || zip.readUInt32LE( local ) !== 0x04034b50 ) throw new Error( 'Invalid ZIP local header boundary' );
		const localName = zip.readUInt16LE( local + 26 ), localExtra = zip.readUInt16LE( local + 28 ), data = local + 30 + localName + localExtra;
		if ( data + compressed > offset || zip.readUInt16LE( local + 6 ) !== flags || zip.readUInt16LE( local + 8 ) !== method || ! zip.subarray( local + 30, local + 30 + localName ).equals( nameBytes ) ) throw new Error( 'ZIP local/central header mismatch or boundary violation' );
		if ( ! ( flags & 8 ) && ( zip.readUInt32LE( local + 14 ) !== crc || zip.readUInt32LE( local + 18 ) !== compressed || zip.readUInt32LE( local + 22 ) !== expanded ) ) throw new Error( 'ZIP local/central size or CRC mismatch' );
		let boundary = data + compressed;
		if ( flags & 8 ) {

			if ( boundary + 12 > offset ) throw new Error( 'ZIP descriptor boundary violation' );
			const descriptor = zip.readUInt32LE( boundary ) === 0x08074b50 ? boundary + 4 : boundary;
			if ( descriptor + 12 > offset || zip.readUInt32LE( descriptor ) !== crc || zip.readUInt32LE( descriptor + 4 ) !== compressed || zip.readUInt32LE( descriptor + 8 ) !== expanded ) throw new Error( 'ZIP descriptor mismatch' );
			boundary = descriptor + 12;

		}
		ranges.push( [ local, boundary ] ); entries.push( { path, data, compressed, expanded, method, crc, directory } );
		cursor += 46 + nameLength + extraLength + commentLength;

	}
	if ( cursor !== end ) throw new Error( 'ZIP directory size mismatch' );
	const names = new Set<string>(), spellings = new Map<string, string>();
	for ( const e of entries ) {

		const parts = e.path.split( '/' );
		for ( let i = 1; i <= parts.length; i ++ ) {

			const prefix = parts.slice( 0, i ).join( '/' ), normalized = prefix.normalize( 'NFC' ).toLowerCase();
			if ( spellings.has( normalized ) && spellings.get( normalized ) !== prefix ) throw new Error( `Case/Unicode ZIP directory collision: ${e.path}` );
			spellings.set( normalized, prefix );

		}
		const key = e.path.normalize( 'NFC' ).toLowerCase(); if ( names.has( key ) ) throw new Error( `Duplicate ZIP entry: ${e.path}` ); names.add( key );

	}
	uniquePaths( entries.filter( e => ! e.directory ).map( e => e.path ) );
	for ( const e of entries.filter( e => e.directory ) ) if ( entries.some( f => ! f.directory && e.path.startsWith( f.path + '/' ) ) ) throw new Error( 'ZIP file/directory collision' );
	ranges.sort( ( a, b ) => a[ 0 ] - b[ 0 ] );
	if ( ranges.length && ( ranges[ 0 ][ 0 ] !== 0 || ranges.at( -1 )![ 1 ] !== offset ) ) throw new Error( 'ZIP boundaries reject prepended/unaccounted content' );
	for ( let i = 1; i < ranges.length; i ++ ) if ( ranges[ i ][ 0 ] !== ranges[ i - 1 ][ 1 ] ) throw new Error( 'Unaccounted/overlapping ZIP entry boundaries' );
	const files = new Map<string, Buffer>();
	for ( const e of entries ) {

		const compressed = zip.subarray( e.data, e.data + e.compressed );
		const bytes = e.method === 0 ? Buffer.from( compressed ) : inflateRawSync( compressed, { maxOutputLength: Math.max( 1, e.expanded ) } );
		if ( bytes.length !== e.expanded || crc32( bytes ) !== e.crc ) throw new Error( `ZIP integrity/CRC failure: ${e.path}` );
		if ( e.directory ) continue;
		allowedFile( e.path, bytes ); files.set( e.path, bytes );

	}
	return files;

}
