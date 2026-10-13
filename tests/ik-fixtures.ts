import { Bone, BufferGeometry, MeshBasicMaterial, Skeleton, SkinnedMesh, Vector3 } from 'three';
import type { IK, IKLink } from '../src/types.js';

export type Vec = [ number, number, number ];
// Scalar Rodrigues rotations provide expected positions independently of Three's
// quaternion/Euler decomposition and the implementation under test.
export function rotateAxis( v: Vec, axis: number, angle: number ): Vec {

	const result = v.slice() as Vec, a = ( axis + 1 ) % 3, b = ( axis + 2 ) % 3;
	result[ a ] = Math.cos( angle ) * v[ a ] - Math.sin( angle ) * v[ b ];
	result[ b ] = Math.sin( angle ) * v[ a ] + Math.cos( angle ) * v[ b ];
	return result;

}
export function rotateEuler( v: Vec, angles: Vec, order: string ): Vec {

	for ( const axis of [ ...order ].reverse() ) v = rotateAxis( v, 'XYZ'.indexOf( axis ), angles[ 'XYZ'.indexOf( axis ) ] );
	return v;

}
export function fixture( position: Vec, targetPosition: Vec, limits?: [ Vec, Vec ], iteration = 80, maxAngle = 0.2 ) {

	const mesh = new SkinnedMesh( new BufferGeometry(), new MeshBasicMaterial() );
	const link = new Bone(), effector = new Bone(), target = new Bone();
	effector.position.fromArray( position ); target.position.fromArray( targetPosition );
	link.add( effector ); mesh.add( link, target ); mesh.bind( new Skeleton( [ link, effector, target ] ) );
	const data: IKLink = { index: 0 };
	if ( limits ) { data.rotationMin = new Vector3().fromArray( limits[ 0 ] ); data.rotationMax = new Vector3().fromArray( limits[ 1 ] ); }
	const ik: IK = { target: 2, effector: 1, links: [ data ], iteration, maxAngle };
	mesh.updateMatrixWorld( true );
	const error = () => effector.getWorldPosition( new Vector3() ).distanceTo( target.getWorldPosition( new Vector3() ) );
	return { mesh, link, effector, target, ik, error };

}
export function hingeLimits( axis: number, min = -Math.PI, max = Math.PI ): [ Vec, Vec ] {

	const lower: Vec = [ 0, 0, 0 ], upper: Vec = [ 0, 0, 0 ]; lower[ axis ] = min; upper[ axis ] = max;
	return [ lower, upper ];

}
