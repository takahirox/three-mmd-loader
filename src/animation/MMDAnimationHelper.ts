import type { Audio, Camera, Object3D as ThreeObject } from 'three';
import type { AnimationAction, AnimationClip, Bone } from 'three';
import type { MMDMesh, MMDBone, Grant, VPD } from '../types.js';
import type { MMDPhysicsParameters } from './MMDPhysics.js';
import {
	AnimationMixer,
	Object3D,
	Quaternion,
	Vector3
} from 'three';
import { CCDIKSolver } from '../animation/CCDIKSolver.js';
import { MMDPhysics } from '../animation/MMDPhysics.js';

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
export type MMDAnimationFeature = 'animation' | 'ik' | 'grant' | 'physics' | 'cameraAnimation';
export type MMDCamera = Camera & { updateProjectionMatrix(): void };
// Three.js exposes no public API for enumerating mixer actions/bindings.
type MMDMixer = AnimationMixer & {
	_actions: AnimationAction[];
	_bindings: { buffer: number[]; valueSize: number; binding: { getValue( buffer: number[], offset: number ): void } }[];
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
 * TODO
 *  - more precise grant skinning support.
 */
class MMDAnimationHelper {

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

		if ( this.sharedPhysics ) this._updateSharedPhysics( delta );

		if ( this.camera !== null ) this._animateCamera( this.camera, delta );

		return this;

	}

	/**
	 * Changes the pose of SkinnedMesh as VPD specifies.
	 *
	 * @param {THREE.SkinnedMesh} mesh
	 * @param {Object} vpd - VPD content parsed MMDParser
	 * @param {Object} params - (optional)
	 * @param {boolean} params.resetPose - Default is true.
	 * @param {boolean} params.ik - Default is true.
	 * @param {boolean} params.grant - Default is true.
	 * @return {MMDAnimationHelper}
	 */
	pose( mesh: MMDMesh, vpd: VPD, params: MMDPoseParameters = {} ) {

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

		mesh.updateMatrixWorld( true );

		// PMX animation system special path
		if ( this.configuration.pmxAnimation &&
			mesh.geometry.userData.MMD && mesh.geometry.userData.MMD.format === 'pmx' ) {

			const sortedBonesData = this._sortBoneDataArray( mesh.geometry.userData.MMD.bones.slice() );
			const ikSolver = params.ik !== false ? this._createCCDIKSolver( mesh ) : null;
			const grantSolver = params.grant !== false ? this.createGrantSolver( mesh ) : null;
			this._animatePMXMesh( mesh, sortedBonesData, ikSolver, grantSolver );

		} else {

			if ( params.ik !== false ) {

				this._createCCDIKSolver( mesh ).update();

			}

			if ( params.grant !== false ) {

				this.createGrantSolver( mesh ).update();

			}

		}

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

		this.meshes.push( mesh );
		this.objects.set( mesh, { looped: false } );

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

		if ( objects.mixer && params.animationWarmup !== false ) {

			this._animateMesh( mesh, 0 );
			objects.physics.reset();

		}

		objects.physics.warmup( params.warmup !== undefined ? params.warmup : 60 );

		this._optimizeIK( mesh, true );

	}

	_animateMesh( mesh: MMDMesh, delta: number ) {

		const objects = this.objects.get( mesh )!;

		const mixer = objects.mixer;
		const ikSolver = objects.ikSolver;
		const grantSolver = objects.grantSolver;
		const physics = objects.physics;
		const looped = objects.looped;

		if ( mixer && this.enabled.animation ) {

			// alternate solution to save/restore bones but less performant?
			//mesh.pose();
			//this._updatePropertyMixersBuffer( mesh );

			this._restoreBones( mesh );

			mixer.update( delta );

			this._saveBones( mesh );

			// PMX animation system special path
			if ( this.configuration.pmxAnimation &&
				mesh.geometry.userData.MMD && mesh.geometry.userData.MMD.format === 'pmx' ) {

				if ( ! objects.sortedBonesData ) objects.sortedBonesData = this._sortBoneDataArray( mesh.geometry.userData.MMD.bones.slice() );

				this._animatePMXMesh(
					mesh,
					objects.sortedBonesData,
					ikSolver && this.enabled.ik ? ikSolver : null,
					grantSolver && this.enabled.grant ? grantSolver : null
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

		if ( looped === true && this.enabled.physics ) {

			if ( physics && this.configuration.resetPhysicsOnLoop ) physics.reset();

			objects.looped = false;

		}

		if ( physics && this.enabled.physics && ! this.sharedPhysics ) {

			this.onBeforePhysics( mesh );
			physics.update( delta );

		}

	}

	// Sort bones in order by 1. transformationClass and 2. bone index.
	// In PMX animation system, bone transformations should be processed
	// in this order.
	_sortBoneDataArray( boneDataArray: MMDBone[] ) {

		return boneDataArray.sort( function ( a, b ) {

			if ( a.transformationClass !== b.transformationClass ) {

				return ( a.transformationClass ?? 0 ) - ( b.transformationClass ?? 0 );

			} else {

				return a.index - b.index;

			}

		} );

	}

	// PMX Animation system is a bit too complex and doesn't great match to
	// Three.js Animation system. This method attempts to simulate it as much as
	// possible but doesn't perfectly simulate.
	// This method is more costly than the regular one so
	// you are recommended to set constructor parameter "pmxAnimation: true"
	// only if your PMX model animation doesn't work well.
	// If you need better method you would be required to write your own.
	_animatePMXMesh( mesh: MMDMesh, sortedBonesData: MMDBone[], ikSolver: CCDIKSolver | null, grantSolver: GrantSolver | null ) {

		_quaternionIndex = 0;
		_grantResultMap.clear();

		for ( let i = 0, il = sortedBonesData.length; i < il; i ++ ) {

			updateOne( mesh, sortedBonesData[ i ].index, ikSolver, grantSolver );

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
					link.enabled = bones[ link.index ].rigidBodyType > 0 ? false : true;

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

		for ( let i = 0, il = this.meshes.length; i < il; i ++ ) {

			const p = this.objects.get( this.meshes[ i ] )!.physics;

			if ( p !== null && p !== undefined ) {

				p._updateRigidBodies();

			}

		}

		physics._stepSimulation( delta );

		for ( let i = 0, il = this.meshes.length; i < il; i ++ ) {

			const p = this.objects.get( this.meshes[ i ] )!.physics;

			if ( p !== null && p !== undefined ) {

				p._updateBones();

			}

		}

	}

}

function isMMDMesh( object: ThreeObject ): object is MMDMesh {

	return 'isSkinnedMesh' in object && object.isSkinnedMesh === true;

}

function isMMDCamera( object: ThreeObject ): object is MMDCamera {

	return 'isCamera' in object && object.isCamera === true;

}

// Keep working quaternions for less GC
const _quaternions: Quaternion[] = [];
let _quaternionIndex = 0;

function getQuaternion() {

	if ( _quaternionIndex >= _quaternions.length ) {

		_quaternions.push( new Quaternion() );

	}

	return _quaternions[ _quaternionIndex ++ ];

}

// Save rotation whose grant and IK are already applied
// used by grant children
const _grantResultMap = new Map<number, Quaternion>();

function updateOne( mesh: MMDMesh, boneIndex: number, ikSolver: CCDIKSolver | null, grantSolver: GrantSolver | null ) {

	const bones = mesh.skeleton.bones;
	const bonesData = mesh.geometry.userData.MMD.bones;
	const boneData = bonesData[ boneIndex ];
	const bone = bones[ boneIndex ];

	// Return if already updated by being referred as a grant parent.
	if ( _grantResultMap.has( boneIndex ) ) return;

	const quaternion = getQuaternion();

	// Initialize grant result here to prevent infinite loop.
	// If it's referred before updating with actual result later
	// result without applyting IK or grant is gotten
	// but better than composing of infinite loop.
	_grantResultMap.set( boneIndex, quaternion.copy( bone.quaternion ) );

	// @TODO: Support global grant and grant position
	if ( grantSolver && boneData.grant &&
		! boneData.grant.isLocal && boneData.grant.affectRotation ) {

		const parentIndex = boneData.grant.parentIndex;
		const ratio = boneData.grant.ratio;

		if ( ! _grantResultMap.has( parentIndex ) ) {

			updateOne( mesh, parentIndex, ikSolver, grantSolver );

		}

		grantSolver.addGrantRotation( bone, _grantResultMap.get( parentIndex )!, ratio );

	}

	if ( ikSolver && boneData.ik ) {

		// @TODO: Updating world matrices every time solving an IK bone is
		// costly. Optimize if possible.
		mesh.updateMatrixWorld( true );
		ikSolver.updateOne( boneData.ik );

		// No confident, but it seems the grant results with ik links should be updated?
		const links = boneData.ik.links;

		for ( let i = 0, il = links.length; i < il; i ++ ) {

			const link = links[ i ];

			if ( link.enabled === false ) continue;

			const linkIndex = link.index;

			if ( _grantResultMap.has( linkIndex ) ) {

				_grantResultMap.set( linkIndex, _grantResultMap.get( linkIndex )!.copy( bones[ linkIndex ].quaternion ) );

			}

		}

	}

	// Update with the actual result here
	quaternion.copy( bone.quaternion );

}

//

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

const _q = new Quaternion();

/**
 * Solver for Grant (Fuyo in Japanese. I just google translated because
 * Fuyo may be MMD specific term and may not be common word in 3D CG terms.)
 * Grant propagates a bone's transform to other bones transforms even if
 * they are not children.
 * @param {THREE.SkinnedMesh} mesh
 * @param {Array<Object>} grants
 */
class GrantSolver {

	mesh: MMDMesh;
	grants: Grant[];

	constructor( mesh: MMDMesh, grants: Grant[] = [] ) {

		this.mesh = mesh;
		this.grants = grants;

	}

	/**
	 * Solve all the grant bones
	 * @return {GrantSolver}
	 */
	update() {

		const grants = this.grants;

		for ( let i = 0, il = grants.length; i < il; i ++ ) {

			this.updateOne( grants[ i ] );

		}

		return this;

	}

	/**
	 * Solve a grant bone
	 * @param {Object} grant - grant parameter
	 * @return {GrantSolver}
	 */
	updateOne( grant: Grant ) {

		const bones = this.mesh.skeleton.bones;
		const bone = bones[ grant.index ];
		const parentBone = bones[ grant.parentIndex ];

		if ( grant.isLocal ) {

			// TODO: implement
			if ( grant.affectPosition ) {

			}

			// TODO: implement
			if ( grant.affectRotation ) {

			}

		} else {

			// TODO: implement
			if ( grant.affectPosition ) {

			}

			if ( grant.affectRotation ) {

				this.addGrantRotation( bone, parentBone.quaternion, grant.ratio );

			}

		}

		return this;

	}

	addGrantRotation( bone: Bone, q: Quaternion, ratio: number ) {

		_q.set( 0, 0, 0, 1 );
		_q.slerp( q, ratio );
		bone.quaternion.multiply( _q );

		return this;

	}

}

export { MMDAnimationHelper };
