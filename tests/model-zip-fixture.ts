import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../scripts/safe-model-zip.ts';
export function modelZip( files: { path: string; bytes: Buffer; mode?: number; method?: number; flags?: number; encodedName?: Buffer }[] ) {

	const locals: Buffer[] = [], centrals: Buffer[] = []; let offset = 0;
	for ( const { path, bytes, mode = 0o100644, method = 8, flags = 0x800, encodedName } of files ) {

		const name = encodedName ?? Buffer.from( path ), compressed = method === 8 ? deflateRawSync( bytes ) : bytes;
		const local = Buffer.alloc( 30 ); local.writeUInt32LE( 0x04034b50 ); local.writeUInt16LE( 20, 4 ); local.writeUInt16LE( flags, 6 ); local.writeUInt16LE( method, 8 );
		if ( ! ( flags & 8 ) ) { local.writeUInt32LE( crc32( bytes ), 14 ); local.writeUInt32LE( compressed.length, 18 ); local.writeUInt32LE( bytes.length, 22 ); }
		local.writeUInt16LE( name.length, 26 );
		const descriptor = flags & 8 ? Buffer.alloc( 16 ) : Buffer.alloc( 0 );
		if ( descriptor.length ) { descriptor.writeUInt32LE( 0x08074b50 ); descriptor.writeUInt32LE( crc32( bytes ), 4 ); descriptor.writeUInt32LE( compressed.length, 8 ); descriptor.writeUInt32LE( bytes.length, 12 ); }
		locals.push( local, name, compressed, descriptor );
		const central = Buffer.alloc( 46 ); central.writeUInt32LE( 0x02014b50 ); central.writeUInt16LE( 0x314, 4 ); central.writeUInt16LE( 20, 6 ); central.writeUInt16LE( flags, 8 ); central.writeUInt16LE( method, 10 ); central.writeUInt32LE( crc32( bytes ), 16 ); central.writeUInt32LE( compressed.length, 20 ); central.writeUInt32LE( bytes.length, 24 ); central.writeUInt16LE( name.length, 28 ); central.writeUInt32LE( ( mode << 16 ) >>> 0, 38 ); central.writeUInt32LE( offset, 42 );
		centrals.push( central, name ); offset += local.length + name.length + compressed.length + descriptor.length;

	}
	const end = Buffer.alloc( 22 ); end.writeUInt32LE( 0x06054b50 ); end.writeUInt16LE( files.length, 8 ); end.writeUInt16LE( files.length, 10 ); end.writeUInt32LE( Buffer.concat( centrals ).length, 12 ); end.writeUInt32LE( offset, 16 );
	return Buffer.concat( [ ...locals, ...centrals, end ] );

}
