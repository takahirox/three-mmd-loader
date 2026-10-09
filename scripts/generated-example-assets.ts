import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assetManifest } from './assets-manifest.ts';
import { cameraVmdBuffer, pmdBuffer, vmdBuffer } from '../tests/fixtures.ts';

/** Synthetic build validation only; never fetch or substitute licensed assets. */
export async function writeGeneratedExampleAssets( directory: string ) {

	const audio = Buffer.alloc( 44 + 8000 * 2 );
	audio.write( 'RIFF', 0 ); audio.writeUInt32LE( audio.length - 8, 4 ); audio.write( 'WAVEfmt ', 8 );
	audio.writeUInt32LE( 16, 16 ); audio.writeUInt16LE( 1, 20 ); audio.writeUInt16LE( 1, 22 );
	audio.writeUInt32LE( 8000, 24 ); audio.writeUInt32LE( 16000, 28 ); audio.writeUInt16LE( 2, 32 ); audio.writeUInt16LE( 16, 34 );
	audio.write( 'data', 36 ); audio.writeUInt32LE( 16000, 40 );
	for ( const { path } of assetManifest.files ) {

		let content: string | Buffer = 'Generated test fixture; contains no third-party model, motion or texture.\n';
		if ( path.endsWith( '.pmd' ) ) content = Buffer.from( pmdBuffer() );
		else if ( path.endsWith( '.vmd' ) ) content = Buffer.from( path.includes( 'camera' ) ? cameraVmdBuffer() : vmdBuffer() );
		else if ( path.endsWith( '.vpd' ) ) content = `Vocaloid Pose Data file\n\ntriangle.osm;\n1;\n\nBone0{root\n  ${Number( /([0-9]+)\.vpd$/.exec( path )?.[ 1 ] ?? 1 )}.0,0.0,0.0;\n  0.0,0.0,0.0,1.0;\n}\n`;
		else if ( path.endsWith( '.mp3' ) ) content = audio; // AudioLoader sniffs WAV bytes.
		else if ( /\.(bmp|png|jpg)$/.test( path ) ) content = Buffer.from( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64' );
		const target = join( directory, path );
		await mkdir( dirname( target ), { recursive: true } ); await writeFile( target, content );

	}

}
