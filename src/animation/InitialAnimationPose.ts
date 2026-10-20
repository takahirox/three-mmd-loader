import { Quaternion, Vector3 } from 'three';
import type { MMDMesh } from '../types.js';

/** One startup transition in authored local space, before morph/IK/grant/physics.
 * No mixer action weights, original bindings or animation clocks are changed.
 * Physics warmup owns the cycle count; later explicit warmups only settle.
 * @internal
 */
export class InitialAnimationPose {
	readonly base: Float64Array;
	readonly target: Float64Array;
	private morphs: number[] = [];
	private stage = 0;
	private remaining: number;
	private stages: number;
	private position = new Vector3();
	private rotation = new Quaternion();
	private targetRotation = new Quaternion();
	get done() { return this.remaining <= 0; }
	get weight() { return this.stages > 0 ? Math.min( this.stage / this.stages, 1 ) : 1; }

	constructor( private mesh: MMDMesh, cycles: number ) {

		this.base = new Float64Array( mesh.skeleton.bones.flatMap( b => [ ...b.position.toArray(), ...b.quaternion.toArray() ] ) );
		this.target = this.base.slice();
		this.remaining = cycles;
		this.stages = Math.min( 30, cycles );

	}
	captureTarget() {

		for ( const [ i, b ] of this.mesh.skeleton.bones.entries() ) {

			b.position.toArray( this.target, i * 7 ); b.quaternion.toArray( this.target, i * 7 + 3 );

		}
		this.morphs = this.mesh.morphTargetInfluences?.slice() ?? [];

	}
	advance() { this.stage ++; this.remaining --; }
	rewind() { this.stage --; this.remaining ++; }
	apply() {

		const weight = this.weight;
		for ( const [ i, bone ] of this.mesh.skeleton.bones.entries() ) {

			bone.position.fromArray( this.base, i * 7 ).lerp( this.position.fromArray( this.target, i * 7 ), weight );
			if ( weight === 1 ) {

				bone.position.fromArray( this.target, i * 7 );
				bone.quaternion.fromArray( this.target, i * 7 + 3 );

			} else bone.quaternion.copy( this.rotation.fromArray( this.base, i * 7 + 3 ) ).slerp( this.targetRotation.fromArray( this.target, i * 7 + 3 ), weight );

		}
		if ( this.mesh.morphTargetInfluences ) for ( const [ i, value ] of this.morphs.entries() ) this.mesh.morphTargetInfluences[ i ] = value * weight;

	}
	restoreMorphs() {

		if ( this.mesh.morphTargetInfluences ) for ( const [ i, value ] of this.morphs.entries() ) this.mesh.morphTargetInfluences[ i ] = value;

	}
	static write( mesh: MMDMesh, pose: Float64Array ) {

		for ( const [ i, bone ] of mesh.skeleton.bones.entries() ) {

			bone.position.fromArray( pose, i * 7 ); bone.quaternion.fromArray( pose, i * 7 + 3 );

		}
		mesh.updateMatrixWorld( true );

	}
}
