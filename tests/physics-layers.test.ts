import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { Parser } from 'mmd-parser';
import { Texture, Vector3 } from 'three';
import { MMDAnimationHelper, MMDLoader, MMDPhysics } from 'three-mmd-loader';
import type { AmmoAPI, MMDMesh } from 'three-mmd-loader';
import { physicsLayerBones, physicsLayerBodies, physicsLayersPmxBuffer, pmdBuffer, vmdBuffer } from './fixtures.ts';
import { product } from './bone-morph-reference.ts';
import { power, rotate } from './grant-reference.ts';

const epsilon = 1e-4;
function near( actual: ArrayLike<number>, expected: ArrayLike<number>, tolerance = epsilon ) {

	assert.equal( actual.length, expected.length );
	Array.from( actual ).forEach( ( value, i ) => assert.ok( Number.isFinite( value ) && Math.abs( value - expected[ i ] ) <= tolerance, `${Array.from( actual )} != ${Array.from( expected )}` ) );

}
function setup( postIK = false ) {

	const parser = new Parser(), data = parser.parsePmx( physicsLayersPmxBuffer(), true );
	if ( ! postIK ) delete data.bones[ 9 ].ik;
	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	return { data, loader, mesh: loader.meshBuilder.build( data, '' ) };

}
function bodyPosition( helper: MMDAnimationHelper, mesh: MMDMesh, index: number ) {

	const p = helper.objects.get( mesh )!.physics!.bodies[ index ].body.getCenterOfMassTransform().getOrigin();
	return [ p.x(), p.y(), p.z() ];

}
const ammoGlobal = globalThis as typeof globalThis & { Ammo?: AmmoAPI };
const initializeAmmo = async () => { ammoGlobal.Ammo = await ( createRequire( import.meta.url )( 'ammojs-typed' ) as () => Promise<AmmoAPI> )(); };

test( 'binary PMX fixture preserves phases, ordered classes, grants, IK, body modes and constrained pair', () => {

	const { data, mesh } = setup( true ), meta = mesh.geometry.userData.MMD;
	assert.equal( data.metadata.rigidBodyCount, 5 ); assert.equal( data.metadata.constraintCount, 1 );
	assert.equal( meta.constraints.length, 1 ); assert.equal( meta.iks.length, 2 );
	assert.deepEqual( data.bones.map( b => b.flag ), physicsLayerBones.map( b => b.flag ) );
	assert.deepEqual( meta.bones.map( b => b.flag ), data.bones.map( b => b.flag ) );
	assert.deepEqual( meta.bones.map( b => b.transformationClass ), physicsLayerBones.map( b => b.transformationClass ) );
	assert.deepEqual( meta.rigidBodies.map( b => [ b.boneIndex, b.type ] ), physicsLayerBodies.map( b => [ b.bone, b.mode ] ) );
	assert.deepEqual( meta.grants.map( g => [ g.parentIndex, g.ratio, g.isLocal, g.affectPosition, g.affectRotation ] ), [ [ 6, 0.5, true, true, true ], [ 6, 0.25, true, true, true ], [ 6, 0.25, true, true, true ] ] );
	assert.equal( meta.boneMorphs!.length, 3 ); assert.equal( meta.groupMorphs![ 0 ].elements[ 0 ].type, 2 );

} );

for ( const pmxAnimation of [ false, true ] ) for ( const sharedPhysics of [ false, true ] ) test( `independent phase oracle, real Ammo contacts/constraint across 90 frames pmx=${pmxAnimation} shared=${sharedPhysics}`, async () => {

	await initializeAmmo();
	try {

		const { mesh, loader } = setup(), helper = new MMDAnimationHelper( { pmxAnimation, sync: false } ); helper.sharedPhysics = sharedPhysics;
		const motion = new Parser().parseVmd( vmdBuffer( { boneName: 'bone0' } ), true ), clip = loader.animationBuilder.build( motion, mesh );
		helper.add( mesh, { animation: clip, warmup: 0, animationWarmup: false, gravity: new Vector3(), unitStep: 1 / 60 } );
		const state = helper.objects.get( mesh )!, mixer = state.mixer!, physics = state.physics!, layers = state.poseLayers!;
		// A second mesh exercises the shared-world barrier, not just a flag.
		const second = setup().mesh; second.position.z = 20;
		helper.add( second, { warmup: 0, animationWarmup: false, gravity: new Vector3(), unitStep: 1 / 60 } );
		if ( sharedPhysics ) assert.equal( helper.objects.get( second )!.physics!.world, physics.world );
		else assert.notEqual( helper.objects.get( second )!.physics!.world, physics.world );
		const rest = layers.rest.slice(), sourceAngle = 0.4;
		// Independent physics oracle: feed scalar expected preceding post poses
		// straight to a separate Bullet world. No helper/layer code runs there.
		const referenceMesh = setup().mesh;
		const referenceInput = new ammoGlobal.Ammo!.btTransform(); referenceInput.setIdentity();
		const referencePhysics = new MMDPhysics( referenceMesh, referenceMesh.geometry.userData.MMD.rigidBodies, referenceMesh.geometry.userData.MMD.constraints, { gravity: new Vector3(), unitStep: 1 / 60 } );
		mesh.skeleton.bones[ 6 ].position.x = 0.2;
		mesh.skeleton.bones[ 6 ].quaternion.set( 0, 0, Math.sin( sourceAngle / 2 ), Math.cos( sourceAngle / 2 ) );
		mesh.morphTargetInfluences![ 1 ] = 0.2; mesh.morphTargetInfluences![ 4 ] = 0.4;
		// Effective bone-a weight = direct .2 + group .4 * .75 = .5.
		const morph = mesh.geometry.userData.MMD.boneMorphs![ 0 ];
		const weighted0 = power( morph.elements[ 0 ].rotation, 0.5 ), weighted1 = power( morph.elements[ 1 ].rotation, 0.5 );
		const grant0 = [ 0, 0, Math.sin( sourceAngle / 4 ), Math.cos( sourceAngle / 4 ) ];
		const grant1 = [ 0, 0, Math.sin( sourceAngle / 8 ), Math.cos( sourceAngle / 8 ) ];
		let previousFinal = [ 0, 0, 0 ], previousRotation = [ 0, 0, 0, 1 ], maxConstraintError = 0, settledConstraintError = 0, contactMoved = false;
		for ( let frame = 0; frame < 90; frame ++ ) {

			const time = Math.min( frame / 180, 0.45 ); mixer.setTime( time );
			const referenceBody = referencePhysics.bodies[ 0 ].body;
			const inputTransform = referenceInput; inputTransform.getOrigin().setValue( ...previousFinal as [ number, number, number ] );
			const inputRotation = inputTransform.getRotation(); inputRotation.setX( previousRotation[ 0 ] ); inputRotation.setY( previousRotation[ 1 ] ); inputRotation.setZ( previousRotation[ 2 ] ); inputRotation.setW( previousRotation[ 3 ] ); inputTransform.setRotation( inputRotation );
			referenceBody.setCenterOfMassTransform( inputTransform ); referenceBody.getMotionState().setWorldTransform( inputTransform );
			if ( frame > 0 ) {

				const mode2 = referencePhysics.bodies[ 2 ].body, transform = mode2.getCenterOfMassTransform(); transform.getOrigin().setValue( -1.95, 0, 0 ); mode2.setCenterOfMassTransform( transform ); mode2.getMotionState().setWorldTransform( transform );

			}
			referencePhysics.world!.stepSimulation( 1 / 60, 2, 1 / 60 );
			helper.update( 1 / 60 );
			for ( const index of [ 1, 2, 3, 4 ] ) {

				const p = referencePhysics.bodies[ index ].body.getCenterOfMassTransform().getOrigin();
				try { near( bodyPosition( helper, mesh, index ), [ p.x(), p.y(), p.z() ], 5e-4 ); } catch ( error ) { throw new Error( `frame ${frame} body ${index}`, { cause: error } ); }

			}
			// Independent scalar oracle: authored VMD x=2t and morph offsets.
			const authoredX = 2 * ( time + 1 / 60 );
			near( layers.authored.slice( 0, 3 ), [ authoredX, 0, 0 ] );
			const final0 = [ authoredX + morph.elements[ 0 ].position[ 0 ] * 0.5 + 0.1, morph.elements[ 0 ].position[ 1 ] * 0.5, morph.elements[ 0 ].position[ 2 ] * 0.5 ];
			near( layers.morphed.slice( 0, 3 ), final0.map( ( v, i ) => v - ( i === 0 ? 0.1 : 0 ) ) );
			near( layers.beforePhysics.slice( 0, 7 ), rest.slice( 0, 7 ) );
			near( layers.physics.slice( 0, 7 ), rest.slice( 0, 7 ) );
			near( layers.final.slice( 0, 3 ), final0 ); near( layers.final.slice( 3, 7 ), product( weighted0, grant0 ) );
			near( bodyPosition( helper, mesh, 0 ), previousFinal );
			// Dynamic body1 is isolated: no gravity/contact or input teleport.
			near( bodyPosition( helper, mesh, 1 ), [ 2, 0, 0 ] );
			near( layers.physics.slice( 7, 10 ), [ 2, 0, 0 ] );
			const final1 = [ 2 + morph.elements[ 1 ].position[ 0 ] * 0.5 + 0.05, morph.elements[ 1 ].position[ 1 ] * 0.5, morph.elements[ 1 ].position[ 2 ] * 0.5 ];
			near( mesh.skeleton.bones[ 1 ].position.toArray(), final1 );
			near( mesh.skeleton.bones[ 1 ].quaternion.toArray(), product( weighted1, grant1 ) );
			// Mode2 retains skeletal position; the raw body uses prior alignment.
			near( mesh.skeleton.bones[ 2 ].getWorldPosition( new Vector3() ).toArray(), [ -1.95, 0, 0 ] );
			if ( frame > 0 ) near( bodyPosition( helper, mesh, 2 ), [ -1.95, 0, 0 ], 1e-4 );
			// Analytic pre IK: vertical unit arm points to source from (-2,2).
			near( mesh.skeleton.bones[ 5 ].getWorldPosition( new Vector3() ).toArray(), [ -1, 2, 0 ] );
			const constrained = bodyPosition( helper, mesh, 3 );
			const rawRotation = physics.bodies[ 3 ].body.getCenterOfMassTransform().getRotation();
			const anchorA = rotate( previousRotation, [ 0.3, 0, 0 ] ).map( ( v, i ) => v + previousFinal[ i ] );
			const anchorB = rotate( [ rawRotation.x(), rawRotation.y(), rawRotation.z(), rawRotation.w() ], [ -0.35, 0, 0 ] ).map( ( v, i ) => v + constrained[ i ] );
			const constraintError = Math.hypot( ...anchorA.map( ( v, i ) => v - anchorB[ i ] ) );
			maxConstraintError = Math.max( maxConstraintError, constraintError );
			if ( frame > 30 ) settledConstraintError = Math.max( settledConstraintError, constraintError );
			contactMoved ||= bodyPosition( helper, mesh, 4 )[ 0 ] < -0.66;
			previousFinal = final0; previousRotation = product( weighted0, grant0 );
			// Final bone palette feeds actual skinning, with no extra helper pass.
			mesh.updateMatrixWorld( true ); mesh.skeleton.update();
			const vertex = new Vector3().fromBufferAttribute( mesh.geometry.attributes.position, 9 );
			const skinned = mesh.applyBoneTransform( 9, vertex );
			assert.ok( skinned.toArray().every( Number.isFinite ) );

		}
		assert.ok( maxConstraintError < 0.2, `constraint drift ${maxConstraintError}` );
		assert.ok( settledConstraintError < 0.08, `settled constraint drift ${settledConstraintError}` );
		assert.ok( contactMoved, 'contact probe must be pushed by the kinematic sphere' );
		near( layers.rest, rest, 0 );
		const raw = bodyPosition( helper, mesh, 1 ), final = Array.from( layers.final );
		mixer.clipAction( clip ).paused = true;
		for ( let repeat = 0; repeat < 20; repeat ++ ) { helper.update( 0 ); near( bodyPosition( helper, mesh, 1 ), raw ); near( layers.final, final ); }
		// Disabling physics reveals authored+grant layers; reenabling does not
		// turn the rendered post offsets into a body1 input.
		helper.enable( 'physics', false ).update( 0 ); helper.enable( 'physics', true ).update( 0 ); near( bodyPosition( helper, mesh, 1 ), raw ); near( layers.final, final );

	} finally { delete ammoGlobal.Ammo; }

} );

for ( const pmxAnimation of [ false, true ] ) test( `post IK can rotate a dynamic link without rotating its body, pmx=${pmxAnimation}`, async () => {

	await initializeAmmo();
	try {

		const { mesh } = setup( true ), helper = new MMDAnimationHelper( { pmxAnimation } );
		helper.add( mesh, { warmup: 0, animationWarmup: false, gravity: new Vector3(), unitStep: 1 / 60 } );
		for ( let frame = 0; frame < 30; frame ++ ) {

			helper.update( 1 / 60 );
			const q = helper.objects.get( mesh )!.physics!.bodies[ 1 ].body.getCenterOfMassTransform().getRotation();
			near( [ q.x(), q.y(), q.z(), q.w() ], [ 0, 0, 0, 1 ] );
			near( mesh.skeleton.bones[ 1 ].quaternion.toArray(), [ 0, 0, -Math.sin( Math.PI / 8 ), Math.cos( Math.PI / 8 ) ] );
			near( mesh.skeleton.bones[ 10 ].getWorldPosition( new Vector3() ).toArray(), [ 2 + Math.SQRT1_2, Math.SQRT1_2, 0 ] );

		}

	} finally { delete ammoGlobal.Ammo; }

} );

for ( const pmxAnimation of [ false, true ] ) for ( const sharedPhysics of [ false, true ] ) for ( const contributions of [ 'none', 'layers', 'ik' ] ) test( `late ancestor IK rebases dynamic descendants, retaining their post layers pmx=${pmxAnimation} shared=${sharedPhysics} contributions=${contributions}`, async () => {

	await initializeAmmo();
	try {

		const { data, loader } = setup( true );
		delete data.bones[ 0 ].grant; delete data.bones[ 6 ].ik;
		if ( contributions !== 'layers' ) delete data.bones[ 1 ].grant;
		data.bones[ 1 ].parentIndex = 0;
		data.bones[ 10 ].parentIndex = 0; data.bones[ 10 ].position = [ 0, 1, 0 ];
		data.bones[ 9 ].position = [ 1, 0, 0 ];
		data.bones[ 9 ].ik = { target: null, effector: 10, iteration: 1, maxAngle: Math.PI, linkCount: 1, links: [ { index: 0, angleLimitation: 0 } ] };
		// The grandchild runs before its dynamic parent in class order. Final
		// rebasing must instead run parent first, through the actual hierarchy.
		delete data.bones[ 2 ].grant;
		data.bones[ 2 ].parentIndex = 1; data.bones[ 2 ].position = [ 2, 0, 1 ]; data.bones[ 2 ].transformationClass = 3;
		data.rigidBodies[ 2 ].type = 1; data.rigidBodies[ 2 ].position = [ 2, 0, 1 ];
		// A later independent local grant must read the rebased source, rather
		// than its temporarily displaced pose under the rotated ancestor.
		data.bones[ 7 ].flag = 0x1380; data.bones[ 7 ].transformationClass = 7;
		data.bones[ 7 ].grant = { parentIndex: 1, ratio: 1, isLocal: true, affectPosition: true, affectRotation: true };
		if ( contributions === 'ik' ) {

			data.bones[ 5 ].parentIndex = 1; data.bones[ 5 ].position = [ 2, 1, 0 ]; data.bones[ 5 ].flag = 0x1000;
			data.bones[ 4 ].position = [ 3, 0, 0 ]; data.bones[ 4 ].flag = 0x1020; data.bones[ 4 ].transformationClass = 5;
			data.bones[ 4 ].ik = { target: null, effector: 5, iteration: 1, maxAngle: Math.PI, linkCount: 1, links: [ { index: 1, angleLimitation: 0 } ] };

		}
		const mesh = loader.meshBuilder.build( data, '' ), helper = new MMDAnimationHelper( { pmxAnimation } ); helper.sharedPhysics = sharedPhysics;
		helper.add( mesh, { warmup: 0, animationWarmup: false, gravity: new Vector3(), unitStep: 1 / 60 } );
		if ( sharedPhysics ) { const second = setup().mesh; second.position.z = 20; helper.add( second, { warmup: 0, animationWarmup: false, gravity: new Vector3(), unitStep: 1 / 60 } ); }
		const authoredRotation = [ Math.sin( 0.1 ), 0, 0, Math.cos( 0.1 ) ];
		const morph = mesh.geometry.userData.MMD.boneMorphs![ 0 ].elements[ 1 ];
		if ( contributions === 'layers' ) {

			mesh.skeleton.bones[ 1 ].position.x += 0.3; mesh.skeleton.bones[ 1 ].quaternion.fromArray( authoredRotation );
			// Keep the ancestor's analytic IK oracle independent of bone0 morphs.
			mesh.geometry.userData.MMD.boneMorphs![ 0 ].elements = [ morph ]; mesh.morphTargetInfluences![ 1 ] = 0.5;
			mesh.skeleton.bones[ 6 ].position.x = 0.8; mesh.skeleton.bones[ 6 ].quaternion.set( 0, 0, Math.sin( 0.2 ), Math.cos( 0.2 ) );

		}
		const offset = contributions === 'layers' ? morph.position.map( ( v, i ) => v * 0.5 + ( i === 0 ? 0.5 : 0 ) ) : [ 0, 0, 0 ];
		const rotation = contributions === 'layers' ? product( product( power( morph.rotation, 0.5 ), authoredRotation ), [ 0, 0, Math.sin( 0.05 ), Math.cos( 0.05 ) ] ) : contributions === 'ik' ? [ 0, 0, -Math.SQRT1_2, Math.SQRT1_2 ] : [ 0, 0, 0, 1 ];
		for ( let frame = 0; frame < 30; frame ++ ) {

			helper.update( 1 / 60 );
			near( mesh.skeleton.bones[ 0 ].quaternion.toArray(), [ 0, 0, -Math.SQRT1_2, Math.SQRT1_2 ] );
			near( bodyPosition( helper, mesh, 1 ), [ 2, 0, 0 ] ); near( bodyPosition( helper, mesh, 2 ), [ 2, 0, 1 ] );
			const raw = helper.objects.get( mesh )!.physics!.bodyResults;
			near( raw[ 1 ].quaternion, [ 0, 0, 0, 1 ] ); near( raw[ 2 ].quaternion, [ 0, 0, 0, 1 ] );
			// Local post translation rotates with the parent; the raw Bullet
			// position and the child's own post rotation retain world authority.
			near( mesh.skeleton.bones[ 1 ].getWorldPosition( new Vector3() ).toArray(), [ 2 + offset[ 1 ], -offset[ 0 ], offset[ 2 ] ] );
			near( mesh.skeleton.bones[ 1 ].getWorldQuaternion( mesh.skeleton.bones[ 1 ].quaternion.clone() ).toArray(), rotation );
			near( mesh.skeleton.bones[ 2 ].getWorldPosition( new Vector3() ).toArray(), [ 2, 0, 1 ] );
			near( mesh.skeleton.bones[ 2 ].getWorldQuaternion( mesh.skeleton.bones[ 2 ].quaternion.clone() ).toArray(), [ 0, 0, 0, 1 ] );
			near( mesh.skeleton.bones[ 7 ].position.toArray(), [ 0.5 + offset[ 1 ], 0.5 - offset[ 0 ], offset[ 2 ] ] );
			near( mesh.skeleton.bones[ 7 ].quaternion.toArray(), rotation );

		}

	} finally { delete ammoGlobal.Ammo; }

} );

for ( const pmxAnimation of [ false, true ] ) for ( const pmxFirst of [ false, true ] ) test( `mixed shared world pauses independently of master format pmx=${pmxAnimation} pmxFirst=${pmxFirst}`, async () => {

	await initializeAmmo();
	try {

		const { mesh, loader } = setup(), pmd = loader.meshBuilder.build( new Parser().parsePmd( pmdBuffer(), true ), '' );
		const helper = new MMDAnimationHelper( { pmxAnimation } ); helper.sharedPhysics = true;
		for ( const participant of pmxFirst ? [ mesh, pmd ] : [ pmd, mesh ] ) helper.add( participant, { warmup: 0, animationWarmup: false, gravity: new Vector3(), unitStep: 1 / 60 } );
		const physics = helper.objects.get( mesh )!.physics!, velocity = new ammoGlobal.Ammo!.btVector3( 1, 0, 0 );
		physics.bodies[ 1 ].body.setLinearVelocity!( velocity );
		for ( let frame = 0; frame < 5; frame ++ ) {

			helper.update( 0 );
			near( bodyPosition( helper, mesh, 1 ), [ 2, 0, 0 ] );
			near( physics.bodyResults[ 1 ].position, [ 2, 0, 0 ] ); assert.equal( physics.bodyResultPhase, 'reset' );
			near( mesh.skeleton.bones[ 1 ].getWorldPosition( new Vector3() ).toArray(), [ 2, 0, 0 ] );

		}
		for ( let frame = 1; frame <= 5; frame ++ ) {

			helper.update( 1 / 60 ); helper.update( 0 );
			near( bodyPosition( helper, mesh, 1 ), [ 2 + frame / 60, 0, 0 ] );
			near( physics.bodyResults[ 1 ].position, [ 2 + frame / 60, 0, 0 ] ); assert.equal( physics.bodyResultPhase, 'step' );

		}

	} finally { delete ammoGlobal.Ammo; }

} );

for ( const phase of [ 'pre', 'post', 'post-parent' ] ) test( `standalone physics synchronizes kinematic and mode2 bodies during update/reset/warmup phase=${phase}`, async () => {

	await initializeAmmo();
	try {

		const { data, loader } = setup();
		data.bones[ 0 ].flag = phase === 'post' ? 0x1000 : 0;
		data.bones[ 2 ].flag = phase === 'post' ? 0x1000 : 0;
		if ( phase === 'post-parent' ) {

			data.bones[ 7 ].flag = 0x1000; data.bones[ 0 ].parentIndex = 7;

		}
		const mesh = loader.meshBuilder.build( data, '' ), meta = mesh.geometry.userData.MMD;
		const physics = new MMDPhysics( mesh, meta.rigidBodies, meta.constraints, { gravity: new Vector3(), unitStep: 1 / 60 } );
		const position = ( index: number ) => { const p = physics.bodies[ index ].body.getCenterOfMassTransform().getOrigin(); return [ p.x(), p.y(), p.z() ]; };
		const verify = ( x: number ) => {

			near( position( 0 ), [ x, 0, 0 ] ); near( physics.bodyResults[ 0 ].position, [ x, 0, 0 ] );
			near( position( 2 ), [ -2 + x, 0, 0 ] );
			near( mesh.skeleton.bones[ 2 ].getWorldPosition( new Vector3() ).toArray(), [ -2 + x, 0, 0 ] );
			assert.equal( physics.bodies[ 0 ].getDeferredPose(), null ); assert.equal( physics.bodies[ 2 ].getDeferredPose(), null );

		};
		for ( const x of [ 3, 4, 5 ] ) {

			mesh.skeleton.bones[ 0 ].position.x = x - ( phase === 'post-parent' ? 0.5 : 0 );
			mesh.skeleton.bones[ 2 ].position.x = -2.5 + x; mesh.updateMatrixWorld( true );
			physics.update( 1 / 60 ); verify( x ); assert.equal( physics.bodyResultPhase, 'step' );
			physics.warmup( 3 ); verify( x );
			physics.reset(); verify( x ); assert.equal( physics.bodyResultPhase, 'reset' );
			physics.warmup( 3 ); verify( x );

		}
		physics.dispose();

	} finally { delete ammoGlobal.Ammo; }

} );

for ( const pmxAnimation of [ false, true ] ) test( `shared warmup stages and finishes every mesh at fixed authored time pmx=${pmxAnimation}`, async () => {

	await initializeAmmo();
	try {

		const { mesh, loader } = setup(), helper = new MMDAnimationHelper( { pmxAnimation, sync: false } ); helper.sharedPhysics = true;
		const clip = loader.animationBuilder.build( new Parser().parseVmd( vmdBuffer( { boneName: 'bone7' } ), true ), mesh );
		helper.add( mesh, { animation: clip, warmup: 0, animationWarmup: false, gravity: new Vector3(), unitStep: 1 / 60 } );
		const state = helper.objects.get( mesh )!, physics = state.physics!, layers = state.poseLayers!;
		state.mixer!.setTime( 0.2 ); mesh.skeleton.bones[ 6 ].position.x = 0.8; helper.update( 0 );
		near( bodyPosition( helper, mesh, 0 ), [ 0, 0, 0 ] ); near( layers.final.slice( 0, 3 ), [ 0.4, 0, 0 ] );
		physics.bodies[ 1 ].body.setLinearVelocity!( new ammoGlobal.Ammo!.btVector3( 1, 0, 0 ) );
		const second = setup().mesh; second.position.z = 20;
		let callbacks = 0;
		helper.onBeforePhysics = participant => {

			if ( participant === mesh ) {

				const completed = callbacks / 2, x = 2 + completed / 60;
				near( physics.bodyResults[ 1 ].position, [ x, 0, 0 ] ); near( layers.final.slice( 7, 10 ), [ x + 0.2, 0, 0 ] );
				near( physics.bodyResults[ 0 ].position, [ completed === 0 ? 0 : 0.4, 0, 0 ] );
				assert.equal( state.mixer!.time, 0.2 );

			}
			callbacks ++;

		};
		helper.add( second, { warmup: 10, animationWarmup: false, gravity: new Vector3(), unitStep: 1 / 60 } );
		const secondState = helper.objects.get( second )!;
		assert.equal( physics.world, secondState.physics!.world );
		assert.equal( callbacks, 20 ); assert.equal( state.mixer!.time, 0.2 );
		const verify = ( steps: number, input: number ) => {

			const x = 2 + steps / 60;
			near( bodyPosition( helper, mesh, 1 ), [ x, 0, 0 ] ); near( physics.bodyResults[ 1 ].position, [ x, 0, 0 ] );
			near( layers.final.slice( 7, 10 ), [ x + input / 2, 0, 0 ] );
			near( bodyPosition( helper, mesh, 0 ), [ input, 0, 0 ] ); near( physics.bodyResults[ 0 ].position, [ input, 0, 0 ] );
			assert.equal( physics.bodyResultPhase, 'step' ); assert.equal( secondState.physics!.bodyResultPhase, 'step' );
			near( secondState.physics!.bodyResults[ 1 ].position, bodyPosition( helper, second, 1 ) );
			near( secondState.poseLayers!.final.slice( 7, 10 ), [ 2, 0, 0 ] );
			assert.equal( state.mixer!.time, 0.2 );

		};
		verify( 10, 0.4 );
		// Calling either adapter directly must still use the shared barrier.
		helper.onBeforePhysics = () => { callbacks ++; };
		mesh.skeleton.bones[ 6 ].position.x = 0.6; helper.update( 0 );
		near( bodyPosition( helper, mesh, 0 ), [ 0.4, 0, 0 ] ); callbacks = 0;
		secondState.physics!.warmup( 5 ); assert.equal( callbacks, 10 ); verify( 15, 0.3 );
		callbacks = 0; physics.warmup( 5 ); assert.equal( callbacks, 10 ); verify( 20, 0.3 );
		helper.update( 0 ); verify( 20, 0.3 );

	} finally { delete ammoGlobal.Ammo; }

} );

for ( const pmxAnimation of [ false, true ] ) for ( const sharedPhysics of [ false, true ] ) test( `layer lifecycle: warmup/reset/pause/seek/loop/toggles/transfer pmx=${pmxAnimation} shared=${sharedPhysics}`, async () => {

	await initializeAmmo();
	try {

		const { mesh, loader } = setup(), helper = new MMDAnimationHelper( { pmxAnimation, sync: false } ); helper.sharedPhysics = sharedPhysics;
		const clip = loader.animationBuilder.build( new Parser().parseVmd( vmdBuffer( { boneName: 'bone0' } ), true ), mesh );
		helper.add( mesh, { animation: clip, warmup: 4, gravity: new Vector3(), unitStep: 1 / 60 } );
		const state = helper.objects.get( mesh )!, layers = state.poseLayers!, physics = state.physics!, mixer = state.mixer!, action = mixer.clipAction( clip );
		const morph = mesh.geometry.userData.MMD.boneMorphs![ 0 ].elements[ 1 ];
		const warmedTime = mixer.time; physics.warmup( 3 ); assert.equal( mixer.time, warmedTime );
		mesh.morphTargetInfluences![ 1 ] = 0.5; mesh.skeleton.bones[ 6 ].position.x = 0.2;
		for ( const time of [ 0.5, 0.1, 0.8, 0, 0.25 ] ) {

			action.paused = false; mixer.setTime( time ); action.paused = true;
			for ( let repeat = 0; repeat < 5; repeat ++ ) {

				helper.update( 0 );
				near( layers.authored.slice( 0, 3 ), [ 2 * time, 0, 0 ] );
				near( bodyPosition( helper, mesh, 1 ), [ 2, 0, 0 ] );
				near( layers.final.slice( 7, 10 ), [ 2 + 0.5 * morph.position[ 0 ] + 0.05, 0.5 * morph.position[ 1 ], 0.5 * morph.position[ 2 ] ] );

			}
			physics.reset(); helper.update( 0 ); near( bodyPosition( helper, mesh, 1 ), [ 2, 0, 0 ] );

		}
		const expected = layers.final.slice();
		const rawBodies = physics.bodies.map( ( _, i ) => bodyPosition( helper, mesh, i ) );
		for ( let repeat = 0; repeat < 20; repeat ++ ) {

			helper.update( 0 ); near( layers.final, expected );
			physics.bodies.forEach( ( _, i ) => near( bodyPosition( helper, mesh, i ), rawBodies[ i ] ) );

		}
		for ( const feature of [ 'animation', 'boneMorph', 'grant', 'ik', 'physics' ] as const ) {

			helper.enable( feature, false ).update( 0 );
			near( bodyPosition( helper, mesh, 1 ), [ 2, 0, 0 ] );
			if ( feature === 'boneMorph' ) near( layers.final.slice( 7, 10 ), [ 2.05, 0, 0 ] );
			if ( feature === 'grant' ) near( layers.final.slice( 7, 10 ), [ 2 + 0.5 * morph.position[ 0 ], 0.5 * morph.position[ 1 ], 0.5 * morph.position[ 2 ] ] );
			helper.enable( feature, true ).update( 0 ); near( layers.final, expected );

		}
		action.paused = false; mixer.setTime( 0.95 ); helper.update( 0.1 ); action.paused = true;
		near( bodyPosition( helper, mesh, 1 ), [ 2, 0, 0 ] );
		assert.equal( state.looped, false ); const loopPose = layers.final.slice(); helper.update( 0 ); near( layers.final, loopPose );
		helper.pose( mesh, { metadata: { boneCount: 0, parentFile: '', coordinateSystem: 'right' }, bones: [] }, { ik: false, grant: false } );
		mesh.morphTargetInfluences!.fill( 0 ); helper.update( 0 ); physics.reset(); helper.update( 0 ); near( bodyPosition( helper, mesh, 1 ), [ 2, 0, 0 ] );
		helper.remove( mesh ); assert.equal( physics.bodies.length, 0 ); assert.equal( physics.constraints.length, 0 ); assert.equal( helper.masterPhysics, null );
		const transferred = new MMDAnimationHelper( { pmxAnimation: ! pmxAnimation } ); transferred.sharedPhysics = sharedPhysics;
		transferred.add( mesh, { warmup: 0, animationWarmup: false, gravity: new Vector3(), unitStep: 1 / 60 } );
		for ( let repeat = 0; repeat < 8; repeat ++ ) { transferred.update( 1 / 60 ); near( bodyPosition( transferred, mesh, 1 ), [ 2, 0, 0 ] ); }

	} finally { delete ammoGlobal.Ammo; }

} );

test( 'ordinary post grant chains inherit procedural motion from dynamic sources, excluding Bullet displacement', async () => {

	await initializeAmmo();
	try {

		const { data, loader } = setup();
		delete data.bones[ 6 ].ik;
		data.bones[ 10 ].parentIndex = -1; data.bones[ 10 ].flag = 0x1300;
		data.bones[ 10 ].grant = { parentIndex: 1, ratio: 0.5, isLocal: false, affectPosition: true, affectRotation: true };
		const mesh = loader.meshBuilder.build( data, '' ), helper = new MMDAnimationHelper();
		helper.add( mesh, { warmup: 0, animationWarmup: false, gravity: new Vector3() } );
		mesh.skeleton.bones[ 6 ].position.x = 0.8; mesh.skeleton.bones[ 6 ].quaternion.set( 0, 0, Math.sin( 0.2 ), Math.cos( 0.2 ) );
		const transform = helper.objects.get( mesh )!.physics!.bodies[ 1 ].body.getCenterOfMassTransform(); transform.getOrigin().setValue( 10, 0, 0 );
		helper.objects.get( mesh )!.physics!.bodies[ 1 ].body.setCenterOfMassTransform( transform );
		for ( let repeat = 0; repeat < 10; repeat ++ ) {

			helper.update( 0 ); near( mesh.skeleton.bones[ 1 ].position.toArray(), [ 10.2, 0, 0 ] );
			near( mesh.skeleton.bones[ 10 ].position.toArray(), [ 2.1, 1, 0 ] );
			near( mesh.skeleton.bones[ 10 ].quaternion.toArray(), [ 0, 0, Math.sin( 0.025 ), Math.cos( 0.025 ) ] );

		}

	} finally { delete ammoGlobal.Ammo; }

} );

test( 'invalid parents, cyclic hierarchies, IK and nonfinite post poses stay bounded and isolated', () => {

	for ( const variant of [ 'missing', 'fractional', 'self', 'cycle', 'ik', 'pose', 'rest', 'unit', 'ratio' ] ) {

		const { data, loader } = setup();
		if ( variant === 'missing' ) data.bones[ 0 ].parentIndex = 999;
		if ( variant === 'fractional' ) data.bones[ 0 ].parentIndex = 0.5;
		if ( variant === 'self' ) data.bones[ 0 ].parentIndex = 0;
		if ( variant === 'cycle' ) { data.bones[ 0 ].parentIndex = 1; data.bones[ 1 ].parentIndex = 0; }
		if ( variant === 'rest' ) data.bones[ 7 ].position[ 0 ] = NaN;
		if ( variant === 'ik' ) { data.bones[ 6 ].ik!.iteration = Infinity; data.bones[ 6 ].ik!.links[ 0 ].index = 999; }
		const mesh = loader.meshBuilder.build( data, '' ), helper = new MMDAnimationHelper(); helper.add( mesh, { physics: false } );
		if ( variant === 'unit' ) mesh.skeleton.bones[ 0 ].quaternion.set( 1e100, 0, 0, 1e100 );
		if ( variant === 'ratio' ) { mesh.geometry.userData.MMD.bones[ 0 ].grant!.ratio = Number.MAX_VALUE; mesh.skeleton.bones[ 6 ].position.x = 1; }
		if ( variant === 'pose' ) { mesh.skeleton.bones[ 0 ].position.x = NaN; mesh.skeleton.bones[ 0 ].quaternion.set( Infinity, 0, 0, 0 ); }
		for ( let repeat = 0; repeat < 3; repeat ++ ) {

			helper.update( 0 ); assert.ok( mesh.skeleton.bones.every( b => b.matrixWorld.elements.every( Number.isFinite ) ) );
			near( mesh.skeleton.bones[ 8 ].position.toArray(), [ -0.65, 0, 0 ] );

		}

	}

} );

test( 'post authored state precedes IK whose dynamic link has a later class', async () => {

	await initializeAmmo();
	try {

		const { data, loader } = setup( true ); data.bones[ 9 ].transformationClass = 3;
		const mesh = loader.meshBuilder.build( data, '' ), helper = new MMDAnimationHelper();
		helper.add( mesh, { warmup: 0, animationWarmup: false, gravity: new Vector3() } );
		for ( let repeat = 0; repeat < 8; repeat ++ ) {

			helper.update( 1 / 60 ); near( mesh.skeleton.bones[ 1 ].quaternion.toArray(), [ 0, 0, -Math.sin( Math.PI / 8 ), Math.cos( Math.PI / 8 ) ] );

		}

	} finally { delete ammoGlobal.Ammo; }

} );

test( 'a dynamic pre child retains body authority when a post parent translates/rotates', async () => {

	await initializeAmmo();
	try {

		const { data, loader } = setup(); delete data.bones[ 6 ].ik;
		data.bones[ 7 ].flag = 0x1000; data.bones[ 3 ].parentIndex = 7;
		const mesh = loader.meshBuilder.build( data, '' ), helper = new MMDAnimationHelper();
		helper.add( mesh, { warmup: 0, animationWarmup: false, gravity: new Vector3() } );
		mesh.skeleton.bones[ 7 ].position.x += 1; mesh.skeleton.bones[ 7 ].quaternion.set( 0, Math.sin( 0.3 ), 0, Math.cos( 0.3 ) );
		for ( let repeat = 0; repeat < 8; repeat ++ ) {

			helper.update( 0 ); near( mesh.skeleton.bones[ 3 ].getWorldPosition( new Vector3() ).toArray(), [ 0.65, 0, 0 ] );
			const q = mesh.skeleton.bones[ 3 ].getWorldQuaternion( mesh.skeleton.bones[ 3 ].quaternion.clone() ); near( q.toArray(), [ 0, 0, 0, 1 ] );

		}

	} finally { delete ammoGlobal.Ammo; }

} );

test( 'VPD captures authored/pre/post snapshots and reset never bakes post motion into a mode-1 body', async () => {

	await initializeAmmo();
	try {

		const { data, loader } = setup();
		data.bones[ 1 ].position = [ 5, 0, 0 ]; data.rigidBodies[ 1 ].position = [ 5, 0, 0 ];
		const mesh = loader.meshBuilder.build( data, '' ), helper = new MMDAnimationHelper();
		helper.add( mesh, { warmup: 0, animationWarmup: false, gravity: new Vector3() } );
		helper.pose( mesh, { metadata: { boneCount: 2, parentFile: '', coordinateSystem: 'right' }, bones: [
			{ name: 'bone0', translation: [ 0.5, 0, 0 ], quaternion: [ 0, 0, 0, 1 ] },
			{ name: 'bone6', translation: [ 0.8, 0, 0 ], quaternion: [ 0, 0, 0, 1 ] }
		] } );
		const state = helper.objects.get( mesh )!, layers = state.poseLayers!;
		near( layers.authored.slice( 0, 3 ), [ 0.5, 0, 0 ] ); near( layers.beforePhysics.slice( 0, 3 ), [ 0, 0, 0 ] ); near( layers.final.slice( 0, 3 ), [ 0.9, 0, 0 ] );
		state.physics!.reset(); near( bodyPosition( helper, mesh, 1 ), [ 5, 0, 0 ] );
		for ( let repeat = 0; repeat < 8; repeat ++ ) {

			helper.update( 1 / 60 ); near( bodyPosition( helper, mesh, 0 ), [ 0.9, 0, 0 ] ); near( bodyPosition( helper, mesh, 1 ), [ 5, 0, 0 ] ); near( layers.final.slice( 7, 10 ), [ 5.2, 0, 0 ] );

		}

	} finally { delete ammoGlobal.Ammo; }

} );

test( 'pre-phase mode2 retains authored position and Bullet rotation across repeated steps', async () => {

	await initializeAmmo();
	try {

		const { data, loader } = setup(); data.bones[ 2 ].flag = 0x0380;
		const mesh = loader.meshBuilder.build( data, '' ), helper = new MMDAnimationHelper();
		helper.add( mesh, { warmup: 0, animationWarmup: false, gravity: new Vector3(), unitStep: 1 / 60 } );
		helper.pose( mesh, { metadata: { boneCount: 2, parentFile: '', coordinateSystem: 'right' }, bones: [
			{ name: 'bone2', translation: [ 0.3, 0.2, 0 ], quaternion: [ 0, Math.sin( 0.1 ), 0, Math.cos( 0.1 ) ] },
			{ name: 'bone6', translation: [ 0.4, 0, 0 ], quaternion: [ 0, 0, Math.sin( 0.2 ), Math.cos( 0.2 ) ] }
		] } );
		for ( let repeat = 0; repeat < 20; repeat ++ ) {

			helper.update( 1 / 60 );
			near( mesh.skeleton.bones[ 2 ].getWorldPosition( new Vector3() ).toArray(), [ -1.6, 0.2, 0 ] );
			near( bodyPosition( helper, mesh, 2 ), [ -1.6, 0.2, 0 ] );
			near( helper.objects.get( mesh )!.physics!.bodyResults[ 2 ].position, repeat === 0 ? [ -2, 0, 0 ] : [ -1.6, 0.2, 0 ] );
			near( mesh.skeleton.bones[ 2 ].quaternion.toArray(), [ 0, 0, 0, 1 ] );

		}
		helper.enable( 'physics', false ).update( 0 );
		near( mesh.skeleton.bones[ 2 ].quaternion.toArray(), product( [ 0, Math.sin( 0.1 ), 0, Math.cos( 0.1 ) ], [ 0, 0, Math.sin( 0.05 ), Math.cos( 0.05 ) ] ) );

	} finally { delete ammoGlobal.Ammo; }

} );

test( 'joint-converted mode2 targets compose using their effective mode1 authority', async () => {

	await initializeAmmo();
	try {

		const { data, loader } = setup(); data.bones[ 2 ].parentIndex = 3;
		data.constraints[ 0 ].rigidBodyIndex1 = 3; data.constraints[ 0 ].rigidBodyIndex2 = 2;
		const mesh = loader.meshBuilder.build( data, '' ), helper = new MMDAnimationHelper();
		assert.equal( data.rigidBodies[ 2 ].type, 2 );
		assert.equal( mesh.geometry.userData.MMD.rigidBodies[ 2 ].type, 1 );
		assert.equal( mesh.geometry.userData.MMD.bones[ 2 ].rigidBodyType, 1 );
		helper.add( mesh, { warmup: 0, animationWarmup: false, gravity: new Vector3() } );
		helper.pose( mesh, { metadata: { boneCount: 2, parentFile: '', coordinateSystem: 'right' }, bones: [
			{ name: 'bone2', translation: [ 0.3, 0, 0 ], quaternion: [ 0, 0, 0, 1 ] },
			{ name: 'bone6', translation: [ 0.4, 0, 0 ], quaternion: [ 0, 0, 0, 1 ] }
		] } );
		const body = helper.objects.get( mesh )!.physics!.bodies[ 2 ].body;
		const transform = body.getCenterOfMassTransform(); transform.getOrigin().setValue( -3, 0, 0 ); body.setCenterOfMassTransform( transform );
		for ( let repeat = 0; repeat < 8; repeat ++ ) {

			helper.update( 0 ); near( bodyPosition( helper, mesh, 2 ), [ -3, 0, 0 ] ); near( mesh.skeleton.bones[ 2 ].getWorldPosition( new Vector3() ).toArray(), [ -2.6, 0, 0 ] );

		}

	} finally { delete ammoGlobal.Ammo; }

} );
