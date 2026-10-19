import assert from 'node:assert/strict';
import { initializeAmmo } from './ammo-runtime.ts';
import { before, test } from 'node:test';
import { Parser } from 'mmd-parser';
import { Matrix4, Quaternion, Texture, Vector3 } from 'three';
import type { AmmoAPI, AmmoTransform } from '../src/ammo.js';
import { MMDPhysics } from '../src/animation/MMDPhysics.js';
import { MMDLoader } from '../src/loaders/MMDLoader.js';
import { rotationPhysicsBuffer } from './fixtures.ts';
import { ManualWorker } from './manual-physics-worker.ts';
import { ammoMatrix, rightHandedRotation, rotationCases } from './rotation-reference.ts';

const host = globalThis as typeof globalThis & { Ammo: AmmoAPI };
before( async () => { host.Ammo = await initializeAmmo<AmmoAPI>(); } );
function model( format: 'pmd' | 'pmx', jointAngles: number[], bodyAngles = [ -0.27, 0.38, -0.56 ] ) {

	const parser = new Parser(), bytes = rotationPhysicsBuffer( format, bodyAngles, 1, true, jointAngles );
	const data = format === 'pmd' ? parser.parsePmd( bytes, true ) : parser.parsePmx( bytes, true );
	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	return loader.meshBuilder.build( data, '' );

}
function difference( a: Matrix4, b: Matrix4 ) { return Math.max( ...a.elements.map( ( v, i ) => Math.abs( v - b.elements[ i ] ) ) ); }
function near( a: Matrix4, b: Matrix4 ) { assert.ok( difference( a, b ) < 5e-5, `${difference( a, b )}` ); }

// Computed-frame assertions: observe actual native constructor inputs, without
// substituting them. The bodies have nonidentity offsets independent of joints.
for ( const format of [ 'pmd', 'pmx' ] as const ) for ( const path of [ 'standalone', 'shared', 'worker' ] ) for ( const fixture of rotationCases ) test( `joint frames ${format} ${path} ${fixture.name}`, t => {

	const frames: Matrix4[][] = [], worlds: Matrix4[][] = [];
	t.mock.method( host.Ammo, 'btGeneric6DofSpringConstraint', class extends host.Ammo.btGeneric6DofSpringConstraint {

		constructor( ...args: ConstructorParameters<AmmoAPI['btGeneric6DofSpringConstraint']> ) {

			frames.push( [ ammoMatrix( args[ 2 ] ), ammoMatrix( args[ 3 ] ) ] );
			worlds.push( [ args[ 0 ], args[ 1 ] ].map( b => ammoMatrix( b.getCenterOfMassTransform() ) ) );
			super( ...args );

		}

	} );
	const worker = new ManualWorker(), meshes = Array.from( { length: path === 'standalone' ? 1 : 2 }, () => model( format, fixture.angles ) ), physics: MMDPhysics[] = [];
	try {

		for ( const mesh of meshes ) {

			const meta = mesh.geometry.userData.MMD;
			assert.deepEqual( meta.constraints[ 0 ].rotation, [ -Math.fround( fixture.angles[ 0 ] ), -Math.fround( fixture.angles[ 1 ] ), Math.fround( fixture.angles[ 2 ] ) ] );
			physics.push( new MMDPhysics( mesh, meta.rigidBodies, meta.constraints, { gravity: new Vector3(), world: path === 'shared' ? physics[ 0 ]?.world ?? undefined : undefined, physicsMode: path === 'worker' ? 'worker' : 'sync', workerPhysics: worker.options() }, physics[ 0 ]?.workerAdapter?.group ) );

		}
		worker.start();
		assert.equal( frames.length, meshes.length );
		for ( const [ m, mesh ] of meshes.entries() ) {

			const joint = mesh.geometry.userData.MMD.constraints[ 0 ];
			const expected = rightHandedRotation( joint.rotation ).setPosition( new Vector3().fromArray( joint.position ) );
			const old = rightHandedRotation( joint.rotation, 'XYZ' ).setPosition( new Vector3().fromArray( joint.position ) );
			assert.equal( difference( expected, old ) > 1e-4, fixture.differs );
			for ( let b = 0; b < 2; b ++ ) {

				near( frames[ m ][ b ], worlds[ m ][ b ].clone().invert().multiply( expected ) );
				near( worlds[ m ][ b ].clone().multiply( frames[ m ][ b ] ), expected );

			}

		}

	} finally {

		for ( const p of physics ) p.dispose(); worker.start();
		for ( const mesh of meshes ) { mesh.geometry.dispose(); mesh.skeleton.dispose(); }

	}

} );

function nativeTransform( matrix: Matrix4 ) {

	const form = new host.Ammo.btTransform(), q = new Quaternion().setFromRotationMatrix( matrix );
	const quaternion = new host.Ammo.btQuaternion( q.x, q.y, q.z, q.w );
	form.setIdentity(); form.getOrigin().setValue( matrix.elements[ 12 ], matrix.elements[ 13 ], matrix.elements[ 14 ] ); form.setRotation( quaternion );
	host.Ammo.destroy!( quaternion ); return form;

}

// Genuine solver results, separate from the frame checks above. A prismatic
// joint allows +/-0.35 along joint X and locks the other five axes. Constant
// world gravity excites the slider. Reference runs replace only constructor
// frames with scalar-oracle frames; all three runs use real Bullet simulation.
for ( const format of [ 'pmd', 'pmx' ] as const ) for ( const fixture of rotationCases ) test( `Bullet joint-axis trajectory ${format} ${fixture.name}`, t => {

	function simulate( order?: 'YXZ' | 'XYZ' ) {

		const mesh = model( format, fixture.angles, [ 0, 0, 0 ] ), meta = mesh.geometry.userData.MMD, joint = meta.constraints[ 0 ];
		// Put the slider pivot at the dynamic center of mass to avoid torque.
		joint.position = mesh.skeleton.bones[ 1 ].getWorldPosition( new Vector3() ).add( new Vector3().fromArray( meta.rigidBodies[ 1 ].position ) ).toArray();
		joint.translationLimitation1 = [ -0.35, 0, 0 ]; joint.translationLimitation2 = [ 0.35, 0, 0 ];
		const worldJoint = rightHandedRotation( joint.rotation, order ).setPosition( new Vector3().fromArray( joint.position ) );
		const mock = order && t.mock.method( host.Ammo, 'btGeneric6DofSpringConstraint', class extends host.Ammo.btGeneric6DofSpringConstraint {

			constructor( ...args: ConstructorParameters<AmmoAPI['btGeneric6DofSpringConstraint']> ) {

				const forms: AmmoTransform[] = [ args[ 0 ], args[ 1 ] ].map( b => nativeTransform( ammoMatrix( b.getCenterOfMassTransform() ).invert().multiply( worldJoint ) ) );
				super( args[ 0 ], args[ 1 ], forms[ 0 ], forms[ 1 ], args[ 4 ] );
				forms.forEach( form => host.Ammo.destroy!( form ) );

			}

		} );
		const p = new MMDPhysics( mesh, meta.rigidBodies, meta.constraints, { gravity: new Vector3( 2, -5, 3 ) } );
		if ( mock ) mock.mock.restore();
		try {

			const initial = ammoMatrix( p.bodies[ 1 ].body.getCenterOfMassTransform() ), trajectory: Matrix4[] = [];
			for ( let frame = 0; frame < 90; frame ++ ) {

				p.update( 1 / 60 ); trajectory.push( ammoMatrix( p.bodies[ 1 ].body.getCenterOfMassTransform() ) );

			}
			return { initial, trajectory, worldJoint };

		} finally { p.dispose(); mesh.geometry.dispose(); mesh.skeleton.dispose(); }

	}
	const actual = simulate(), expected = simulate( 'YXZ' ), previous = simulate( 'XYZ' );
	const axis = new Vector3().setFromMatrixColumn( expected.worldJoint, 0 );
	let travel = 0, oldDifference = 0, referenceError = 0, transverse = 0, rotationError = 0;
	for ( const [ i, pose ] of actual.trajectory.entries() ) {

		referenceError = Math.max( referenceError, difference( pose, expected.trajectory[ i ] ) );
		oldDifference = Math.max( oldDifference, difference( pose, previous.trajectory[ i ] ) );
		const displacement = new Vector3().setFromMatrixPosition( pose ).sub( new Vector3().setFromMatrixPosition( actual.initial ) );
		const along = displacement.dot( axis ); travel = Math.max( travel, Math.abs( along ) );
		transverse = Math.max( transverse, displacement.addScaledVector( axis, -along ).length() );
		rotationError = Math.max( rotationError, difference( pose.clone().setPosition( 0, 0, 0 ), actual.initial.clone().setPosition( 0, 0, 0 ) ) );

	}
	// Bullet resolves finite-step constraint error under gravity. These solver
	// bounds are separate from the 5e-5 computed-frame tolerance above.
	assert.ok( referenceError < 0.002, `oracle native trajectory error: ${referenceError}` );
	assert.ok( transverse < 0.002, `motion follows joint X: ${transverse}` );
	assert.ok( rotationError < 5e-5, `locked angular axes: ${rotationError}` );
	assert.ok( travel > 0.02 && travel < 0.38, `nonzero travel with discrete limit overshoot: ${travel}` );
	if ( fixture.differs ) assert.ok( oldDifference > 0.02, `old XYZ trajectory differs: ${oldDifference}` );
	else assert.ok( oldDifference < 0.002, `zero/single-axis trajectories equivalent: ${oldDifference}` );

} );
