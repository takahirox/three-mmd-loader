import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test, before } from 'node:test';
import { Parser } from 'mmd-parser';
import { Texture, Vector3 } from 'three';
import { MMDAnimationHelper } from '../src/animation/MMDAnimationHelper.js';
import { MMDPhysics } from '../src/animation/MMDPhysics.js';
import { MMDLoader } from '../src/loaders/MMDLoader.js';
import type { AmmoAPI } from '@takahirox/three-mmd';
import { PhysicsWorkerRuntime } from '../src/animation/PhysicsWorkerRuntime.js';
import { inputLength, outputLength, selectPhysicsTransport } from '../src/animation/PhysicsWorkerProtocol.js';
import type { PhysicsRequest, PhysicsResponse } from '../src/animation/PhysicsWorkerProtocol.js';
import { WorkerPhysicsAdapter, WorkerPhysicsWorld } from '../src/animation/WorkerPhysicsAdapter.js';
import { physicsLayersPmxBuffer, pmdBuffer } from './fixtures.ts';

const host = globalThis as typeof globalThis & { Ammo: AmmoAPI };
before( async () => { host.Ammo = await ( createRequire( import.meta.url )( 'ammojs-typed' ) as () => Promise<AmmoAPI> )(); } );
function mesh( format: 'pmx' | 'pmd' = 'pmx', postIK = false ) {

	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	const parser = new Parser();
	const data = format === 'pmx' ? parser.parsePmx( physicsLayersPmxBuffer(), true ) : parser.parsePmd( pmdBuffer(), true );
	const bone = data.bones[ 9 ]; if ( ! postIK && bone && 'ik' in bone ) delete bone.ik;
	return loader.meshBuilder.build( data, '' );

}
function near( actual: ArrayLike<number>, expected: ArrayLike<number>, tolerance = 1e-4 ) {

	assert.equal( actual.length, expected.length );
	Array.from( actual ).forEach( ( v, i ) => assert.ok( Math.abs( v - expected[ i ] ) < tolerance, `${i}: ${v} != ${expected[ i ]}` ) );

}
// Real shared simulation, deterministic scheduler, and actual structured-clone
// transfers. Tests decide exactly when requests/results become visible.
class ManualWorker {
	onmessage: Worker['onmessage'] = null;
	onerror: Worker['onerror'] = null;
	onmessageerror: Worker['onmessageerror'] = null;
	requests: PhysicsRequest[] = [];
	responses: PhysicsResponse[] = [];
	terminated = false;
	frames = 0;
	private runtime = new PhysicsWorkerRuntime( ( response, transfer = [] ) => {

		this.responses.push( structuredClone( response, { transfer } ) );

	} );
	postMessage( message: PhysicsRequest, transfer: Transferable[] = [] ) { this.requests.push( structuredClone( message, { transfer } ) ); }
	terminate() { this.terminated = true; }
	process() {

		const message = this.requests.shift(); assert.ok( message );
		if ( message.type !== 'init' ) { if ( message.type === 'frame' ) this.frames ++; this.runtime.handle( message ); }

	}
	deliver( response = this.responses.shift() ) {

		assert.ok( response ); this.onmessage?.call( this as unknown as Worker, { data: response } as MessageEvent );

	}
	start() { while ( this.requests.length ) this.process(); while ( this.responses.length ) this.deliver(); }
	finish() { this.process(); this.deliver(); }
	options() { return { ammoURL: 'https://example.test/ammo.js', createWorker: () => this as unknown as Worker }; }
}
function add( worker: ManualWorker, shared = false ) {

	const helper = new MMDAnimationHelper( { sync: false } ); helper.sharedPhysics = shared;
	const model = mesh(); helper.add( model, { physicsMode: 'worker', workerPhysics: worker.options(), warmup: 0, animationWarmup: false, gravity: new Vector3() } );
	return { helper, model, physics: helper.objects.get( model )!.physics! };

}

test( 'default/explicit sync retain standalone behavior, worker uses no main-thread Ammo', async () => {

	const model = mesh(), meta = model.geometry.userData.MMD;
	for ( const physicsMode of [ undefined, 'sync' ] as const ) {

		const physics = new MMDPhysics( model, meta.rigidBodies, meta.constraints, { physicsMode } );
		assert.equal( physics.physicsMode, 'sync' ); assert.ok( physics.world ); physics.update( 1 / 60 ); physics.dispose();

	}
	const saved = host.Ammo; delete ( host as Partial<typeof host> ).Ammo;
	try {

		const worker = new ManualWorker(), { physics, helper, model: asyncModel } = add( worker );
		assert.equal( physics.physicsMode, 'worker' ); assert.equal( physics.world, null ); assert.equal( physics.bodies.length, 0 );
		helper.update( 1 / 60 ); assert.equal( worker.requests.filter( r => r.type === 'frame' ).length, 0 );
		helper.remove( asyncModel ); assert.ok( worker.terminated ); await physics.ready;

	} finally { host.Ammo = saved; }

} );

test( 'one in-flight frame, ownership transfer, stale/out-of-order results and slow-worker coalescing', async () => {

	const worker = new ManualWorker(), { helper, model, physics } = add( worker ); worker.start(); await physics.ready;
	helper.update( 1 / 60 );
	const frame = worker.requests[ 0 ]; assert.equal( frame.type, 'frame' );
	if ( frame.type !== 'frame' ) return;
	assert.ok( frame.buffer instanceof ArrayBuffer );
	const byteLength = frame.buffer.byteLength;
	const before = structuredClone( physics.bodyResults );
	for ( let i = 0; i < 20; i ++ ) helper.update( 1 / 60 );
	assert.equal( worker.requests.length, 1 ); assert.deepEqual( physics.bodyResults, before );
	worker.process();
	const result = worker.responses[ 0 ]; assert.equal( result.type, 'result' );
	if ( result.type !== 'result' ) return;
	worker.deliver( { ...result, sequence: result.sequence + 1 } );
	helper.update( 1 / 60 ); assert.equal( worker.requests.length, 0 ); assert.deepEqual( physics.bodyResults, before );
	worker.deliver(); helper.update( 0 );
	assert.equal( worker.requests.length, 0, 'zero delta cannot flush elapsed-time backlog into a PMX step' );
	helper.update( 1 / 60 );
	const next = worker.requests[ 0 ]; assert.equal( next.type, 'frame' );
	if ( next.type === 'frame' ) { assert.equal( next.delta, 0.25 ); assert.equal( next.buffer.byteLength, byteLength ); }
	worker.deliver( result ); // duplicate old result cannot release current ownership
	helper.update( 1 / 60 ); assert.equal( worker.requests.length, 1 );
	helper.remove( model );

} );

test( 'reset snapshot precedes next input, invalidates pending generation; disable/remove/dispose races', () => {

	const worker = new ManualWorker(), { helper, model, physics } = add( worker ); worker.start();
	helper.update( 1 / 60 ); worker.process();
	physics.reset(); const reset = structuredClone( physics.bodyResults );
	worker.deliver(); assert.deepEqual( physics.bodyResults, reset );
	helper.update( 1 / 60 );
	const frame = worker.requests[ 0 ]; assert.equal( frame.type, 'frame' );
	if ( frame.type === 'frame' ) { assert.equal( frame.models[ 0 ].reset, true ); assert.ok( frame.models[ 0 ].resetPose ); }
	worker.process(); helper.enable( 'physics', false ); worker.deliver(); assert.deepEqual( physics.bodyResults, reset );
	helper.update( 1 / 60 ); assert.equal( worker.requests.length, 0 );
	helper.enable( 'physics', true ).update( 1 / 60 ); worker.process();
	helper.remove( model ); worker.deliver(); assert.equal( physics.bodyResults.length, 0 ); assert.ok( worker.terminated );
	physics.dispose(); physics.update( 1 / 60 ); physics.reset(); physics.setGravity( new Vector3() );

} );

test( 'shared models have one worker/step and coherent outputs; removal keeps surviving model active', () => {

	const worker = new ManualWorker(), { helper, model, physics } = add( worker, true );
	const second = mesh(); second.position.z = 20;
	helper.add( second, { physicsMode: 'worker', workerPhysics: { ammoURL: 'unused', createWorker: () => { throw new Error( 'must reuse worker' ); } }, warmup: 0, animationWarmup: false } );
	const other = helper.objects.get( second )!.physics!; assert.equal( physics.workerAdapter!.group, other.workerAdapter!.group );
	worker.start(); helper.update( 1 / 60 ); assert.equal( worker.requests.length, 1 );
	const frame = worker.requests[ 0 ]; assert.equal( frame.type, 'frame' ); if ( frame.type === 'frame' ) assert.equal( frame.models.length, 2 );
	worker.finish(); assert.equal( worker.frames, 1 );
	assert.equal( physics.bodyResultPhase, 'step' ); assert.equal( other.bodyResultPhase, 'step' );
	helper.update( 0 ); assert.equal( worker.requests.length, 0 );
	helper.remove( model ); assert.equal( worker.terminated, false ); worker.process();
	helper.update( 1 / 60 ); worker.finish(); assert.equal( worker.frames, 2 );
	helper.remove( second ); assert.ok( worker.terminated );

} );

test( 'gravity and warmup run on the worker, warmup schedules one step per completion', async () => {

	const worker = new ManualWorker(), { helper, model, physics } = add( worker );
	physics.warmup( 3 ); worker.start();
	// start processes setup, delivering added schedules exactly one warmup.
	assert.equal( worker.requests.length, 1 );
	for ( let i = 0; i < 3; i ++ ) {

		const request = worker.requests[ 0 ]; assert.equal( request.type, 'frame' );
		if ( request.type === 'frame' ) assert.equal( request.delta, 1 / 60 );
		for ( let frame = 0; frame < 10; frame ++ ) helper.update( 1 / 60 );
		worker.finish();

	}
	assert.equal( worker.frames, 3 ); assert.equal( worker.requests.length, 0 );
	physics.setGravity( new Vector3( 0, -10, 0 ) ); assert.equal( worker.requests[ 0 ].type, 'gravity' ); worker.process();
	helper.update( 0 ); assert.equal( worker.requests.length, 0 );
	physics.reset(); helper.update( 0 ); worker.finish();
	assert.equal( physics.bodyResultPhase, 'reset' );
	near( physics.bodyResults[ 1 ].position, [ 2, 0, 0 ] );
	helper.update( 0 ); assert.equal( worker.requests.length, 0 );
	helper.remove( model );

} );

test( 'startup, runtime, message-decode and watchdog failures rebuild synchronous shared worlds', async () => {

	for ( const failure of [ 'startup', 'runtime', 'decode', 'watchdog' ] ) {

		const worker = new ManualWorker(), helper = new MMDAnimationHelper(); helper.sharedPhysics = true;
		const first = mesh(), second = mesh(), reasons: string[] = [];
		const options = { ...worker.options(), timeout: 10, onFallback: ( reason: string ) => reasons.push( reason ), ...( failure === 'startup' ? { createWorker: () => { throw new Error( 'unsupported' ); } } : {} ) };
		helper.add( first, { physicsMode: 'worker', workerPhysics: options, warmup: 0 } );
		helper.add( second, { physicsMode: 'worker', workerPhysics: options, warmup: 0 } );
		if ( failure === 'runtime' ) worker.deliver( { type: 'error', reason: 'simulation failed' } );
		if ( failure === 'decode' ) worker.onmessageerror?.call( worker as unknown as Worker, {} as MessageEvent );
		if ( failure === 'watchdog' ) await new Promise( resolve => setTimeout( resolve, 25 ) );
		const p = helper.objects.get( first )!.physics!, q = helper.objects.get( second )!.physics!;
		assert.equal( p.physicsMode, 'sync' ); assert.equal( q.physicsMode, 'sync' ); assert.equal( p.world, q.world );
		assert.equal( reasons.length, 1 ); await p.ready; await q.ready;
		helper.update( 1 / 60 ); helper.remove( first ); helper.update( 1 / 60 ); helper.remove( second );

	}

} );

for ( const isolated of [ false, true ] ) test( `transport selection and atomic publication isolated=${isolated}`, () => {

	const original = Object.getOwnPropertyDescriptor( globalThis, 'crossOriginIsolated' );
	Object.defineProperty( globalThis, 'crossOriginIsolated', { configurable: true, value: isolated } );
	try {

		assert.equal( selectPhysicsTransport(), isolated ? 'shared' : 'transferable' );
		const worker = new ManualWorker(), { helper, model, physics } = add( worker ); worker.start();
		helper.update( 1 / 60 ); const frame = worker.requests[ 0 ]; assert.equal( frame.type, 'frame' );
		if ( frame.type === 'frame' ) {

			assert.equal( frame.buffer instanceof SharedArrayBuffer, isolated );
			worker.process();
			if ( frame.control ) { const control = new Int32Array( frame.control ); assert.equal( Atomics.load( control, 0 ), 1 ); assert.equal( Atomics.load( control, 2 ), frame.sequence ); }
			worker.deliver(); assert.equal( physics.bodyResultPhase, 'step' );
			// Completed buffer can now be reused, but zero delta sends no PMX step.
			helper.update( 0 ); assert.equal( worker.requests.length, 0 );

		}
		helper.remove( model );

	} finally { if ( original ) Object.defineProperty( globalThis, 'crossOriginIsolated', original ); else Reflect.deleteProperty( globalThis, 'crossOriginIsolated' ); }

} );

for ( const postIK of [ false, true ] ) test( `real Ammo worker core matches sync for identical sequenced PMX inputs, postIK=${postIK}`, () => {

	const model = mesh( 'pmx', postIK ), helper = new MMDAnimationHelper( { sync: false } );
	helper.add( model, { warmup: 0, animationWarmup: false, gravity: new Vector3(), unitStep: 1 / 60 } );
	model.morphTargetInfluences![ 1 ] = 0.5;
	model.skeleton.bones[ 6 ].position.x = 0.2; model.skeleton.bones[ 6 ].quaternion.set( 0, 0, Math.sin( 0.2 ), Math.cos( 0.2 ) );
	const physics = helper.objects.get( model )!.physics!;
	// The tape is captured at the actual pre-physics boundary. Replaying it
	// exercises the same world, constraints, modes and preceding post inputs.
	const dummy = new ManualWorker();
	const adapter = new WorkerPhysicsAdapter( physics, new WorkerPhysicsWorld( dummy.options() ), model.geometry.userData.MMD.rigidBodies, model.geometry.userData.MMD.constraints );
	const results: PhysicsResponse[] = [];
	const runtime = new PhysicsWorkerRuntime( result => results.push( result ) );
	runtime.handle( { type: 'add', model: { ...adapter.model, id: 1 } } ); results.length = 0;
	for ( let sequence = 1; sequence <= 60; sequence ++ ) {

		const data = new Float64Array( inputLength( adapter.model ) + outputLength( adapter.model ) );
		model.skeleton.bones[ 6 ].position.x = 0.2 + Math.sin( sequence / 9 ) * 0.1;
		const angle = 0.4 + Math.sin( sequence / 7 ) * 0.1;
		model.skeleton.bones[ 6 ].quaternion.set( 0, 0, Math.sin( angle / 2 ), Math.cos( angle / 2 ) );
		helper.onBeforePhysics = () => adapter.capture( data, 0 );
		helper.update( 1 / 60 );
		runtime.handle( { type: 'frame', generation: 0, sequence, delta: 1 / 60, models: [ { id: 1, reset: sequence === 1, resetPose: adapter.resetSnapshot, staged: true } ], buffer: data.buffer } );
		const expected = physics.bodyResults.flatMap( r => [ ...r.position, ...r.quaternion ] );
		near( data.subarray( inputLength( adapter.model ) ), expected, 5e-4 );
		adapter.deferAfterPhysics();

	}
	runtime.handle( { type: 'remove', id: 1 } ); helper.remove( model );

} );

for ( const postIK of [ false, true ] ) test( `delayed PMX output projects at post layer boundary, zero-time is stable, postIK=${postIK}`, () => {

	const syncModel = mesh( 'pmx', postIK ), workerModel = mesh( 'pmx', postIK );
	const sync = new MMDAnimationHelper(), async = new MMDAnimationHelper(), worker = new ManualWorker();
	const params = { warmup: 0, animationWarmup: false, gravity: new Vector3(), unitStep: 1 / 60 };
	sync.add( syncModel, params ); async.add( workerModel, { ...params, physicsMode: 'worker', workerPhysics: worker.options() } );
	for ( const m of [ syncModel, workerModel ] ) { m.morphTargetInfluences![ 1 ] = 0.5; m.skeleton.bones[ 6 ].position.x = 0.2; m.skeleton.bones[ 6 ].quaternion.set( 0, 0, Math.sin( 0.2 ), Math.cos( 0.2 ) ); }
	worker.start();
	// Delayed display deliberately stages the preceding displayed post pose.
	// For this isolated dynamic probe, that only changes the constrained pair;
	// raw dynamic authority and post IK/grants must still project identically.
	for ( let i = 0; i < 15; i ++ ) {

		sync.update( 1 / 60 ); async.update( 1 / 60 ); worker.finish(); async.update( 0 );
		near( workerModel.skeleton.bones[ 1 ].position.toArray(), syncModel.skeleton.bones[ 1 ].position.toArray() );
		near( workerModel.skeleton.bones[ 1 ].quaternion.toArray(), syncModel.skeleton.bones[ 1 ].quaternion.toArray() );
		const final = async.objects.get( workerModel )!.poseLayers!.final.slice();
		for ( let zero = 0; zero < 4; zero ++ ) { async.update( 0 ); near( async.objects.get( workerModel )!.poseLayers!.final, final ); }

	}
	sync.remove( syncModel ); async.remove( workerModel );

} );

test( 'PMD standalone sync/worker use identical sequenced inputs, including zero delta', () => {

	const a = mesh( 'pmd' ), b = mesh( 'pmd' ), worker = new ManualWorker();
	const meta = a.geometry.userData.MMD;
	const sync = new MMDPhysics( a, meta.rigidBodies, meta.constraints, { gravity: new Vector3(), unitStep: 1 / 60 } );
	const async = new MMDPhysics( b, meta.rigidBodies, meta.constraints, { gravity: new Vector3(), unitStep: 1 / 60, physicsMode: 'worker', workerPhysics: worker.options() } );
	worker.start();
	for ( const delta of [ 1 / 60, 0, 1 / 120, 1 / 60, 0 ] ) {

		sync.update( delta ); async.update( delta ); worker.finish(); async.workerAdapter!.project();
		near( b.skeleton.bones[ 0 ].position.toArray(), a.skeleton.bones[ 0 ].position.toArray() );
		near( b.skeleton.bones[ 0 ].quaternion.toArray(), a.skeleton.bones[ 0 ].quaternion.toArray() );

	}
	sync.dispose(); async.dispose();

} );

test( 'mixed shared setup fails before registration and unavailable main Ammo reports a settled error', async () => {

	const worker = new ManualWorker(), { helper, model } = add( worker, true );
	assert.throws( () => helper.add( mesh(), { physicsMode: 'sync', warmup: 0 } ), /same physicsMode/ );
	assert.equal( helper.meshes.length, 1 ); helper.remove( model );
	const sync = new MMDAnimationHelper(); sync.sharedPhysics = true; const a = mesh(); sync.add( a, { warmup: 0 } );
	assert.throws( () => sync.add( mesh(), { physicsMode: 'worker', workerPhysics: worker.options() } ), /same physicsMode/ ); sync.remove( a );
	const saved = host.Ammo; delete ( host as Partial<typeof host> ).Ammo;
	try {

		const fallback = new MMDAnimationHelper(); fallback.sharedPhysics = true; const b = mesh();
		fallback.add( b, { physicsMode: 'worker', warmup: 0 } );
		const physics = fallback.objects.get( b )!.physics!; await physics.ready;
		assert.match( physics.initializationError!.message, /initialized Ammo/ ); fallback.update( 1 / 60 ); fallback.remove( b );

	} finally { host.Ammo = saved; }

} );

test( 'missing SAB and unusable SAB construction select transfers even on an isolated host', () => {

	const isolation = Object.getOwnPropertyDescriptor( globalThis, 'crossOriginIsolated' );
	const sab = Object.getOwnPropertyDescriptor( globalThis, 'SharedArrayBuffer' )!;
	Object.defineProperty( globalThis, 'crossOriginIsolated', { configurable: true, value: true } );
	try {

		Object.defineProperty( globalThis, 'SharedArrayBuffer', { configurable: true, value: undefined } ); assert.equal( selectPhysicsTransport(), 'transferable' );
		Object.defineProperty( globalThis, 'SharedArrayBuffer', { configurable: true, value: class { constructor() { throw new Error( 'unsupported' ); } } } ); assert.equal( selectPhysicsTransport(), 'transferable' );

	} finally {

		Object.defineProperty( globalThis, 'SharedArrayBuffer', sab );
		if ( isolation ) Object.defineProperty( globalThis, 'crossOriginIsolated', isolation ); else Reflect.deleteProperty( globalThis, 'crossOriginIsolated' );

	}

} );


test( 'a matching message with incomplete SAB publication never applies partial data', () => {

	const original = Object.getOwnPropertyDescriptor( globalThis, 'crossOriginIsolated' );
	Object.defineProperty( globalThis, 'crossOriginIsolated', { configurable: true, value: true } );
	try {

		const worker = new ManualWorker(), { helper, model, physics } = add( worker ); worker.start(); helper.update( 1 / 60 );
		const frame = worker.requests[ 0 ]; assert.equal( frame.type, 'frame' );
		if ( frame.type === 'frame' ) {

			assert.ok( frame.control );
			// Worker has not executed or published this buffer. A notification by
			// itself must never authorize reading mutable output bytes.
			worker.deliver( { type: 'result', generation: frame.generation, sequence: frame.sequence } );
			assert.equal( physics.physicsMode, 'sync' ); assert.ok( worker.terminated );

		}
		helper.remove( model );

	} finally { if ( original ) Object.defineProperty( globalThis, 'crossOriginIsolated', original ); else Reflect.deleteProperty( globalThis, 'crossOriginIsolated' ); }

} );

test( 'interacting shared models match a single synchronous Bullet world over sequenced frames', () => {

	const worker = new ManualWorker(), async = new MMDAnimationHelper(), sync = new MMDAnimationHelper();
	async.sharedPhysics = sync.sharedPhysics = true;
	const asynchronous = [ mesh(), mesh() ], synchronous = [ mesh(), mesh() ];
	// Overlapping models exercise cross-model contacts, not independent worlds.
	for ( const [ i, model ] of asynchronous.entries() ) {

		model.position.z = i * 0.2;
		async.add( model, { physicsMode: 'worker', workerPhysics: worker.options(), warmup: 0, animationWarmup: false, gravity: new Vector3(), unitStep: 1 / 60 } );
		synchronous[ i ].position.z = i * 0.2;
		sync.add( synchronous[ i ], { warmup: 0, animationWarmup: false, gravity: new Vector3(), unitStep: 1 / 60 } );

	}
	worker.start();
	for ( let frame = 0; frame < 30; frame ++ ) {

		sync.update( 1 / 60 ); async.update( 1 / 60 ); worker.finish(); async.update( 0 );
		for ( let i = 0; i < 2; i ++ ) {

			const a = async.objects.get( asynchronous[ i ] )!.physics!, b = sync.objects.get( synchronous[ i ] )!.physics!;
			near( a.bodyResults.flatMap( body => [ ...body.position, ...body.quaternion ] ), b.bodyResults.flatMap( body => [ ...body.position, ...body.quaternion ] ), 5e-4 );

		}

	}
	assert.equal( worker.frames, 30 );
	for ( const model of asynchronous ) async.remove( model );
	for ( const model of synchronous ) sync.remove( model );

} );
