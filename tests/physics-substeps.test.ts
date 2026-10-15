import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { before, test } from 'node:test';
import { Parser } from 'mmd-parser';
import { Texture, Vector3 } from 'three';
import type { AmmoAPI, AmmoWorld } from '../src/ammo.js';
import { MMDAnimationHelper } from '../src/animation/MMDAnimationHelper.js';
import { MMDLoader } from '../src/loaders/MMDLoader.js';
import { linkedCollisionBuffer } from './fixtures.ts';
import { ManualWorker } from './manual-physics-worker.ts';

const host = globalThis as typeof globalThis & { Ammo: AmmoAPI };
before( async () => { host.Ammo = await ( createRequire( import.meta.url )( 'ammojs-typed' ) as () => Promise<AmmoAPI> )(); } );
const tapes = [
	...[ 10, 20, 30, 60, 120, 144 ].map( fps => ( { name: `${fps} FPS`, deltas: Array.from( { length: fps }, () => 1 / fps ), long: false } ) ),
	{ name: '100ms one-off stall', deltas: [ 1 / 120, 0.1, ...Array<number>( 12 ).fill( 1 / 120 ) ], long: false },
	{ name: '250ms stall and recovery', deltas: [ 0.25, ...Array<number>( 12 ).fill( 1 / 120 ) ], long: true }
];
function model( format: 'pmd' | 'pmx' ) {

	const parser = new Parser(), buffer = linkedCollisionBuffer( format, { masks: [ 0, 0 ], timeProbe: true } );
	const data = format === 'pmd' ? parser.parsePmd( buffer, true ) : parser.parsePmx( buffer, true );
	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	const mesh = loader.meshBuilder.build( data, '' );
	assert.deepEqual( mesh.geometry.userData.MMD.rigidBodies.map( b => b.type ), [ 0, 1, 1 ] );
	assert.equal( mesh.geometry.userData.MMD.constraints.length, 1 );
	return mesh;

}
function near( actual: number[], expected: number[], tolerance = 5e-4 ) {

	assert.equal( actual.length, expected.length );
	for ( const [ i, value ] of actual.entries() ) assert.ok( Math.abs( value - expected[ i ] ) < tolerance, `${i}: ${value} != ${expected[ i ]}` );

}

for ( const format of [ 'pmd', 'pmx' ] as const ) for ( const path of [ 'standalone', 'shared', 'worker' ] ) for ( const override of [ undefined, 1 / 65 ] ) for ( const cap of [ undefined, 3 ] ) for ( const tape of tapes ) test( `native substeps ${format} ${path} step=${override ?? 'default'} cap=${cap ?? 'default'} ${tape.name}`, t => {

	const h = override ?? 1 / 60;
	// Parsed binary fixtures: moving kinematic anchor, constrained dynamic body,
	// and a separate unbound dynamic probe accelerating at 10 units/s² along Z.
	const helper = new MMDAnimationHelper( { sync: false } ); helper.sharedPhysics = path !== 'standalone';
	const reference = new MMDAnimationHelper( { sync: false } ); reference.sharedPhysics = helper.sharedPhysics;
	const worker = new ManualWorker(), count = path === 'standalone' ? 1 : 2;
	const meshes = Array.from( { length: count }, () => model( format ) );
	const refs = Array.from( { length: count }, () => model( format ) );
	const params = { unitStep: override, maxStepNum: cap, warmup: 0, animationWarmup: false, gravity: new Vector3( 0, 0, 10 ) };
	for ( let i = 0; i < count; i ++ ) {

		meshes[ i ].position.z = refs[ i ].position.z = i * 20;
		helper.add( meshes[ i ], { ...params, physicsMode: path === 'worker' ? 'worker' : 'sync', workerPhysics: worker.options() } );
		reference.add( refs[ i ], params );

	}
	if ( path === 'worker' ) worker.start();
	const physics = meshes.map( mesh => helper.objects.get( mesh )!.physics! );
	const native = refs.map( mesh => reference.objects.get( mesh )!.physics! );
	const step = t.mock.method( native[ 0 ].world!, 'stepSimulation' );
	let integrated = 0, elapsed = 0, zeroSteps = 0, dropped = 0;
	const initialZ = physics.map( p => p.bodyResults[ 2 ].position[ 2 ] );
	try {

		assert.ok( physics.every( p => p.maxStepNum === ( cap ?? 10 ) && p.unitStep === h ) );
		if ( path === 'shared' ) assert.equal( physics[ 0 ].world, physics[ 1 ].world );
		if ( path === 'worker' ) {

			assert.equal( physics[ 0 ].workerAdapter!.group, physics[ 1 ].workerAdapter!.group );
			assert.equal( physics[ 0 ].workerAdapter!.model.maxStepNum, cap ?? 10 );

		}
		for ( const [ frame, delta ] of tape.deltas.entries() ) {

			for ( const driver of [ helper, reference ] ) driver.onBeforePhysics = mesh => {

				mesh.skeleton.bones[ 0 ].position.y = ( frame + 1 ) / 650; mesh.updateMatrixWorld( true );

			};
			helper.update( delta ); reference.update( delta );
			if ( path === 'worker' ) worker.finish();
			const call = step.mock.calls.at( -1 )!;
			// Bullet returns the requested count BEFORE clamping. Native probe
			// displacement below independently verifies the actual integrated count.
			const completed = Math.min( call.result!, cap ?? 10 );
			integrated += completed; elapsed += delta; dropped += call.result! - completed;
			if ( completed === 0 ) zeroSteps ++;
			assert.ok( completed <= ( cap ?? 10 ) );
			// Ammo float rounding can retain nearly a full 1/60 step at the 100ms boundary.
			// Cumulative time and the native trajectory below still detect lost steps.
			if ( delta === 0.1 ) assert.ok( cap === 3 ? completed === 3 : completed >= ( override === undefined ? 5 : 6 ) && completed <= 7 );
			if ( delta === 0.25 ) assert.equal( completed, cap ?? 10 );
			assert.deepEqual( call.arguments, [ delta, Math.min( Math.floor( delta / h ) + 1, cap ?? 10 ), h ] );
			assert.ok( integrated * h <= elapsed + 2e-6, 'native simulation must not run ahead of elapsed time' );
			if ( cap === undefined && ! tape.long ) assert.ok( elapsed - integrated * h < h + 2e-6, 'no elapsed full steps discarded up to 100ms' );
			// Publication then zero-time projection is the supported completion
			// boundary. PMD can send a zero-time pose synchronization request.
			helper.update( 0 ); reference.update( 0 );
			if ( path === 'worker' ) worker.start();
			for ( const [ i, p ] of physics.entries() ) {

				const z = p.bodyResults[ 2 ].position[ 2 ];
				const expectedZ = initialZ[ i ] + 10 * h * h * integrated * ( integrated + 1 ) / 2;
				assert.ok( Math.abs( z - expectedZ ) < 5e-4, `native clock probe: ${z} != ${expectedZ}` );
				near( p.bodyResults.flatMap( r => [ ...r.position, ...r.quaternion ] ), native[ i ].bodyResults.flatMap( r => [ ...r.position, ...r.quaternion ] ) );
				for ( const [ j, bone ] of meshes[ i ].skeleton.bones.entries() ) {

					near( [ ...bone.position.toArray(), ...bone.quaternion.toArray() ], [ ...refs[ i ].skeleton.bones[ j ].position.toArray(), ...refs[ i ].skeleton.bones[ j ].quaternion.toArray() ] );

				}
				const transform = native[ i ].bodies[ 2 ].body.getCenterOfMassTransform();
				assert.ok( Math.abs( transform.getOrigin().z() - z ) < 5e-4, 'published output agrees with native transform' );

			}

		}
		if ( tape.name === '120 FPS' || tape.name === '144 FPS' ) assert.ok( zeroSteps > 0 );
		if ( tape.long || ( cap === 3 && ( tape.name === '10 FPS' || ( tape.name === '20 FPS' && override !== undefined ) || tape.name.includes( '100ms' ) ) ) ) assert.ok( dropped > 0, 'bounded cap still discards excessive time' );
		else assert.equal( dropped, 0 );
		if ( tape.long ) assert.ok( elapsed - integrated * h > 5 * h, 'discarded long-stall time is not recovered later' );

	} finally {

		step.mock.restore();
		for ( const mesh of meshes ) helper.remove( mesh );
		worker.start(); // Apply queued removals in the manual runtime before releasing fixtures.
		for ( const mesh of refs ) reference.remove( mesh );
		for ( const mesh of [ ...meshes, ...refs ] ) { mesh.geometry.dispose(); mesh.skeleton.dispose(); }

	}

} );

for ( const format of [ 'pmd', 'pmx' ] as const ) for ( const override of [ undefined, 1 / 65 ] ) for ( const cap of [ undefined, 3 ] ) for ( const batch of [ 0.1, 0.25 ] ) test( `native Worker batching ${format} step=${override ?? 'default'} cap=${cap ?? 'default'} batch=${batch}`, t => {

	const h = override ?? 1 / 60;
	const worlds: AmmoWorld[] = [];
	t.mock.method( host.Ammo, 'btDiscreteDynamicsWorld', class extends host.Ammo.btDiscreteDynamicsWorld {

		constructor( ...args: ConstructorParameters<AmmoAPI['btDiscreteDynamicsWorld']> ) { super( ...args ); worlds.push( this ); }

	} );
	const worker = new ManualWorker(), helper = new MMDAnimationHelper( { sync: false } ); helper.sharedPhysics = true;
	const meshes = [ model( format ), model( format ) ]; meshes[ 1 ].position.z = 20;
	for ( const mesh of meshes ) helper.add( mesh, { physicsMode: 'worker', workerPhysics: worker.options(), unitStep: override, maxStepNum: cap, warmup: 0, animationWarmup: false, gravity: new Vector3( 0, 0, 10 ) } );
	worker.start(); assert.equal( worlds.length, 1 );
	const physics = meshes.map( m => helper.objects.get( m )!.physics! );
	const initialZ = physics.map( p => p.bodyResults[ 2 ].position[ 2 ] );
	const step = t.mock.method( worlds[ 0 ], 'stepSimulation' );
	try {

		helper.update( h ); // Keep one real native simulation in flight.
		const before = structuredClone( physics.map( p => p.bodyResults ) );
		if ( batch === 0.1 ) for ( let i = 0; i < 3; i ++ ) helper.update( 0.03 );
		else for ( let i = 0; i < 20; i ++ ) helper.update( 1 / 60 );
		for ( const delta of [ 0, -1, NaN, Infinity, -Infinity ] ) helper.update( delta );
		assert.equal( worker.requests.length, 1, 'one request in flight, pending updates are accumulated' );
		worker.process();
		assert.deepEqual( physics.map( p => p.bodyResults ), before, 'native results remain hidden until publication' );
		worker.deliver();
		helper.update( batch === 0.1 ? 0.01 : 1 / 60 );
		const frame = worker.requests[ 0 ]; assert.equal( frame.type, 'frame' );
		if ( frame.type !== 'frame' ) throw new Error( 'expected batched frame' );
		assert.ok( Math.abs( frame.delta - batch ) < 1e-12, 'existing 250ms coalescing cap' );
		worker.finish();
		assert.equal( step.mock.callCount(), 2 );
		const calls = step.mock.calls;
		const completed = calls.map( c => Math.min( c.result!, cap ?? 10 ) );
		assert.equal( completed[ 0 ], 1 );
		if ( batch === 0.1 && cap === undefined ) assert.ok( completed[ 1 ] === 6 || completed[ 1 ] === 7 );
		else assert.equal( completed[ 1 ], cap ?? 10 );
		const n = completed.reduce( ( sum, steps ) => sum + steps, 0 );
		for ( const [ i, p ] of physics.entries() ) {

			assert.ok( Math.abs( p.bodyResults[ 2 ].position[ 2 ] - initialZ[ i ] - 10 * h * h * n * ( n + 1 ) / 2 ) < 5e-4 );
			assert.equal( p.workerStatus!.completedSequence, physics[ 0 ].workerStatus!.completedSequence );

		}
		assert.ok( n * h <= h + batch + 2e-6 );

	} finally {

		step.mock.restore();
		for ( const mesh of meshes ) helper.remove( mesh );
		worker.start();
		for ( const mesh of meshes ) { mesh.geometry.dispose(); mesh.skeleton.dispose(); }

	}

} );
