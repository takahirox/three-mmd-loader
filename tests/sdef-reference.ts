import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';

export interface SdefInput {
	position: number[];
	normal: number[];
	c: number[];
	r0: number[];
	r1: number[];
	weight: number;
}

// Independent CPU formulation using Three's Quaternion.slerp and matrix math.
// Derive corrected centers as (C + (C + Ri - Rw)) / 2, rather than mirroring
// the TSL graph. This module is test-only and never shipped with the runtime.
export function referenceSdef( input: SdefInput, bones: Matrix4[], bind = new Matrix4() ) {

	const inverse = bind.clone().invert();
	const c = new Vector3().fromArray( input.c ).applyMatrix4( bind );
	const r = [ input.r0, input.r1 ].map( value => new Vector3().fromArray( value ).applyMatrix4( bind ) );
	const weights = [ input.weight, 1 - input.weight ];
	const weighted = r[ 0 ].clone().multiplyScalar( weights[ 0 ] ).addScaledVector( r[ 1 ], weights[ 1 ] );
	const centers = r.map( value => value.clone().sub( weighted ).add( c ).add( c ).multiplyScalar( 0.5 ) );
	const rotations = bones.slice( 0, 2 ).map( bone => new Quaternion().setFromRotationMatrix( new Matrix4().extractRotation( bone ) ) );
	const rotation = rotations[ 0 ].slerp( rotations[ 1 ], weights[ 1 ] );
	const position = new Vector3().fromArray( input.position ).applyMatrix4( bind ).sub( c ).applyQuaternion( rotation );
	for ( let i = 0; i < 2; i ++ ) position.addScaledVector( centers[ i ].applyMatrix4( bones[ i ] ), weights[ i ] );
	position.applyMatrix4( inverse );
	const normal = new Vector3().fromArray( input.normal ).applyMatrix3( new Matrix3().setFromMatrix4( bind ) )
		.applyQuaternion( rotation ).applyMatrix3( new Matrix3().setFromMatrix4( inverse ) );
	return { position: position.toArray(), normal: normal.toArray() };

}

export function referenceBdef( position: number[], normal: number[], bones: Matrix4[], weights: number[], bind = new Matrix4() ) {

	const blended = new Matrix4();
	blended.elements.fill( 0 );
	for ( let i = 0; i < bones.length; i ++ ) {

		for ( let j = 0; j < 16; j ++ ) blended.elements[ j ] += bones[ i ].elements[ j ] * ( weights[ i ] ?? 0 );

	}
	const matrix = bind.clone().invert().multiply( blended ).multiply( bind );
	return {
		position: new Vector3().fromArray( position ).applyMatrix4( matrix ).toArray(),
		normal: new Vector3().fromArray( normal ).applyMatrix3( new Matrix3().setFromMatrix4( matrix ) ).toArray()
	};

}
