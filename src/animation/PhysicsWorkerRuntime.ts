// Worker-side scene adapter: reconstruct only a skeleton, never geometry,
// materials or animation. Bullet stepping/body rules use the same MMDPhysics
// implementation as sync. All Ammo allocations stay on this thread.
import { Bone, BufferGeometry, Matrix4, Skeleton, SkinnedMesh, Vector3 } from 'three';
import { MMDPhysics } from './MMDPhysics.js';
import type { PhysicsModel, PhysicsRequest, PhysicsResponse } from './PhysicsWorkerProtocol.js';

export class PhysicsWorkerRuntime {
	private models = new Map<number, { model: PhysicsModel; physics: MMDPhysics }>();
	private world: MMDPhysics['world'] = null;
	constructor( private send: ( response: PhysicsResponse, transfer?: Transferable[] ) => void ) {}

	handle( message: Exclude<PhysicsRequest, { type: 'init' }> ) {

		if ( message.type === 'add' ) {

			const model = message.model, geometry = new BufferGeometry();
			geometry.userData.MMD = { format: model.format, bones: model.bones };
			const mesh = new SkinnedMesh( geometry ), bones = model.bones.map( () => new Bone() );
			for ( const [ i, bone ] of bones.entries() ) {

				bone.position.fromArray( model.rest, i * 7 ); bone.quaternion.fromArray( model.rest, i * 7 + 3 );
				( bones[ model.bones[ i ].parent ] ?? mesh ).add( bone );

			}
			mesh.skeleton = new Skeleton( bones ); mesh.updateMatrixWorld( true );
			const physics = new MMDPhysics( mesh, model.bodies, model.constraints, {
				world: this.world ?? undefined, unitStep: model.unitStep, maxStepNum: model.maxStepNum,
				gravity: new Vector3().fromArray( model.gravity )
			} );
			this.world = physics.world;
			this.models.set( model.id, { model, physics } );
			this.send( { type: 'added', id: model.id } );
			return;

		}
		if ( message.type === 'remove' ) {

			const entry = this.models.get( message.id );
			entry?.physics.dispose(); entry?.physics.mesh.geometry.dispose(); entry?.physics.mesh.skeleton.dispose();
			this.models.delete( message.id ); if ( this.models.size === 0 ) this.world = null; return;

		}
		if ( message.type === 'gravity' ) {

			this.models.values().next().value?.physics.setGravity( new Vector3().fromArray( message.value ) ); return;

		}
		const evaluateOnly = ! Number.isFinite( message.delta ) || message.delta <= 0;
		const data = new Float64Array( message.buffer );
		let offset = 0;
		for ( const frame of message.models ) {

			const { physics } = this.models.get( frame.id )!;
			const mesh = physics.mesh;
			if ( frame.reset && frame.resetPose ) {

				new Matrix4().fromArray( frame.resetPose ).decompose( mesh.position, mesh.quaternion, mesh.scale );
				for ( const [ i, bone ] of mesh.skeleton.bones.entries() ) {

					bone.position.fromArray( frame.resetPose, 16 + i * 7 ); bone.quaternion.fromArray( frame.resetPose, 19 + i * 7 );

				}
				mesh.updateMatrixWorld( true ); physics.reset();

			}
			new Matrix4().fromArray( data, offset ).decompose( mesh.position, mesh.quaternion, mesh.scale ); offset += 16;
			for ( const bone of mesh.skeleton.bones ) {

				bone.position.fromArray( data, offset ); bone.quaternion.fromArray( data, offset + 3 ); offset += 7;

			}
			mesh.updateMatrixWorld( true );
			for ( const body of physics.bodies ) { body.setDeferredPose( data, offset ); offset += 7; }
			if ( ! evaluateOnly ) {

				for ( const body of physics.bodies ) body.updateFromBone( frame.staged );

			}

		}
		const first = this.models.get( message.models[ 0 ].id )!.physics;
		if ( ! evaluateOnly ) first._stepSimulation( message.delta );
		for ( const frame of message.models ) {

			const { physics } = this.models.get( frame.id )!;
			physics._captureBodyResults( message.delta > 0 ? 'step' : 'reset' );
			for ( const result of physics.bodyResults ) {

				data.set( result.position, offset ); data.set( result.quaternion, offset + 3 ); offset += 7;

			}
			// Both formats project dynamic results on bones without writing native
			// bodies, independent of delayed display (#92).
			for ( const body of physics.bodies ) body.updateBone( ! evaluateOnly, frame.staged );

		}
		if ( message.control ) {

			const control = new Int32Array( message.control );
			Atomics.store( control, 1, message.generation ); Atomics.store( control, 2, message.sequence );
			Atomics.store( control, 0, 1 ); // release: every output byte is complete
			this.send( { type: 'result', generation: message.generation, sequence: message.sequence } );

		} else this.send( { type: 'result', generation: message.generation, sequence: message.sequence, buffer: message.buffer as ArrayBuffer }, [ message.buffer as ArrayBuffer ] );

	}
}
