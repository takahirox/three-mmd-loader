import assert from 'node:assert/strict';
import { initializeAmmo } from './ammo-runtime.ts';
import { before, test } from 'node:test';
import { Parser } from 'mmd-parser';
import { Matrix4, Texture, Vector3 } from 'three';
import type { AmmoAPI, AmmoBody } from '../src/ammo.js';
import { MMDPhysics } from '../src/animation/MMDPhysics.js';
import { MMDAnimationHelper } from '../src/animation/MMDAnimationHelper.js';
import { MMDLoader } from '../src/loaders/MMDLoader.js';
import { rotationPhysicsBuffer } from './fixtures.ts';
import { ManualWorker } from './manual-physics-worker.ts';
import { ammoMatrix, reflectedRotation, resultMatrix, rotationCases } from './rotation-reference.ts';

const host = globalThis as typeof globalThis & { Ammo: AmmoAPI };
before( async () => { host.Ammo = await initializeAmmo<AmmoAPI>(); } );
function model( format: 'pmd' | 'pmx', angles: number[], type: number, constrained = true, deferred = false ) {

	const parser = new Parser(), buffer = rotationPhysicsBuffer( format, angles, type, constrained );
	const data = format === 'pmd' ? parser.parsePmd( buffer, true ) : parser.parsePmx( buffer, true );
	if ( deferred && 'flag' in data.bones[ 0 ] ) data.bones[ 0 ].flag |= 0x1000;
	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	return loader.meshBuilder.build( data, '' );

}
function near( actual: Matrix4, expected: Matrix4, tolerance = 5e-5 ) {

	actual.elements.forEach( ( v, i ) => assert.ok( Math.abs( v - expected.elements[ i ] ) < tolerance, `${i}: ${v} != ${expected.elements[ i ]}` ) );

}
function offset( angles: number[], position: number[] ) { return reflectedRotation( angles ).setPosition( new Vector3().fromArray( position ) ); }

for ( const format of [ 'pmd', 'pmx' ] as const ) for ( const path of [ 'standalone', 'shared', 'worker' ] ) for ( const type of [ 1, 2 ] ) for ( const fixture of rotationCases ) test( `rigid-body reference ${format} ${path} type=${type} ${fixture.name}`, async t => {

	// Observe real native constructor inputs in every world, including the Worker
	// runtime; nothing replaces Ammo's transforms, constraints or simulation.
	const native: AmmoBody[] = [], frames: Matrix4[][] = [];
	t.mock.method( host.Ammo, 'btRigidBody', class extends host.Ammo.btRigidBody {

		constructor( ...args: ConstructorParameters<AmmoAPI['btRigidBody']> ) { super( ...args ); native.push( this ); }

	} );
	t.mock.method( host.Ammo, 'btGeneric6DofSpringConstraint', class extends host.Ammo.btGeneric6DofSpringConstraint {

		constructor( ...args: ConstructorParameters<AmmoAPI['btGeneric6DofSpringConstraint']> ) {

			frames.push( [ ammoMatrix( args[ 2 ] ), ammoMatrix( args[ 3 ] ) ] ); super( ...args );

		}

	} );
	const worker = new ManualWorker(), meshes = Array.from( { length: path === 'standalone' ? 1 : 2 }, () => model( format, fixture.angles, type ) );
	const physics: MMDPhysics[] = [];
	try {

		for ( const mesh of meshes ) {

			const meta = mesh.geometry.userData.MMD;
			assert.deepEqual( meta.rigidBodies[ 1 ].rotation, [ -Math.fround( fixture.angles[ 0 ] ), -Math.fround( fixture.angles[ 1 ] ), Math.fround( fixture.angles[ 2 ] ) ] );
			assert.equal( meta.rigidBodies[ 1 ].type, type );
			// Both binary formats must produce the same reflected, bone-relative offsets.
			for ( const [ i, position ] of [ [ 0.2, -0.15, -0.25 ], [ 1, 0.5, 0.75 ] ].entries() ) near( new Matrix4().setPosition( new Vector3().fromArray( meta.rigidBodies[ i ].position ) ), new Matrix4().setPosition( new Vector3().fromArray( position ) ) );
			physics.push( new MMDPhysics( mesh, meta.rigidBodies, meta.constraints, { gravity: new Vector3(), world: path === 'shared' ? physics[ 0 ]?.world ?? undefined : undefined, physicsMode: path === 'worker' ? 'worker' : 'sync', workerPhysics: worker.options() }, physics[ 0 ]?.workerAdapter?.group ) );

		}
		worker.start();
		if ( path === 'shared' ) assert.equal( physics[ 0 ].world, physics[ 1 ].world );
		if ( path === 'worker' ) assert.equal( physics[ 0 ].workerAdapter!.group, physics[ 1 ].workerAdapter!.group );
		for ( const [ m, mesh ] of meshes.entries() ) {

			const p = physics[ m ], meta = mesh.geometry.userData.MMD;
			const expected = meta.rigidBodies.map( ( b, i ) => offset( fixture.angles, b.position ).premultiply( mesh.skeleton.bones[ i ].matrixWorld ) );
			for ( let i = 0; i < 2; i ++ ) {

				near( ammoMatrix( native[ m * 2 + i ].getCenterOfMassTransform() ), expected[ i ] );
				near( resultMatrix( p.bodyResults[ i ] ), expected[ i ] );
				if ( ! p.workerAdapter ) near( ammoMatrix( p.bodies[ i ].boneOffsetForm ), offset( fixture.angles, meta.rigidBodies[ i ].position ) );

			}
			// Check both local native frames against the explicit multi-axis YXZ
			// joint world transform, independently of the body-offset convention.
			const joint = reflectedRotation( [ 0.31, -0.47, 0.62 ] ).setPosition( Math.fround( 0.4 ), Math.fround( 0.3 ), -Math.fround( -0.2 ) );
			for ( let i = 0; i < 2; i ++ ) near( frames[ m ][ i ], expected[ i ].clone().invert().multiply( joint ) );
			const difference = Math.max( ...reflectedRotation( fixture.angles ).elements.map( ( v, i ) => Math.abs( v - reflectedRotation( fixture.angles, 'XYZ' ).elements[ i ] ) ) );
			assert.equal( difference > 1e-4, fixture.differs );

		}
		// Reset from a translated, rotated hierarchy; independently compose
		// bone-world * reference-offset, then verify raw Bullet and projection.
		for ( const [ m, mesh ] of meshes.entries() ) {

			mesh.position.set( 2 + m * 10, -1, 0.5 );
			mesh.skeleton.bones[ 0 ].quaternion.setFromAxisAngle( new Vector3( 1, 2, 3 ).normalize(), 0.53 );
			mesh.skeleton.bones[ 1 ].quaternion.setFromAxisAngle( new Vector3( -2, 1, 1 ).normalize(), -0.39 );
			mesh.updateMatrixWorld( true ); physics[ m ].reset();

		}
		if ( path === 'worker' ) { physics[ 0 ].update( 0 ); worker.start(); }
		for ( const [ m, mesh ] of meshes.entries() ) for ( let i = 0; i < 2; i ++ ) {

			const b = mesh.geometry.userData.MMD.rigidBodies[ i ], expected = mesh.skeleton.bones[ i ].matrixWorld.clone().multiply( offset( fixture.angles, b.position ) );
			near( ammoMatrix( native[ m * 2 + i ].getCenterOfMassTransform() ), expected );
			near( resultMatrix( physics[ m ].bodyResults[ i ] ), expected );

		}
		for ( const [ m, mesh ] of meshes.entries() ) {

			const before = mesh.skeleton.bones.map( b => b.matrixWorld.clone() );
			if ( physics[ m ].workerAdapter ) physics[ m ].workerAdapter!.project(); else physics[ m ].update( 0 );
			mesh.skeleton.bones.forEach( ( b, i ) => near( b.matrixWorld, before[ i ] ) );

		}
	} finally {

		for ( const p of physics ) p.dispose(); worker.start();
		for ( const mesh of meshes ) { mesh.geometry.dispose(); mesh.skeleton.dispose(); }

	}

} );

for ( const format of [ 'pmd', 'pmx' ] as const ) for ( const type of [ 1, 2 ] ) for ( const shared of [ false, true ] ) for ( const deferred of [ false, true ] ) test( `mixed-axis constrained warmup/reset/projection ${format} type=${type} shared=${shared} deferred=${deferred}`, async () => {

	const worker = new ManualWorker(), helpers = [ new MMDAnimationHelper( { sync: false } ), new MMDAnimationHelper( { sync: false } ) ];
	for ( const h of helpers ) h.sharedPhysics = shared;
	const models = helpers.map( () => Array.from( { length: shared ? 2 : 1 }, () => model( format, rotationCases[ 4 ].angles, type, true, deferred ) ) );
	try {

		for ( const [ d, h ] of helpers.entries() ) for ( const [ i, mesh ] of models[ d ].entries() ) {

			mesh.position.z = i * 10;
			h.add( mesh, { physicsMode: d === 0 ? 'worker' : 'sync', workerPhysics: worker.options(), gravity: new Vector3(), warmup: 0, animationWarmup: false } );

		}
		worker.start();
		const allPhysics = models.map( ( list, d ) => list.map( mesh => helpers[ d ].objects.get( mesh )!.physics! ) );
		for ( const phase of [ 'motion', 'reset', 'warmup' ] ) {

			if ( phase === 'reset' ) {

				// Supply the same authored reset snapshot to both backends. A Worker
				// display pose can lag the most recent native publication.
				for ( const list of allPhysics ) for ( const p of list ) {

					p.mesh.skeleton.pose(); p.mesh.updateMatrixWorld( true );
					if ( p.poseLayers ) p.poseLayers.capture( p.poseLayers.beforePhysics );
					p.reset();

				}
				allPhysics[ 0 ][ 0 ].workerAdapter!.group.update( 0 ); worker.start();

			}
			if ( phase === 'warmup' ) {

				for ( const list of allPhysics ) for ( const p of list ) p.warmup( 2 );
				await Promise.resolve();
				// Drain warmup requests scheduled by completed warmup publications.
				while ( worker.requests.length || worker.responses.length ) worker.start();

			}
			for ( let frame = 0; frame < 8; frame ++ ) {

				for ( const h of helpers ) h.onBeforePhysics = mesh => {

					mesh.skeleton.bones[ 0 ].position.x = frame * 0.002;
					mesh.skeleton.bones[ 0 ].quaternion.setFromAxisAngle( new Vector3( 1, 2, -1 ).normalize(), frame * 0.003 ); mesh.updateMatrixWorld( true );

				};
				for ( const h of helpers ) h.update( 1 / 60 ); worker.start();
				if ( format === 'pmx' ) for ( const h of helpers ) h.update( 0 );
				for ( const [ i, p ] of allPhysics[ 0 ].entries() ) {

					p.workerAdapter!.project(); const ref = allPhysics[ 1 ][ i ];
					if ( format === 'pmx' && deferred ) {

						const expected = models[ 0 ][ i ].skeleton.bones[ 0 ].matrixWorld.clone().multiply( offset( rotationCases[ 4 ].angles, p.workerAdapter!.model.bodies[ 0 ].position ) );
						const snapshot = new Float64Array( 16 + 2 * 7 + 2 * 7 ); p.workerAdapter!.capture( snapshot, 0 );
						near( resultMatrix( { position: Array.from( snapshot.slice( 30, 33 ) ), quaternion: Array.from( snapshot.slice( 33, 37 ) ) } ), expected );
						near( resultMatrix( ref.bodies[ 0 ].getDeferredPose()! ), expected );

					}
					for ( let b = 0; b < 2; b ++ ) {

						try { near( resultMatrix( p.bodyResults[ b ] ), resultMatrix( ref.bodyResults[ b ] ), 5e-4 ); } catch ( error ) { throw new Error( `${phase} frame=${frame} body=${b}`, { cause: error } ); }
						const mesh = models[ 0 ][ i ], bone = mesh.skeleton.bones[ b ];
						near( bone.matrixWorld, models[ 1 ][ i ].skeleton.bones[ b ].matrixWorld, 5e-4 );
						if ( b === 1 ) {

							const projected = resultMatrix( p.bodyResults[ b ] ).multiply( offset( rotationCases[ 4 ].angles, mesh.geometry.userData.MMD.rigidBodies[ b ].position ).invert() );
							if ( type === 2 ) projected.setPosition( bone.getWorldPosition( new Vector3() ) );
							near( bone.matrixWorld, projected, 5e-4 );

						}

					}

				}

			}

		}
	} finally {

		for ( const [ d, h ] of helpers.entries() ) for ( const mesh of models[ d ] ) h.remove( mesh ); worker.start();
		for ( const mesh of models.flat() ) { mesh.geometry.dispose(); mesh.skeleton.dispose(); }

	}

} );
