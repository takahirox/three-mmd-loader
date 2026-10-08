import type { SkinnedMesh, Texture } from 'three';
import type { Node, NodeBuilder, NodeMaterial } from 'three/webgpu';
import {
	Fn, If, OnObjectUpdate, acos, attribute, float, int, ivec2, mat3, mat4,
	materialReference, mix, morphReference, normalLocal, positionLocal, reference,
	referenceBuffer, sin, skinning, subBuild, tangentLocal, texture, textureSize, vec4
} from 'three/tsl';

// See docs/sdef.md for input spaces, the reference formula and r186 integration.
const rotationQuaternion = Fn( ( [ matrix ]: [ Node<'mat4'> ] ) => {

	// Normalize columns: SDEF interpolates rotations, not bone scale.
	const x = ( matrix as unknown as { element( i: number ): Node<'vec4'> } ).element( 0 ).xyz.normalize();
	const y = ( matrix as unknown as { element( i: number ): Node<'vec4'> } ).element( 1 ).xyz.normalize();
	const z = ( matrix as unknown as { element( i: number ): Node<'vec4'> } ).element( 2 ).xyz.normalize();
	const trace = x.x.add( y.y ).add( z.z );
	const q = vec4().toVar();
	If( trace.greaterThan( 0 ), () => {

		const s = trace.add( 1 ).sqrt().mul( 2 );
		q.assign( vec4( y.z.sub( z.y ).div( s ), z.x.sub( x.z ).div( s ), x.y.sub( y.x ).div( s ), s.mul( 0.25 ) ) );

	} ).ElseIf( x.x.greaterThan( y.y ).and( x.x.greaterThan( z.z ) ), () => {

		const s = float( 1 ).add( x.x ).sub( y.y ).sub( z.z ).max( 0 ).sqrt().mul( 2 );
		q.assign( vec4( s.mul( 0.25 ), x.y.add( y.x ).div( s ), x.z.add( z.x ).div( s ), y.z.sub( z.y ).div( s ) ) );

	} ).ElseIf( y.y.greaterThan( z.z ), () => {

		const s = float( 1 ).add( y.y ).sub( x.x ).sub( z.z ).max( 0 ).sqrt().mul( 2 );
		q.assign( vec4( x.y.add( y.x ).div( s ), s.mul( 0.25 ), y.z.add( z.y ).div( s ), z.x.sub( x.z ).div( s ) ) );

	} ).Else( () => {

		const s = float( 1 ).add( z.z ).sub( x.x ).sub( y.y ).max( 0 ).sqrt().mul( 2 );
		q.assign( vec4( x.z.add( z.x ).div( s ), y.z.add( z.y ).div( s ), s.mul( 0.25 ), x.y.sub( y.x ).div( s ) ) );

	} );
	return q.normalize();

} );

const slerp = Fn( ( [ a, b, weight ]: [ Node<'vec4'>, Node<'vec4'>, Node<'float'> ] ) => {

	const cosine = a.dot( b );
	const end = cosine.lessThan( 0 ).select( b.negate(), b );
	const dot = cosine.abs().clamp( 0, 1 );
	const q = vec4().toVar();
	If( dot.greaterThan( 0.9995 ), () => {

		q.assign( mix( a, end, weight ).normalize() );

	} ).Else( () => {

		const angle = acos( dot );
		q.assign( a.mul( sin( float( 1 ).sub( weight ).mul( angle ) ) ).add( end.mul( sin( weight.mul( angle ) ) ) ).div( sin( angle ) ) );

	} );
	return q;

} );

const rotate = Fn( ( [ q, v ]: [ Node<'vec4'>, Node<'vec3'> ] ) => {

	return v.add( q.xyz.cross( q.xyz.cross( v ).add( v.mul( q.w ) ) ).mul( 2 ) );

} );

interface BoneMatrices { element( index: Node<'uint'> ): Node<'mat4'> }
type R186Builder = NodeBuilder & { getUniformBufferLimit(): number };

// Match r186's uniform-buffer / bone-texture selection. References track the
// rendered object, so cached materials can be shared by different skeletons.
function boneMatrices( builder: NodeBuilder, mesh: SkinnedMesh ): BoneMatrices {

	if ( mesh.skeleton.bones.length * 64 <= ( builder as R186Builder ).getUniformBufferLimit() ) {

		return referenceBuffer( 'skeleton.boneMatrices', 'mat4', mesh.skeleton.bones.length, undefined ) as unknown as BoneMatrices;

	}
	if ( mesh.skeleton.boneTexture === null ) mesh.skeleton.computeBoneTexture();
	const bones = texture( mesh.skeleton.boneTexture! );
	OnObjectUpdate( ( { object } ) => {

		const skeleton = ( object as SkinnedMesh ).skeleton;
		if ( skeleton.boneTexture === null ) skeleton.computeBoneTexture();
		bones.value = skeleton.boneTexture!;

	} );
	return { element: index => {

		const size = int( ( textureSize( bones ) as unknown as Node<'uvec2'> ).x );
		const j = int( index ).mul( 4 );
		const y = j.div( size );
		const x = j.sub( y.mul( size ) );
		return mat4( bones.load( ivec2( x, y ) ), bones.load( ivec2( x.add( 1 ), y ) ), bones.load( ivec2( x.add( 2 ), y ) ), bones.load( ivec2( x.add( 3 ), y ) ) );

	} };

}

const sdefSkinning = Fn( ( builder ) => {

	const mesh = builder.object as SkinnedMesh;
	const matrices = boneMatrices( builder, mesh );
	const index = attribute( 'skinIndex', 'uvec4' );
	const weight = attribute( 'skinWeight', 'vec4' );
	const bind = reference( 'bindMatrix', 'mat4', undefined );
	const inverse = reference( 'bindMatrixInverse', 'mat4', undefined );
	const m0 = matrices.element( index.x ).toVar();
	const m1 = matrices.element( index.y ).toVar();
	const c = bind.mul( vec4( attribute( 'mmdSdefC', 'vec3' ), 1 ) ).xyz.toVar();
	const r0 = bind.mul( vec4( attribute( 'mmdSdefR0', 'vec3' ), 1 ) ).xyz;
	const r1 = bind.mul( vec4( attribute( 'mmdSdefR1', 'vec3' ), 1 ) ).xyz;
	const rw = r0.mul( weight.x ).add( r1.mul( weight.y ) ).toVar();
	const cr0 = c.add( r0.sub( rw ).mul( 0.5 ) );
	const cr1 = c.add( r1.sub( rw ).mul( 0.5 ) );
	const q = slerp( rotationQuaternion( m0 ), rotationQuaternion( m1 ), weight.y ).toVar();
	const offset = m0.mul( vec4( cr0, 1 ) ).xyz.mul( weight.x ).add( m1.mul( vec4( cr1, 1 ) ).xyz.mul( weight.y ) );
	const p = rotate( q, bind.mul( vec4( positionLocal, 1 ) ).xyz.sub( c ) ).add( offset );
	positionLocal.assign( inverse.mul( vec4( p, 1 ) ).xyz );
	if ( builder.geometry.hasAttribute( 'normal' ) ) {

		normalLocal.assign( mat3( inverse ).mul( rotate( q, mat3( bind ).mul( normalLocal ) ) ) );
		if ( builder.geometry.hasAttribute( 'tangent' ) ) tangentLocal.assign( mat3( inverse ).mul( rotate( q, mat3( bind ).mul( tangentLocal ) ) ) );

	}

}, 'void' );

export function hasSdef( builder: NodeBuilder ): boolean {

	return ( builder.object as SkinnedMesh ).isSkinnedMesh === true && builder.geometry.hasAttribute( 'mmdSdefC' );

}

type DeformationMaterial = NodeMaterial & { displacementMap?: Texture | null };

/** r186's morph → skin → displacement → position-node order for SDEF meshes. */
export function setupMMDPosition( material: DeformationMaterial, builder: NodeBuilder ) {

	const { geometry } = builder;
	const mesh = builder.object as SkinnedMesh;
	if ( geometry.morphAttributes.position || geometry.morphAttributes.normal || geometry.morphAttributes.color ) morphReference( mesh );
	If( attribute( 'mmdSkinningType', 'float' ).equal( 3 ), () => {

		sdefSkinning();

	} ).Else( () => {

		// Retain Three's BDEF code and its frame-scoped skeleton update event.
		// Events are registered while building, independently of the GPU branch.
		skinning( mesh );

	} );
	if ( material.displacementMap ) {

		const map = materialReference( 'displacementMap', 'texture' ) as unknown as Node<'vec4'>;
		const scale = materialReference( 'displacementScale', 'float' ) as unknown as Node<'float'>;
		const bias = materialReference( 'displacementBias', 'float' ) as unknown as Node<'float'>;
		positionLocal.addAssign( normalLocal.normalize().mul( map.x.mul( scale ).add( bias ) ) );

	}
	if ( material.positionNode !== null ) positionLocal.assign( subBuild( material.positionNode, 'POSITION', 'vec3' ) as unknown as Node<'vec3'> );
	return positionLocal;

}

/** Scope r186's shadow override setup to this draw, without patching Three. */
export function enableSdefShadows( mesh: SkinnedMesh ) {

	let restore: ( () => void ) | undefined;
	mesh.onBeforeShadow = ( _renderer, _object, _camera, _shadowCamera, _geometry, shadowMaterial ) => {

		const material = shadowMaterial as DeformationMaterial;
		const original = material.setupPosition;
		material.setupPosition = function ( builder ) {

			return hasSdef( builder ) ? setupMMDPosition( this, builder ) : original.call( this, builder );

		};
		restore = () => { material.setupPosition = original; };

	};
	mesh.onAfterShadow = () => { restore?.(); restore = undefined; };

}
