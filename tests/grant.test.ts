import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { Parser } from 'mmd-parser';
import type { Vpd } from 'mmd-parser';
import { Texture, Vector3 } from 'three';
import { MMDAnimationHelper, MMDLoader } from 'three-mmd-loader';
import type { AmmoAPI, MMDMesh } from 'three-mmd-loader';
import { grantPmxBuffer, vmdBuffer } from './fixtures.ts';
import { accumulated, authoredGrantPose, identity, power, referenceGrants, rotate } from './grant-reference.ts';
import type { Pose } from './grant-reference.ts';
import { product } from './bone-morph-reference.ts';

const emptyPose = { metadata: { boneCount: 0, parentFile: '', coordinateSystem: 'right' as const }, bones: [] };
function setup() {

	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	const data = new Parser().parsePmx( grantPmxBuffer(), true );
	return { mesh: loader.meshBuilder.build( data, '' ), data, loader };

}
const snapshot = ( mesh: MMDMesh ) => mesh.skeleton.bones.map( b => ( { position: b.position.toArray(), rotation: b.quaternion.toArray() } ) );
function write( mesh: MMDMesh, pose: Pose[] ) {

	mesh.skeleton.bones.forEach( ( b, i ) => { b.position.fromArray( pose[ i ].position ); b.quaternion.fromArray( pose[ i ].rotation ); } );

}
function near( a: number[], b: number[], tolerance = 1e-5 ) {

	a.forEach( ( v, c ) => assert.ok( Math.abs( v - b[ c ] ) < tolerance, `${a} != ${b}` ) );

}
function check( mesh: MMDMesh, expected: Pose[] ) {

	mesh.skeleton.bones.forEach( ( b, i ) => {

		near( b.position.toArray(), expected[ i ].position );
		const q = b.quaternion.toArray(), e = expected[ i ].rotation;
		near( q, e.map( v => q.reduce( ( n, x, c ) => n + x * e[ c ], 0 ) < 0 ? - v : v ) );

	} );

}

test( 'released parser preserves all four grant flags, combined flags, classes, signed ratios and phases', () => {

	const { mesh, data } = setup();
	assert.equal( mesh.geometry.userData.MMD.grants.length, 6 );
	for ( const b of mesh.geometry.userData.MMD.bones ) {

		assert.equal( b.flag, data.bones[ b.index ].flag );
		assert.equal( b.transformationClass, data.bones[ b.index ].transformationClass );
		if ( b.grant ) assert.deepEqual( b.grant, { index: b.index, ...data.bones[ b.index ].grant, transformationClass: b.transformationClass } );

	}
	assert.deepEqual( mesh.geometry.userData.MMD.grants.map( g => [ g.isLocal, g.affectRotation, g.affectPosition ] ), [ [ false, true, true ], [ true, true, false ], [ false, false, true ], [ true, false, true ], [ true, true, true ], [ false, true, false ] ] );

} );

for ( const pmxAnimation of [ false, true ] ) {

	for ( const strength of [ 0, 0.25, 1, - 0.5, 1.5 ] ) for ( const ratio of [ 0, 0.25, 1, - 0.5, 1.5 ] ) test( `scalar grant reference and BDEF palette strength=${strength}, ratio=${ratio}, pmx=${pmxAnimation}`, () => {

		const { mesh } = setup(), metadata = mesh.geometry.userData.MMD;
		for ( const g of metadata.grants ) g.ratio = ratio;
		const base = authoredGrantPose( metadata.bones, strength ); write( mesh, base );
		// Scene translation/rotation/scale must not become local append input.
		mesh.position.set( 2, - 3, 4 ); mesh.rotation.set( 0.3, - 0.7, 0.2 ); mesh.scale.setScalar( 1.3 );
		const helper = new MMDAnimationHelper( { pmxAnimation } ); helper.add( mesh, { physics: false } );
		const expected = referenceGrants( metadata.bones, base );
		for ( let i = 0; i < 4; i ++ ) { helper.update( 0 ); check( mesh, expected ); }
		// Palette is model-space; compare actual mesh CPU skinning, not only bones.
		mesh.position.set( 0, 0, 0 ); mesh.quaternion.identity(); mesh.scale.setScalar( 1 ); mesh.updateMatrixWorld( true ); mesh.skeleton.update();
		const vertex = new Vector3().fromBufferAttribute( mesh.geometry.attributes.position, 9 );
		const rest = metadata.bones.map( b => ( { position: b.pos, rotation: identity() } ) );
		const source = accumulated( metadata.bones, expected, 0 ), origin = accumulated( metadata.bones, rest, 0 );
		near( mesh.applyBoneTransform( 9, vertex.clone() ).toArray(), rotate( source.rotation, vertex.toArray().map( ( v, c ) => v - origin.position[ c ] ) ).map( ( v, c ) => v + source.position[ c ] ) );
		helper.enable( 'grant', false ).update( 0 ); check( mesh, base );
		helper.enable( 'grant', true ).update( 0 ); check( mesh, expected );
		helper.remove( mesh ); check( mesh, base );
		const second = new MMDAnimationHelper( { pmxAnimation: ! pmxAnimation } ); second.add( mesh, { physics: false } ).update( 0 ); check( mesh, expected );

	} );

	test( `VMD, direct/group morphs, pause/play, seek, loop and VPD restoration pmx=${pmxAnimation}`, () => {

		const { mesh, loader } = setup();
		const meta = mesh.geometry.userData.MMD;
		const motion = new Parser().parseVmd( vmdBuffer( { boneName: 'bone6' } ), true );
		const clip = loader.animationBuilder.build( motion, mesh );
		const helper = new MMDAnimationHelper( { pmxAnimation, sync: false } ); helper.add( mesh, { animation: clip, physics: false } );
		const mixer = helper.objects.get( mesh )!.mixer!, action = mixer.clipAction( clip );
		mesh.morphTargetInfluences![ 1 ] = 0.3; mesh.morphTargetInfluences![ 4 ] = 0.4;
		for ( const time of [ 0.5, 0.2, 0.8, 0, 0.5 ] ) {

			mixer.setTime( time );
			const base = meta.bones.map( b => ( { position: b.pos.slice(), rotation: identity() } ) );
			base[ 6 ].position[ 0 ] += 2 * time;
			for ( const e of meta.boneMorphs![ 0 ].elements ) {

				base[ e.index ].position = base[ e.index ].position.map( ( v, c ) => v + e.position[ c ] * 0.6 );
				base[ e.index ].rotation = product( power( e.rotation, 0.6 ), base[ e.index ].rotation );

			}
			const expected = referenceGrants( meta.bones, base );
			for ( let i = 0; i < 4; i ++ ) { helper.update( 0 ); check( mesh, expected ); }
			action.paused = true; helper.update( 0.3 ); check( mesh, expected ); action.paused = false;

		}
		helper.update( 0.7 ); const looping = snapshot( mesh ); helper.update( 0 ); check( mesh, looping );
		action.stop(); action.reset().play(); helper.update( 0 ); const restarting = snapshot( mesh ); helper.update( 0 ); check( mesh, restarting );
		helper.remove( mesh ); mesh.morphTargetInfluences!.fill( 0 );
		const pose: Vpd = { ...emptyPose, bones: [ { name: 'bone6', translation: [ 0.2, 0.3, 0.4 ], quaternion: power( [ 0.2, 0.3, 0, Math.sqrt( 0.87 ) ], 1 ) as [ number, number, number, number ] } ] };
		const base = meta.bones.map( b => ( { position: b.pos.slice(), rotation: identity() } ) ); base[ 6 ].position = base[ 6 ].position.map( ( v, c ) => v + pose.bones[ 0 ].translation[ c ] ); base[ 6 ].rotation = pose.bones[ 0 ].quaternion;
		for ( let i = 0; i < 4; i ++ ) { helper.pose( mesh, pose, { ik: false } ); check( mesh, referenceGrants( meta.bones, base ) ); }
		helper.pose( mesh, emptyPose, { ik: false } ); check( mesh, meta.bones.map( b => ( { position: b.pos, rotation: identity() } ) ) );

	} );

	test( `invalid indices, self/cyclic grants and nonfinite/overflow input are isolated pmx=${pmxAnimation}`, () => {

		for ( const variant of [ 'missing', 'fractional', 'self', 'cycle', 'nan', 'infinity', 'overflow', 'sourceNaN', 'zeroQuaternion', 'descendant' ] ) {

			const { mesh } = setup(), meta = mesh.geometry.userData.MMD;
			const bad = meta.bones[ 1 ].grant!;
			if ( variant === 'missing' ) bad.parentIndex = 200;
			if ( variant === 'fractional' ) bad.parentIndex = 1.5;
			if ( variant === 'self' ) bad.parentIndex = 1;
			if ( variant === 'cycle' ) { bad.parentIndex = 3; meta.bones[ 3 ].grant!.parentIndex = 1; }
			if ( variant === 'nan' ) bad.ratio = NaN;
			if ( variant === 'infinity' ) bad.ratio = Infinity;
			if ( variant === 'overflow' ) { bad.affectPosition = true; bad.isLocal = false; bad.ratio = Number.MAX_VALUE; }
			if ( variant === 'descendant' ) { bad.parentIndex = 6; meta.bones[ 6 ].parent = 1; mesh.skeleton.bones[ 1 ].add( mesh.skeleton.bones[ 6 ] ); }
			const base = authoredGrantPose( meta.bones, 1 ); write( mesh, base );
			if ( variant === 'sourceNaN' ) mesh.skeleton.bones[ 6 ].quaternion.x = NaN;
			if ( variant === 'zeroQuaternion' ) mesh.skeleton.bones[ 6 ].quaternion.set( 0, 0, 0, 0 );
			if ( variant === 'overflow' ) mesh.skeleton.bones[ 6 ].position.setScalar( Number.MAX_VALUE );
			const helper = new MMDAnimationHelper( { pmxAnimation } ); helper.add( mesh, { physics: false } ).update( 0 );
			near( mesh.skeleton.bones[ 1 ].quaternion.toArray(), base[ 1 ].rotation );
			near( mesh.skeleton.bones[ 5 ].position.toArray(), base[ 5 ].position );
			assert.ok( mesh.skeleton.bones[ 1 ].position.toArray().every( Number.isFinite ) );

		}

	} );
}

for ( const pmxAnimation of [ false, true ] ) {

	test( `transformation classes govern IK reference timing in grant-only PMX, pmx=${pmxAnimation}`, () => {

		for ( const grantClass of [ 0, 2 ] ) {

			const { data, loader } = setup();
			data.morphs = []; data.metadata.morphCount = 0;
			for ( const b of data.bones ) { delete b.grant; b.parentIndex = - 1; b.transformationClass = 0; b.flag = 0; }
			data.bones[ 0 ].position = [ 0, 0, 0 ]; data.bones[ 1 ].position = [ 0, 1, 0 ]; data.bones[ 1 ].parentIndex = 0;
			data.bones[ 2 ].position = [ 1, 0, 0 ]; data.bones[ 2 ].transformationClass = 1;
			data.bones[ 2 ].ik = { target: null, effector: 1, iteration: 20, maxAngle: 0.5, linkCount: 1, links: [ { index: 0, angleLimitation: 0 } ] };
			data.bones[ 3 ].transformationClass = grantClass;
			data.bones[ 3 ].grant = { parentIndex: 0, ratio: 0.5, isLocal: false, affectRotation: true, affectPosition: true };
			const mesh = loader.meshBuilder.build( data, '' ), helper = new MMDAnimationHelper( { pmxAnimation } );
			helper.add( mesh, { physics: false } ); helper.update( 0 );
			near( mesh.skeleton.bones[ 1 ].getWorldPosition( new Vector3() ).toArray(), [ 1, 0, 0 ] );
			near( mesh.skeleton.bones[ 3 ].quaternion.toArray(), grantClass === 0 ? identity() : [ 0, 0, - Math.sin( Math.PI / 8 ), Math.cos( Math.PI / 8 ) ] );
			const first = snapshot( mesh ); for ( let i = 0; i < 20; i ++ ) { helper.update( 0 ); check( mesh, first ); }

		}

	} );

	test( `real Ammo pre/post grants and kinematic/dynamic targets, shared and individual physics, pmx=${pmxAnimation}`, async () => {

		const ammoGlobal = globalThis as typeof globalThis & { Ammo?: AmmoAPI };
		ammoGlobal.Ammo = await ( createRequire( import.meta.url )( 'ammojs-typed' ) as () => Promise<AmmoAPI> )();
		try {

			for ( const shared of [ false, true ] ) {

				const { data, loader } = setup();
				for ( const b of data.bones ) { delete b.grant; b.parentIndex = - 1; b.flag = 0; }
				// A dynamic source is moved by physics; only post local grants see
				// its same-frame result. Pre kinematic targets follow authored input.
				for ( const index of [ 0, 1, 2, 3, 4 ] ) {

					data.bones[ index ].grant = { parentIndex: 6, ratio: 0.5, isLocal: true, affectRotation: true, affectPosition: true };
					data.bones[ index ].transformationClass = 3;

				}
				data.bones[ 1 ].flag = data.bones[ 3 ].flag = data.bones[ 4 ].flag = 0x1000;
				data.bones[ 4 ].grant!.isLocal = false;
				data.rigidBodies = [ [ 6, 1 ], [ 0, 0 ], [ 2, 1 ], [ 3, 1 ] ].map( ( [ boneIndex, type ], i ) => ( { name: `body${i}`, englishName: '', boneIndex, type, shapeType: 0, width: 0.01, height: 0.01, depth: 0.01, position: data.bones[ boneIndex ].position.slice() as [ number, number, number ], rotation: [ 0, 0, 0 ], weight: type, friction: 0.5, restitution: 0, positionDamping: 0, rotationDamping: 0, groupIndex: i, groupTarget: 0 } ) );
				data.metadata.rigidBodyCount = data.rigidBodies.length;
				const mesh = loader.meshBuilder.build( data, '' ), helper = new MMDAnimationHelper( { pmxAnimation } ); helper.sharedPhysics = shared;
				helper.add( mesh, { warmup: 0, animationWarmup: false, gravity: new Vector3( 0, 0, 0 ) } );
				const physics = helper.objects.get( mesh )!.physics!;
				const transform = physics.bodies[ 0 ].body.getCenterOfMassTransform();
				transform.getOrigin().setValue( 1.2, 0.3, 0.4 );
				const rotation = transform.getRotation(); rotation.setX( 0 ); rotation.setY( 0 ); rotation.setZ( Math.sin( 0.3 ) ); rotation.setW( Math.cos( 0.3 ) ); transform.setRotation( rotation ); physics.bodies[ 0 ].body.setCenterOfMassTransform( transform );
				const rest = mesh.geometry.userData.MMD.bones.map( b => b.pos.slice() );
				mesh.skeleton.bones[ 6 ].position.add( new Vector3( 0.4, 0.2, 0.1 ) );
				helper.update( 1 / 60 );
				near( mesh.skeleton.bones[ 0 ].position.toArray(), rest[ 0 ].map( ( v, c ) => v + [ 0.4, 0.2, 0.1 ][ c ] * 0.5 ) );
				near( mesh.skeleton.bones[ 2 ].position.toArray(), rest[ 2 ] );
				near( mesh.skeleton.bones[ 3 ].position.toArray(), rest[ 3 ].map( ( v, c ) => v + ( [ 1.2, 0.3, 0.4 ][ c ] - rest[ 6 ][ c ] ) * 0.5 ) );
				const rawDynamic = physics.bodies[ 3 ].body.getCenterOfMassTransform().getOrigin();
				near( [ rawDynamic.x(), rawDynamic.y(), rawDynamic.z() ], rest[ 3 ] );
				near( mesh.skeleton.bones[ 4 ].position.toArray(), rest[ 4 ].map( ( v, c ) => v + [ 0.4, 0.2, 0.1 ][ c ] * 0.5 ) );
				const expectedPost = rest[ 1 ].map( ( v, c ) => v + ( [ 1.2, 0.3, 0.4 ][ c ] - rest[ 6 ][ c ] ) * 0.5 );
				near( mesh.skeleton.bones[ 1 ].position.toArray(), expectedPost );
				near( mesh.skeleton.bones[ 1 ].quaternion.toArray(), [ 0, 0, Math.sin( 0.15 ), Math.cos( 0.15 ) ] );
				near( mesh.skeleton.bones[ 4 ].quaternion.toArray(), identity() );
				const origin = physics.bodies[ 1 ].body.getCenterOfMassTransform().getOrigin();
				near( [ origin.x(), origin.y(), origin.z() ], mesh.skeleton.bones[ 0 ].position.toArray() );
				for ( let i = 0; i < 10; i ++ ) { helper.update( 0 ); near( mesh.skeleton.bones[ 1 ].position.toArray(), expectedPost ); }
				helper.enable( 'physics', false ).update( 0 );
				near( mesh.skeleton.bones[ 1 ].position.toArray(), rest[ 1 ].map( ( v, c ) => v + [ 0.4, 0.2, 0.1 ][ c ] * 0.5 ) );

			}

		} finally { delete ammoGlobal.Ammo; }

	} );
}

test( 'after-physics kinematic grant is deferred to the next simulation step', async () => {

	const ammoGlobal = globalThis as typeof globalThis & { Ammo?: AmmoAPI };
	ammoGlobal.Ammo = await ( createRequire( import.meta.url )( 'ammojs-typed' ) as () => Promise<AmmoAPI> )();
	try {

		const { data, loader } = setup();
		for ( const b of data.bones ) { delete b.grant; b.parentIndex = - 1; b.flag = 0; }
		data.bones[ 0 ].flag = 0x1000;
		data.bones[ 0 ].grant = { parentIndex: 6, ratio: 1, isLocal: true, affectPosition: true, affectRotation: false };
		data.rigidBodies = [ { name: 'post kinematic', englishName: '', boneIndex: 0, type: 0, shapeType: 0, width: 0.01, height: 0.01, depth: 0.01, position: data.bones[ 0 ].position.slice() as [ number, number, number ], rotation: [ 0, 0, 0 ], weight: 0, friction: 0.5, restitution: 0, positionDamping: 0, rotationDamping: 0, groupIndex: 0, groupTarget: 0 } ];
		data.metadata.rigidBodyCount = 1;
		const mesh = loader.meshBuilder.build( data, '' ), helper = new MMDAnimationHelper();
		helper.add( mesh, { warmup: 0, animationWarmup: false } );
		mesh.skeleton.bones[ 6 ].position.x += 1;
		helper.update( 0 );
		const origin = helper.objects.get( mesh )!.physics!.bodies[ 0 ].body.getCenterOfMassTransform().getOrigin();
		assert.ok( Math.abs( mesh.skeleton.bones[ 0 ].position.x - origin.x() - 1 ) < 1e-5 );
		// The completed step stays at its input, while the next step consumes
		// the FULL preceding post pose (authored plus grant), not a partial pose.
		helper.update( 1 / 60 );
		const next = helper.objects.get( mesh )!.physics!.bodies[ 0 ].body.getCenterOfMassTransform().getOrigin();
		assert.ok( Math.abs( mesh.skeleton.bones[ 0 ].position.x - next.x() ) < 1e-5 );

	} finally { delete ammoGlobal.Ammo; }

} );

for ( const pmxAnimation of [ false, true ] ) for ( const parentIndex of [ 4, 6, - 1 ] ) test( `local grants with same-parent, child and independent targets parent=${parentIndex}, pmx=${pmxAnimation}`, () => {

	const { data, loader } = setup();
	data.bones[ 1 ].parentIndex = parentIndex;
	const mesh = loader.meshBuilder.build( data, '' ), meta = mesh.geometry.userData.MMD;
	const base = authoredGrantPose( meta.bones, 0.7 ); write( mesh, base );
	const helper = new MMDAnimationHelper( { pmxAnimation } ); helper.add( mesh, { physics: false } ).update( 0 );
	check( mesh, referenceGrants( meta.bones, base ) );

} );
