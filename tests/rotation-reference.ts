import { Matrix4, Quaternion, Vector3 } from 'three';
import type { AmmoTransform } from '../src/ammo.js';

export const rotationCases = [
	{ name: 'identity', angles: [ 0, 0, 0 ], differs: false },
	{ name: 'X only', angles: [ 0.7, 0, 0 ], differs: false },
	{ name: 'Y only', angles: [ 0, -0.9, 0 ], differs: false },
	{ name: 'Z only', angles: [ 0, 0, 1.1 ], differs: false },
	{ name: 'mixed', angles: [ 0.43, -0.71, 1.13 ], differs: true },
	{ name: 'near YXZ singularity', angles: [ Math.PI / 2 - 1e-5, -0.6, 0.9 ], differs: true },
	{ name: 'near pi', angles: [ Math.PI - 1e-5, 0.8, -Math.PI + 1e-5 ], differs: true },
	{ name: 'negative and wrapped', angles: [ -2.4, 4.2, -3.8 ], differs: true }
];

// Independent row-major scalar matrix oracle. No Euler or quaternion Euler
// conversion is used. The joint oracle consumes already converted parser angles.
function multiply( a: number[], b: number[] ) {

	return Array.from( { length: 9 }, ( _, i ) => {

		const row = Math.floor( i / 3 ), col = i % 3;
		return a[ row * 3 ] * b[ col ] + a[ row * 3 + 1 ] * b[ col + 3 ] + a[ row * 3 + 2 ] * b[ col + 6 ];

	} );

}
function scalarRotation( angles: number[], order: 'YXZ' | 'XYZ' ) {

	const [ x, y, z ] = angles;
	const cx = Math.cos( x ), sx = Math.sin( x ), cy = Math.cos( y ), sy = Math.sin( y ), cz = Math.cos( z ), sz = Math.sin( z );
	const rx = [ 1, 0, 0, 0, cx, -sx, 0, sx, cx ];
	const ry = [ cy, 0, sy, 0, 1, 0, -sy, 0, cy ];
	const rz = [ cz, -sz, 0, sz, cz, 0, 0, 0, 1 ];
	return order === 'YXZ' ? multiply( multiply( ry, rx ), rz ) : multiply( multiply( rx, ry ), rz );

}
function matrixFromRows( r: number[] ) {

	return new Matrix4().set( r[ 0 ], r[ 1 ], r[ 2 ], 0, r[ 3 ], r[ 4 ], r[ 5 ], 0, r[ 6 ], r[ 7 ], r[ 8 ], 0, 0, 0, 0, 1 );

}
export function rightHandedRotation( angles: number[], order: 'YXZ' | 'XYZ' = 'YXZ' ) {

	return matrixFromRows( scalarRotation( angles, order ) );

}
// Keep the original body oracle: round binary angles, compose in the original
// coordinate system, then reflect with S R S. This independently checks the
// parser's X/Y sign conversion against the joint oracle above.
export function reflectedRotation( angles: number[], order: 'YXZ' | 'XYZ' = 'YXZ' ) {

	const s = [ 1, 0, 0, 0, 1, 0, 0, 0, -1 ];
	return matrixFromRows( multiply( multiply( s, scalarRotation( angles.map( Math.fround ), order ) ), s ) );

}
export function resultMatrix( pose: { position: number[]; quaternion: number[] } ) {

	return new Matrix4().compose( new Vector3().fromArray( pose.position ), new Quaternion().fromArray( pose.quaternion ), new Vector3( 1, 1, 1 ) );

}
export function ammoMatrix( transform: AmmoTransform ) {

	const p = transform.getOrigin(), q = transform.getRotation();
	return resultMatrix( { position: [ p.x(), p.y(), p.z() ], quaternion: [ q.x(), q.y(), q.z(), q.w() ] } );

}
