import type { MMDBone } from '../src/types.js';
import { product } from './bone-morph-reference.ts';

export interface Pose { position: number[]; rotation: number[] }
export const identity = () => [ 0, 0, 0, 1 ];
export function power( q: number[], ratio: number ) {

	const length = Math.hypot( ...q );
	q = q.map( v => v / length * ( q[ 3 ] < 0 ? - 1 : 1 ) );
	const angle = Math.acos( Math.min( 1, Math.max( - 1, q[ 3 ] ) ) );
	if ( angle < 1e-12 ) return identity();
	const multiplier = Math.sin( ratio * angle ) / Math.sin( angle );
	return [ ...q.slice( 0, 3 ).map( v => v * multiplier ), Math.cos( ratio * angle ) ];

}
export function rotate( q: number[], p: number[] ) {

	return product( product( q, [ ...p, 0 ] ), [ - q[ 0 ], - q[ 1 ], - q[ 2 ], q[ 3 ] ] ).slice( 0, 3 );

}
export const authoredGrantPose = ( data: MMDBone[], strength: number ): Pose[] => data.map( ( b, i ) => ( {
	position: b.pos.map( ( v, c ) => v + strength * [ 0.11 * ( i + 1 ), - 0.04 * ( i + 1 ), 0.07 * ( i + 1 ) ][ c ] ),
	rotation: power( [ ...[ [ 0.2, 0, 0 ], [ 0, 0.3, 0 ], [ 0, 0, - 0.4 ] ][ i % 3 ], Math.sqrt( 1 - [ 0.04, 0.09, 0.16 ][ i % 3 ] ) ], strength )
} ) );

// Scalar rigid-transform composition, independent of Three.js matrices and
// runtime solver. PMX bind rotations are identity and positions are model-space.
export function accumulated( data: MMDBone[], pose: Pose[], index: number ): Pose {

	const b = data[ index ], current = pose[ index ];
	if ( b.parent === - 1 ) return { position: current.position.slice(), rotation: current.rotation.slice() };
	const parent = accumulated( data, pose, b.parent );
	const offset = rotate( parent.rotation, current.position );
	return { position: parent.position.map( ( v, c ) => v + offset[ c ] ), rotation: product( parent.rotation, current.rotation ) };

}
export function referenceGrants( data: MMDBone[], base: Pose[] ): Pose[] {

	const pose = base.map( b => ( { position: b.position.slice(), rotation: b.rotation.slice() } ) );
	const rest = data.map( b => ( { position: b.pos, rotation: identity() } ) );
	const ordered = data.slice().sort( ( a, b ) => ( ( a.flag ?? 0 ) & 0x1000 ) - ( ( b.flag ?? 0 ) & 0x1000 ) || ( a.transformationClass ?? 0 ) - ( b.transformationClass ?? 0 ) || a.index - b.index );
	for ( const b of ordered ) {

		const g = b.grant;
		if ( ! g ) continue;
		const source = g.isLocal ? accumulated( data, pose, g.parentIndex ) : pose[ g.parentIndex ];
		const origin = g.isLocal ? accumulated( data, rest, g.parentIndex ).position : data[ g.parentIndex ].pos;
		if ( g.affectPosition ) pose[ b.index ].position = pose[ b.index ].position.map( ( v, c ) => v + ( source.position[ c ] - origin[ c ] ) * g.ratio );
		if ( g.affectRotation ) pose[ b.index ].rotation = product( pose[ b.index ].rotation, power( source.rotation, g.ratio ) );

	}
	return pose;

}
