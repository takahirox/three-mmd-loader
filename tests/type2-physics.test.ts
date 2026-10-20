import assert from 'node:assert/strict';
import { initializeAmmo } from './ammo-runtime.ts';
import { before, test } from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { MMDAnimationHelper } from '../src/animation/MMDAnimationHelper.js';
import { MMDPhysics } from '../src/animation/MMDPhysics.js';
import type { AmmoAPI } from '@takahirox/three-mmd';
import { type2Fixture } from './type2-fixture.ts';

const host = globalThis as typeof globalThis & { Ammo: AmmoAPI };
before( async () => { host.Ammo = await initializeAmmo<AmmoAPI>(); } );
function near( actual: ArrayLike<number>, expected: ArrayLike<number>, tolerance = 5e-4 ) {

	assert.equal( actual.length, expected.length );
	Array.from( actual ).forEach( ( v, i ) => assert.ok( Math.abs( v - expected[ i ] ) < tolerance, `${Array.from( actual )} != ${Array.from( expected )}` ) );

}
function pose( physics: MMDPhysics, index: number ) {

	const t = physics.bodies[ index ].body.getCenterOfMassTransform(), p = t.getOrigin(), q = t.getRotation();
	return { position: [ p.x(), p.y(), p.z() ], quaternion: [ q.x(), q.y(), q.z(), q.w() ] };

}
function anchorError( physics: MMDPhysics, localB: number[] ) {

	const a = pose( physics, 0 ), b = pose( physics, 1 );
	const anchor = ( p: typeof a, offset: number[] ) => new Vector3().fromArray( offset ).applyQuaternion( new Quaternion().fromArray( p.quaternion ) ).add( new Vector3().fromArray( p.position ) );
	return anchor( a, [ 0.3, 0, 0 ] ).distanceTo( anchor( b, localB ) );

}

// Saba DynamicAndBoneMergeMotionState and Babylon syncBones retain bone
// translation and never write a dynamic body's native transform. The oracle
// only uses MMDPhysics to construct the same Bullet shapes/joint: it steps the
// world directly, writes mode 0 from scalar inputs and never calls updateBone,
// updateFromBone, deferAfterPhysics or any dynamic alignment implementation.
for ( const format of [ 'pmd', 'pmx' ] as const ) for ( const fps of [ 60, 120 ] ) for ( const phase of format === 'pmd' ? [ 'pre' ] : [ 'pre', 'post', 'post-parent' ] ) for ( const pmxAnimation of [ false, true ] ) for ( const sharedPhysics of [ false, true ] ) for ( const contact of [ false, true, 'joint-contact' ] as const ) test( `type2 independent native-body oracle format=${format} fps=${fps} phase=${phase} pmx=${pmxAnimation} shared=${sharedPhysics} contact=${contact}`, () => {

	const mesh = type2Fixture( phase, contact, format ), referenceMesh = type2Fixture( phase, contact, format );
	const meta = referenceMesh.geometry.userData.MMD;
	const oracle = new MMDPhysics( referenceMesh, meta.rigidBodies, meta.constraints, { gravity: new Vector3(), unitStep: 1 / 60 } );
	const helper = new MMDAnimationHelper( { pmxAnimation, sync: false } ); helper.sharedPhysics = sharedPhysics;
	helper.add( mesh, { warmup: 0, animationWarmup: false, gravity: new Vector3(), unitStep: 1 / 60 } );
	const second = type2Fixture(); second.position.z = 20;
	helper.add( second, { warmup: 0, animationWarmup: false, gravity: new Vector3(), unitStep: 1 / 60 } );
	const physics = helper.objects.get( mesh )!.physics!;
	const initial = pose( oracle, 1 );
	const localB = new Vector3( 0.3, 0, 0 ).sub( new Vector3().fromArray( initial.position ) )
		.applyQuaternion( new Quaternion().fromArray( initial.quaternion ).invert() ).toArray();
	const input = new host.Ammo.btTransform(); input.setIdentity();
	let maxError = 0, contactDisplacement = 0, rotationChanged = false;
	try {

		for ( let frame = 0; frame < fps; frame ++ ) {

			const x = -frame / fps / 10;
			mesh.skeleton.bones[ 0 ].position.x = x;
			mesh.skeleton.bones[ 7 ].position.set( 0.5 + frame / 100, 0.5, 0 );
			mesh.skeleton.bones[ 7 ].quaternion.setFromAxisAngle( new Vector3( 0, 0, 1 ), frame / 100 );
			mesh.skeleton.bones[ 3 ].position.set( 2 + frame / 50, -0.3, 0.2 );
			mesh.skeleton.bones[ 3 ].quaternion.setFromAxisAngle( new Vector3( 0, 1, 0 ), 0.2 );
			input.getOrigin().setValue( x, 0, 0 );
			oracle.bodies[ 0 ].body.getMotionState().setWorldTransform( input );
			oracle.world!.stepSimulation( 1 / fps, Math.floor( 60 / fps ) + 1, 1 / 60 );
			mesh.updateMatrixWorld( true ); helper.update( 1 / fps );
			for ( const i of [ 0, 1, 2 ] ) {

				const expected = pose( oracle, i ), actual = pose( physics, i );
				near( physics.bodyResults[ i ].position, expected.position ); near( physics.bodyResults[ i ].quaternion, expected.quaternion );
				near( actual.position, expected.position ); near( actual.quaternion, expected.quaternion );

			}
			const bone = mesh.skeleton.bones[ 3 ], layers = helper.objects.get( mesh )!.poseLayers;
			near( bone.position.toArray(), [ 2 + frame / 50, -0.3, 0.2 ] );
			const offset = physics.bodies[ 1 ].boneOffsetForm.getRotation();
			const offsetRotation = new Quaternion( offset.x(), offset.y(), offset.z(), offset.w() );
			const expectedRotation = bone.parent!.getWorldQuaternion( new Quaternion() ).invert()
				.multiply( new Quaternion().fromArray( pose( oracle, 1 ).quaternion ) )
				.multiply( offsetRotation.invert() );
			if ( phase === 'post' ) expectedRotation.multiply( new Quaternion().fromArray( layers!.authored, 3 * 7 + 3 ) );
			near( bone.quaternion.toArray(), expectedRotation.normalize().toArray() );
			assert.equal( physics.bodies[ 1 ].getDeferredPose(), null );
			if ( ! contact ) maxError = Math.max( maxError, anchorError( physics, localB ) );
			else contactDisplacement = Math.max( contactDisplacement, Math.abs( pose( physics, 1 ).position[ 0 ] + 0.65 ) );
			rotationChanged ||= Math.hypot( ...pose( physics, 1 ).quaternion.map( ( v, i ) => v - initial.quaternion[ i ] ) ) > 0.005;
			const raw = pose( physics, 1 );
			for ( let repeat = 0; repeat < 2; repeat ++ ) { helper.update( 0 ); near( pose( physics, 1 ).position, raw.position, 1e-7 ); near( pose( physics, 1 ).quaternion, raw.quaternion, 1e-7 ); }

		}
		if ( contact ) assert.ok( contactDisplacement > 0.1, `contact displacement ${contactDisplacement}` );
		else { assert.ok( maxError < 0.06, `joint anchor error ${maxError}` ); assert.ok( rotationChanged, 'joint must produce physical rotation' ); }

	} finally { host.Ammo.destroy?.( input ); oracle.dispose(); helper.remove( mesh ); helper.remove( second ); }

} );

for ( const phase of [ 'pre', 'post', 'post-parent' ] ) for ( const contact of [ false, true ] ) test( `reproduce legacy type2 alignment damage phase=${phase} contact=${contact}`, t => {

	const helpers = [ new MMDAnimationHelper( { sync: false } ), new MMDAnimationHelper( { sync: false } ) ];
	const meshes = [ type2Fixture( phase, contact ), type2Fixture( phase, contact ) ];
	for ( const [ i, helper ] of helpers.entries() ) helper.add( meshes[ i ], { warmup: 0, animationWarmup: false, gravity: new Vector3(), unitStep: 1 / 60 } );
	const [ corrected, legacy ] = helpers.map( ( h, i ) => h.objects.get( meshes[ i ] )!.physics! );
	const initial = pose( corrected, 1 );
	const localB = new Vector3( 0.3, 0, 0 ).sub( new Vector3().fromArray( initial.position ) ).applyQuaternion( new Quaternion().fromArray( initial.quaternion ).invert() ).toArray();
	let pending: number[] | undefined, maxLegacyError = 0, maxCorrectedError = 0, maxDifference = 0, firstJump = 0;
	try {

		for ( let frame = 0; frame < 60; frame ++ ) {

			for ( const mesh of meshes ) {

				mesh.skeleton.bones[ 0 ].position.x = -frame / 600;
				mesh.skeleton.bones[ 7 ].position.set( 0.5 + frame / 100, 0.5, 0 );
				mesh.skeleton.bones[ 7 ].quaternion.setFromAxisAngle( new Vector3( 0, 0, 1 ), frame / 100 );
				mesh.skeleton.bones[ 3 ].position.set( 2 + frame / 50, -0.3, 0.2 );
				mesh.skeleton.bones[ 3 ].quaternion.setFromAxisAngle( new Vector3( 0, 1, 0 ), 0.2 );

			}
			// Explicit historical schedule, separate from the corrected adapter:
			// post alignment consumes the previous final input before integration.
			if ( pending ) {

				const body = legacy.bodies[ 1 ].body, transform = body.getCenterOfMassTransform();
				transform.getOrigin().setValue( ...pending as [ number, number, number ] );
				body.setCenterOfMassTransform( transform ); body.getMotionState().setWorldTransform( transform );

			}
			helpers.forEach( h => h.update( 1 / 60 ) );
			const bone = meshes[ 1 ].skeleton.bones[ 3 ];
			if ( phase === 'pre' ) {

				// Historical teleport is reproduced here, outside production code.
				const body = legacy.bodies[ 1 ].body, transform = body.getCenterOfMassTransform();
				const origin = new Vector3().fromArray( legacy.bodies[ 1 ].params.position ).applyQuaternion( bone.getWorldQuaternion( new Quaternion() ) ).add( bone.getWorldPosition( new Vector3() ) );
				transform.getOrigin().setValue( origin.x, origin.y, origin.z );
				body.setCenterOfMassTransform( transform ); body.getMotionState().setWorldTransform( transform );

			} else pending = new Vector3().fromArray( legacy.bodies[ 1 ].params.position ).applyQuaternion( bone.getWorldQuaternion( new Quaternion() ) ).add( bone.getWorldPosition( new Vector3() ) ).toArray();
			const old = pose( legacy, 1 ), expected = pose( corrected, 1 );
			if ( frame === 0 ) firstJump = new Vector3().fromArray( old.position ).distanceTo( new Vector3().fromArray( legacy.bodyResults[ 1 ].position ) );
			maxDifference = Math.max( maxDifference, new Vector3().fromArray( old.position ).distanceTo( new Vector3().fromArray( expected.position ) ) );
			maxLegacyError = Math.max( maxLegacyError, anchorError( legacy, localB ) ); maxCorrectedError = Math.max( maxCorrectedError, anchorError( corrected, localB ) );

		}
		assert.ok( maxDifference > 1, `native trajectory discrepancy ${maxDifference}` );
		if ( ! contact ) {

			assert.ok( maxLegacyError > 1 );
			// Additional damping resists this slow kinematic drive: the measured
			// native joint lag rises from 0.00167 to 0.00718 model units. Keep a
			// tight absolute bound and the separation from legacy teleport damage.
			assert.ok( maxCorrectedError < 0.008, `joint anchor error ${maxCorrectedError}` );
			assert.ok( maxCorrectedError < maxLegacyError / 100 );

		}
		if ( phase === 'pre' ) assert.ok( firstJump > 1 ); else near( [ firstJump ], [ 0 ], 1e-7 );
		t.diagnostic( JSON.stringify( { firstJump, maxDifference, ...( contact ? {} : { maxLegacyError, maxCorrectedError } ) } ) );

	} finally { helpers.forEach( ( h, i ) => h.remove( meshes[ i ] ) ); }

} );

for ( const format of [ 'pmd', 'pmx' ] as const ) for ( const phase of format === 'pmd' ? [ 'pre' ] : [ 'pre', 'post', 'post-parent' ] ) test( `standalone type2 reset and warmup preserve rotated offsets format=${format} phase=${phase}`, () => {

	const mesh = type2Fixture( phase, false, format ), meta = mesh.geometry.userData.MMD;
	meta.constraints = []; for ( const body of meta.rigidBodies ) body.groupTarget = 0;
	const physics = new MMDPhysics( mesh, meta.rigidBodies, meta.constraints, { gravity: new Vector3(), unitStep: 1 / 60 } );
	const velocity = new host.Ammo.btVector3( 0, 0, 0.4 );
	try {

		physics.bodies[ 1 ].body.setAngularVelocity!( velocity );
		mesh.skeleton.bones[ 7 ].position.set( 1, 2, 3 );
		mesh.skeleton.bones[ 7 ].quaternion.setFromAxisAngle( new Vector3( 0, 1, 0 ), 0.4 );
		mesh.skeleton.bones[ 3 ].position.set( 2, 3, 4 ); mesh.updateMatrixWorld( true );
		physics.warmup( 10 ); near( pose( physics, 1 ).position, [ 0.85, 0.1, 0 ] );
		const raw = pose( physics, 1 ); physics.update( 0 ); near( pose( physics, 1 ).position, raw.position, 1e-7 ); near( pose( physics, 1 ).quaternion, raw.quaternion, 1e-7 );
		mesh.skeleton.bones[ 3 ].quaternion.setFromAxisAngle( new Vector3( 1, 0, 0 ), 0.3 ); mesh.updateMatrixWorld( true );
		const offset = physics.bodies[ 1 ].params.position, offsetQ = physics.bodies[ 1 ].boneOffsetForm.getRotation();
		const offsetRotation = new Quaternion( offsetQ.x(), offsetQ.y(), offsetQ.z(), offsetQ.w() );
		const bone = mesh.skeleton.bones[ 3 ], boneRotation = bone.getWorldQuaternion( new Quaternion() );
		const resetPosition = new Vector3().fromArray( offset ).applyQuaternion( boneRotation ).add( bone.getWorldPosition( new Vector3() ) ).toArray();
		const resetRotation = boneRotation.multiply( offsetRotation ).toArray();
		physics.reset(); near( pose( physics, 1 ).position, resetPosition ); near( pose( physics, 1 ).quaternion, resetRotation );
		physics.warmup( 10 ); near( pose( physics, 1 ).position, resetPosition ); near( pose( physics, 1 ).quaternion, resetRotation );
		near( physics.bodyResults[ 1 ].position, resetPosition );

	} finally { host.Ammo.destroy?.( velocity ); physics.dispose(); }

} );

for ( const format of [ 'pmd', 'pmx' ] as const ) test( `${format} types 0/1/2 follow their kinematic/dynamic authorities`, () => {

	const mesh = type2Fixture( 'pre', false, format ), meta = mesh.geometry.userData.MMD;
	meta.constraints = []; for ( const body of meta.rigidBodies ) body.groupTarget = 0;
	const physics = new MMDPhysics( mesh, meta.rigidBodies, [], { gravity: new Vector3(), unitStep: 1 / 60 } );
	try {

		for ( let frame = 0; frame < 3; frame ++ ) {

			mesh.skeleton.bones[ 0 ].position.x = frame;
			mesh.skeleton.bones[ 3 ].position.x = 2 + frame; mesh.updateMatrixWorld( true ); physics.update( 1 / 60 );
			const bone = mesh.skeleton.bones[ 3 ];
			near( bone.position.toArray(), [ 2 + frame, -0.5, 0 ] );
			near( pose( physics, 1 ).position, physics.bodyResults[ 1 ].position );
			near( pose( physics, 2 ).position, physics.bodyResults[ 2 ].position );
			near( pose( physics, 0 ).position, [ frame, 0, 0 ] );

		}

	} finally { physics.dispose(); }

} );
