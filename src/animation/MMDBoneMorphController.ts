import { Quaternion, Vector3 } from 'three';
import type { MMDMesh } from '../types.js';

// Restore authored/mixer transforms before the next morph/IK/grant/physics
// pass. Preserve absolute edits, pose resets and external mixer.setTime().
export class MMDBoneMorphController {

	private base: Float64Array;
	private result: Float64Array;
	private hasResult = false;
	private translation = new Vector3();
	private rotation = new Quaternion();
	private weightedRotation = new Quaternion();
	private offsets: Quaternion[];

	constructor( private mesh: MMDMesh ) {

		this.base = new Float64Array( mesh.skeleton.bones.length * 7 );
		this.result = new Float64Array( this.base.length );
		this.offsets = mesh.skeleton.bones.map( () => new Quaternion() );

	}

	restore() {

		if ( ! this.hasResult ) return;
		for ( const [ i, bone ] of this.mesh.skeleton.bones.entries() ) {

			const offset = i * 7;
			if ( bone.position.x === this.result[ offset ] && bone.position.y === this.result[ offset + 1 ] && bone.position.z === this.result[ offset + 2 ] ) {

				bone.position.fromArray( this.base, offset );

			}
			if ( bone.quaternion.x === this.result[ offset + 3 ] && bone.quaternion.y === this.result[ offset + 4 ] && bone.quaternion.z === this.result[ offset + 5 ] && bone.quaternion.w === this.result[ offset + 6 ] ) {

				bone.quaternion.fromArray( this.base, offset + 3 );

			}

		}
		this.hasResult = false;

	}

	apply( enabled: boolean ) {

		this.save( this.base );
		if ( ! enabled ) return;
		for ( const offset of this.offsets ) offset.identity();
		for ( const morph of this.mesh.geometry.userData.MMD.boneMorphs ?? [] ) {

			const weight = this.mesh.morphTargetInfluences?.[ morph.index ] ?? 0;
			if ( weight === 0 ) continue;
			for ( const element of morph.elements ) {

				const bone = this.mesh.skeleton.bones[ element.index ];
				if ( ! bone ) continue;
				bone.position.addScaledVector( this.translation.fromArray( element.position ), weight );
				this.rotation.fromArray( element.rotation ).normalize();
				this.weightedRotation.identity().slerp( this.rotation, weight );
				// Compose the weighted offsets in PMX morph/element order.
				this.offsets[ element.index ].multiply( this.weightedRotation );

			}

		}

		// PMX morph offsets precede the authored animation rotation, so a
		// noncommuting VMD/VPD rotation is composed as morph * animation.
		for ( const [ i, bone ] of this.mesh.skeleton.bones.entries() ) bone.quaternion.premultiply( this.offsets[ i ] );

	}

	capture() {

		this.save( this.result );
		this.hasResult = true;

	}

	private save( target: Float64Array ) {

		for ( const [ i, bone ] of this.mesh.skeleton.bones.entries() ) {

			bone.position.toArray( target, i * 7 );
			bone.quaternion.toArray( target, i * 7 + 3 );

		}

	}

}
