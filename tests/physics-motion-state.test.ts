import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Parser } from 'mmd-parser';
import { Euler, Matrix4, Quaternion, Texture, Vector3 } from 'three';
import type { AmmoAPI, AmmoBody, AmmoTransform, AmmoVector3, AmmoWorld } from '../src/ammo.js';
import { MMDAnimationHelper } from '../src/animation/MMDAnimationHelper.js';
import { MMDPhysics } from '../src/animation/MMDPhysics.js';
import { MMDLoader } from '../src/loaders/MMDLoader.js';
import { initializeAmmo } from './ammo-runtime.ts';
import { linkedCollisionBuffer } from './fixtures.ts';
import { ManualWorker } from './manual-physics-worker.ts';

const host = globalThis as typeof globalThis & { Ammo: AmmoAPI };
before( async () => { host.Ammo = await initializeAmmo<AmmoAPI>(); } );
// Read existing native binding methods without expanding the library's API.
interface NativeBody extends AmmoBody {
	getLinearVelocity(): AmmoVector3; getAngularVelocity(): AmmoVector3;
	setInterpolationWorldTransform( transform: AmmoTransform ): void; clearForces(): void;
}
const vector = ( v: AmmoVector3 ) => [ v.x(), v.y(), v.z() ];
function pose( transform: AmmoTransform ) {

	const q = transform.getRotation();
	return [ ...vector( transform.getOrigin() ), q.x(), q.y(), q.z(), q.w() ];

}
function near( a: number[], b: number[], tolerance = 3e-5 ) {

	assert.equal( a.length, b.length );
	a.forEach( ( v, i ) => assert.ok( Number.isFinite( v ) && Math.abs( v - b[ i ] ) < tolerance, `${a} != ${b}` ) );

}
function model( format: 'pmd' | 'pmx', post: boolean ) {

	const parser = new Parser(), buffer = linkedCollisionBuffer( format, { masks: [ 0, 0 ], timeProbe: true } );
	const data = format === 'pmd' ? parser.parsePmd( buffer, true ) : parser.parsePmx( buffer, true );
	if ( post && 'flag' in data.bones[ 0 ] ) data.bones[ 0 ].flag |= 0x1000;
	// Nonzero authored offsets test the existing bone -> body conversion.
	data.rigidBodies[ 0 ].position = [ 0.1, 0.2, 0.3 ];
	data.rigidBodies[ 0 ].rotation = [ 0.1, -0.2, 0.05 ];
	data.constraints[ 0 ].translationLimitation1 = [ 0, 0, 0 ];
	data.constraints[ 0 ].translationLimitation2 = [ 0, 0, 0 ];
	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	return loader.meshBuilder.build( data, '' );

}
const tapes = [
	...[ 60, 120, 144 ].map( fps => ( { name: `${fps} FPS`, deltas: Array<number>( fps ).fill( 1 / fps ) } ) ),
	{ name: 'nonuniform 120 FPS', deltas: Array.from( { length: 120 }, ( _, i ) => i % 2 === 0 ? 1 / 480 : 7 / 480 ) }
];

for ( const format of [ 'pmd', 'pmx' ] as const ) for ( const post of format === 'pmx' ? [ false, true ] : [ false ] ) for ( const path of [ 'standalone', 'shared', 'worker transfer', 'worker shared', 'fallback' ] ) for ( const tape of tapes ) test( `MotionState kinematic drive ${format} post=${post} ${path} ${tape.name}`, t => {

	const descriptor = Object.getOwnPropertyDescriptor( globalThis, 'crossOriginIsolated' );
	Object.defineProperty( globalThis, 'crossOriginIsolated', { value: path === 'worker shared', configurable: true } );
	const bodies: NativeBody[] = [], worlds: AmmoWorld[] = [];
	t.mock.method( host.Ammo, 'btRigidBody', class extends host.Ammo.btRigidBody {

		constructor( info: ConstructorParameters<AmmoAPI['btRigidBody']>[0] ) { super( info ); bodies.push( this as unknown as NativeBody ); }

	} );
	t.mock.method( host.Ammo, 'btDiscreteDynamicsWorld', class extends host.Ammo.btDiscreteDynamicsWorld {

		constructor( ...args: ConstructorParameters<AmmoAPI['btDiscreteDynamicsWorld']> ) { super( ...args ); worlds.push( this ); }

	} );
	const helper = new MMDAnimationHelper( { sync: false } ); helper.sharedPhysics = true;
	const worker = new ManualWorker(), isWorker = path.startsWith( 'worker' );
	const meshes = Array.from( { length: path === 'standalone' ? 1 : 2 }, ( _, i ) => {

		const mesh = model( format, post ); mesh.position.z = i * 20;
		mesh.quaternion.setFromAxisAngle( new Vector3( 0, 1, 0 ), -0.3 ); mesh.updateMatrixWorld( true ); return mesh;

	} );
	let standalone: MMDPhysics | undefined;
	const h = 1 / 60;
	try {

		if ( path === 'standalone' ) {

			const mesh = meshes[ 0 ], meta = mesh.geometry.userData.MMD;
			standalone = new MMDPhysics( mesh, meta.rigidBodies, meta.constraints, { gravity: new Vector3( 0, 0, 10 ) } );

		} else for ( const mesh of meshes ) helper.add( mesh, {
			warmup: 0, animationWarmup: false, gravity: new Vector3( 0, 0, 10 ),
			physicsMode: isWorker || path === 'fallback' ? 'worker' : 'sync',
			workerPhysics: path === 'fallback' ? { ammoURL: 'https://example.test/ammo.js', createWorker: () => { throw new Error( 'intentional startup failure' ); } } : worker.options()
		} );
		worker.start();
		// Consume Worker creation/reset before spying on routine following.
		if ( isWorker ) { helper.update( 0 ); worker.start(); }
		assert.equal( worlds.length, 1 ); assert.equal( bodies.length, meshes.length * 3 );
		const physics = meshes.map( mesh => standalone ?? helper.objects.get( mesh )!.physics! );
		for ( const p of physics ) {

			assert.equal( p.unitStep, h ); assert.equal( p.maxStepNum, 10 );
			assert.equal( p.physicsMode, isWorker ? 'worker' : 'sync' );
			if ( isWorker ) assert.equal( p.transport, path === 'worker shared' ? 'shared' : 'transferable' );
			if ( path === 'fallback' ) assert.equal( p.requestedPhysicsMode, 'worker' );

		}
		const anchors = bodies.filter( ( _, i ) => i % 3 === 0 ), dynamics = bodies.filter( ( _, i ) => i % 3 === 1 ), clocks = bodies.filter( ( _, i ) => i % 3 === 2 );
		const initialZ = clocks.map( body => body.getCenterOfMassTransform().getOrigin().z() );
		const teleports = anchors.map( body => t.mock.method( body, 'setCenterOfMassTransform' ) );
		const motion = new host.Ammo.btTransform();
		const offset = new Matrix4().compose( new Vector3( 0.1, 0.2, 0.3 ), new Quaternion().setFromEuler( new Euler( 0.1, -0.2, 0.05, 'YXZ' ) ), new Vector3( 1, 1, 1 ) );
		const target = ( i: number ) => {

			const matrix = meshes[ i ].skeleton.bones[ 0 ].matrixWorld.clone().multiply( offset );
			const p = new Vector3(), q = new Quaternion(); matrix.decompose( p, q, new Vector3() ); return [ ...p.toArray(), ...q.toArray() ];

		};
		let expected = meshes.map( ( _, i ) => target( i ) ), previous = anchors.map( b => pose( b.getCenterOfMassTransform() ) );
		// Independent joint point coordinates: the authored joint is the mesh origin.
		const jointPoints = bodies.map( ( body, i ) => {

			const p = pose( body.getCenterOfMassTransform() );
			return meshes[ Math.floor( i / 3 ) ].getWorldPosition( new Vector3() ).sub( new Vector3().fromArray( p ) ).applyQuaternion( new Quaternion().fromArray( p, 3 ).invert() );

		} );
		let completed = 0, zero = 0, elapsed = 0, maxError = 0, moved = false;
		const nativeStep = worlds[ 0 ].stepSimulation;
		const step = t.mock.method( worlds[ 0 ], 'stepSimulation', function ( this: AmmoWorld, delta: number, budget: number, fixed: number ) {

			assert.equal( fixed, h );
			for ( const [ i, body ] of anchors.entries() ) {

				near( pose( body.getCenterOfMassTransform() ), previous[ i ], 1e-7 );
				body.getMotionState().getWorldTransform( motion ); near( pose( motion ), expected[ i ] );

			}
			const velocities = anchors.map( b => [ ...vector( b.getLinearVelocity() ), ...vector( b.getAngularVelocity() ) ] );
			const beforeDynamic = dynamics.map( b => pose( b.getCenterOfMassTransform() ) );
			const requested = nativeStep.call( this, delta, budget, fixed ), count = Math.min( requested, budget );
			completed += count;
			for ( const [ i, body ] of anchors.entries() ) {

				const actual = pose( body.getCenterOfMassTransform() );
				near( actual, count ? expected[ i ] : previous[ i ] );
				body.getMotionState().getWorldTransform( motion ); near( pose( motion ), expected[ i ] );
				if ( count ) {

					near( vector( body.getLinearVelocity() ), actual.slice( 0, 3 ).map( ( v, j ) => ( v - previous[ i ][ j ] ) / ( count * h ) ) );
					assert.ok( vector( body.getAngularVelocity() ).every( Number.isFinite ) );
					moved ||= Math.hypot( ...vector( body.getAngularVelocity() ) ) > 0.01;

				} else {

					near( [ ...vector( body.getLinearVelocity() ), ...vector( body.getAngularVelocity() ) ], velocities[ i ], 1e-7 );
					near( pose( dynamics[ i ].getCenterOfMassTransform() ), beforeDynamic[ i ], 1e-7 );

				}
				previous[ i ] = actual;

			}
			if ( ! count ) zero ++;
			return requested;

		} );
		try {

			// A quarter-step lead avoids float rounding at the exact one-second boundary.
			for ( const delta of [ h / 4, ...tape.deltas ] ) {

				elapsed += delta;
				for ( const mesh of meshes ) {

					mesh.skeleton.bones[ 0 ].position.y = elapsed * 0.2;
					mesh.skeleton.bones[ 0 ].quaternion.setFromAxisAngle( new Vector3( 0, 0, 1 ), elapsed * 0.1 ); mesh.updateMatrixWorld( true );

				}
				// Helper-managed PMX post inputs intentionally consume the preceding
				// final layer. Standalone physics reads the caller's current pose.
				if ( ! post || standalone ) expected = meshes.map( ( _, i ) => target( i ) );
				if ( standalone ) standalone.update( delta ); else helper.update( delta );
				if ( isWorker ) worker.start();
				if ( post && ! standalone ) expected = meshes.map( ( _, i ) => target( i ) );
				assert.ok( completed * h <= elapsed + 2e-6 && elapsed - completed * h < h + 2e-6 );
				for ( const [ i, clock ] of clocks.entries() ) {

					assert.ok( Math.abs( clock.getCenterOfMassTransform().getOrigin().z() - initialZ[ i ] - 10 * h * h * completed * ( completed + 1 ) / 2 ) < 5e-4 );
					for ( const body of bodies ) assert.ok( [ ...pose( body.getCenterOfMassTransform() ), ...vector( body.getLinearVelocity() ), ...vector( body.getAngularVelocity() ) ].every( Number.isFinite ) );
					const joint = ( body: NativeBody, index: number ) => {

						const p = pose( body.getCenterOfMassTransform() ); return jointPoints[ index ].clone().applyQuaternion( new Quaternion().fromArray( p, 3 ) ).add( new Vector3().fromArray( p ) );

					};
					maxError = Math.max( maxError, joint( anchors[ i ], i * 3 ).distanceTo( joint( dynamics[ i ], i * 3 + 1 ) ) );

				}

			}
			assert.equal( step.mock.callCount(), tape.deltas.length + 1 );
			assert.equal( completed, 60, 'one second plus a retained quarter-step completes exactly 60 physical steps' );
			if ( tape.name !== '60 FPS' ) assert.ok( zero > 0 );
			assert.ok( moved, 'native angular velocity must reflect the moving anchor' );
			assert.ok( maxError < 0.03, `joint must follow the moving anchor: ${maxError}` );
			assert.ok( dynamics.every( b => b.getCenterOfMassTransform().getOrigin().y() > 0.1 ), 'joint must move dynamic bodies against the zero-contact baseline' );
			assert.ok( teleports.every( spy => spy.mock.callCount() === 0 ), 'no per-render Type-0 native body setter' );

		} finally { step.mock.restore(); host.Ammo.destroy?.( motion ); }

	} finally {

		standalone?.dispose(); for ( const mesh of helper.meshes.slice() ) helper.remove( mesh ); worker.start();
		for ( const mesh of meshes ) { mesh.geometry.dispose(); mesh.skeleton.dispose(); }
		if ( descriptor ) Object.defineProperty( globalThis, 'crossOriginIsolated', descriptor ); else Reflect.deleteProperty( globalThis, 'crossOriginIsolated' );

	}

} );

for ( const format of [ 'pmd', 'pmx' ] as const ) test( `explicit ${format} reset synchronizes native pose, MotionState, interpolation, velocities and caches`, t => {

	const mesh = model( format, true ), meta = mesh.geometry.userData.MMD;
	const physics = new MMDPhysics( mesh, meta.rigidBodies, meta.constraints );
	const transform = new host.Ammo.btTransform(), velocity = new host.Ammo.btVector3( 10, -20, 30 );
	try {

		const anchor = physics.bodies[ 0 ];
		// Queue a pose that must never survive a subsequent deliberate teleport.
		mesh.skeleton.bones[ 0 ].position.set( 7, 8, 9 ); mesh.updateMatrixWorld( true ); physics.deferAfterPhysics();
		if ( format === 'pmx' ) assert.ok( anchor.getDeferredPose() );
		mesh.skeleton.bones[ 0 ].position.set( -2, 3, 4 );
		mesh.skeleton.bones[ 0 ].quaternion.setFromAxisAngle( new Vector3( 0, 0, 1 ), 0.3 ); mesh.updateMatrixWorld( true );
		const expected = physics.bodies.map( b => {

			const form = b._getBoneTransform(), result = pose( form ); physics.manager.freeTransform( form ); return result;

		} );
		const teleports = physics.bodies.map( b => t.mock.method( b.body, 'setCenterOfMassTransform' ) );
		const interpolations = physics.bodies.map( b => {

			const native = b.body.setInterpolationWorldTransform!;
			return t.mock.method( b.body as NativeBody, 'setInterpolationWorldTransform', function ( this: AmmoBody, form: AmmoTransform ) {

				near( pose( form ), pose( this.getCenterOfMassTransform() ) ); native.call( this, form );

			} );

		} );
		const forces = physics.bodies.map( b => t.mock.method( b.body as NativeBody, 'clearForces' ) );
		const activations = physics.bodies.map( b => t.mock.method( b.body, 'setActivationState' ) );
		for ( const b of physics.bodies ) {

			b.body.setLinearVelocity!( velocity ); b.body.setAngularVelocity!( velocity ); b.body.setActivationState( 2 );

		}
		physics.reset();
		assert.equal( physics.bodyResultPhase, 'reset' );
		for ( const [ i, b ] of physics.bodies.entries() ) {

			const native = b.body as NativeBody;
			near( pose( native.getCenterOfMassTransform() ), expected[ i ] );
			native.getMotionState().getWorldTransform( transform ); near( pose( transform ), expected[ i ] );
			near( [ ...physics.bodyResults[ i ].position, ...physics.bodyResults[ i ].quaternion ], expected[ i ] );
			near( vector( native.getLinearVelocity() ), [ 0, 0, 0 ] ); near( vector( native.getAngularVelocity() ), [ 0, 0, 0 ] );
			assert.equal( b.getDeferredPose(), null ); assert.equal( teleports[ i ].mock.callCount(), 1 );
			assert.equal( interpolations[ i ].mock.callCount(), 1 ); assert.equal( forces[ i ].mock.callCount(), 1 );
			assert.deepEqual( activations[ i ].mock.calls.at( -1 )!.arguments, [ b.params.type === 0 ? 4 : 1 ] );

		}
		const step = t.mock.method( physics.world!, 'stepSimulation' );
		physics.update( 1 / 240 ); assert.equal( step.mock.calls.at( -1 )!.result, 0 );
		near( pose( anchor.body.getCenterOfMassTransform() ), expected[ 0 ] );
		physics.update( 1 / 80 ); assert.equal( step.mock.calls.at( -1 )!.result, 1 );
		near( vector( ( anchor.body as NativeBody ).getLinearVelocity() ), [ 0, 0, 0 ] );
		near( vector( ( anchor.body as NativeBody ).getAngularVelocity() ), [ 0, 0, 0 ] );
		physics.warmup( 3 ); assert.equal( step.mock.callCount(), 5 );
		near( pose( anchor.body.getCenterOfMassTransform() ), expected[ 0 ] );
		assert.equal( teleports[ 0 ].mock.callCount(), 1, 'warmup follows through MotionState; only reset teleports' );

	} finally { host.Ammo.destroy?.( transform ); host.Ammo.destroy?.( velocity ); physics.dispose(); mesh.geometry.dispose(); mesh.skeleton.dispose(); }

} );
