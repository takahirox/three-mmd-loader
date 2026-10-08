import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { Parser } from 'mmd-parser';
import type { Pmx, Vpd } from 'mmd-parser';
import { LoopOnce, Quaternion, Texture, Vector3 } from 'three';
import { MMDAnimationHelper, MMDLoader } from 'three-mmd-loader';
import type { AmmoAPI, MMDMesh } from 'three-mmd-loader';
import { authoredBoneMorphs, sdefPmxBuffer, vmdBuffer } from './fixtures.ts';
import { referenceBonePose, weightedRotation } from './bone-morph-reference.ts';

function setup( data = new Parser().parsePmx( sdefPmxBuffer( { boneMorphs: true } ), true ) ) {

	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	return { loader, mesh: loader.meshBuilder.build( data, '' ) };

}
function weights( mesh: MMDMesh, values: number[] ) {

	values.forEach( ( value, i ) => { mesh.morphTargetInfluences![ i + 1 ] = value; } );

}
function near( actual: number[], expected: number[], tolerance = 1e-6 ) {

	actual.forEach( ( v, i ) => assert.ok( Math.abs( v - expected[ i ] ) < tolerance, `${actual} != ${expected}` ) );

}
function checkPose( mesh: MMDMesh, expected: ReturnType<typeof referenceBonePose>, tolerance = 1e-6 ) {

	mesh.skeleton.bones.forEach( ( bone, i ) => {

		near( bone.position.toArray(), expected[ i ].position, tolerance );
		const actual = bone.quaternion.toArray();
		const dot = actual.reduce( ( sum, v, c ) => sum + v * expected[ i ].rotation[ c ], 0 );
		near( actual, expected[ i ].rotation.map( v => dot < 0 ? - v : v ), tolerance );

	} );

}
const snapshot = ( mesh: MMDMesh ) => mesh.skeleton.bones.map( b => ( { position: b.position.toArray(), rotation: b.quaternion.toArray() } ) );
const emptyPose: Vpd = { metadata: { boneCount: 0, parentFile: '', coordinateSystem: 'right' }, bones: [] };

test( 'published parser converts bone morph translation/quaternions exactly once and loader retains direct payloads and indices', () => {

	const bytes = sdefPmxBuffer( { boneMorphs: true } );
	const left = new Parser().parsePmx( bytes, false ), right = new Parser().parsePmx( bytes, true );
	assert.deepEqual( right.morphs.map( m => m.type ), [ 1, 2, 2, 2, 0, 3 ] );
	for ( let i = 1; i <= 3; i ++ ) {

		const a = left.morphs[ i ], b = right.morphs[ i ];
		assert.equal( a.type, 2 ); assert.equal( b.type, 2 );
		if ( a.type !== 2 || b.type !== 2 ) throw new Error( 'wrong type' );
		a.elements.forEach( ( e, j ) => {

			near( b.elements[ j ].position, [ e.position[ 0 ], e.position[ 1 ], - e.position[ 2 ] ] );
			near( b.elements[ j ].rotation, [ - e.rotation[ 0 ], - e.rotation[ 1 ], e.rotation[ 2 ], e.rotation[ 3 ] ] );

		} );

	}
	const { mesh } = setup( right );
	assert.deepEqual( mesh.geometry.userData.MMD.boneMorphs?.map( m => [ m.index, m.name ] ), [ [ 1, 'bone-a' ], [ 2, 'bone-b' ], [ 3, 'bone-near' ] ] );
	for ( const morph of mesh.geometry.userData.MMD.boneMorphs! ) {

		assert.equal( mesh.morphTargetDictionary![ morph.name ], morph.index );
		assert.deepEqual( morph.elements, right.morphs[ morph.index ].elements );
		assert.notEqual( morph.elements, right.morphs[ morph.index ].elements );
		assert.deepEqual( mesh.geometry.morphAttributes.position![ morph.index ].array, mesh.geometry.attributes.position.array );

	}

} );

for ( const pmxAnimation of [ false, true ] ) {

	for ( const activation of [ 'restart', 'newAction', 'uncacheAction', 'uncacheRoot' ] ) {

		test( `mixer ${activation} saves authored originals with interactive bone morphs selected (pmxAnimation=${pmxAnimation})`, () => {

			const { mesh, loader } = setup();
			const rest = snapshot( mesh );
			let clip = loader.animationBuilder.build( new Parser().parseVmd( vmdBuffer( {
				boneName: 'bone0', morphs: [ { morphName: 'bone-b', frameNum: 0, weight: 0.25 }, { morphName: 'bone-b', frameNum: 30, weight: 0.5 } ]
			} ), true ), mesh );
			const helper = new MMDAnimationHelper( { pmxAnimation, sync: false } );
			helper.add( mesh, { animation: clip, physics: false } );
			const mixer = helper.objects.get( mesh )!.mixer!;
			let action = mixer.clipAction( clip );
			weights( mesh, [ 1, 0, 0 ] );
			helper.update( 0 ); checkPose( mesh, referenceBonePose( [ 1, 0.25, 0 ], rest ), 1e-5 );
			for ( let cycle = 0; cycle < 3; cycle ++ ) {

				action.stop();
				helper.update( 0 ); checkPose( mesh, referenceBonePose( [ 1, 0, 0 ], rest ) );
				if ( activation === 'uncacheAction' ) mixer.uncacheAction( clip );
				else if ( activation === 'uncacheRoot' ) mixer.uncacheRoot( mesh );
				else if ( activation === 'newAction' ) clip = clip.clone();
				action = mixer.clipAction( clip ).reset().play();
				for ( let frame = 0; frame < 3; frame ++ ) {

					helper.update( 0 ); checkPose( mesh, referenceBonePose( [ 1, 0.25, 0 ], rest ), 1e-5 );

				}
				action.stop();
				helper.update( 0 ); checkPose( mesh, referenceBonePose( [ 1, 0, 0 ], rest ) );
				helper.enable( 'boneMorph', false ).update( 0 ); checkPose( mesh, rest );
				helper.enable( 'boneMorph', true ).update( 0 ); checkPose( mesh, referenceBonePose( [ 1, 0, 0 ], rest ) );

			}

		} );

	}

	for ( const property of [ 'translation', 'rotation' ] ) for ( const evaluate of [ 'setTime', 'update' ] ) {

		test( `external mixer ${evaluate} preserves authored ${property} equal to previous morph output (pmxAnimation=${pmxAnimation})`, () => {

			const data = new Parser().parsePmx( sdefPmxBuffer( { boneMorphs: true } ), true );
			data.morphs[ 1 ] = { name: 'bone-a', englishName: '', panel: 4, type: 2, elementCount: 1,
				elements: [ { index: 0, position: property === 'translation' ? [ 1, 0, 0 ] : [ 0, 0, 0 ],
					rotation: property === 'rotation' ? [ 0, 0, 1, 0 ] : [ 0, 0, 0, 1 ] } ] };
			const { mesh, loader } = setup( data );
			const motion = new Parser().parseVmd( vmdBuffer( { boneName: 'bone0',
				rotation: property === 'rotation' ? [ 0, 0, 1, 0 ] : [ 0, 0, 0, 1 ],
				morphs: [ { morphName: 'bone-a', frameNum: 0, weight: 1 }, { morphName: 'bone-a', frameNum: 30, weight: 1 } ]
			} ), true );
			// An exact half-turn collision avoids floating-point equality accidents:
			// the midpoint is identity, then the endpoint equals the morph quaternion.
			if ( property === 'rotation' ) {

				motion.motions.push( { ...motion.motions[ 0 ], frameNum: 18, position: [ 1.2, 0, 0 ] } );
				motion.metadata.motionCount ++;

			}
			const clip = loader.animationBuilder.build( motion, mesh );
			const helper = new MMDAnimationHelper( { pmxAnimation, sync: false } );
			helper.add( mesh, { animation: clip, physics: false } );
			const mixer = helper.objects.get( mesh )!.mixer!;
			const action = mixer.clipAction( clip ).setLoop( LoopOnce, 1 ); action.clampWhenFinished = true;
			helper.update( 0.5 );
			const bone = mesh.skeleton.bones[ 0 ];
			const previous = property === 'translation' ? bone.position.toArray() : bone.quaternion.toArray();
			assert.deepEqual( previous, property === 'translation' ? [ 2, 0, 0 ] : [ 0, 0, 1, 0 ] );
			if ( evaluate === 'setTime' ) assert.equal( mixer.setTime( 1 ), mixer );
			else assert.equal( mixer.update( 0.5 ), mixer );
			assert.equal( action.paused, true );
			const authored = property === 'translation' ? bone.position.toArray() : bone.quaternion.toArray();
			assert.ok( authored.every( ( value, i ) => value === previous[ i ] ), 'authored pose must exactly collide with previous output' );
			for ( let i = 0; i < 10; i ++ ) {

				helper.update( 0 );
				near( bone.position.toArray(), property === 'translation' ? [ 3, 0, 0 ] : [ 2, 0, 0 ] );
				near( bone.quaternion.toArray(), property === 'rotation' ? [ 0, 0, 0, - 1 ] : [ 0, 0, 0, 1 ] );

			}
			// Re-evaluating the same seek must also preserve the mixer's cached pose.
			action.paused = false; // LoopOnce clamping pauses the action; allow another seek.
			mixer.setTime( 1 ); helper.update( 0 );
			near( bone.position.toArray(), property === 'translation' ? [ 3, 0, 0 ] : [ 2, 0, 0 ] );
			near( bone.quaternion.toArray(), property === 'rotation' ? [ 0, 0, 0, - 1 ] : [ 0, 0, 0, 1 ] );

		} );

	}

	for ( const stop of [ 'stopAllAction', 'stop', 'uncacheAction', 'uncacheRoot', 'restart' ] ) {

		test( `mixer ${stop} preserves a reset pose equal to the previous morph output (pmxAnimation=${pmxAnimation})`, () => {

			const data = new Parser().parsePmx( sdefPmxBuffer( { boneMorphs: true } ), true );
			data.morphs[ 1 ] = { name: 'bone-a', englishName: '', panel: 4, type: 2, elementCount: 1,
				elements: [ { index: 0, position: [ - 2, 0, 0 ], rotation: [ 0, 0, - 1, 0 ] } ] };
			const { mesh, loader } = setup( data );
			const clip = loader.animationBuilder.build( new Parser().parseVmd( vmdBuffer( {
				boneName: 'bone0', rotation: [ 0, 0, 1, 0 ],
				morphs: [ { morphName: 'bone-a', frameNum: 0, weight: 0 }, { morphName: 'bone-a', frameNum: 30, weight: 1 } ]
			} ), true ), mesh );
			const helper = new MMDAnimationHelper( { pmxAnimation, sync: false } );
			helper.add( mesh, { animation: clip, physics: false } );
			const mixer = helper.objects.get( mesh )!.mixer!;
			const action = mixer.clipAction( clip ).setLoop( LoopOnce, 1 ); action.clampWhenFinished = true;
			const rest = snapshot( mesh );
			helper.update( 1 );
			assert.equal( mesh.morphTargetInfluences![ 1 ], 1 );
			assert.deepEqual( snapshot( mesh ), rest ); // Animation and morph cancel exactly.
			if ( stop === 'stopAllAction' ) mixer.stopAllAction();
			else if ( stop === 'uncacheAction' ) mixer.uncacheAction( clip );
			else if ( stop === 'uncacheRoot' ) mixer.uncacheRoot( mesh );
			else action.stop();
			assert.equal( mesh.morphTargetInfluences![ 1 ], 0 );
			assert.deepEqual( snapshot( mesh ), rest );
			if ( stop === 'restart' ) action.reset().play();
			for ( let i = 0; i < 10; i ++ ) {

				helper.update( 0 );
				if ( stop === 'restart' ) checkPose( mesh, rest, 1e-5 );
				else assert.deepEqual( snapshot( mesh ), rest );
				assert.equal( mesh.morphTargetInfluences![ 1 ], 0 );

			}

		} );

	}

	test( `direct bone morphs match scalar reference without drift, reset or disable accumulation (pmxAnimation=${pmxAnimation})`, () => {

		const { mesh } = setup(); const helper = new MMDAnimationHelper( { pmxAnimation } );
		helper.add( mesh, { physics: false } );
		for ( const value of [ [ 0, 0, 0 ], [ 1, 0, 0 ], [ 0, 1, 0 ], [ 0.25, 0.6, 0.5 ], [ 1, 1, 1 ] ] ) {

			weights( mesh, value ); helper.update( 0 ); checkPose( mesh, referenceBonePose( value ) );
			const first = snapshot( mesh );
			for ( let i = 0; i < 100; i ++ ) helper.update( 0 );
			assert.deepEqual( snapshot( mesh ), first );

		}
		// Unsupported dispatch must not turn a group weight into bone motion.
		weights( mesh, [ 0, 0, 0 ] ); mesh.morphTargetInfluences![ 4 ] = 1; mesh.morphTargetInfluences![ 5 ] = 1;
		helper.update( 0 ); checkPose( mesh, referenceBonePose( [] ) );
		weights( mesh, [ 0.7, 0.4, 0 ] ); helper.update( 0 );
		helper.enable( 'boneMorph', false ).update( 0 ); checkPose( mesh, referenceBonePose( [] ) );
		helper.enable( 'boneMorph', true ).update( 0 ); checkPose( mesh, referenceBonePose( [ 0.7, 0.4, 0 ] ) );
		mesh.pose(); helper.update( 0 ); checkPose( mesh, referenceBonePose( [ 0.7, 0.4, 0 ] ) );
		helper.pose( mesh, emptyPose ); helper.update( 0 ); checkPose( mesh, referenceBonePose( [ 0.7, 0.4, 0 ] ) );
		helper.pose( mesh, emptyPose, { resetPose: false } ); checkPose( mesh, referenceBonePose( [ 0.7, 0.4, 0 ] ) );
		helper.remove( mesh ).add( mesh, { physics: false } ).update( 0 ); checkPose( mesh, referenceBonePose( [ 0.7, 0.4, 0 ] ) );
		mesh.skeleton.bones[ 0 ].position.set( 2, 3, 4 );
		mesh.skeleton.bones[ 0 ].quaternion.setFromAxisAngle( new Vector3( 1, 0, 0 ), 0.4 );
		const base = referenceBonePose( [] ); base[ 0 ] = { position: [ 2, 3, 4 ], rotation: mesh.skeleton.bones[ 0 ].quaternion.toArray() };
		helper.update( 0 ); checkPose( mesh, referenceBonePose( [ 0.7, 0.4, 0 ], base ) );

	} );

	test( `VMD bone/vertex/bone-morph tracks remain stable when paused, looping and seeking (pmxAnimation=${pmxAnimation})`, () => {

		const { mesh, loader } = setup();
		const morphs = [ 'vertex-morph', 'bone-a', 'bone-b' ].flatMap( morphName => [ { morphName, frameNum: 0, weight: 0 }, { morphName, frameNum: 30, weight: 1 } ] );
		const clip = loader.animationBuilder.build( new Parser().parseVmd( vmdBuffer( { boneName: 'bone0', morphs, rotation: authoredBoneMorphs[ 0 ].elements[ 1 ].rotation } ), true ), mesh );
		assert.equal( clip.tracks.length, 5 );
		const helper = new MMDAnimationHelper( { pmxAnimation, sync: false } ); helper.add( mesh, { animation: clip, physics: false } );
		const mixer = helper.objects.get( mesh )!.mixer!;
		function check( time: number ) {

			const base = referenceBonePose( [] ); base[ 0 ].position[ 0 ] = time * 2; base[ 0 ].rotation = weightedRotation( authoredBoneMorphs[ 0 ].elements[ 1 ].rotation, time );
			checkPose( mesh, referenceBonePose( [ time, time, 0 ], base ), 1e-5 );
			near( mesh.morphTargetInfluences!.slice( 0, 3 ), [ time, time, time ] );

		}
		helper.update( 0.5 ); check( 0.5 );
		for ( let i = 0; i < 10; i ++ ) helper.update( 0 ); check( 0.5 );
		mixer.clipAction( clip ).paused = true; helper.update( 0.3 ); check( 0.5 );
		mixer.clipAction( clip ).paused = false;
		mixer.setTime( 0.2 ); helper.update( 0 ); check( 0.2 );
		mixer.setTime( 0.8 ); helper.update( 0 ); check( 0.8 );
		helper.update( 0.4 ); check( 0.2 );
		helper.enable( 'animation', false ).update( 0.2 ); check( 0.2 );
		helper.enable( 'boneMorph', false ).update( 0 );
		near( mesh.skeleton.bones[ 0 ].position.toArray(), [ 0.4, 0, 0 ], 1e-5 );
		helper.enable( 'boneMorph', true ).enable( 'animation', true ).update( 0.3 ); check( 0.5 );
		mixer.stopAllAction(); helper.update( 0 ); checkPose( mesh, referenceBonePose( [] ) );
		mixer.clipAction( clip ).reset().play(); helper.update( 0.25 ); check( 0.25 );

	} );

	test( `VPD pose composes once before bone morphs on an unregistered mesh (pmxAnimation=${pmxAnimation})`, () => {

		const { mesh } = setup(); const helper = new MMDAnimationHelper( { pmxAnimation } );
		weights( mesh, [ 0.5, 0.7, 0 ] );
		const rotation = new Quaternion().setFromAxisAngle( new Vector3( 1, 2, 3 ).normalize(), 0.6 ).toArray();
		const pose: Vpd = { ...emptyPose, bones: [ { name: 'bone0', translation: [ 0.2, 0.5, - 0.3 ], quaternion: rotation } ] };
		const base = referenceBonePose( [] ); base[ 0 ] = { position: pose.bones[ 0 ].translation, rotation };
		for ( let i = 0; i < 10; i ++ ) { helper.pose( mesh, pose ); checkPose( mesh, referenceBonePose( [ 0.5, 0.7, 0 ], base ) ); }

	} );

	test( `IK and grants see bone morphs before solving and never accumulate (pmxAnimation=${pmxAnimation})`, () => {

		const data: Pmx = new Parser().parsePmx( sdefPmxBuffer( { boneMorphs: true } ), true );
		data.bones[ 1 ].parentIndex = 0; data.bones[ 1 ].position = [ 0, 1, 0 ];
		data.bones[ 2 ].position = [ 1, 0, 0 ];
		data.bones[ 2 ].ik = { target: null, effector: 1, iteration: 20, maxAngle: 0.5, linkCount: 1, links: [ { index: 0, angleLimitation: 0 } ] };
		data.bones[ 3 ].grant = { parentIndex: 0, ratio: 0.5, isLocal: false, affectRotation: true, affectPosition: false };
		// Pure bone0 rotation: IK should undo the morph to reach this target.
		data.morphs[ 1 ] = { name: 'bone-a', englishName: '', panel: 4, type: 2, elementCount: 1, elements: [ { index: 0, position: [ 0, 0, 0 ], rotation: authoredBoneMorphs[ 0 ].elements[ 0 ].rotation.map( ( v, i ) => Math.fround( i < 2 ? - v : v ) ) as [ number, number, number, number ] } ] };
		const { mesh } = setup( data ); const helper = new MMDAnimationHelper( { pmxAnimation } ); helper.add( mesh, { physics: false } );
		weights( mesh, [ 1, 0, 0 ] ); helper.update( 0 );
		const effector = mesh.skeleton.bones[ 1 ], target = mesh.skeleton.bones[ 2 ];
		assert.ok( effector.getWorldPosition( new Vector3() ).distanceTo( target.getWorldPosition( new Vector3() ) ) < 1e-5 );
		const expectedGrant = new Quaternion().slerp( mesh.skeleton.bones[ 0 ].quaternion, 0.5 );
		near( mesh.skeleton.bones[ 3 ].quaternion.toArray(), expectedGrant.toArray() );
		const first = snapshot( mesh ); for ( let i = 0; i < 50; i ++ ) helper.update( 0 ); assert.deepEqual( snapshot( mesh ), first );
		helper.enable( 'ik', false ).enable( 'grant', false ).update( 0 );
		near( mesh.skeleton.bones[ 0 ].quaternion.toArray(), weightedRotation( authoredBoneMorphs[ 0 ].elements[ 0 ].rotation, 1 ) );
		near( mesh.skeleton.bones[ 3 ].quaternion.toArray(), [ 0, 0, 0, 1 ] );

	} );

	test( `existing local/position grant limitations stay unchanged with bone morphs (pmxAnimation=${pmxAnimation})`, () => {

		for ( const isLocal of [ false, true ] ) {

			const data = new Parser().parsePmx( sdefPmxBuffer( { boneMorphs: true } ), true );
			data.bones[ 3 ].grant = { parentIndex: 0, ratio: 0.5, isLocal, affectRotation: isLocal, affectPosition: true };
			const { mesh } = setup( data ); const helper = new MMDAnimationHelper( { pmxAnimation } ); helper.add( mesh, { physics: false } );
			weights( mesh, [ 1, 0, 0 ] ); helper.update( 0 );
			checkPose( mesh, referenceBonePose( [ 1, 0, 0 ] ) );

		}

	} );

}

test( 'real Ammo consumes morphed kinematic transforms, dynamic bones override morph output, including shared physics', async () => {

	const ammoGlobal = globalThis as typeof globalThis & { Ammo?: AmmoAPI };
	ammoGlobal.Ammo = await ( createRequire( import.meta.url )( 'ammojs-typed' ) as () => Promise<AmmoAPI> )();
	try {

		for ( const pmxAnimation of [ false, true ] ) for ( const shared of [ false, true ] ) for ( const animationWarmup of [ false, true ] ) {

			const data = new Parser().parsePmx( sdefPmxBuffer( { boneMorphs: true } ), true );
			data.rigidBodies = [ 0, 1 ].map( i => ( { name: `body${i}`, englishName: '', boneIndex: i, type: i, shapeType: 0, width: 0.01, height: 0.01, depth: 0.01, position: [ ...data.bones[ i ].position ], rotation: [ 0, 0, 0 ], weight: i, friction: 0.5, restitution: 0, positionDamping: 0, rotationDamping: 0, groupIndex: i, groupTarget: 0 } ) );
			data.metadata.rigidBodyCount = 2;
			const { mesh } = setup( data ); const helper = new MMDAnimationHelper( { pmxAnimation } ); helper.sharedPhysics = shared;
			helper.add( mesh, { animationWarmup, warmup: 0, gravity: new Vector3( 0, 0, 0 ) } ); weights( mesh, [ 1, 0, 0 ] );
			helper.update( 1 / 60 );
			near( mesh.skeleton.bones[ 0 ].position.toArray(), referenceBonePose( [ 1, 0, 0 ] )[ 0 ].position );
			// Dynamic body stays at its initial position under zero gravity.
			near( mesh.skeleton.bones[ 1 ].position.toArray(), referenceBonePose( [] )[ 1 ].position );
			const body = helper.objects.get( mesh )!.physics!.bodies[ 0 ].body;
			const origin = body.getCenterOfMassTransform().getOrigin();
			near( [ origin.x(), origin.y(), origin.z() ], referenceBonePose( [ 1, 0, 0 ] )[ 0 ].position );
			for ( let i = 0; i < 10; i ++ ) helper.update( 0 );
			near( mesh.skeleton.bones[ 0 ].position.toArray(), referenceBonePose( [ 1, 0, 0 ] )[ 0 ].position );
			helper.enable( 'physics', false ).update( 0 ); checkPose( mesh, referenceBonePose( [ 1, 0, 0 ] ) );
			const physics = helper.objects.get( mesh )!.physics!;
			let resets = 0; const reset = physics.reset.bind( physics ); physics.reset = () => { resets ++; return reset(); };
			helper.objects.get( mesh )!.looped = true;
			helper.enable( 'physics', true ).update( 0 ); assert.equal( resets, 1 );
			helper.update( 0 ); assert.equal( resets, 1 );

		}

	} finally { delete ammoGlobal.Ammo; }

} );
