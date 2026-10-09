import { PMXPoseLayers } from './PMXPoseLayers.js';
import { GrantSolver } from './GrantSolver.js';
import { updateMMDUVs } from './MMDUVMorphController.js';
import { MMDMaterialMorphController } from './MMDMaterialMorphController.js';
import type { Audio, Camera, Object3D as ThreeObject } from 'three';
import type { AnimationAction, AnimationClip } from 'three';
import type { Vpd } from 'mmd-parser';
import type { MMDMesh, MMDBone } from '../types.js';
import type { MMDPhysicsParameters } from './MMDPhysics.js';
import {
	AnimationMixer,
	Object3D,
	Quaternion,
	Vector3
} from 'three';
import { CCDIKSolver } from '../animation/CCDIKSolver.js';
import { MMDPhysics } from '../animation/MMDPhysics.js';
import { MMDBoneMorphController } from './MMDBoneMorphController.js';

export interface MMDAnimationHelperParameters {
	sync?: boolean;
	afterglow?: number;
	resetPhysicsOnLoop?: boolean;
	pmxAnimation?: boolean;
}
export interface MMDAnimationParameters extends MMDPhysicsParameters {
	animation?: AnimationClip | AnimationClip[];
	physics?: boolean;
	warmup?: number;
	animationWarmup?: boolean;
	delayTime?: number;
}
export interface MMDPoseParameters { resetPose?: boolean; ik?: boolean; grant?: boolean }
export type MMDAnimationFeature = 'animation' | 'uvMorph' | 'materialMorph' | 'boneMorph' | 'ik' | 'grant' | 'physics' | 'cameraAnimation';
export type MMDCamera = Camera & { updateProjectionMatrix(): void };
// Three.js exposes no public API for enumerating mixer actions/bindings.
type MMDMixer = AnimationMixer & {
	_actions: AnimationAction[];
	_activateAction( action: AnimationAction ): void;
	_bindings: { restoreOriginalState(): void; buffer: number[]; valueSize: number; binding: { getValue( buffer: number[], offset: number ): void } }[];
	_accuIndex: number;
};
export interface MMDAnimationState {
	mixer?: MMDMixer;
	ikSolver?: CCDIKSolver;
	grantSolver?: GrantSolver;
	physics?: MMDPhysics;
	looped?: boolean;
	duration?: number;
	backupBones?: Float32Array;
	sortedBonesData?: MMDBone[];
	poseLayers?: PMXPoseLayers;
}


/**
 * MMDAnimationHelper handles animation of MMD assets loaded by MMDLoader
 * with MMD special features as IK, Grant, and Physics.
 *
 * Dependencies
 *  - ammo.js https://github.com/kripken/ammo.js
 *  - MMDPhysics
 *  - CCDIKSolver
 *
 */
class MMDAnimationHelper {

	private materialMorphControllers = new WeakMap<MMDMesh, MMDMaterialMorphController>();
	private boneMorphControllers = new WeakMap<MMDMesh, MMDBoneMorphController>();

	meshes: MMDMesh[];
	camera: MMDCamera | null;
	cameraTarget: Object3D;
	audio: Audio | null;
	audioManager: AudioManager | null;
	objects: WeakMap<object, MMDAnimationState>;
	configuration: Required<MMDAnimationHelperParameters>;
	enabled: Record<MMDAnimationFeature, boolean>;
	onBeforePhysics: ( mesh: MMDMesh ) => void;
	sharedPhysics: boolean;
	masterPhysics: MMDPhysics | null;

	/**
	 * @param {Object} params - (optional)
	 * @param {boolean} params.sync - Whether animation durations of added objects are synched. Default is true.
	 * @param {Number} params.afterglow - Default is 0.0.
	 * @param {boolean} params.resetPhysicsOnLoop - Default is true.
	 */
	constructor( params: MMDAnimationHelperParameters = {} ) {

		this.meshes = [];

		this.camera = null;
		this.cameraTarget = new Object3D();
		this.cameraTarget.name = 'target';

		this.audio = null;
		this.audioManager = null;

		this.objects = new WeakMap();

		this.configuration = {
			sync: params.sync !== undefined ? params.sync : true,
			afterglow: params.afterglow !== undefined ? params.afterglow : 0.0,
			resetPhysicsOnLoop: params.resetPhysicsOnLoop !== undefined ? params.resetPhysicsOnLoop : true,
			pmxAnimation: params.pmxAnimation !== undefined ? params.pmxAnimation : false
		};

		this.enabled = {
			animation: true,
			boneMorph: true,
			materialMorph: true,
			uvMorph: true,
			ik: true,
			grant: true,
			physics: true,
			cameraAnimation: true
		};

		this.onBeforePhysics = function ( /* mesh */ ) {};

		// experimental
		this.sharedPhysics = false;
		this.masterPhysics = null;

	}

	/**
	 * Adds an Three.js Object to helper and setups animation.
	 * The anmation durations of added objects are synched
	 * if this.configuration.sync is true.
	 *
	 * @param {THREE.SkinnedMesh|THREE.Camera|THREE.Audio} object
	 * @param {Object} params - (optional)
	 * @param {THREE.AnimationClip|Array<THREE.AnimationClip>} params.animation - Only for THREE.SkinnedMesh and THREE.Camera. Default is undefined.
	 * @param {boolean} params.physics - Only for THREE.SkinnedMesh. Default is true.
	 * @param {Integer} params.warmup - Only for THREE.SkinnedMesh and physics is true. Default is 60.
	 * @param {Number} params.unitStep - Only for THREE.SkinnedMesh and physics is true. Default is 1 / 65.
	 * @param {Integer} params.maxStepNum - Only for THREE.SkinnedMesh and physics is true. Default is 3.
	 * @param {Vector3} params.gravity - Only for THREE.SkinnedMesh and physics is true. Default ( 0, - 9.8 * 10, 0 ).
	 * @param {Number} params.delayTime - Only for THREE.Audio. Default is 0.0.
	 * @return {MMDAnimationHelper}
	 */
	add( object: MMDMesh | MMDCamera | Audio, params: MMDAnimationParameters = {} ) {

		if ( isMMDMesh( object ) ) {

			this._addMesh( object, params );

		} else if ( isMMDCamera( object ) ) {

			this._setupCamera( object, params );

		} else if ( object.type === 'Audio' ) {

			this._setupAudio( object, params );

		} else {

			throw new Error( 'THREE.MMDAnimationHelper.add: '
				+ 'accepts only '
				+ 'THREE.SkinnedMesh or '
				+ 'THREE.Camera or '
				+ 'THREE.Audio instance.' );

		}

		if ( this.configuration.sync ) this._syncDuration();

		return this;

	}

	/**
	 * Removes an Three.js Object from helper.
	 *
	 * @param {THREE.SkinnedMesh|THREE.Camera|THREE.Audio} object
	 * @return {MMDAnimationHelper}
	 */
	remove( object: MMDMesh | MMDCamera | Audio ) {

		if ( isMMDMesh( object ) ) {

			this._removeMesh( object );

		} else if ( isMMDCamera( object ) ) {

			this._clearCamera( object );

		} else if ( object.type === 'Audio' ) {

			this._clearAudio( object );

		} else {

			throw new Error( 'THREE.MMDAnimationHelper.remove: '
				+ 'accepts only '
				+ 'THREE.SkinnedMesh or '
				+ 'THREE.Camera or '
				+ 'THREE.Audio instance.' );

		}

		if ( this.configuration.sync ) this._syncDuration();

		return this;

	}

	/**
	 * Updates the animation.
	 *
	 * @param {Number} delta
	 * @return {MMDAnimationHelper}
	 */
	update( delta: number ) {

		if ( this.audioManager !== null ) this.audioManager.control( delta );

		for ( let i = 0; i < this.meshes.length; i ++ ) {

			this._animateMesh( this.meshes[ i ], delta );

		}

		if ( this.sharedPhysics ) {

			this._finishSharedPhysics( delta );

		}

		if ( this.camera !== null ) this._animateCamera( this.camera, delta );

		return this;

	}

	/**
	 * Changes the pose of SkinnedMesh as VPD specifies.
	 *
	 * @param {THREE.SkinnedMesh} mesh
	 * @param {Object} vpd - VPD content parsed by mmd-parser
	 * @param {Object} params - (optional)
	 * @param {boolean} params.resetPose - Default is true.
	 * @param {boolean} params.ik - Default is true.
	 * @param {boolean} params.grant - Default is true.
	 * @return {MMDAnimationHelper}
	 */
	pose( mesh: MMDMesh, vpd: Vpd, params: MMDPoseParameters = {} ) {

		const boneMorphs = this._getBoneMorphController( mesh );
		boneMorphs?.restore();
		if ( params.resetPose !== false ) mesh.pose();

		const bones = mesh.skeleton.bones;
		const boneParams = vpd.bones;

		const boneNameDictionary: Record<string, number> = {};

		for ( let i = 0, il = bones.length; i < il; i ++ ) {

			boneNameDictionary[ bones[ i ].name ] = i;

		}

		const vector = new Vector3();
		const quaternion = new Quaternion();

		for ( let i = 0, il = boneParams.length; i < il; i ++ ) {

			const boneParam = boneParams[ i ];
			const boneIndex = boneNameDictionary[ boneParam.name ];

			if ( boneIndex === undefined ) continue;

			const bone = bones[ boneIndex ];
			bone.position.add( vector.fromArray( boneParam.translation ) );
			bone.quaternion.multiply( quaternion.fromArray( boneParam.quaternion ) );

		}

		const poseLayers = mesh.geometry.userData.MMD.format === 'pmx' ? this.objects.get( mesh )?.poseLayers ?? new PMXPoseLayers( mesh ) : undefined;
		poseLayers?.capture( poseLayers.authored );
		boneMorphs?.apply( this.enabled.boneMorph );
		poseLayers?.capture( poseLayers.morphed );
		poseLayers?.stageBeforePhysics();
		this._getMaterialMorphController( mesh )?.apply( this.enabled.materialMorph );
		updateMMDUVs( mesh, this.enabled.uvMorph );
		mesh.updateMatrixWorld( true );

		// PMX animation system special path
		if ( mesh.geometry.userData.MMD.format === 'pmx' ) {

			const sortedBonesData = this._sortBoneDataArray( mesh.geometry.userData.MMD.bones.slice() );
			const ikSolver = params.ik !== false ? this._createCCDIKSolver( mesh ) : null;
			const grantSolver = params.grant !== false ? this.createGrantSolver( mesh ) : null;
			if ( poseLayers && grantSolver ) grantSolver.invalidPoseIndices = poseLayers.invalid;
			this._animatePMXMesh( mesh, sortedBonesData, ikSolver, grantSolver, false, false );
			poseLayers?.capture( poseLayers.beforePhysics );
			poseLayers?.capture( poseLayers.physics );
			for ( const data of sortedBonesData ) if ( ( data.flag ?? 0 ) & 0x1000 ) poseLayers?.applyAfterPhysics( data.index, - 1 );
			this._animatePMXMesh( mesh, sortedBonesData, ikSolver, grantSolver, true, false );
			poseLayers?.capture( poseLayers.final );
			this.objects.get( mesh )?.physics?.deferAfterPhysics();

		} else {

			if ( params.ik !== false ) {

				this._createCCDIKSolver( mesh ).update();

			}

			if ( params.grant !== false ) {

				this.createGrantSolver( mesh ).update();

			}

		}

		boneMorphs?.capture();
		return this;

	}

	/**
	 * Enabes/Disables an animation feature.
	 *
	 * @param {string} key
	 * @param {boolean} enabled
	 * @return {MMDAnimationHelper}
	 */
	enable( key: MMDAnimationFeature, enabled: boolean ) {

		if ( this.enabled[ key ] === undefined ) {

			throw new Error( 'THREE.MMDAnimationHelper.enable: '
				+ 'unknown key ' + key );

		}

		this.enabled[ key ] = enabled;

		if ( key === 'physics' ) {

			for ( let i = 0, il = this.meshes.length; i < il; i ++ ) {

				this._optimizeIK( this.meshes[ i ], enabled );

			}

		}

		return this;

	}

	/**
	 * Creates an GrantSolver instance.
	 *
	 * @param {THREE.SkinnedMesh} mesh
	 * @return {GrantSolver}
	 */
	createGrantSolver( mesh: MMDMesh ) {

		return new GrantSolver( mesh, mesh.geometry.userData.MMD.grants );

	}

	// private methods

	_addMesh( mesh: MMDMesh, params: MMDAnimationParameters ) {

		if ( this.meshes.indexOf( mesh ) >= 0 ) {

			throw new Error( 'THREE.MMDAnimationHelper._addMesh: '
				+ 'SkinnedMesh \'' + mesh.name + '\' has already been added.' );

		}

		this._getBoneMorphController( mesh )?.restore();
		this.meshes.push( mesh );
		this.objects.set( mesh, { looped: false, poseLayers: mesh.geometry.userData.MMD.format === 'pmx' ? new PMXPoseLayers( mesh ) : undefined } );

		this._setupMeshAnimation( mesh, params.animation );

		if ( params.physics !== false ) {

			this._setupMeshPhysics( mesh, params );

		}

		return this;

	}

	_setupCamera( camera: MMDCamera, params: MMDAnimationParameters ) {

		if ( this.camera === camera ) {

			throw new Error( 'THREE.MMDAnimationHelper._setupCamera: '
				+ 'Camera \'' + camera.name + '\' has already been set.' );

		}

		if ( this.camera ) this._clearCamera( this.camera );

		this.camera = camera;

		camera.add( this.cameraTarget );

		this.objects.set( camera, {} );

		if ( params.animation !== undefined ) {

			this._setupCameraAnimation( camera, params.animation );

		}

		return this;

	}

	_setupAudio( audio: Audio, params: MMDAnimationParameters ) {

		if ( this.audio === audio ) {

			throw new Error( 'THREE.MMDAnimationHelper._setupAudio: '
				+ 'Audio \'' + audio.name + '\' has already been set.' );

		}

		if ( this.audio ) this._clearAudio( this.audio );

		this.audio = audio;
		this.audioManager = new AudioManager( audio, params );

		this.objects.set( this.audioManager, {
			duration: this.audioManager.duration
		} );

		return this;

	}

	_removeMesh( mesh: MMDMesh ) {

		let found = false;
		let writeIndex = 0;

		for ( let i = 0, il = this.meshes.length; i < il; i ++ ) {

			if ( this.meshes[ i ] === mesh ) {

				// Release the authored pose so a new helper cannot bake in bone morphs.
				this.boneMorphControllers.get( mesh )?.restore();
				this.materialMorphControllers.get( mesh )?.apply( false );
				updateMMDUVs( mesh, false );
				this.objects.get( mesh )?.physics?.dispose();
				if ( this.masterPhysics === this.objects.get( mesh )?.physics ) this.masterPhysics = null;
				this.objects.delete( mesh );
				found = true;

				continue;

			}

			this.meshes[ writeIndex ++ ] = this.meshes[ i ];

		}

		if ( ! found ) {

			throw new Error( 'THREE.MMDAnimationHelper._removeMesh: '
				+ 'SkinnedMesh \'' + mesh.name + '\' has not been added yet.' );

		}

		this.meshes.length = writeIndex;

		return this;

	}

	_clearCamera( camera: MMDCamera ) {

		if ( camera !== this.camera ) {

			throw new Error( 'THREE.MMDAnimationHelper._clearCamera: '
				+ 'Camera \'' + camera.name + '\' has not been set yet.' );

		}

		this.camera!.remove( this.cameraTarget );

		this.objects.delete( this.camera! );
		this.camera = null;

		return this;

	}

	_clearAudio( audio: Audio ) {

		if ( audio !== this.audio ) {

			throw new Error( 'THREE.MMDAnimationHelper._clearAudio: '
				+ 'Audio \'' + audio.name + '\' has not been set yet.' );

		}

		this.objects.delete( this.audioManager! );

		this.audio = null;
		this.audioManager = null;

		return this;

	}

	_setupMeshAnimation( mesh: MMDMesh, animation?: AnimationClip | AnimationClip[] ) {

		const objects = this.objects.get( mesh )!;

		if ( animation !== undefined ) {

			const animations = Array.isArray( animation )
				? animation : [ animation ];

			objects.mixer = new AnimationMixer( mesh ) as MMDMixer;
			this._getBoneMorphController( mesh )?.watchAnimationMixer( objects.mixer );

			for ( let i = 0, il = animations.length; i < il; i ++ ) {

				objects.mixer.clipAction( animations[ i ] ).play();

			}
			// TODO: find a workaround not to access ._clip looking like a private property
			objects.mixer.addEventListener( 'loop', function ( event ) {

				const tracks = event.action.getClip().tracks;

				if ( tracks.length > 0 && tracks[ 0 ].name.slice( 0, 6 ) !== '.bones' ) return;

				objects.looped = true;

			} );

		}

		objects.ikSolver = this._createCCDIKSolver( mesh );
		objects.grantSolver = this.createGrantSolver( mesh );

		return this;

	}

	_setupCameraAnimation( camera: MMDCamera, animation: AnimationClip | AnimationClip[] ) {

		const animations = Array.isArray( animation )
			? animation : [ animation ];

		const objects = this.objects.get( camera )!;

		objects.mixer = new AnimationMixer( camera ) as MMDMixer;

		for ( let i = 0, il = animations.length; i < il; i ++ ) {

			objects.mixer.clipAction( animations[ i ] ).play();

		}

	}

	_setupMeshPhysics( mesh: MMDMesh, params: MMDAnimationParameters ) {

		const objects = this.objects.get( mesh )!;

		// shared physics is experimental

		if ( params.world === undefined && this.sharedPhysics ) {

			const masterPhysics = this._getMasterPhysics();

			if ( masterPhysics !== null && masterPhysics.world !== null ) params = { ...params, world: masterPhysics.world };

		}

		objects.physics = this._createMMDPhysics( mesh, params );
		objects.physics.poseLayers = objects.poseLayers;
		if ( objects.poseLayers ) objects.physics.reset();
		this._optimizeIK( mesh, this.enabled.physics );

		const animationWarmup = ( objects.mixer || this._getBoneMorphController( mesh ) ) && params.animationWarmup !== false;
		if ( animationWarmup ) {

			this._animateMesh( mesh, 0 );
			objects.physics.reset();

		}

		if ( objects.poseLayers || this.sharedPhysics ) objects.physics.warmupStep = delta => {

			// Settle physics at a fixed authored time, through both pose phases.
			// One shared-world step affects every mesh, including meshes already
			// present when a new adapter is added or warmup is called directly.
			if ( this.sharedPhysics ) {

				for ( const participant of this.meshes ) this._animateMesh( participant, delta, 0 );
				this._finishSharedPhysics( delta );

			} else {

				this._animateMesh( mesh, delta, 0 );

			}

		};
		objects.physics.warmup( params.warmup !== undefined ? params.warmup : 60 );

		this._optimizeIK( mesh, this.enabled.physics );
		if ( animationWarmup ) this.boneMorphControllers.get( mesh )?.capture();

	}

	_animateMesh( mesh: MMDMesh, delta: number, animationDelta = delta ) {

		const objects = this.objects.get( mesh )!;

		const mixer = objects.mixer;
		const ikSolver = objects.ikSolver;
		const grantSolver = objects.grantSolver;
		const physics = objects.physics;
		const boneMorphs = this._getBoneMorphController( mesh );
		if ( mixer ) boneMorphs?.watchAnimationMixer( mixer );
		boneMorphs?.restore();

		if ( mixer && this.enabled.animation ) {

			// alternate solution to save/restore bones but less performant?
			//mesh.pose();
			//this._updatePropertyMixersBuffer( mesh );

			if ( ! boneMorphs ) this._restoreBones( mesh );

			mixer.update( animationDelta );

			this._saveBones( mesh );

		}

		objects.poseLayers?.capture( objects.poseLayers.authored );
		boneMorphs?.apply( this.enabled.boneMorph );
		objects.poseLayers?.capture( objects.poseLayers.morphed );
		objects.poseLayers?.stageBeforePhysics();
		if ( objects.poseLayers && grantSolver ) grantSolver.invalidPoseIndices = objects.poseLayers.invalid;
		this._getMaterialMorphController( mesh )?.apply( this.enabled.materialMorph );
		updateMMDUVs( mesh, this.enabled.uvMorph );

		if ( ( mixer && this.enabled.animation ) || boneMorphs ) {

			// PMX animation system special path
			if ( mesh.geometry.userData.MMD.format === 'pmx' ) {

				if ( ! objects.sortedBonesData ) objects.sortedBonesData = this._sortBoneDataArray( mesh.geometry.userData.MMD.bones.slice() );

				this._animatePMXMesh(
					mesh,
					objects.sortedBonesData,
					ikSolver && this.enabled.ik ? ikSolver : null,
					grantSolver && this.enabled.grant ? grantSolver : null,
					false
				);

			} else {

				if ( ikSolver && this.enabled.ik ) {

					mesh.updateMatrixWorld( true );
					ikSolver.update();

				}

				if ( grantSolver && this.enabled.grant ) {

					grantSolver.update();

				}

			}

		}

		objects.poseLayers?.capture( objects.poseLayers.beforePhysics );
		grantSolver?.captureBeforePhysics( objects.poseLayers?.morphed );

		if ( objects.looped === true && this.enabled.physics ) {

			if ( physics && this.configuration.resetPhysicsOnLoop ) physics.reset();

			objects.looped = false;

		}

		if ( physics && this.enabled.physics && ! this.sharedPhysics ) {

			this.onBeforePhysics( mesh );
			physics.update( delta );

		}

		if ( ! this.sharedPhysics ) this._animateAfterPhysics( mesh );
		boneMorphs?.capture();

	}

	_animateAfterPhysics( mesh: MMDMesh ) {

		const objects = this.objects.get( mesh )!;
		if ( mesh.geometry.userData.MMD.format !== 'pmx' || ! objects.sortedBonesData ) return;
		objects.poseLayers?.capture( objects.poseLayers.physics );
		objects.poseLayers?.postPhysicsBase.set( objects.poseLayers.physics );
		// Publish the authored post layer once at the phase boundary. An IK
		// controller may legally affect a link whose own ordered turn is later.
		const physicsActive = this.enabled.physics && Boolean( objects.physics );
		for ( const data of objects.sortedBonesData ) if ( ( data.flag ?? 0 ) & 0x1000 ) {

			if ( physicsActive && data.rigidBodyType > 0 ) objects.physics?.projectBone( data.index );
			objects.poseLayers?.applyAfterPhysics( data.index, physicsActive ? data.rigidBodyType : - 1 );

		}
		this._animatePMXMesh( mesh, objects.sortedBonesData,
			this.enabled.ik ? objects.ikSolver ?? null : null,
			this.enabled.grant ? objects.grantSolver ?? null : null, true );
		// Later post IK/grants can move ancestors of already processed dynamic
		// bones in either phase. Rebase parent first, preserving each bone's own
		// post contributions, so correcting a parent cannot move a corrected child.
		if ( physicsActive ) this._reprojectDynamicBones( mesh );
		objects.poseLayers?.capture( objects.poseLayers.final );
		objects.physics?.deferAfterPhysics();

	}

	_reprojectDynamicBones( mesh: MMDMesh ) {

		const objects = this.objects.get( mesh )!;
		if ( ! objects.poseLayers || ! objects.physics ) return;
		for ( const index of objects.poseLayers.parentFirstIndices ) {

			if ( mesh.geometry.userData.MMD.bones[ index ].rigidBodyType <= 0 ) continue;
			objects.poseLayers.reprojectDynamic( index, () => objects.physics!.projectBone( index ) );

		}

	}

	_getMaterialMorphController( mesh: MMDMesh ) {

		if ( ! mesh.geometry.userData.MMD.materialMorphs?.length ) return undefined;
		let controller = this.materialMorphControllers.get( mesh );
		if ( ! controller ) {

			controller = new MMDMaterialMorphController( mesh );
			this.materialMorphControllers.set( mesh, controller );

		}
		return controller;

	}

	_getBoneMorphController( mesh: MMDMesh ) {

		if ( mesh.geometry.userData.MMD.format !== 'pmx' && ! mesh.geometry.userData.MMD.boneMorphs?.length && ! mesh.geometry.userData.MMD.grants.length ) return undefined;
		let controller = this.boneMorphControllers.get( mesh );
		if ( ! controller ) {

			controller = new MMDBoneMorphController( mesh );
			this.boneMorphControllers.set( mesh, controller );

		}
		return controller;

	}

	// Sort bones by physics phase, transformationClass and bone index.
	// In PMX animation system, bone transformations should be processed
	// in this order.
	_sortBoneDataArray( boneDataArray: MMDBone[] ) {

		return boneDataArray.sort( function ( a, b ) {

			if ( Boolean( ( a.flag ?? 0 ) & 0x1000 ) !== Boolean( ( b.flag ?? 0 ) & 0x1000 ) ) {

				return ( ( a.flag ?? 0 ) & 0x1000 ) - ( ( b.flag ?? 0 ) & 0x1000 );

			} else if ( a.transformationClass !== b.transformationClass ) {

				return ( a.transformationClass ?? 0 ) - ( b.transformationClass ?? 0 );

			} else {

				return a.index - b.index;

			}

		} );

	}

	_animatePMXMesh( mesh: MMDMesh, sortedBonesData: MMDBone[], ikSolver: CCDIKSolver | null, grantSolver: GrantSolver | null, afterPhysics?: boolean, physicsActive = this.enabled.physics && Boolean( this.objects.get( mesh )?.physics ) ) {

		// PMX order is phase, transformation class, then file index. Do not
		// recursively solve grant sources: that would move IK across classes.
		for ( const data of sortedBonesData ) {

			if ( afterPhysics !== undefined && Boolean( ( data.flag ?? 0 ) & 0x1000 ) !== afterPhysics ) continue;
			if ( grantSolver && data.grant ) {

				// Earlier post operations may have moved any source/target ancestor.
				// Publish body authority before consumers read accumulated matrices.
				if ( afterPhysics === true && physicsActive ) this._reprojectDynamicBones( mesh );
				grantSolver.updateOne( data.grant, afterPhysics === true && physicsActive );

			}
			if ( ikSolver && data.ik ) {

				if ( afterPhysics === true && physicsActive ) this._reprojectDynamicBones( mesh );
				mesh.updateMatrixWorld( true );
				ikSolver.updateOne( data.ik );

			}

			if ( afterPhysics === true && physicsActive && grantSolver ) {

				const raw = this.objects.get( mesh )?.poseLayers?.postPhysicsBase;
				if ( raw ) {

					grantSolver.capturePostProcedural( data.index, raw );
					if ( data.ik && ikSolver ) for ( const link of data.ik.links ) grantSolver.capturePostProcedural( link.index, raw );

				}

			}
		}

		mesh.updateMatrixWorld( true );
		return this;

	}

	_animateCamera( camera: MMDCamera, delta: number ) {

		const mixer = this.objects.get( camera )!.mixer;

		if ( mixer && this.enabled.cameraAnimation ) {

			mixer.update( delta );

			camera.updateProjectionMatrix();

			camera.up.set( 0, 1, 0 );
			camera.up.applyQuaternion( camera.quaternion );
			camera.lookAt( this.cameraTarget.position );

		}

	}

	_optimizeIK( mesh: MMDMesh, physicsEnabled: boolean ) {

		const iks = mesh.geometry.userData.MMD.iks;
		const bones = mesh.geometry.userData.MMD.bones;

		for ( let i = 0, il = iks.length; i < il; i ++ ) {

			const ik = iks[ i ];
			const links = ik.links;

			for ( let j = 0, jl = links.length; j < jl; j ++ ) {

				const link = links[ j ];

				if ( physicsEnabled === true ) {

					// disable IK of the bone the corresponding rigidBody type of which is 1 or 2
					// because its rotation will be overriden by physics
					link.enabled = ! bones[ link.index ] || ( bones[ link.index ].rigidBodyType > 0 && ! ( ( bones[ ik.target ]?.flag ?? 0 ) & 0x1000 ) ) ? false : true;

				} else {

					link.enabled = true;

				}

			}

		}

	}

	_createCCDIKSolver( mesh: MMDMesh ) {

		if ( CCDIKSolver === undefined ) {

			throw new Error( 'THREE.MMDAnimationHelper: Import CCDIKSolver.' );

		}

		return new CCDIKSolver( mesh, mesh.geometry.userData.MMD.iks );

	}

	_createMMDPhysics( mesh: MMDMesh, params: MMDAnimationParameters ) {

		if ( MMDPhysics === undefined ) {

			throw new Error( 'THREE.MMDPhysics: Import MMDPhysics.' );

		}

		return new MMDPhysics(
			mesh,
			mesh.geometry.userData.MMD.rigidBodies,
			mesh.geometry.userData.MMD.constraints,
			params );

	}

	/*
	 * Detects the longest duration and then sets it to them to sync.
	 * TODO: Not to access private properties ( ._actions and ._clip )
	 */
	_syncDuration() {

		let max = 0.0;

		const objects = this.objects;
		const meshes = this.meshes;
		const camera = this.camera;
		const audioManager = this.audioManager;

		// get the longest duration

		for ( let i = 0, il = meshes.length; i < il; i ++ ) {

			const mixer = this.objects.get( meshes[ i ] )!.mixer;

			if ( mixer === undefined ) continue;

			for ( let j = 0; j < mixer._actions.length; j ++ ) {

				const clip = mixer._actions[ j ].getClip();

				if ( ! objects.has( clip ) ) {

					objects.set( clip, {
						duration: clip.duration
					} );

				}

				max = Math.max( max, objects.get( clip )!.duration! );

			}

		}

		if ( camera !== null ) {

			const mixer = this.objects.get( camera )!.mixer;

			if ( mixer !== undefined ) {

				for ( let i = 0, il = mixer._actions.length; i < il; i ++ ) {

					const clip = mixer._actions[ i ].getClip();

					if ( ! objects.has( clip ) ) {

						objects.set( clip, {
							duration: clip.duration
						} );

					}

					max = Math.max( max, objects.get( clip )!.duration! );

				}

			}

		}

		if ( audioManager !== null ) {

			max = Math.max( max, objects.get( audioManager )!.duration! );

		}

		max += this.configuration.afterglow;

		// update the duration

		for ( let i = 0, il = this.meshes.length; i < il; i ++ ) {

			const mixer = this.objects.get( this.meshes[ i ] )!.mixer;

			if ( mixer === undefined ) continue;

			for ( let j = 0, jl = mixer._actions.length; j < jl; j ++ ) {

				mixer._actions[ j ].getClip().duration = max;

			}

		}

		if ( camera !== null ) {

			const mixer = this.objects.get( camera )!.mixer;

			if ( mixer !== undefined ) {

				for ( let i = 0, il = mixer._actions.length; i < il; i ++ ) {

					mixer._actions[ i ].getClip().duration = max;

				}

			}

		}

		if ( audioManager !== null ) {

			audioManager.duration = max;

		}

	}

	// workaround

	_updatePropertyMixersBuffer( mesh: MMDMesh ) {

		const mixer = this.objects.get( mesh )!.mixer;

		const propertyMixers = mixer!._bindings;
		const accuIndex = mixer!._accuIndex;

		for ( let i = 0, il = propertyMixers.length; i < il; i ++ ) {

			const propertyMixer = propertyMixers[ i ];
			const buffer = propertyMixer.buffer;
			const stride = propertyMixer.valueSize;
			const offset = ( accuIndex + 1 ) * stride;

			propertyMixer.binding.getValue( buffer, offset );

		}

	}

	/*
	 * Avoiding these two issues by restore/save bones before/after mixer animation.
	 *
	 * 1. PropertyMixer used by AnimationMixer holds cache value in .buffer.
	 *    Calculating IK, Grant, and Physics after mixer animation can break
	 *    the cache coherency.
	 *
	 * 2. Applying Grant two or more times without reset the posing breaks model.
	 */
	_saveBones( mesh: MMDMesh ) {

		const objects = this.objects.get( mesh )!;

		const bones = mesh.skeleton.bones;

		let backupBones = objects.backupBones;

		if ( backupBones === undefined ) {

			backupBones = new Float32Array( bones.length * 7 );
			objects.backupBones = backupBones;

		}

		for ( let i = 0, il = bones.length; i < il; i ++ ) {

			const bone = bones[ i ];
			bone.position.toArray( backupBones, i * 7 );
			bone.quaternion.toArray( backupBones, i * 7 + 3 );

		}

	}

	_restoreBones( mesh: MMDMesh ) {

		const objects = this.objects.get( mesh )!;

		const backupBones = objects.backupBones;

		if ( backupBones === undefined ) return;

		const bones = mesh.skeleton.bones;

		for ( let i = 0, il = bones.length; i < il; i ++ ) {

			const bone = bones[ i ];
			bone.position.fromArray( backupBones, i * 7 );
			bone.quaternion.fromArray( backupBones, i * 7 + 3 );

		}

	}

	// experimental

	_getMasterPhysics() {

		if ( this.masterPhysics !== null ) return this.masterPhysics;

		for ( let i = 0, il = this.meshes.length; i < il; i ++ ) {

			const physics = this.objects.get( this.meshes[ i ] )!.physics;

			if ( physics !== undefined && physics !== null ) {

				this.masterPhysics = physics;
				return this.masterPhysics;

			}

		}

		return null;

	}

	_updateSharedPhysics( delta: number ) {

		if ( this.meshes.length === 0 || ! this.enabled.physics || ! this.sharedPhysics ) return;

		const physics = this._getMasterPhysics();

		if ( physics === null ) return;

		// A shared world has one clock. Any PMX participant requires zero-time
		// pose evaluation to leave every body's simulation state unchanged,
		// regardless of which mesh supplied the master adapter.
		const evaluateOnly = ! Number.isFinite( delta ) || ( delta <= 0 && this.meshes.some( mesh =>
			mesh.geometry.userData.MMD.format === 'pmx' && Boolean( this.objects.get( mesh )?.physics ) ) );

		for ( let i = 0, il = this.meshes.length; i < il; i ++ ) {

			const p = this.objects.get( this.meshes[ i ] )!.physics;

			if ( p !== null && p !== undefined ) {

				this.onBeforePhysics( this.meshes[ i ] );
				if ( ! evaluateOnly ) p._updateRigidBodies();

			}

		}

		if ( ! evaluateOnly ) physics._stepSimulation( delta );

		for ( let i = 0, il = this.meshes.length; i < il; i ++ ) {

			const p = this.objects.get( this.meshes[ i ] )!.physics;

			if ( p !== null && p !== undefined ) {

				if ( delta > 0 ) p._captureBodyResults( 'step' );
				p._updateBones( ! evaluateOnly );

			}

		}

	}

	_finishSharedPhysics( delta: number ) {

		this._updateSharedPhysics( delta );
		for ( const mesh of this.meshes ) {

			this._animateAfterPhysics( mesh );
			this.boneMorphControllers.get( mesh )?.capture();

		}

	}

}

function isMMDMesh( object: ThreeObject ): object is MMDMesh {

	return 'isSkinnedMesh' in object && object.isSkinnedMesh === true;

}

function isMMDCamera( object: ThreeObject ): object is MMDCamera {

	return 'isCamera' in object && object.isCamera === true;

}

class AudioManager {

	audio: Audio;
	elapsedTime: number;
	currentTime: number;
	delayTime: number;
	audioDuration: number;
	duration: number;

	/**
	 * @param {THREE.Audio} audio
	 * @param {Object} params - (optional)
	 * @param {Nuumber} params.delayTime
	 */
	constructor( audio: Audio, params: MMDAnimationParameters = {} ) {

		this.audio = audio;

		this.elapsedTime = 0.0;
		this.currentTime = 0.0;
		this.delayTime = params.delayTime !== undefined
			? params.delayTime : 0.0;

		this.audioDuration = this.audio.buffer!.duration;
		this.duration = this.audioDuration + this.delayTime;

	}

	/**
	 * @param {Number} delta
	 * @return {AudioManager}
	 */
	control( delta: number ) {

		this.elapsedTime += delta;
		this.currentTime += delta;

		if ( this._shouldStopAudio() ) this.audio.stop();
		if ( this._shouldStartAudio() ) this.audio.play();

		return this;

	}

	// private methods

	_shouldStartAudio() {

		if ( this.audio.isPlaying ) return false;

		while ( this.currentTime >= this.duration ) {

			this.currentTime -= this.duration;

		}

		if ( this.currentTime < this.delayTime ) return false;

		// 'duration' can be bigger than 'audioDuration + delayTime' because of sync configuration
		if ( ( this.currentTime - this.delayTime ) > this.audioDuration ) return false;

		return true;

	}

	_shouldStopAudio() {

		return this.audio.isPlaying &&
			this.currentTime >= this.duration;

	}

}

export { MMDAnimationHelper };
