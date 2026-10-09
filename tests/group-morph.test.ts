import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Parser } from 'mmd-parser';
import { Matrix4, Quaternion, Texture, Vector3 } from 'three';
import { MMDAnimationHelper, MMDLoader } from '@takahirox/three-mmd';
import type { MMDMesh } from '@takahirox/three-mmd';
import { sdefMorph, sdefPmxBuffer, sdefProbeVertices, vmdBuffer } from './fixtures.ts';
import { referenceBonePose } from './bone-morph-reference.ts';
import { referenceGroupPose, referenceGroupWeights } from './group-morph-reference.ts';
import { referenceBdef } from './sdef-reference.ts';

function setup() {

	const data = new Parser().parsePmx( sdefPmxBuffer( { groupMorphs: true } ), true );
	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	return { data, loader, mesh: loader.meshBuilder.build( data, '' ) };

}
function near( actual: number[], expected: number[], tolerance = 1e-6 ) {

	actual.forEach( ( value, i ) => assert.ok( Math.abs( value - expected[ i ] ) < tolerance, `${actual} != ${expected}` ) );

}
function check( mesh: MMDMesh, base?: Parameters<typeof referenceBonePose>[ 1 ], enabled = true ) {

	const weights = mesh.morphTargetInfluences!;
	const effective = referenceGroupWeights( weights );
	const expected = enabled ? referenceGroupPose( weights, base ) : referenceBonePose( [], base );
	mesh.skeleton.bones.forEach( ( b, i ) => {

		near( b.position.toArray(), expected[ i ].position, 1e-5 );
		const q = b.quaternion.toArray();
		const dot = q.reduce( ( sum, value, c ) => sum + value * expected[ i ].rotation[ c ], 0 );
		near( q, expected[ i ].rotation.map( v => dot < 0 ? - v : v ), 1e-5 );

	} );
	const positions = mesh.geometry.attributes.position;
	for ( let i = 0; i < positions.count; i ++ ) {

		const rest = [ positions.getX( i ), positions.getY( i ), positions.getZ( i ) ];
		const actual = rest.map( ( v, c ) => v + mesh.geometry.morphAttributes.position!.reduce( ( sum, a, index ) => sum + weights[ index ] * ( a.array[ i * 3 + c ] - v ), 0 ) );
		const reference = rest.map( ( v, c ) => v + Math.fround( sdefMorph[ c ] ) * ( c === 2 ? - 1 : 1 ) * effective.vertex );
		near( actual, reference ); // group vertex displacement exactly once

	}
	mesh.updateMatrixWorld( true ); mesh.skeleton.update();
	const rest = referenceBonePose( [] );
	const palette = expected.map( ( b, i ) => new Matrix4().compose( new Vector3().fromArray( b.position ), new Quaternion().fromArray( b.rotation ), new Vector3( 1, 1, 1 ) ).multiply( new Matrix4().makeTranslation( ...rest[ i ].position as [ number, number, number ] ).invert() ) );
	// Three.js's CPU getVertexPosition implements BDEF. SDEF is compared on GPU.
	for ( const [ index, v ] of sdefProbeVertices.entries() ) {

		if ( v.type === 3 ) continue;
		const position = v.position.map( ( value, c ) => ( Math.fround( value ) + Math.fround( sdefMorph[ c ] ) * effective.vertex ) * ( c === 2 ? - 1 : 1 ) );
		const skinWeights = v.type === 0 ? [ 1 ] : v.type === 1 ? [ Math.fround( v.weight ), 1 - Math.fround( v.weight ) ] : [ 0.2, 0.3, 0.1, 0.4 ];
		near( mesh.getVertexPosition( index * 3, new Vector3() ).toArray(), referenceBdef( position, [ 0, 0, 1 ], palette, skinWeights ).position, 1e-5 );

	}

}
const emptyPose = { metadata: { boneCount: 0, parentFile: '', coordinateSystem: 'right' as const }, bones: [] };

test( 'released parser group payloads preserve names, indices, ratios and explicitly unsupported references', () => {

	const { mesh, data } = setup();
	assert.deepEqual( data.morphs.map( m => m.type ), [ 1, 2, 2, 2, 0, 3, 0, 0, 0, 0, 8, 4, 5, 6, 7, 0 ] );
	assert.equal( mesh.morphTargetInfluences!.length, 16 );
	data.morphs.forEach( ( m, i ) => assert.equal( mesh.morphTargetDictionary![ m.name ], i ) );
	const group = mesh.geometry.userData.MMD.groupMorphs!.find( m => m.index === 6 )!;
	assert.deepEqual( group.elements, [ { index: 0, ratio: 0.5, type: 1, name: 'vertex-morph' }, { index: 1, ratio: 0.25, type: 2, name: 'bone-a' }, { index: 2, ratio: 0.5, type: 2, name: 'bone-b' }, { index: 1, ratio: 0.125, type: 2, name: 'bone-a' } ] );
	const invalid = mesh.geometry.userData.MMD.groupMorphs!.find( m => m.index === 15 )!;
	assert.deepEqual( invalid.elements.slice( 0, 2 ).map( e => [ e.index, e.type, e.name ] ), [ [ - 1, null, null ], [ 120, null, null ] ] );
	assert.deepEqual( mesh.geometry.morphAttributes.position![ 4 ].array, mesh.geometry.attributes.position.array );

} );

test( 'disabled UV morphs and unsupported group links preserve UVs and materialMorph toggle restores material parameters', () => {

	const { mesh } = setup();
	const state = () => ( {
		attributes: Object.fromEntries( Object.entries( mesh.geometry.attributes ).map( ( [ name, a ] ) => [ name, Array.from( a.array ) ] ) ),
		materials: mesh.material.map( m => ( { color: m.color.toArray(), opacity: m.opacity, transparent: m.transparent, uniforms: m.userData } ) )
	} );
	const helper = new MMDAnimationHelper(); helper.enable( 'materialMorph', false ).enable( 'uvMorph', false ).add( mesh, { physics: false } ).update( 0 );
	const before = structuredClone( state() );
	for ( const index of [ 5, 9, 10, 11, 12, 13, 14, 15 ] ) mesh.morphTargetInfluences![ index ] = 1;
	for ( let i = 0; i < 5; i ++ ) { helper.update( 0 ); check( mesh ); assert.deepEqual( state(), before ); }
	const data = new Parser().parsePmx( sdefPmxBuffer( { groupMorphs: true } ), true );
	const group = data.morphs[ 6 ]; if ( group.type !== 0 ) throw new Error( 'wrong fixture' );
	group.elements = [ { index: 0.5, ratio: 1 }, { index: NaN, ratio: 1 }, { index: - 2, ratio: 1 }, { index: 300, ratio: 1 } ];
	group.elementCount = group.elements.length;
	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	const invalid = loader.meshBuilder.build( data, '' );
	assert.ok( invalid.geometry.userData.MMD.groupMorphs!.find( g => g.index === 6 )!.elements.every( e => e.type === null ) );
	invalid.morphTargetInfluences![ 6 ] = 1; helper.add( invalid, { physics: false } ).update( 0 );
	invalid.skeleton.bones.forEach( ( b, i ) => near( b.position.toArray(), referenceBonePose( [] )[ i ].position ) );
	assert.deepEqual( invalid.geometry.morphAttributes.position![ 6 ].array, invalid.geometry.attributes.position.array );

} );

for ( const pmxAnimation of [ false, true ] ) {

	test( `groups match independent vertex/bone/skin reference through controls and helper lifecycle (pmxAnimation=${pmxAnimation})`, () => {

		const { mesh } = setup(); const helper = new MMDAnimationHelper( { pmxAnimation } );
		helper.add( mesh, { physics: false } );
		for ( const weight of [ 0, 0.5, 1, 0 ] ) for ( const active of [ [ 0, 1, 2, 3 ], [ 6 ], [ 0, 1, 2, 3, 6 ], [ 0, 1, 2, 3, 4, 6, 7 ], [ 8, 9, 15 ], [ 5, 10, 11, 12, 13, 14, 15 ] ] ) {

			mesh.morphTargetInfluences!.fill( 0 ); active.forEach( i => mesh.morphTargetInfluences![ i ] = weight );
			const publicWeights = mesh.morphTargetInfluences!.slice();
			for ( let i = 0; i < 5; i ++ ) { helper.update( 0 ); check( mesh ); }
			assert.deepEqual( mesh.morphTargetInfluences, publicWeights );
			helper.enable( 'boneMorph', false ).update( 0 ); check( mesh, undefined, false );
			helper.enable( 'boneMorph', true ).update( 0 ); check( mesh );
			mesh.pose(); helper.update( 0 ); check( mesh );
			helper.pose( mesh, emptyPose ); check( mesh );
			helper.remove( mesh );
			const next = new MMDAnimationHelper( { pmxAnimation: ! pmxAnimation } );
			next.add( mesh, { physics: false } ).update( 0 ); check( mesh ); next.remove( mesh );
			helper.add( mesh, { physics: false } ).update( 0 ); check( mesh );

		}
		mesh.morphTargetInfluences!.fill( 0 ); helper.update( 0 ); check( mesh );

	} );

	test( `group VMD and direct interactive weights remain stable on pause, seek, loop, stop and restart (pmxAnimation=${pmxAnimation})`, () => {

		const { mesh, loader } = setup();
		const clip = loader.animationBuilder.build( new Parser().parseVmd( vmdBuffer( { boneName: 'bone0', morphs: [ 'mixed-group', 'bone-a', 'vertex-morph' ].flatMap( morphName => [ { morphName, frameNum: 0, weight: 0 }, { morphName, frameNum: 30, weight: 1 } ] ) } ), true ), mesh );
		assert.ok( clip.tracks.some( track => track.name === '.morphTargetInfluences[6]' ) );
		const helper = new MMDAnimationHelper( { pmxAnimation, sync: false } ); helper.add( mesh, { physics: false, animation: clip } );
		const mixer = helper.objects.get( mesh )!.mixer!; const action = mixer.clipAction( clip );
		function at( time: number ) {

			const base = referenceBonePose( [] ); base[ 0 ].position[ 0 ] = time * 2;
			near( [ mesh.morphTargetInfluences![ 0 ], mesh.morphTargetInfluences![ 1 ], mesh.morphTargetInfluences![ 6 ] ], [ time, time, time ] );
			check( mesh, base );

		}
		mesh.morphTargetInfluences![ 7 ] = 0.5;
		helper.update( 0.5 ); at( 0.5 );
		action.paused = true; for ( let i = 0; i < 5; i ++ ) { helper.update( 0.2 ); at( 0.5 ); }
		mesh.morphTargetInfluences![ 7 ] = 0.75; helper.update( 0 ); at( 0.5 );
		action.paused = false;
		for ( const time of [ 0.2, 0.8, 0.2 ] ) { mixer.setTime( time ); helper.update( 0 ); at( time ); }
		mixer.setTime( 0.8 ); helper.update( 0.4 ); at( 0.2 );
		helper.enable( 'animation', false ).update( 0.4 ); at( 0.2 ); helper.enable( 'animation', true );
		mixer.stopAllAction(); helper.update( 0 ); at( 0 );
		action.reset().play(); helper.update( 0.5 ); at( 0.5 );
		action.stop(); helper.update( 0 ); at( 0 );
		mesh.morphTargetInfluences!.fill( 0 ); helper.pose( mesh, emptyPose ); check( mesh );

	} );

}
