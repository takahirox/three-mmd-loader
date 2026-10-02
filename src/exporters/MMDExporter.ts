import {
	Matrix4,
	Quaternion,
	Vector3
} from 'three';
import type { SkinnedMesh } from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { MMDParser } from '../libs/mmdparser.module.js';

/**
 * Dependencies
 *  - mmd-parser https://github.com/takahirox/mmd-parser
 */

class MMDExporter {

	/* TODO: implement
	// mesh -> pmd
	this.parsePmd = function ( object ) {

	};
	*/

	/* TODO: implement
	// mesh -> pmx
	this.parsePmx = function ( object ) {

	};
	*/

	/* TODO: implement
	// animation + skeleton -> vmd
	this.parseVmd = function ( object ) {

	};
	*/

	/*
	 * skeleton -> vpd
	 * Returns Shift_JIS encoded Uint8Array. Otherwise return strings.
	 */
	parseVpd( skin: SkinnedMesh, outputShiftJis?: false, useOriginalBones?: boolean ): string | null;
	parseVpd( skin: SkinnedMesh, outputShiftJis: true, useOriginalBones?: boolean ): Uint8Array | null;
	parseVpd( skin: SkinnedMesh, outputShiftJis: boolean, useOriginalBones?: boolean ): string | Uint8Array | null;
	parseVpd( skin: SkinnedMesh, outputShiftJis = false, useOriginalBones = false ): string | Uint8Array | null {

		if ( skin.isSkinnedMesh !== true ) {

			console.warn( 'THREE.MMDExporter: parseVpd() requires SkinnedMesh instance.' );
			return null;

		}

		function toStringsFromNumber( num: number ) {

			if ( Math.abs( num ) < 1e-6 ) num = 0;

			let a = num.toString();

			if ( a.indexOf( '.' ) === - 1 ) {

				a += '.';

			}

			a += '000000';

			const index = a.indexOf( '.' );

			const d = a.slice( 0, index );
			const p = a.slice( index + 1, index + 7 );

			return d + '.' + p;

		}

		function toStringsFromArray( array: number[] ) {

			const a = [];

			for ( let i = 0, il = array.length; i < il; i ++ ) {

				a.push( toStringsFromNumber( array[ i ] ) );

			}

			return a.join( ',' );

		}

		skin.updateMatrixWorld( true );

		const bones = skin.skeleton.bones;
		const bones2 = getBindBones( skin );

		const position = new Vector3();
		const quaternion = new Quaternion();
		const quaternion2 = new Quaternion();
		const matrix = new Matrix4();

		const array = [];
		array.push( 'Vocaloid Pose Data file' );
		array.push( '' );
		array.push( ( skin.name !== '' ? skin.name.replace( /\s/g, '_' ) : 'skin' ) + '.osm;' );
		array.push( bones.length + ';' );
		array.push( '' );

		for ( let i = 0, il = bones.length; i < il; i ++ ) {

			const bone = bones[ i ];
			const bone2 = bones2[ i ];

			/*
			 * use the bone matrix saved before solving IK.
			 * see CCDIKSolver for the detail.
			 */
			if ( useOriginalBones === true &&
				bone.userData.ik !== undefined &&
				bone.userData.ik.originalMatrix !== undefined ) {

				matrix.fromArray( bone.userData.ik.originalMatrix );

			} else {

				matrix.copy( bone.matrix );

			}

			position.setFromMatrixPosition( matrix );
			quaternion.setFromRotationMatrix( matrix );

			const pArray = position.sub( bone2.position ).toArray();
			const qArray = quaternion2.copy( bone2.quaternion ).conjugate().multiply( quaternion ).toArray();

			// right to left
			pArray[ 2 ] = - pArray[ 2 ];
			qArray[ 0 ] = - qArray[ 0 ];
			qArray[ 1 ] = - qArray[ 1 ];

			array.push( 'Bone' + i + '{' + bone.name );
			array.push( '  ' + toStringsFromArray( pArray ) + ';' );
			array.push( '  ' + toStringsFromArray( qArray ) + ';' );
			array.push( '}' );
			array.push( '' );

		}

		array.push( '' );

		const lines = array.join( '\n' );

		return ( outputShiftJis === true ) ? unicodeToShiftjis( lines ) : lines;

	}

}

// Unicode to Shift_JIS table
let u2sTable: Record<number, number> | undefined;

function unicodeToShiftjis( str: string ) {

	if ( u2sTable === undefined ) {

		const encoder = new MMDParser.CharsetEncoder();
		const table = encoder.s2uTable;
		u2sTable = {};

		const keys = Object.keys( table );

		for ( let i = 0, il = keys.length; i < il; i ++ ) {

			const key = keys[ i ];

			const value = table[ Number( key ) ];
			const code = parseInt( key );

			u2sTable[ value ] = code;

		}

	}

	const array = [];

	for ( let i = 0, il = str.length; i < il; i ++ ) {

		const code = str.charCodeAt( i );

		const value = u2sTable[ code ];

		if ( value === undefined ) {

			throw new Error( 'cannot convert charcode 0x' + code.toString( 16 ) );

		} else if ( value > 0xff ) {

			array.push( ( value >> 8 ) & 0xff );
			array.push( value & 0xff );

		} else {

			array.push( value & 0xff );

		}

	}

	return new Uint8Array( array );

}

function getBindBones( skin: SkinnedMesh ) {

	// any more efficient ways?
	// SkinnedMesh.clone() shares the skeleton and posing it changes the source.
	const poseSkin = clone( skin ) as SkinnedMesh;
	poseSkin.pose();
	return poseSkin.skeleton.bones;

}

export { MMDExporter };
