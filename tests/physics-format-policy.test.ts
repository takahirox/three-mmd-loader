import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { AnimationClip, Quaternion, Texture, Vector3, VectorKeyframeTrack } from 'three';
import { Parser } from 'mmd-parser';
import { MMDLoader } from '../src/loaders/MMDLoader.js';
import { pmdBuffer, pmxBuffer } from './fixtures.ts';
import type { AmmoAPI } from '../src/ammo.js';
import { MMDAnimationHelper } from '../src/animation/MMDAnimationHelper.js';
import { MMDPhysics } from '../src/animation/MMDPhysics.js';
import { initializeAmmo } from './ammo-runtime.ts';
import { ManualWorker } from './manual-physics-worker.ts';
import { type2Fixture } from './type2-fixture.ts';

const host = globalThis as typeof globalThis & { Ammo: AmmoAPI };
before( async () => { host.Ammo = await initializeAmmo<AmmoAPI>(); } );
function near( a: ArrayLike<number>, b: ArrayLike<number>, tolerance = 5e-4 ) {

	assert.equal( a.length, b.length );
	Array.from( a ).forEach( ( v, i ) => assert.ok( Number.isFinite( v ) && Math.abs( v - b[ i ] ) < tolerance, `${i}: ${v} != ${b[ i ]}` ) );

}
function native( physics: MMDPhysics ) {

	return physics.bodies.flatMap( b => {

		const t = b.body.getCenterOfMassTransform(), p = t.getOrigin(), q = t.getRotation();
		return [ p.x(), p.y(), p.z(), q.x(), q.y(), q.z(), q.w() ];

	} );

}
const raw = ( physics: MMDPhysics ) => physics.bodyResults.flatMap( r => [ ...r.position, ...r.quaternion ] );
const drain = ( worker: ManualWorker ) => { for ( let n = 0; worker.requests.length; n ++ ) { assert.ok( n < 100 ); worker.process(); while ( worker.responses.length ) worker.deliver(); } };

// Every path runs paired, equivalent normalized fixtures. The independent
// direct-Bullet oracle in type2-physics.test.ts establishes physical authority;
// these comparisons check that transport/lifecycle do not change that policy.
for ( const fps of [ 60, 120 ] ) for ( const path of [ 'standalone', 'helper', 'shared', 'worker transfer', 'worker shared', 'fallback startup', 'fallback runtime' ] ) test( `equivalent PMD/PMX joint AND contact lifecycle ${path} ${fps} FPS`, async () => {

	const isolation = Object.getOwnPropertyDescriptor( globalThis, 'crossOriginIsolated' );
	Object.defineProperty( globalThis, 'crossOriginIsolated', { value: path === 'worker shared', configurable: true } );
	const cases = ( [ 'pmd', 'pmx' ] as const ).map( format => {

		const model = type2Fixture( 'pre', 'joint-contact', format ), worker = new ManualWorker();
		const helper = new MMDAnimationHelper( { sync: false } ); helper.sharedPhysics = path === 'shared' || path.startsWith( 'worker' ) || path.startsWith( 'fallback' );
		const params = { warmup: 0, animationWarmup: false, gravity: new Vector3(), ...( path.startsWith( 'worker' ) || path.startsWith( 'fallback' ) ? { physicsMode: 'worker' as const, workerPhysics: { ...worker.options(), ...( path === 'fallback startup' ? { createWorker: () => { throw new Error( 'fixture startup failure' ); } } : {} ) } } : {} ) };
		let physics: MMDPhysics;
		const second = helper.sharedPhysics ? type2Fixture( 'pre', false, format ) : undefined;
		if ( path === 'standalone' ) {

			const meta = model.geometry.userData.MMD; physics = new MMDPhysics( model, meta.rigidBodies, meta.constraints, params );

		} else {

			helper.add( model, params ); physics = helper.objects.get( model )!.physics!;
			if ( second ) { second.position.z = 20; helper.add( second, params ); }
			if ( physics.workerAdapter ) worker.start();

		}
		const update = ( delta: number ) => {

			model.updateMatrixWorld( true );
			if ( path === 'standalone' ) physics.update( delta ); else helper.update( delta );
			if ( physics.workerAdapter ) { drain( worker ); helper.update( 0 ); }

		};
		const bodyPhysics = () => physics.workerAdapter ? Array.from( worker[ 'runtime' ][ 'models' ].values() )[ 0 ].physics : physics;
		return { model, helper, physics, worker, second, update, bodyPhysics };

	} );
	try {

		const [ a, b ] = cases;
		assert.deepEqual( a.model.geometry.userData.MMD.rigidBodies, b.model.geometry.userData.MMD.rigidBodies );
		assert.deepEqual( a.model.geometry.userData.MMD.constraints, b.model.geometry.userData.MMD.constraints );
		for ( const c of cases ) { c.physics.warmup( 3 ); await Promise.resolve(); drain( c.worker ); }
		near( raw( a.physics ), raw( b.physics ) );
		for ( let frame = 0; frame < fps; frame ++ ) {

			for ( const c of cases ) {

				const bones = c.model.skeleton.bones;
				bones[ 0 ].position.x = -frame / fps / 10;
				bones[ 7 ].position.set( 0.5 + frame / fps, 0.5, 0 );
				bones[ 7 ].quaternion.setFromAxisAngle( new Vector3( 0, 0, 1 ), frame / fps );
				bones[ 3 ].position.set( 2 + frame / fps, -0.3, 0.2 );
				c.update( 1 / fps );
				near( native( c.bodyPhysics() ), raw( c.physics ) );
				near( bones[ 3 ].position.toArray(), [ 2 + frame / fps, -0.3, 0.2 ] );
				const body = c.bodyPhysics().bodies[ 1 ], q = body.boneOffsetForm.getRotation();
				const rotation = bones[ 3 ].parent!.getWorldQuaternion( new Quaternion() ).invert()
					.multiply( new Quaternion().fromArray( c.physics.bodyResults[ 1 ].quaternion ) )
					.multiply( new Quaternion( q.x(), q.y(), q.z(), q.w() ).invert() );
				assert.ok( Math.abs( bones[ 3 ].quaternion.dot( rotation.normalize() ) ) > 1 - 1e-6 );
				assert.equal( body.getDeferredPose(), null );
				const frozen = native( c.bodyPhysics() );
				for ( const delta of path === 'standalone' ? [ 0, -1, NaN, Infinity ] : [ 0 ] ) { c.update( delta ); near( native( c.bodyPhysics() ), frozen, 1e-7 ); assert.equal( c.worker.requests.length, 0 ); }
				if ( frame === 12 ) {

					c.physics.reset(); c.update( 0 ); near( native( c.bodyPhysics() ), raw( c.physics ) );
					c.physics.warmup( 3 ); await Promise.resolve(); drain( c.worker );

				}
				if ( frame === 20 && path === 'fallback runtime' ) {

					c.worker.deliver( { type: 'error', reason: 'fixture runtime failure' } );
					assert.equal( c.physics.physicsMode, 'sync' );

				}

			}
			try { near( raw( a.physics ), raw( b.physics ) ); } catch ( e ) { throw new Error( `frame=${frame}`, { cause: e } ); }

		}

	} finally {

		for ( const c of cases ) { if ( path === 'standalone' ) c.physics.dispose(); else { c.helper.remove( c.model ); if ( c.second ) c.helper.remove( c.second ); drain( c.worker ); } }
		if ( isolation ) Object.defineProperty( globalThis, 'crossOriginIsolated', isolation ); else Reflect.deleteProperty( globalThis, 'crossOriginIsolated' );

	}

} );

for ( const format of [ 'pmd', 'pmx' ] as const ) for ( const shared of [ false, true ] ) for ( const mode of [ 'sync', 'worker' ] as const ) test( `type2 skeletal animation, seek and loop ${format} shared=${shared} ${mode}`, () => {

	const model = type2Fixture( 'pre', false, format ), meta = model.geometry.userData.MMD;
	// An isolated Type-2 body is an independent constant-position oracle:
	// skeletal translation alone cannot move it. A loop deliberately resets
	// bodies; its output/native agreement is checked separately below.
	meta.constraints = []; for ( const b of meta.rigidBodies ) b.groupTarget = 0;
	const clip = new AnimationClip( 'move type2', 1, [ new VectorKeyframeTrack( '.bones[bone3].position', [ 0, 1 ], [ 1.5, -0.5, 0, 3.5, -0.5, 0 ] ) ] );
	const helper = new MMDAnimationHelper( { sync: false } ); helper.sharedPhysics = shared;
	const worker = new ManualWorker();
	helper.add( model, { animation: clip, warmup: 0, animationWarmup: false, physicsMode: mode, workerPhysics: worker.options(), gravity: new Vector3() } );
	if ( mode === 'worker' ) worker.start();
	const state = helper.objects.get( model )!, physics = state.physics!;
	try {

		const initial = physics.bodyResults[ 1 ].position.slice();
		for ( const time of [ 0.25, 0.8, 0.1, 0 ] ) {

			state.mixer!.setTime( time );
			for ( let i = 0; i < 3; i ++ ) { helper.update( 0 ); drain( worker ); }
			near( model.skeleton.bones[ 3 ].position.toArray(), [ 1.5 + 2 * time, -0.5, 0 ] );
			near( physics.bodyResults[ 1 ].position, initial );
			helper.update( 1 / 60 ); drain( worker ); helper.update( 0 );
			near( physics.bodyResults[ 1 ].position, initial );

		}
		state.mixer!.setTime( 0.99 ); helper.update( 0.02 ); drain( worker ); helper.update( 0 );
		assert.equal( state.looped, false );
		near( [ state.mixer!.time % 1 ], [ 0.01 ] );
		near( model.skeleton.bones[ 3 ].position.toArray(), [ 1.52, -0.5, 0 ] );
		near( native( physics.workerAdapter ? Array.from( worker[ 'runtime' ][ 'models' ].values() )[ 0 ].physics : physics ), raw( physics ) );

		helper.enable( 'animation', false );
		helper.pose( model, { metadata: { boneCount: 1, parentFile: '', coordinateSystem: 'right' }, bones: [ { name: 'bone3', translation: [ 2, 1, 0 ], quaternion: [ 0, 0, 0, 1 ] } ] }, { ik: false, grant: false } );
		model.updateMatrixWorld( true );
		const bone = model.skeleton.bones[ 3 ];
		const resetOrigin = new Vector3().fromArray( meta.rigidBodies[ 1 ].position ).applyQuaternion( bone.getWorldQuaternion( new Quaternion() ) ).add( bone.getWorldPosition( new Vector3() ) );
		physics.reset(); helper.update( 0 ); drain( worker );
		near( physics.bodyResults[ 1 ].position, resetOrigin.toArray() );

	} finally { helper.remove( model ); drain( worker ); }

} );

// PMD encodes the IK cap in quarter-radians and has no per-link angular
// bounds. PMX carries radians and explicit bounds, requiring normalization.
test( 'loader retains PMD IK encoding and knee convention, PMX explicit ranges', () => {

	const parser = new Parser(), pmd = parser.parsePmd( pmdBuffer( { twoBones: true } ), true ), pmx = parser.parsePmx( pmxBuffer( { twoBones: true } ), true );
	pmd.bones[ 0 ].name = 'ひざ'; pmd.metadata.ikCount = 1;
	pmd.iks = [ { target: 0, effector: 1, iteration: 10, maxAngle: 0.1, linkCount: 1, links: [ { index: 0 } ] } ];
	pmx.bones[ 0 ].ik = { target: null, effector: 1, iteration: 10, maxAngle: 0.4, linkCount: 1, links: [ { index: 0, angleLimitation: 1, lowerLimitationAngle: [ -Math.PI, 0, 0 ], upperLimitationAngle: [ 0, 0, 0 ] } ] };
	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	const a = loader.meshBuilder.build( pmd, '' ).geometry.userData.MMD.iks[ 0 ], b = loader.meshBuilder.build( pmx, '' ).geometry.userData.MMD.iks[ 0 ];
	near( [ a.maxAngle!, a.iteration! ], [ b.maxAngle!, b.iteration! ] );
	near( a.links[ 0 ].limitation!.toArray(), [ 1, 0, 0 ] );
	near( b.links[ 0 ].rotationMin!.toArray(), [ 0, 0, 0 ] ); near( b.links[ 0 ].rotationMax!.toArray(), [ Math.PI, 0, 0 ] );

} );
