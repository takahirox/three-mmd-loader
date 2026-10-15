import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { before, test } from 'node:test';
import { Vector3 } from 'three';
import type { AmmoAPI } from '../src/ammo.js';
import { MMDAnimationHelper } from '../src/animation/MMDAnimationHelper.js';
import { MMDPhysics } from '../src/animation/MMDPhysics.js';
import { type2Fixture } from './type2-fixture.ts';

const host = globalThis as typeof globalThis & { Ammo: AmmoAPI };
before( async () => { host.Ammo = await ( createRequire( import.meta.url )( 'ammojs-typed' ) as () => Promise<AmmoAPI> )(); } );
const unitStep = 1 / 65;
const invalidDeltas = [ 0, -0, -1 / 60, -1, NaN, Infinity, -Infinity ];

for ( const format of [ 'pmd', 'pmx' ] as const ) test( `Bullet receives elapsed time and safe capped substep counts (${format})`, t => {

	const mesh = type2Fixture(); mesh.geometry.userData.MMD.format = format;
	const physics = new MMDPhysics( mesh, [], [] );
	const step = t.mock.method( physics.world!, 'stepSimulation', () => 0 );
	try {

		assert.equal( physics.unitStep, unitStep ); assert.equal( physics.maxStepNum, 10 );
		for ( const [ delta, maxSteps ] of [
			[ 1 / 144, 1 ], [ 1 / 120, 1 ], [ unitStep, 2 ], [ 1 / 60, 2 ], [ 1 / 30, 3 ],
			[ 0.1, 7 ], [ 0.25, 10 ], [ ( 2 ** 31 ) * unitStep, 10 ], [ Number.MAX_VALUE, 10 ]
		] ) {

			physics.update( delta );
			assert.deepEqual( step.mock.calls.at( -1 )!.arguments, [ delta, maxSteps, unitStep ] );

		}
		const count = step.mock.callCount();
		for ( const delta of invalidDeltas ) physics.update( delta );
		assert.equal( step.mock.callCount(), count, 'zero/invalid time must never enter Bullet' );

	} finally { step.mock.restore(); physics.dispose(); }

} );

test( 'custom fixed step and maximum retain the existing substep budget policy', t => {

	const physics = new MMDPhysics( type2Fixture(), [], [], { unitStep: 1 / 100, maxStepNum: 5 } );
	const step = t.mock.method( physics.world!, 'stepSimulation', () => 0 );
	try {

		for ( const [ delta, maxSteps ] of [ [ 1 / 240, 1 ], [ 0.01, 2 ], [ 0.035, 4 ], [ 1, 5 ] ] ) {

			physics._stepSimulation( delta );
			assert.deepEqual( step.mock.calls.at( -1 )!.arguments, [ delta, maxSteps, 0.01 ] );

		}
		assert.equal( physics.unitStep, 0.01 ); assert.equal( physics.maxStepNum, 5 );

	} finally { step.mock.restore(); physics.dispose(); }

} );

for ( const fps of [ 30, 60, 120, 144 ] ) test( `${fps} FPS forwards one second to Bullet's fixed-step accumulator`, t => {

	const physics = new MMDPhysics( type2Fixture(), [], [] );
	let remainder = 0, simulated = 0, elapsed = 0;
	// Deterministic model of Bullet's accumulator, driven by actual call arguments.
	const step = t.mock.method( physics.world!, 'stepSimulation', ( delta: number, maxSteps: number, fixedStep: number ) => {

		remainder += delta;
		const steps = Math.floor( remainder / fixedStep );
		remainder -= steps * fixedStep;
		simulated += Math.min( steps, maxSteps ) * fixedStep;
		return steps;

	} );
	try {

		for ( let frame = 0; frame < fps; frame ++ ) {

			elapsed += 1 / fps; physics.update( 1 / fps );
			assert.deepEqual( step.mock.calls.at( -1 )!.arguments, [ 1 / fps, Math.min( Math.floor( 65 / fps ) + 1, 10 ), unitStep ] );
			assert.ok( simulated <= elapsed + 1e-12 );
			assert.ok( elapsed - simulated < unitStep + 1e-12 );

		}
		assert.equal( step.mock.callCount(), fps );
		const forwarded = step.mock.calls.reduce( ( sum, call ) => sum + call.arguments[ 0 ], 0 );
		assert.ok( Math.abs( forwarded - 1 ) < 1e-12 );

	} finally { step.mock.restore(); physics.dispose(); }

} );

for ( const format of [ 'pmd', 'pmx' ] as const ) test( `shared ${format} world forwards short deltas once per frame`, t => {

	const helper = new MMDAnimationHelper( { sync: false } ); helper.sharedPhysics = true;
	const models = [ type2Fixture(), type2Fixture() ];
	for ( const [ i, mesh ] of models.entries() ) {

		mesh.geometry.userData.MMD.format = format; mesh.position.z = i * 20;
		helper.add( mesh, { warmup: 0, animationWarmup: false, gravity: new Vector3() } );

	}
	const physics = helper.objects.get( models[ 0 ] )!.physics!;
	assert.equal( physics.world, helper.objects.get( models[ 1 ] )!.physics!.world );
	const step = t.mock.method( physics.world!, 'stepSimulation', () => 0 );
	try {

		for ( let frame = 0; frame < 8; frame ++ ) helper.update( 1 / 120 );
		assert.deepEqual( step.mock.calls.map( call => call.arguments ), Array.from( { length: 8 }, () => [ 1 / 120, 1, unitStep ] ) );
		for ( const delta of invalidDeltas ) helper.update( delta );
		assert.equal( step.mock.callCount(), 8 );

	} finally { step.mock.restore(); for ( const mesh of models ) helper.remove( mesh ); }

} );

for ( const format of [ 'pmd', 'pmx' ] as const ) for ( const fps of [ 10, 20, 30, 60, 120, 144 ] ) test( `real Ammo ${format} accumulates fractional time at ${fps} FPS`, t => {

	// Keep a moving kinematic/constrained pair and an isolated mode-1 probe.
	const mesh = type2Fixture(), meta = mesh.geometry.userData.MMD; meta.format = format;
	meta.rigidBodies[ 2 ].groupTarget = 0;
	meta.rigidBodies[ 2 ].positionDamping = 0;
	const physics = new MMDPhysics( mesh, meta.rigidBodies, meta.constraints, { gravity: new Vector3() } );
	const probe = physics.bodies[ 2 ].body;
	const initialZ = probe.getCenterOfMassTransform().getOrigin().z();
	const velocity = new host.Ammo.btVector3( 0, 0, 1 ); probe.setLinearVelocity!( velocity );
	const step = t.mock.method( physics.world!, 'stepSimulation' ); // Calls the actual Ammo method.
	let elapsed = 0, simulated = 0, fractionalFrames = 0;
	try {

		for ( let frame = 0; frame < fps; frame ++ ) {

			mesh.skeleton.bones[ 0 ].position.x = -frame / fps / 10; mesh.updateMatrixWorld( true );
			elapsed += 1 / fps; physics.update( 1 / fps );
			const call = step.mock.calls.at( -1 )!;
			assert.deepEqual( call.arguments, [ 1 / fps, Math.min( Math.floor( 65 / fps ) + 1, 10 ), unitStep ] );
			simulated += call.result! * unitStep;
			if ( call.result === 0 ) fractionalFrames ++;
			const z = probe.getCenterOfMassTransform().getOrigin().z();
			assert.ok( Math.abs( z - initialZ - simulated ) < 3e-5, 'native probe integrates only completed fixed steps' );
			assert.ok( simulated <= elapsed + 2e-6 && elapsed - simulated < unitStep + 2e-6 );
			assert.ok( physics.bodyResults.every( r => [ ...r.position, ...r.quaternion ].every( Number.isFinite ) ) );
			const before = z;
			for ( const delta of invalidDeltas ) physics.update( delta );
			assert.equal( probe.getCenterOfMassTransform().getOrigin().z(), before );

		}
		assert.equal( step.mock.callCount(), fps );
		if ( fps > 65 ) assert.ok( fractionalFrames > 0, 'some rendered frames must complete no Bullet substep' );

	} finally { step.mock.restore(); host.Ammo.destroy?.( velocity ); physics.dispose(); }

} );
