import { authoredBoneMorphs } from './fixtures.ts';

// Independent scalar Hamilton product and axis/angle interpolation, rather
// than the runtime's Quaternion.multiply/slerp. Inputs match PMX float32 bytes.
export function product( a: number[], b: number[] ) {

	const [ x, y, z, w ] = a, [ X, Y, Z, W ] = b;
	return [ w * X + x * W + y * Z - z * Y, w * Y - x * Z + y * W + z * X, w * Z + x * Y - y * X + z * W, w * W - x * X - y * Y - z * Z ];

}
export function weightedRotation( source: number[], weight: number ) {

	let q = source.map( Math.fround ).map( ( v, i ) => i < 2 ? - v : v );
	const norm = Math.hypot( ...q ); q = q.map( v => v / norm );
	if ( q[ 3 ] < 0 ) q = q.map( v => - v );
	const sine = Math.hypot( ...q.slice( 0, 3 ) );
	if ( sine === 0 ) return [ 0, 0, 0, 1 ];
	const halfAngle = Math.atan2( sine, q[ 3 ] ) * weight;
	return [ ...q.slice( 0, 3 ).map( v => v / sine * Math.sin( halfAngle ) ), Math.cos( halfAngle ) ];

}
export function referenceBonePose( weights: number[], base?: { position: number[]; rotation: number[] }[] ) {

	const bones = base?.map( b => ( { position: b.position.slice(), rotation: b.rotation.slice() } ) ) ?? Array.from( { length: 4 }, ( _, i ) => ( { position: [ Math.fround( i * 0.2 ), Math.fround( i * 0.1 ), - Math.fround( i * - 0.15 ) ], rotation: [ 0, 0, 0, 1 ] } ) );
	const offsets = bones.map( () => [ 0, 0, 0, 1 ] );
	for ( const [ i, morph ] of authoredBoneMorphs.entries() ) {

		for ( const element of morph.elements ) {

			const bone = bones[ element.index ], weight = weights[ i ] ?? 0;
			bone.position = bone.position.map( ( v, c ) => v + Math.fround( element.position[ c ] ) * ( c === 2 ? - 1 : 1 ) * weight );
			offsets[ element.index ] = product( offsets[ element.index ], weightedRotation( element.rotation, weight ) );

		}

	}
	bones.forEach( ( bone, i ) => { bone.rotation = product( offsets[ i ], bone.rotation ); } );
	return bones;

}
