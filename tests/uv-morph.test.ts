import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Parser } from 'mmd-parser';
import { Texture, Vector3 } from 'three';
import { MMDAnimationHelper, MMDLoader, updateMMDUVs } from '@takahirox/three-mmd';
import type { MMDMesh } from '@takahirox/three-mmd';
import { sdefPmxBuffer, vmdBuffer } from './fixtures.ts';
import { referenceUV } from './uv-morph-reference.ts';

function setup( additionalUVCount = 4 ) {

	const data = new Parser().parsePmx( sdefPmxBuffer( { uvMorphs: true, additionalUVCount } ), true );
	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	return { data, loader, mesh: loader.meshBuilder.build( data, '' ) };

}
function check( mesh: MMDMesh, weights = mesh.morphTargetInfluences!, count = 4 ) {

	for ( let c = 0; c <= count; c ++ ) {

		const a = mesh.geometry.getAttribute( c ? `mmdAdditionalUV${c}` : 'uv' );
		assert.equal( a.itemSize, c ? 4 : 2 );
		for ( let i = 0; i < a.count; i ++ ) {

			const expected = referenceUV( c, i, weights );
			const actual = c ? [ a.getX( i ), a.getY( i ), a.getZ( i ), a.getW( i ) ] : [ a.getX( i ), a.getY( i ) ];
			actual.forEach( ( value, k ) => assert.ok( Math.abs( value - expected[ k ] ) < 1e-6, `channel ${c} vertex ${i}: ${actual} != ${expected}` ) );

		}

	}

}

test( 'public PMX parser preserves UV signs, vec4 offsets and only declared extra channels', () => {

	for ( const count of [ 0, 1, 2, 3, 4 ] ) {

		const { mesh, data } = setup( count );
		assert.deepEqual( data.morphs.map( m => m.type ), [ 1, 3, 4, 5, 6, 7, 0, 0, 0 ] );
		data.morphs.forEach( ( m, i ) => assert.equal( mesh.morphTargetDictionary![ m.name ], i ) );
		assert.equal( mesh.morphTargetInfluences!.length, 9 );
		assert.equal( mesh.geometry.userData.MMD.uvBases!.length, count + 1 );
		assert.ok( Object.isFrozen( mesh.geometry.userData.MMD.uvBases![ 0 ] ) );
		for ( let c = count + 1; c <= 4; c ++ ) assert.ok( ! mesh.geometry.hasAttribute( `mmdAdditionalUV${c}` ) );
		const raw = data.morphs[ 1 ]; if ( raw.type !== 3 ) throw new Error( 'fixture' );
		assert.deepEqual( mesh.geometry.userData.MMD.uvMorphs![ 0 ].elements, raw.elements );
		assert.notEqual( mesh.geometry.userData.MMD.uvMorphs![ 0 ].elements[ 0 ].uv, raw.elements[ 0 ].uv );
		mesh.morphTargetInfluences!.fill( 1 ); updateMMDUVs( mesh ); check( mesh, mesh.morphTargetInfluences!, count );
		mesh.morphTargetInfluences!.fill( 0 ); updateMMDUVs( mesh ); check( mesh, [], count );

	}

} );
for ( const pmxAnimation of [ false, true ] ) {

	test( `absolute UV sums, groups, static sliders, helper transfers (${pmxAnimation})`, () => {

		const { mesh } = setup(); const helper = new MMDAnimationHelper( { pmxAnimation } ); helper.add( mesh, { physics: false } );
		const weights = mesh.morphTargetInfluences!, dict = { ...mesh.morphTargetDictionary };
		const position = mesh.geometry.attributes.position.array.slice();
		const skin = mesh.geometry.getAttribute( 'mmdSdefC' );
		const centers = Array.from( { length: skin.count }, ( _, i ) => [ skin.getX( i ), skin.getY( i ), skin.getZ( i ) ] );
		for ( const weight of [ 0, 0.5, 1, - 0.5, 1.5, 0 ] ) for ( const active of [ [ 1 ], [ 2, 3, 4, 5 ], [ 6 ], [ 6, 7, 8 ], [ 1, 2, 3, 4, 5, 6, 7, 8 ] ] ) {

			weights.fill( 0 ); active.forEach( i => weights[ i ] = weight );
			for ( let repeat = 0; repeat < 4; repeat ++ ) { helper.update( 0 ); check( mesh ); }
			const uv = mesh.geometry.getAttribute( 'uv' ); const version = 'data' in uv ? uv.data.version : uv.version;
			helper.update( 0 ); assert.equal( 'data' in uv ? uv.data.version : uv.version, version, 'unchanged weights reuploaded' );
			helper.enable( 'uvMorph', false ).update( 0 ); check( mesh, [] );
			helper.enable( 'uvMorph', true ).update( 0 ); check( mesh );
			helper.pose( mesh, { metadata: { boneCount: 0, parentFile: '', coordinateSystem: 'right' }, bones: [] } ); check( mesh );
			helper.remove( mesh ); check( mesh, [] );
			const next = new MMDAnimationHelper( { pmxAnimation: ! pmxAnimation } ); next.add( mesh, { physics: false } ).update( 0 ); check( mesh ); next.remove( mesh ); helper.add( mesh, { physics: false } );

		}
		assert.deepEqual( mesh.geometry.attributes.position.array, position );
		assert.deepEqual( Array.from( { length: skin.count }, ( _, i ) => [ skin.getX( i ), skin.getY( i ), skin.getZ( i ) ] ), centers );
		assert.deepEqual( mesh.morphTargetDictionary, dict ); assert.equal( mesh.morphTargetInfluences, weights );
		// Vertex group links remain handled once by Three's existing position targets.
		weights.fill( 0 ); weights[ 6 ] = 1; helper.update( 0 );
		const p = mesh.getVertexPosition( 0, new Vector3() ); weights.fill( 0 ); helper.update( 0 ); const rest = mesh.getVertexPosition( 0, new Vector3() );
		assert.ok( Math.abs( p.x - rest.x - 0.15 * 0.2 ) < 1e-6 );

	} );
	test( `named UV/group VMD tracks pause, seek, loop, stop/restart and reset (${pmxAnimation})`, () => {

		const { mesh, loader } = setup();
		const clip = loader.animationBuilder.build( new Parser().parseVmd( vmdBuffer( { morphs: [ 'uv0', 'uv4', 'uv-group' ].flatMap( morphName => [ { morphName, frameNum: 0, weight: 0 }, { morphName, frameNum: 30, weight: 1 } ] ) } ), true ), mesh );
		for ( const i of [ 1, 5, 6 ] ) assert.ok( clip.tracks.some( t => t.name === `.morphTargetInfluences[${i}]` ) );
		const helper = new MMDAnimationHelper( { pmxAnimation, sync: false } ); helper.add( mesh, { animation: clip, physics: false } );
		const mixer = helper.objects.get( mesh )!.mixer!, action = mixer.clipAction( clip );
		const at = ( time: number ) => { assert.ok( Math.abs( mesh.morphTargetInfluences![ 1 ] - time ) < 1e-6 ); check( mesh ); };
		helper.update( 0.5 ); at( 0.5 ); action.paused = true;
		for ( let repeat = 0; repeat < 4; repeat ++ ) { helper.update( 0.2 ); at( 0.5 ); }
		mesh.morphTargetInfluences![ 2 ] = 0.7; helper.update( 0 ); at( 0.5 ); action.paused = false;
		for ( const time of [ 0.2, 0.8, 0.2 ] ) { mixer.setTime( time ); helper.update( 0 ); at( time ); }
		mixer.setTime( 0.8 ); helper.update( 0.4 ); at( 0.2 );
		helper.enable( 'animation', false ).update( 0.4 ); at( 0.2 ); helper.enable( 'animation', true );
		mixer.stopAllAction(); helper.update( 0 ); at( 0 ); action.reset().play(); helper.update( 0.5 ); at( 0.5 ); action.stop(); helper.update( 0 ); at( 0 );
		mesh.morphTargetInfluences!.fill( 0 ); helper.update( 0 ); check( mesh, [] );

	} );

}
test( 'standalone draws, invalid weights/indices/components and float32 overflow stay finite', () => {

	const { mesh } = setup(); const weights = mesh.morphTargetInfluences!;
	for ( const value of [ NaN, Infinity, - Infinity ] ) { weights.fill( value ); updateMMDUVs( mesh ); check( mesh, [] ); }
	weights.fill( 0 ); weights[ 1 ] = 0.5;
	mesh.onBeforeRender( null!, null!, null!, mesh.geometry, mesh.material[ 0 ], null! ); check( mesh ); mesh.onAfterRender( null!, null!, null!, mesh.geometry, mesh.material[ 0 ], null! );
	const m = mesh.geometry.userData.MMD.uvMorphs![ 0 ];
	m.elements.push( { index: - 1, uv: [ 1, 2, 3, 4 ] }, { index: 0.5, uv: [ 1, 2, 3, 4 ] }, { index: NaN, uv: [ 1, 2, 3, 4 ] } );
	weights[ 1 ] = 1; updateMMDUVs( mesh ); check( mesh );
	weights[ 1 ] = Number.MAX_VALUE; updateMMDUVs( mesh );
	for ( const a of Object.values( mesh.geometry.attributes ) ) assert.ok( Array.from( a.array ).every( Number.isFinite ) );
	weights.fill( 0 ); updateMMDUVs( mesh ); check( mesh, [] );

} );

test( 'one direct group combines UV with bone/material/vertex targets without applying UV twice', () => {

	const data = new Parser().parsePmx( sdefPmxBuffer( { uvMorphs: true, groupMorphs: true } ), true );
	const group = data.morphs[ 21 ]; if ( group.type !== 0 ) throw new Error( 'fixture' );
	group.elements = [ ...( group.elements as { index: number; ratio: number }[] ), { index: 1, ratio: 0.5 }, { index: 10, ratio: 0.4 } ]; group.elementCount = group.elements.length;
	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	const mesh = loader.meshBuilder.build( data, '' ), helper = new MMDAnimationHelper(); helper.add( mesh, { physics: false } );
	mesh.morphTargetInfluences![ 16 ] = 0.25; mesh.morphTargetInfluences![ 21 ] = 1;
	for ( let repeat = 0; repeat < 3; repeat ++ ) {

		helper.update( 0 );
		assert.ok( Math.abs( mesh.geometry.attributes.uv.getX( 3 ) - 0.725 ) < 1e-6 ); // .25 direct + .75 group
		assert.ok( Math.abs( mesh.geometry.attributes.mmdAdditionalUV4.getW( 3 ) - 0.42 ) < 1e-6 );
		assert.ok( Math.abs( mesh.skeleton.bones[ 0 ].position.x - 0.15 ) < 1e-6 );
		assert.ok( Math.abs( mesh.material[ 0 ].opacity - 1.2 ) < 1e-6 );
		assert.ok( Math.abs( mesh.geometry.morphAttributes.position![ 21 ].getX( 3 ) - mesh.geometry.attributes.position.getX( 3 ) - 0.03 ) < 1e-6 );

	}
	mesh.morphTargetInfluences!.fill( 0 ); helper.update( 0 );
	assert.ok( Math.abs( mesh.geometry.attributes.uv.getX( 3 ) - 0.125 ) < 1e-6 );
	assert.equal( mesh.skeleton.bones[ 0 ].position.x, 0 ); assert.equal( mesh.material[ 0 ].opacity, 1 );

} );

test( 'UV0 morph maps are transparent even when the base UV never reaches a zero-alpha texel', () => {

	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	const data = new Parser().parsePmx( sdefPmxBuffer( { uvMorphs: true, texturePath: 'generated.png' } ), true );
	const mesh = loader.meshBuilder.build( data, '' );
	assert.equal( mesh.material[ 0 ].transparent, true );

} );
