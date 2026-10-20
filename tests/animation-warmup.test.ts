import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Parser } from 'mmd-parser';
import { AnimationClip, NumberKeyframeTrack, Quaternion, QuaternionKeyframeTrack, Texture, Vector3, VectorKeyframeTrack } from 'three';
import { MMDAnimationHelper } from '../src/animation/MMDAnimationHelper.js';
import { MMDLoader } from '../src/loaders/MMDLoader.js';
import type { AmmoAPI, AmmoWorld } from '../src/ammo.js';
import type { MMDMesh } from '../src/types.js';
import { initializeAmmo } from './ammo-runtime.ts';
import { linkedCollisionBuffer, physicsLayersPmxBuffer } from './fixtures.ts';
import { ManualWorker } from './manual-physics-worker.ts';

const host = globalThis as typeof globalThis & { Ammo: AmmoAPI };
before( async () => { host.Ammo = await initializeAmmo<AmmoAPI>(); } );
const rotation = new Quaternion().setFromAxisAngle( new Vector3( 0, 0, 1 ), 1.2 );
function near( a: ArrayLike<number>, b: ArrayLike<number>, epsilon = 2e-5 ) {

	assert.equal( a.length, b.length );
	Array.from( a ).forEach( ( v, i ) => assert.ok( Number.isFinite( v ) && Math.abs( v - b[ i ] ) < epsilon, `${i}: ${v} != ${b[ i ]}` ) );

}
function fixture( format: 'pmd' | 'pmx' ) {

	const parser = new Parser(), loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	const data = format === 'pmd' ? parser.parsePmd( linkedCollisionBuffer( 'pmd', { masks: [ 0, 0 ] } ), true ) : parser.parsePmx( physicsLayersPmxBuffer(), true );
	const mesh = loader.meshBuilder.build( data, '' );
	const bones = mesh.skeleton.bones, animated = format === 'pmd' ? 0 : 6;
	const base = bones[ animated ].position.toArray(), target = [ base[ 0 ] + 3, base[ 1 ] + 0.6, base[ 2 ] - 0.9 ];
	const tracks = [
		new VectorKeyframeTrack( `.bones[${bones[ animated ].name}].position`, [ 0, 2 ], [ ...target, ...target.map( v => v + 0.5 ) ] ),
		// Opposite quaternion sign must still take the short arc.
		new QuaternionKeyframeTrack( `.bones[${bones[ animated ].name}].quaternion`, [ 0, 2 ], [ ...rotation.toArray().map( v => -v ), ...rotation.toArray().map( v => -v ) ] )
	];
	const clip = new AnimationClip( 'distant initial pose', 2, format === 'pmx' ? [ ...tracks, new NumberKeyframeTrack( '.morphTargetInfluences[1]', [ 0, 2 ], [ 0.8, 0.8 ] ) ] : tracks );
	return { mesh, clip, base, target, animated };

}
const pose = ( mesh: MMDMesh ) => mesh.skeleton.bones.flatMap( b => [ ...b.position.toArray(), ...b.quaternion.toArray() ] );
function finish( worker: ManualWorker ) {

	let guard = 0;
	while ( worker.requests.length || worker.responses.length ) {

		assert.ok( guard ++ < 1000 );
		if ( worker.requests.length ) worker.process();
		if ( worker.responses.length ) worker.deliver();

	}

}

for ( const format of [ 'pmd', 'pmx' ] as const ) for ( const shared of [ false, true ] ) for ( const mode of [ 'sync', 'worker' ] as const ) for ( const cycles of [ 0, 1, 7, 30, 60 ] ) test( `fixed-time authored ramp ${format} shared=${shared} ${mode} cycles=${cycles}`, async t => {

	const worlds: AmmoWorld[] = [];
	t.mock.method( host.Ammo, 'btDiscreteDynamicsWorld', class extends host.Ammo.btDiscreteDynamicsWorld {

		constructor( ...args: ConstructorParameters<AmmoAPI['btDiscreteDynamicsWorld']> ) { super( ...args ); worlds.push( this ); }

	} );
	const nativeSteps: number[][] = [];
	const original = host.Ammo.btDiscreteDynamicsWorld.prototype.stepSimulation;
	t.mock.method( host.Ammo.btDiscreteDynamicsWorld.prototype, 'stepSimulation', function ( this: AmmoWorld, ...args: Parameters<AmmoWorld['stepSimulation']> ) {

		nativeSteps.push( args ); return original.apply( this, args );

	} );
	const { mesh, clip, base, target, animated } = fixture( format ), helper = new MMDAnimationHelper( { sync: false } ); helper.sharedPhysics = shared;
	const worker = new ManualWorker();
	const observations: { weight: number; time: number; raw: number[]; morph: number; morphed?: number[] }[] = [];
	helper.onBeforePhysics = model => {

		if ( model !== mesh ) return;
		const state = helper.objects.get( mesh )!;
		observations.push( { weight: state.initialPose?.weight ?? 1, time: state.mixer!.time,
			raw: Array.from( state.poseLayers?.authored.slice( animated * 7, animated * 7 + 7 ) ?? [ ...mesh.skeleton.bones[ animated ].position.toArray(), ...mesh.skeleton.bones[ animated ].quaternion.toArray() ] ),
			morph: mesh.morphTargetInfluences?.[ 1 ] ?? 0, morphed: state.poseLayers ? Array.from( state.poseLayers.morphed ) : undefined } );

	};
	try {

		helper.add( mesh, { animation: clip, ...( cycles === 60 ? {} : { warmup: cycles } ), physicsMode: mode, workerPhysics: worker.options(), gravity: new Vector3() } );
		const state = helper.objects.get( mesh )!, p = state.physics!;
		if ( mode === 'worker' ) {

			// Readiness can lag arbitrarily; render calls must not advance time or
			// consume a ramp stage before the worker accepts a model.
			if ( cycles ) for ( let i = 0; i < 12; i ++ ) helper.update( 1 / 120 );
			finish( worker );

		}
		assert.equal( worlds.length, 1 ); assert.equal( nativeSteps.length, cycles );
		assert.deepEqual( nativeSteps, Array.from( { length: cycles }, () => [ 1 / 60, 2, 1 / 60 ] ) );
		assert.equal( observations.length, cycles );
		for ( const [ i, o ] of observations.entries() ) {

			const weight = Math.min( ( i + 1 ) / Math.min( 30, cycles ), 1 );
			assert.equal( o.weight, weight ); assert.equal( o.time, 0 );
			near( o.raw.slice( 0, 3 ), base.map( ( v, j ) => v + ( target[ j ] - v ) * weight ) );
			const expected = new Quaternion().slerp( rotation, weight );
			assert.ok( Math.abs( expected.dot( new Quaternion().fromArray( o.raw, 3 ) ) ) > 1 - 1e-6 );
			if ( format === 'pmx' ) {

				near( [ o.morph ], [ 0.8 * weight ] );
				const element = mesh.geometry.userData.MMD.boneMorphs![ 0 ].elements[ 0 ];
				const b = mesh.geometry.userData.MMD.bones[ element.index ];
				near( o.morphed!.slice( element.index * 7, element.index * 7 + 3 ), b.pos.map( ( v, j ) => v + element.position[ j ] * o.morph ) );

			}

		}
		assert.equal( state.mixer!.time, 0 ); assert.equal( state.mixer!._actions[ 0 ].time, 0 );
		assert.equal( state.initialPose, undefined ); assert.ok( pose( mesh ).every( Number.isFinite ) );
		const authored = state.poseLayers?.authored ?? state.backupBones!;
		near( authored.slice( animated * 7, animated * 7 + 3 ), target );
		if ( format === 'pmx' ) near( [ mesh.morphTargetInfluences![ 1 ] ], [ 0.8 ] );
		const settled = pose( mesh );
		if ( format === 'pmx' ) { helper.update( 0 ); near( pose( mesh ), settled, 1e-4 ); }
		observations.length = 0;
		// Later explicit warmup and zero-time frames cannot restart the ramp.
		p.warmup( 2 ); if ( mode === 'worker' ) { await Promise.resolve(); finish( worker ); }
		assert.deepEqual( observations.map( o => o.weight ), [ 1, 1 ] );
		helper.update( 1 / 60 ); if ( mode === 'worker' ) finish( worker );
		near( [ state.mixer!.time ], [ 1 / 60 ] ); assert.ok( pose( mesh ).every( Number.isFinite ) );
		// Stopping restores original bindings, never an intermediate blended pose.
		state.mixer!.stopAllAction();
		near( mesh.skeleton.bones[ animated ].position.toArray(), base );

	} finally { helper.remove( mesh ); }

} );

for ( const mode of [ 'sync', 'worker' ] as const ) test( `adding a shared participant preserves the running authored state and clock ${mode}`, () => {

	const helper = new MMDAnimationHelper( { sync: false } ); helper.sharedPhysics = true;
	const worker = new ManualWorker(), first = fixture( 'pmx' ), second = fixture( 'pmx' ); second.mesh.position.z = 20;
	const params = { warmup: 7, physicsMode: mode, workerPhysics: worker.options(), gravity: new Vector3() };
	helper.add( first.mesh, { ...params, animation: first.clip } ); if ( mode === 'worker' ) finish( worker );
	helper.update( 0.4 ); if ( mode === 'worker' ) finish( worker ); helper.update( 0 );
	const state = helper.objects.get( first.mesh )!, authored = state.poseLayers!.authored.slice(), time = state.mixer!.time;
	let resets = 0; const reset = state.physics!.reset.bind( state.physics ); state.physics!.reset = () => { resets ++; return reset(); };
	helper.add( second.mesh, { ...params, animation: second.clip } ); if ( mode === 'worker' ) finish( worker );
	near( state.poseLayers!.authored, authored ); assert.equal( state.mixer!.time, time ); assert.equal( resets, 0 );
	assert.equal( state.initialPose, undefined );
	helper.remove( first.mesh ); helper.remove( second.mesh );

} );

for ( const shared of [ false, true ] ) test( `queued/re-entrant warmup and in-flight fallback preserve ramp progress shared=${shared}`, () => {

	const helper = new MMDAnimationHelper( { sync: false } ); helper.sharedPhysics = shared;
	const worker = new ManualWorker(), { mesh, clip } = fixture( 'pmx' );
	const weights: number[] = [];
	helper.onBeforePhysics = () => weights.push( helper.objects.get( mesh )!.initialPose?.weight ?? 1 );
	helper.add( mesh, { animation: clip, warmup: 7, physicsMode: 'worker', workerPhysics: worker.options(), gravity: new Vector3() } );
	worker.start(); worker.finish(); // accept stage 1 and queue stage 2
	const p = helper.objects.get( mesh )!.physics!;
	p.warmup( 2 ); // append settling, without restarting stage 1
	worker.deliver( { type: 'error', reason: 'warmup fixture failure' } );
	assert.equal( p.physicsMode, 'sync' ); assert.equal( helper.objects.get( mesh )!.initialPose, undefined );
	// The unaccepted second stage is replayed against the rebuilt sync world.
	near( weights, [ 1 / 7, 2 / 7, 2 / 7, 3 / 7, 4 / 7, 5 / 7, 6 / 7, 1, 1, 1 ] );
	assert.equal( helper.objects.get( mesh )!.mixer!.time, 0 ); assert.ok( pose( mesh ).every( Number.isFinite ) );
	helper.update( 1 / 60 ); near( [ helper.objects.get( mesh )!.mixer!.time ], [ 1 / 60 ] );
	helper.remove( mesh );

} );

for ( const format of [ 'pmd', 'pmx' ] as const ) test( `animationWarmup opt-out and pose-only startup ${format}`, () => {

	for ( const animation of [ false, true ] ) for ( const optOut of [ false, true ] ) {

		const helper = new MMDAnimationHelper(), { mesh, clip } = fixture( format );
		mesh.skeleton.bones[ 0 ].position.y = 0.25;
		let calls = 0;
		helper.onBeforePhysics = () => { calls ++; assert.equal( helper.objects.get( mesh )!.initialPose, undefined ); };
		helper.add( mesh, { animation: animation ? clip : undefined, animationWarmup: !optOut, warmup: 0, gravity: new Vector3() } );
		assert.equal( calls, 0 ); assert.ok( pose( mesh ).every( Number.isFinite ) );
		if ( optOut ) { helper.objects.get( mesh )!.physics!.warmup( 2 ); assert.equal( helper.objects.get( mesh )!.initialPose, undefined ); }
		helper.update( 0 ); assert.ok( pose( mesh ).every( Number.isFinite ) ); helper.remove( mesh );

	}

} );

for ( const format of [ 'pmd', 'pmx' ] as const ) for ( const shared of [ false, true ] ) test( `first playback is deterministic across repeated Sync and Worker startup ${format} shared=${shared}`, () => {

	const results: { pose: number[]; bodies: number[]; time: number }[] = [];
	for ( const mode of [ 'sync', 'sync', 'worker', 'worker' ] as const ) {

		const helper = new MMDAnimationHelper( { sync: false } ); helper.sharedPhysics = shared;
		const worker = new ManualWorker(), { mesh, clip } = fixture( format );
		helper.add( mesh, { animation: clip, warmup: 7, physicsMode: mode, workerPhysics: worker.options(), gravity: new Vector3() } );
		if ( mode === 'worker' ) finish( worker );
		helper.update( 1 / 60 ); if ( mode === 'worker' ) finish( worker ); helper.update( 0 );
		const s = helper.objects.get( mesh )!;
		results.push( { pose: pose( mesh ), bodies: s.physics!.bodyResults.flatMap( b => [ ...b.position, ...b.quaternion ] ), time: s.mixer!.time } );
		helper.remove( mesh );

	}
	for ( const r of results.slice( 1 ) ) { near( r.pose, results[ 0 ].pose, 1e-4 ); near( r.bodies, results[ 0 ].bodies, 1e-4 ); assert.equal( r.time, results[ 0 ].time ); }

} );

for ( const joinDuringFlight of [ false, true ] ) test( `shared Worker queues independent startup ramps, join during flight=${joinDuringFlight}`, async () => {

	const helper = new MMDAnimationHelper( { sync: false } ); helper.sharedPhysics = true;
	const worker = new ManualWorker(), first = fixture( 'pmx' ), second = fixture( 'pmx' ); second.mesh.position.z = 20;
	const params = { warmup: 1, physicsMode: 'worker' as const, workerPhysics: worker.options(), gravity: new Vector3() };
	helper.add( first.mesh, { ...params, animation: first.clip } );
	if ( joinDuringFlight ) worker.start(); // the only stage is now in flight
	helper.add( second.mesh, { ...params, animation: second.clip } );
	finish( worker );
	assert.equal( worker.frames, 2 );
	for ( const { mesh } of [ first, second ] ) {

		const state = helper.objects.get( mesh )!;
		assert.equal( state.initialPose, undefined ); assert.equal( state.mixer!.time, 0 );
		assert.ok( pose( mesh ).every( Number.isFinite ) );

	}
	helper.update( 0.4 ); finish( worker ); helper.update( 0 );
	const state = helper.objects.get( first.mesh )!, authored = state.poseLayers!.authored.slice();
	state.physics!.warmup( 2 ); await Promise.resolve(); finish( worker );
	near( state.poseLayers!.authored, authored ); assert.equal( state.mixer!.time, 0.4 );
	helper.remove( first.mesh ); helper.remove( second.mesh );

} );

for ( const mode of [ 'sync', 'worker' ] as const ) test( `pose-only PMX ramps morphs without accumulating untracked authored offsets ${mode}`, () => {

	const helper = new MMDAnimationHelper(), worker = new ManualWorker(), { mesh } = fixture( 'pmx' );
	mesh.skeleton.bones[ 6 ].position.x = 0.7;
	mesh.morphTargetInfluences![ 1 ] = 0.6;
	const weights: number[] = [];
	helper.onBeforePhysics = () => {

		const state = helper.objects.get( mesh )!; weights.push( mesh.morphTargetInfluences![ 1 ] );
		near( state.poseLayers!.authored.slice( 6 * 7, 6 * 7 + 3 ), [ 0.7, 2, 0 ] );

	};
	helper.add( mesh, { warmup: 3, physicsMode: mode, workerPhysics: worker.options(), gravity: new Vector3() } );
	if ( mode === 'worker' ) finish( worker );
	near( weights, [ 0.2, 0.4, 0.6 ] );
	for ( let i = 0; i < 5; i ++ ) helper.update( 0 );
	near( helper.objects.get( mesh )!.poseLayers!.authored.slice( 6 * 7, 6 * 7 + 3 ), [ 0.7, 2, 0 ] );
	near( [ mesh.morphTargetInfluences![ 1 ] ], [ 0.6 ] ); helper.remove( mesh );

} );

test( 'synchronous re-entrant warmup appends cycles after the current pose pipeline', () => {

	const helper = new MMDAnimationHelper(), { mesh, clip } = fixture( 'pmx' );
	const weights: number[] = [];
	helper.onBeforePhysics = () => {

		const s = helper.objects.get( mesh )!; weights.push( s.initialPose?.weight ?? 1 );
		if ( weights.length === 1 ) s.physics!.warmup( 2 );

	};
	helper.add( mesh, { animation: clip, warmup: 3, gravity: new Vector3() } );
	near( weights, [ 1 / 3, 2 / 3, 1, 1, 1 ] );
	assert.equal( helper.objects.get( mesh )!.mixer!.time, 0 ); helper.remove( mesh );

} );

test( 'removal during queued Worker startup discards its completion safely', () => {

	const helper = new MMDAnimationHelper(); helper.sharedPhysics = true;
	const worker = new ManualWorker(), first = fixture( 'pmx' ), second = fixture( 'pmx' );
	const params = { warmup: 3, physicsMode: 'worker' as const, workerPhysics: worker.options(), gravity: new Vector3() };
	helper.add( first.mesh, { ...params, animation: first.clip } );
	helper.add( second.mesh, { ...params, animation: second.clip } );
	worker.start(); worker.process(); helper.remove( first.mesh ); worker.deliver(); finish( worker );
	assert.equal( helper.objects.get( second.mesh )!.initialPose, undefined );
	assert.ok( pose( second.mesh ).every( Number.isFinite ) ); helper.remove( second.mesh );

} );

for ( const mode of [ 'sync', 'worker' ] as const ) test( `ramp ends at the same complete authored PMX pipeline as immediate initialization ${mode}`, () => {

	const ramp = new MMDAnimationHelper(), immediate = new MMDAnimationHelper();
	const first = fixture( 'pmx' ), reference = fixture( 'pmx' ), worker = new ManualWorker();
	ramp.add( first.mesh, { animation: first.clip, warmup: 7, physicsMode: mode, workerPhysics: worker.options(), gravity: new Vector3() } );
	if ( mode === 'worker' ) finish( worker );
	immediate.add( reference.mesh, { animation: reference.clip, warmup: 0, gravity: new Vector3() } );
	const full = immediate.objects.get( reference.mesh )!.poseLayers!, layers = ramp.objects.get( first.mesh )!.poseLayers!;
	for ( const name of [ 'authored', 'morphed', 'beforePhysics' ] as const ) near( layers[ name ], full[ name ], 1e-4 );
	// Remove physical authority from this comparison: dynamic settling is
	// intentionally different, while the authored pre/post IK/morph/grant
	// result must be identical, including untracked bones and the post layer.
	for ( const [ helper, mesh ] of [ [ ramp, first.mesh ], [ immediate, reference.mesh ] ] as const ) helper.enable( 'physics', false ).update( 0 );
	near( pose( first.mesh ), pose( reference.mesh ), 1e-4 );
	ramp.remove( first.mesh ); immediate.remove( reference.mesh );

} );

test( 'delayed Worker display keeps morph influence in the current stage and removal restores authored weights', () => {

	const helper = new MMDAnimationHelper(), worker = new ManualWorker(), { mesh, clip } = fixture( 'pmx' );
	helper.add( mesh, { animation: clip, warmup: 7, physicsMode: 'worker', workerPhysics: worker.options(), gravity: new Vector3() } );
	near( [ mesh.morphTargetInfluences![ 1 ] ], [ 0 ] );
	worker.start(); near( [ mesh.morphTargetInfluences![ 1 ] ], [ 0.8 / 7 ] );
	for ( let i = 0; i < 10; i ++ ) helper.update( 1 / 120 );
	near( [ mesh.morphTargetInfluences![ 1 ] ], [ 0.8 / 7 ] );
	worker.finish(); near( [ mesh.morphTargetInfluences![ 1 ] ], [ 0.8 * 2 / 7 ] );
	helper.remove( mesh ); near( [ mesh.morphTargetInfluences![ 1 ] ], [ 0.8 ] );

} );

test( 'removing a PMD during Worker startup releases the full authored pose', () => {

	const helper = new MMDAnimationHelper(), worker = new ManualWorker(), { mesh, clip, animated, target } = fixture( 'pmd' );
	helper.add( mesh, { animation: clip, warmup: 7, physicsMode: 'worker', workerPhysics: worker.options(), gravity: new Vector3() } ); worker.start();
	helper.remove( mesh ); near( mesh.skeleton.bones[ animated ].position.toArray(), target );
	assert.ok( Math.abs( mesh.skeleton.bones[ animated ].quaternion.dot( rotation ) ) > 1 - 1e-6 );

} );
