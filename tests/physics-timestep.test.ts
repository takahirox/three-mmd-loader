import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { before, test } from 'node:test';
import { Parser } from 'mmd-parser';
import { Texture, Vector3 } from 'three';
import type { AmmoAPI, AmmoBody, AmmoWorld } from '../src/ammo.js';
import { MMDAnimationHelper } from '../src/animation/MMDAnimationHelper.js';
import { MMDPhysics } from '../src/animation/MMDPhysics.js';
import { PhysicsWorkerRuntime } from '../src/animation/PhysicsWorkerRuntime.js';
import type { PhysicsRequest, PhysicsResponse } from '../src/animation/PhysicsWorkerProtocol.js';
import { MMDLoader } from '../src/loaders/MMDLoader.js';
import { linkedCollisionBuffer } from './fixtures.ts';
import { type2Fixture } from './type2-fixture.ts';

const host = globalThis as typeof globalThis & { Ammo: AmmoAPI };
before( async () => { host.Ammo = await ( createRequire( import.meta.url )( 'ammojs-typed' ) as () => Promise<AmmoAPI> )(); } );
const unitStep = 1 / 60;
const invalidDeltas = [ 0, -0, -1 / 60, -1, NaN, Infinity, -Infinity ];

// Deterministic message delivery with real cloning/transfers and real Ammo.
// The browser suite separately runs the bundled Worker on another thread.
class TimestepWorker {
	onmessage: Worker['onmessage'] = null;
	requests: PhysicsRequest[] = [];
	sent: PhysicsRequest[] = [];
	private responses: PhysicsResponse[] = [];
	private runtime = new PhysicsWorkerRuntime( ( response, transfer = [] ) => this.responses.push( structuredClone( response, { transfer } ) ) );
	postMessage( message: PhysicsRequest, transfer: Transferable[] = [] ) {

		const copy = structuredClone( message, { transfer } ); this.requests.push( copy ); this.sent.push( copy );

	}
	terminate() {}
	flush() {

		while ( this.requests.length ) {

			const request = this.requests.shift()!;
			if ( request.type !== 'init' ) this.runtime.handle( request );

		}
		while ( this.responses.length ) this.onmessage?.call( this as unknown as Worker, { data: this.responses.shift()! } as MessageEvent );

	}
}

for ( const format of [ 'pmd', 'pmx' ] as const ) for ( const path of [ 'sync', 'shared sync', 'worker' ] ) for ( const override of [ undefined, 1 / 65 ] ) for ( const fps of [ 30, 60, 120, 144 ] ) test( `native timekeeping ${format} ${path}, ${override === undefined ? 'default 60 Hz' : 'explicit 65 Hz'}, ${fps} FPS`, t => {

	const fixedStep = override ?? 1 / 60, worlds: AmmoWorld[] = [], bodies: AmmoBody[] = [];
	t.mock.method( host.Ammo, 'btDiscreteDynamicsWorld', class extends host.Ammo.btDiscreteDynamicsWorld {

		constructor( ...args: ConstructorParameters<AmmoAPI['btDiscreteDynamicsWorld']> ) { super( ...args ); worlds.push( this ); }

	} );
	t.mock.method( host.Ammo, 'btRigidBody', class extends host.Ammo.btRigidBody {

		constructor( info: ConstructorParameters<AmmoAPI['btRigidBody']>[0] ) { super( info ); bodies.push( this ); }

	} );
	// Parsed binary PMD/PMX: a constrained dynamic probe can move freely along X.
	// Collision masks reject contact; zero authored damping gives a native clock.
	const parser = new Parser(), buffer = linkedCollisionBuffer( format, { masks: [ 0, 0 ] } );
	const data = format === 'pmd' ? parser.parsePmd( buffer, true ) : parser.parsePmx( buffer, true );
	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	const meshes = Array.from( { length: path === 'sync' ? 1 : 2 }, ( _, i ) => {

		const mesh = loader.meshBuilder.build( data, '' ); mesh.position.z = i * 20; mesh.updateMatrixWorld( true ); return mesh;

	} );
	const helper = new MMDAnimationHelper( { sync: false } ); helper.sharedPhysics = true;
	const worker = new TimestepWorker();
	const params = { gravity: new Vector3(), ...( override === undefined ? {} : { unitStep: override } ) };
	let standalone: MMDPhysics | undefined;
	try {

		if ( path === 'sync' ) {

			const meta = meshes[ 0 ].geometry.userData.MMD;
			standalone = new MMDPhysics( meshes[ 0 ], meta.rigidBodies, meta.constraints, params );

		}
		else for ( const mesh of meshes ) helper.add( mesh, {
			...params, warmup: 0, animationWarmup: false,
			...( path === 'worker' ? { physicsMode: 'worker' as const, workerPhysics: { ammoURL: 'https://example.test/ammo.js', createWorker: () => worker as unknown as Worker } } : {} )
		} );
		worker.flush();
		assert.equal( worlds.length, 1, 'shared models construct and step exactly one native world' );
		assert.equal( bodies.length, meshes.length * 2 );
		for ( const mesh of meshes ) {

			const physics = standalone ?? helper.objects.get( mesh )!.physics!;
			assert.equal( physics.unitStep, fixedStep ); assert.equal( physics.maxStepNum, 10 );
			assert.equal( physics.physicsMode, path === 'worker' ? 'worker' : 'sync' );
			if ( path === 'shared sync' ) assert.equal( physics.world, worlds[ 0 ] );

		}
		if ( path === 'worker' ) {

			const adds = worker.sent.filter( message => message.type === 'add' );
			assert.equal( adds.length, meshes.length );
			for ( const message of adds ) { assert.equal( message.model.unitStep, fixedStep ); assert.equal( message.model.maxStepNum, 10 ); }
			// Consume the initial reset snapshot before installing the probe drive.
			helper.update( 0 ); worker.flush();

		}
		const probes = bodies.filter( ( _, i ) => i % 2 === 1 );
		const origins = probes.map( body => body.getCenterOfMassTransform().getOrigin().x() );
		const velocity = new host.Ammo.btVector3( 1, 0, 0 );
		for ( const probe of probes ) probe.setLinearVelocity!( velocity );
		host.Ammo.destroy?.( velocity );
		const step = t.mock.method( worlds[ 0 ], 'stepSimulation' ); // Pass through to native Bullet.
		let simulated = 0, elapsed = 0, zeroStepFrames = 0;
		function advance( delta: number ) {

			const count = step.mock.callCount();
			if ( standalone ) standalone.update( delta ); else helper.update( delta );
			worker.flush();
			if ( delta > 0 && Number.isFinite( delta ) ) {

				assert.equal( step.mock.callCount(), count + 1, 'one Bullet call per positive frame, even with shared models' );
				const call = step.mock.calls.at( -1 )!, budget = Math.min( Math.floor( delta / fixedStep ) + 1, 10 );
				assert.deepEqual( call.arguments, [ delta, budget, fixedStep ] );
				// Bullet returns requested steps BEFORE clamping. Probe motion below
				// independently verifies the number of steps actually executed.
				const executed = Math.min( call.result!, budget );
				assert.ok( executed >= 0 && executed <= 10 );
				simulated += executed * fixedStep;
				if ( executed === 0 ) zeroStepFrames ++;

			} else assert.equal( step.mock.callCount(), count, 'invalid time cannot enter Bullet' );
			for ( const [ i, probe ] of probes.entries() ) {

				const x = probe.getCenterOfMassTransform().getOrigin().x();
				assert.ok( Math.abs( x - origins[ i ] - simulated ) < 3e-5, `native displacement ${x - origins[ i ]} must equal simulated time ${simulated}` );

			}

		}
		// A quarter-step must be retained, without forcing any integration.
		advance( fixedStep / 4 ); elapsed += fixedStep / 4;
		assert.equal( simulated, 0 );
		for ( const delta of invalidDeltas ) advance( delta );
		for ( let frame = 0; frame < fps; frame ++ ) {

			advance( 1 / fps ); elapsed += 1 / fps;
			assert.ok( simulated <= elapsed + 2e-6 && elapsed - simulated < fixedStep + 2e-6, 'native simulation stays within one fixed step of elapsed time' );

		}
		assert.ok( Math.abs( simulated - 1 ) < 2e-6, 'one elapsed second completes 60 or 65 steps, without speed-up' );
		if ( fps > 65 ) assert.ok( zeroStepFrames > 1, 'high-refresh frames sometimes execute no substep' );
		const beforeStall = simulated;
		advance( 0.25 );
		assert.ok( step.mock.calls.at( -1 )!.result! > 10, 'stall requests more steps than the budget' );
		assert.ok( Math.abs( simulated - beforeStall - 10 * fixedStep ) < 1e-12, 'native work is capped at ten substeps' );
		advance( fixedStep / 8 );
		assert.equal( simulated, beforeStall + 10 * fixedStep, 'discarded stall time does not become a catch-up backlog' );
		advance( fixedStep );
		assert.ok( Math.abs( simulated - beforeStall - 11 * fixedStep ) < 1e-12, 'fractional accumulation continues after the stall' );
		for ( const delta of invalidDeltas ) advance( delta );

	} finally {

		standalone?.dispose(); for ( const mesh of [ ...helper.meshes ] ) helper.remove( mesh ); worker.flush();
		for ( const mesh of meshes ) { mesh.geometry.dispose(); mesh.skeleton.dispose(); }

	}

} );

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
			assert.deepEqual( call.arguments, [ 1 / fps, Math.min( Math.floor( ( 1 / fps ) / unitStep ) + 1, 10 ), unitStep ] );
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
		if ( fps > 60 ) assert.ok( fractionalFrames > 0, 'some rendered frames must complete no Bullet substep' );

	} finally { step.mock.restore(); host.Ammo.destroy?.( velocity ); physics.dispose(); }

} );
