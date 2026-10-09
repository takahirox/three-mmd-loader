import { Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { MMDMesh } from '../types.js';

/** Frame snapshots in bone-parent space, xyz + quaternion xyzw per bone.
 * Rest comes from PMX metadata, never from an animated skeleton. Snapshots
 * are separate storage; physics and rendering cannot become authored input.
 */
export class PMXPoseLayers {

	readonly invalid = new Set<number>();
	readonly rest: Float64Array;
	readonly authored: Float64Array;
	readonly morphed: Float64Array;
	readonly beforePhysics: Float64Array;
	readonly physics: Float64Array;
	readonly postPhysicsBase: Float64Array;
	readonly final: Float64Array;
	/** Hierarchy order is independent of PMX procedural class/file order. */
	readonly parentFirstIndices: number[] = [];
	private position = new Vector3();
	private rotation = new Quaternion();
	private restPosition = new Vector3();
	private deltaPosition = new Vector3();
	private deltaRotation = new Quaternion();

	constructor( private mesh: MMDMesh ) {

		const indices = new Map<Object3D, number>( mesh.skeleton.bones.map( ( bone, i ) => [ bone, i ] ) );
		mesh.traverse( object => {

			const index = indices.get( object );
			if ( index !== undefined ) this.parentFirstIndices.push( index );

		} );
		this.rest = new Float64Array( mesh.skeleton.bones.length * 7 );
		for ( const [ i, b ] of mesh.geometry.userData.MMD.bones.entries() ) {

			this.rest.set( [ ...b.pos, ...b.rotq ], i * 7 );

		}
		this.authored = this.rest.slice();
		this.morphed = this.rest.slice();
		this.beforePhysics = this.rest.slice();
		this.physics = this.rest.slice();
		this.postPhysicsBase = this.rest.slice();
		this.final = this.rest.slice();
		this.capture( this.authored ); this.morphed.set( this.authored ); this.beforePhysics.set( this.authored );
		for ( const [ i, b ] of mesh.geometry.userData.MMD.bones.entries() ) if ( ( b.flag ?? 0 ) & 0x1000 ) this.beforePhysics.set( this.rest.subarray( i * 7, i * 7 + 7 ), i * 7 );

	}

	capture( target: Float64Array ) {

		for ( const [ i, b ] of this.mesh.skeleton.bones.entries() ) {

			b.position.toArray( target, i * 7 );
			b.quaternion.toArray( target, i * 7 + 3 );

		}

	}

	stageBeforePhysics() {

		this.invalid.clear();

		for ( const [ i, bone ] of this.mesh.skeleton.bones.entries() ) {

			if ( ! bone.position.toArray().every( value => Number.isFinite( value ) && Math.abs( value ) < 1e15 ) ) { this.invalid.add( i ); bone.position.fromArray( this.rest, i * 7 ); }
			if ( ! bone.quaternion.toArray().every( Number.isFinite ) || ! Number.isFinite( bone.quaternion.lengthSq() ) || bone.quaternion.lengthSq() === 0 ) { this.invalid.add( i ); bone.quaternion.fromArray( this.rest, i * 7 + 3 ); }
			else bone.quaternion.normalize();

		}
		this.capture( this.morphed );

		for ( const [ i, data ] of this.mesh.geometry.userData.MMD.bones.entries() ) {

			if ( ( data.flag ?? 0 ) & 0x1000 ) this.write( i, this.rest );

		}
		this.mesh.updateMatrixWorld( true );

	}

	applyAfterPhysics( index: number, bodyMode: number ) {

		const raw = this.mesh.skeleton.bones[ index ];
		raw.position.toArray( this.postPhysicsBase, index * 7 ); raw.quaternion.toArray( this.postPhysicsBase, index * 7 + 3 );

		const bone = this.mesh.skeleton.bones[ index ];
		if ( bodyMode <= 0 ) {

			this.write( index, this.morphed );

		} else {

			// Bullet owns the simulation transform. Post motion/morph is an
			// additive skeletal layer, never fed back into a mode-1 body.
			if ( bodyMode === 1 ) bone.position.add( this.position.fromArray( this.morphed, index * 7 ).sub( this.restPosition.fromArray( this.rest, index * 7 ) ) );
			else bone.position.fromArray( this.morphed, index * 7 );
			this.rotation.fromArray( this.morphed, index * 7 + 3 );
			bone.quaternion.multiply( this.rotation );

		}
		bone.updateMatrixWorld( true );

	}

	/** Preserve skeletal contributions while re-expressing Bullet in a moved parent. */
	reprojectDynamic( index: number, project: () => void ) {

		const bone = this.mesh.skeleton.bones[ index ];
		const bodyOwnsPosition = this.mesh.geometry.userData.MMD.bones[ index ].rigidBodyType === 1;
		if ( bodyOwnsPosition ) this.deltaPosition.copy( bone.position ).sub( this.position.fromArray( this.postPhysicsBase, index * 7 ) );
		this.deltaRotation.fromArray( this.postPhysicsBase, index * 7 + 3 ).invert().multiply( bone.quaternion );
		project();
		if ( bodyOwnsPosition ) {

			bone.position.toArray( this.postPhysicsBase, index * 7 );
			bone.position.add( this.deltaPosition );

		}
		// Mode 2 keeps its skeletal position; projecting only its Bullet rotation
		// must neither replace the position baseline nor add post offsets again.
		bone.quaternion.toArray( this.postPhysicsBase, index * 7 + 3 );
		bone.quaternion.multiply( this.deltaRotation );
		bone.updateMatrixWorld( true );

	}

	private write( index: number, pose: Float64Array ) {

		const b = this.mesh.skeleton.bones[ index ];
		b.position.fromArray( pose, index * 7 );
		b.quaternion.fromArray( pose, index * 7 + 3 );

	}

}
