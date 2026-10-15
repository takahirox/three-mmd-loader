import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { before, test } from 'node:test';
import { Parser } from 'mmd-parser';
import { Texture, Vector3 } from 'three';
import type { AmmoAPI, AmmoBody, AmmoWorld } from '../src/ammo.js';
import { MMDAnimationHelper } from '../src/animation/MMDAnimationHelper.js';
import { MMDPhysics } from '../src/animation/MMDPhysics.js';
import { PhysicsWorkerRuntime } from '../src/animation/PhysicsWorkerRuntime.js';
import { inputLength, outputLength } from '../src/animation/PhysicsWorkerProtocol.js';
import type { PhysicsModel } from '../src/animation/PhysicsWorkerProtocol.js';
import { MMDLoader } from '../src/loaders/MMDLoader.js';
import { linkedCollisionBuffer } from './fixtures.ts';

// Test-only native inspection; all allocation, filtering and solving use Ammo.
interface NativeWorld extends AmmoWorld {
	getDispatcher(): {
		getNumManifolds(): number;
		getManifoldByIndexInternal( index: number ): {
			getNumContacts(): number;
			getContactPoint( index: number ): { getDistance(): number; getAppliedImpulse(): number };
		};
	};
}
type NativeAmmo = Omit<AmmoAPI, 'btDiscreteDynamicsWorld'> & {
	btDiscreteDynamicsWorld: new ( ...args: ConstructorParameters<AmmoAPI['btDiscreteDynamicsWorld']> ) => NativeWorld;
};
const host = globalThis as typeof globalThis & { Ammo: NativeAmmo };
before( async () => { host.Ammo = await ( createRequire( import.meta.url )( 'ammojs-typed' ) as () => Promise<NativeAmmo> )(); } );

const cases = [
	{ name: 'linked, both masks allow', linked: true, masks: [ 128, 4 ], contact: true },
	{ name: 'linked, anchor mask rejects', linked: true, masks: [ 4, 4 ], contact: false },
	{ name: 'linked, probe mask rejects', linked: true, masks: [ 128, 128 ], contact: false },
	{ name: 'unlinked contact control', linked: false, masks: [ 128, 4 ], contact: true },
	{ name: 'unlinked mask control', linked: false, masks: [ 0, 0 ], contact: false },
	{ name: 'linked non-contact joint solving', linked: true, masks: [ 0, 0 ], contact: false, drive: true },
	{ name: 'unlinked non-contact free-motion control', linked: false, masks: [ 0, 0 ], contact: false, drive: true }
];

for ( const format of [ 'pmd', 'pmx' ] as const ) for ( const path of [ 'sync', 'shared sync', 'worker runtime' ] ) for ( const fixture of cases ) test( `real Ammo ${format} ${path}: ${fixture.name}`, t => {

	const ammo = host.Ammo, worlds: NativeWorld[] = [], bodies: AmmoBody[] = [];
	// Observe native wrappers without replacing their behavior or accessing the
	// runtime's private model map. Shared sync must construct exactly one world.
	t.mock.method( ammo, 'btDiscreteDynamicsWorld', class extends ammo.btDiscreteDynamicsWorld {

		constructor( ...args: ConstructorParameters<NativeAmmo['btDiscreteDynamicsWorld']> ) { super( ...args ); worlds.push( this ); }

	} );
	t.mock.method( ammo, 'btRigidBody', class extends ammo.btRigidBody {

		constructor( info: ConstructorParameters<AmmoAPI['btRigidBody']>[0] ) { super( info ); bodies.push( this ); }

	} );
	const parser = new Parser(), buffer = linkedCollisionBuffer( format, fixture );
	const data = format === 'pmd' ? parser.parsePmd( buffer, true ) : parser.parsePmx( buffer, true );
	assert.deepEqual( data.rigidBodies.map( b => [ b.groupIndex, b.groupTarget ] ), [ [ 2, fixture.masks[ 0 ] ], [ 7, fixture.masks[ 1 ] ] ] );
	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	const meshes = Array.from( { length: path === 'shared sync' ? 2 : 1 }, ( _, i ) => {

		const mesh = loader.meshBuilder.build( data, '' ); mesh.position.z = i * 20; mesh.updateMatrixWorld( true ); return mesh;

	} );
	const mesh = meshes[ 0 ], meta = mesh.geometry.userData.MMD;
	assert.deepEqual( meta.rigidBodies.map( b => [ b.groupIndex, b.groupTarget ] ), data.rigidBodies.map( b => [ b.groupIndex, b.groupTarget ] ) );
	assert.deepEqual( meta.rigidBodies.map( b => b.type ), [ 0, 1 ] );
	assert.equal( meta.constraints.length, fixture.linked ? 1 : 0 );
	const helper = new MMDAnimationHelper( { sync: false } ); helper.sharedPhysics = true;
	const runtime = new PhysicsWorkerRuntime( response => assert.ok( response.type === 'added' || response.type === 'result' ) );
	const model: PhysicsModel = {
		id: 1, format, bones: meta.bones,
		rest: mesh.skeleton.bones.flatMap( b => [ ...b.position.toArray(), ...b.quaternion.toArray() ] ),
		bodies: meta.rigidBodies, constraints: meta.constraints, unitStep: 1 / 65, maxStepNum: 3, gravity: [ 0, 0, 0 ]
	};
	let physics: MMDPhysics | undefined, peakContactPairs = 0, peakImpulsePairs = 0;
	try {

		if ( path === 'worker runtime' ) runtime.handle( { type: 'add', model } );
		else if ( path === 'shared sync' ) {

			for ( const mesh of meshes ) helper.add( mesh, { warmup: 0, animationWarmup: false, gravity: new Vector3() } );
			assert.equal( helper.objects.get( meshes[ 0 ] )!.physics!.world, helper.objects.get( meshes[ 1 ] )!.physics!.world );

		} else physics = new MMDPhysics( mesh, meta.rigidBodies, meta.constraints, { gravity: new Vector3() } );
		assert.equal( worlds.length, 1 ); assert.equal( bodies.length, meshes.length * 2 );
		const velocity = new ammo.btVector3( 0, fixture.drive ? 1 : 0, 0 );
		for ( let i = 1; i < bodies.length; i += 2 ) bodies[ i ].setLinearVelocity!( velocity );
		ammo.destroy?.( velocity );
		for ( let frame = 1; frame <= 24; frame ++ ) {

			if ( path === 'worker runtime' ) {

				const frameData = new Float64Array( inputLength( model ) + outputLength( model ) );
				frameData.set( mesh.matrixWorld.elements ); frameData.set( model.rest, 16 );
				frameData.fill( NaN, 16 + model.rest.length, inputLength( model ) );
				runtime.handle( { type: 'frame', generation: 0, sequence: frame, delta: 1 / 65, models: [ { id: 1, reset: false, staged: false } ], buffer: frameData.buffer } );
				assert.ok( frameData.subarray( inputLength( model ) ).every( Number.isFinite ), 'Worker publishes finite native body poses' );

			} else if ( path === 'shared sync' ) helper.update( 1 / 65 );
			else physics!.update( 1 / 65 );
			const dispatcher = worlds[ 0 ].getDispatcher();
			let contactPairs = 0, impulsePairs = 0;
			for ( let i = 0; i < dispatcher.getNumManifolds(); i ++ ) {

				const manifold = dispatcher.getManifoldByIndexInternal( i );
				let contact = false, impulse = false;
				for ( let j = 0; j < manifold.getNumContacts(); j ++ ) {

					const point = manifold.getContactPoint( j );
					contact ||= point.getDistance() <= 0; impulse ||= point.getAppliedImpulse() > 0;

				}
				if ( contact ) contactPairs ++; if ( impulse ) impulsePairs ++;

			}
			peakContactPairs = Math.max( peakContactPairs, contactPairs );
			peakImpulsePairs = Math.max( peakImpulsePairs, impulsePairs );

		}
		assert.equal( peakContactPairs, fixture.contact ? meshes.length : 0, 'native penetrating contact pairs' );
		assert.equal( peakImpulsePairs, fixture.contact ? meshes.length : 0, 'native contact solver impulses' );
		for ( let i = 1; i < bodies.length; i += 2 ) {

			const origin = bodies[ i ].getCenterOfMassTransform().getOrigin();
			assert.ok( [ origin.x(), origin.y(), origin.z() ].every( Number.isFinite ) );
			if ( fixture.contact ) assert.ok( origin.x() > 0.95, 'contact separates the overlapping spheres along free X' );
			else assert.ok( Math.abs( origin.x() - 0.75 ) < 1e-5, 'no contact separation when masks reject' );
			if ( fixture.drive ) {

				if ( fixture.linked ) assert.ok( Math.abs( origin.y() ) < 1e-5, 'joint still locks Y without any contact' );
				else assert.ok( origin.y() > 0.3, 'unlinked probe moves freely under the identical drive' );

			}

		}

	} finally {

		physics?.dispose(); for ( const mesh of [ ...helper.meshes ] ) helper.remove( mesh );
		runtime.handle( { type: 'remove', id: 1 } );
		for ( const mesh of meshes ) { mesh.geometry.dispose(); mesh.skeleton.dispose(); }

	}

} );
