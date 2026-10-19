import assert from 'node:assert/strict';
import { initializeAmmo } from './ammo-runtime.ts';
import { before, test } from 'node:test';
import { Parser } from 'mmd-parser';
import { Texture, Vector3 } from 'three';
import type { AmmoAPI, AmmoBody, AmmoBodyInfo } from '../src/ammo.js';
import { MMDAnimationHelper } from '../src/animation/MMDAnimationHelper.js';
import { MMDPhysics } from '../src/animation/MMDPhysics.js';
import { PhysicsWorkerRuntime } from '../src/animation/PhysicsWorkerRuntime.js';
import { MMDLoader } from '../src/loaders/MMDLoader.js';
import { dampingPhysicsBuffer } from './fixtures.ts';

// Test-only native getters, following the library's structural Ammo typing.
interface NativeInfo extends AmmoBodyInfo {
	get_m_additionalDamping(): boolean;
	get_m_additionalDampingFactor(): number;
	get_m_additionalLinearDampingThresholdSqr(): number;
	get_m_additionalAngularDampingThresholdSqr(): number;
	get_m_additionalAngularDampingFactor(): number;
	get_m_friction(): number;
	get_m_restitution(): number;
}
interface NativeBody extends AmmoBody {
	getLinearDamping(): number;
	getAngularDamping(): number;
}
type NativeAmmo = Omit<AmmoAPI, 'btRigidBodyConstructionInfo' | 'btRigidBody'> & {
	btRigidBodyConstructionInfo: new ( ...args: ConstructorParameters<AmmoAPI['btRigidBodyConstructionInfo']> ) => NativeInfo;
	btRigidBody: new ( info: NativeInfo ) => NativeBody;
};
const host = globalThis as typeof globalThis & { Ammo: NativeAmmo };
before( async () => { host.Ammo = await initializeAmmo<NativeAmmo>(); } );

function additionalDefaults( info: NativeInfo ) {

	return [ info.get_m_additionalDampingFactor(), info.get_m_additionalLinearDampingThresholdSqr(),
		info.get_m_additionalAngularDampingThresholdSqr(), info.get_m_additionalAngularDampingFactor() ];

}

for ( const format of [ 'pmd', 'pmx' ] as const ) for ( const path of [ 'sync', 'shared sync', 'worker runtime' ] ) test( `real Ammo ${format} ${path} enables additional damping before native construction`, t => {

	const ammo = host.Ammo, defaults = new WeakMap<NativeInfo, number[]>();
	const bodies: NativeBody[] = [];
	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	const parser = new Parser(), buffer = dampingPhysicsBuffer( format );
	const data = format === 'pmd' ? parser.parsePmd( buffer, true ) : parser.parsePmx( buffer, true );
	const mesh = loader.meshBuilder.build( data, '' ), meta = mesh.geometry.userData.MMD;
	assert.deepEqual( meta.rigidBodies.map( body => body.type ), [ 0, 1, 2 ] );
	assert.deepEqual( meta.rigidBodies.map( body => body.shapeType ), [ 0, 1, 2 ] );
	const expected = path === 'shared sync' ? [ ...meta.rigidBodies, ...meta.rigidBodies ] : meta.rigidBodies;

	// Subclass only the JS wrappers: allocation, setters, getters and simulation
	// still run in the pinned official Bullet native runtime.
	t.mock.method( ammo, 'btRigidBodyConstructionInfo', class extends ammo.btRigidBodyConstructionInfo {

		constructor( ...args: ConstructorParameters<NativeAmmo['btRigidBodyConstructionInfo']> ) {

			super( ...args );
			assert.equal( this.get_m_additionalDamping(), false, 'native default starts disabled' );
			defaults.set( this, additionalDefaults( this ) );

		}

	} );
	t.mock.method( ammo, 'btRigidBody', class extends ammo.btRigidBody {

		constructor( info: NativeInfo ) {

			const params = expected[ bodies.length ];
			assert.equal( info.get_m_additionalDamping(), true, 'flag must be set before btRigidBody copies construction info' );
			assert.deepEqual( additionalDefaults( info ), defaults.get( info ), 'Bullet factors and thresholds remain unchanged' );
			assert.equal( info.get_m_friction(), params.friction );
			assert.equal( info.get_m_restitution(), params.restitution );
			super( info ); bodies.push( this );

		}

	} );

	const helper = new MMDAnimationHelper( { sync: false } );
	const runtime = new PhysicsWorkerRuntime( response => assert.equal( response.type, 'added' ) );
	let physics: MMDPhysics | undefined;
	try {

		if ( path === 'worker runtime' ) {

			runtime.handle( { type: 'add', model: {
				id: 1, format, bones: meta.bones,
				rest: mesh.skeleton.bones.flatMap( bone => [ ...bone.position.toArray(), ...bone.quaternion.toArray() ] ),
				bodies: meta.rigidBodies, constraints: meta.constraints, unitStep: 1 / 65, maxStepNum: 3, gravity: [ 0, 0, 0 ]
			} } );

		} else if ( path === 'shared sync' ) {

			helper.sharedPhysics = true;
			const second = loader.meshBuilder.build( data, '' ); second.position.z = 20;
			for ( const model of [ mesh, second ] ) helper.add( model, { warmup: 0, animationWarmup: false, gravity: new Vector3() } );
			assert.equal( helper.objects.get( mesh )!.physics!.world, helper.objects.get( second )!.physics!.world );

		} else physics = new MMDPhysics( mesh, meta.rigidBodies, meta.constraints );

		assert.equal( bodies.length, expected.length );
		for ( const [ i, body ] of bodies.entries() ) {

			assert.equal( body.getLinearDamping(), expected[ i ].positionDamping, 'model linear damping retained' );
			assert.equal( body.getAngularDamping(), expected[ i ].rotationDamping, 'model angular damping retained' );
			assert.equal( body.getCollisionFlags() & 2, expected[ i ].type === 0 ? 2 : 0 );

		}

	} finally {

		physics?.dispose();
		for ( const model of [ ...helper.meshes ] ) helper.remove( model );
		runtime.handle( { type: 'remove', id: 1 } );

	}

} );
