import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Parser } from 'mmd-parser';
import { Texture, Vector3 } from 'three';
import { MMDAnimationHelper, MMDLoader } from '@takahirox/three-mmd';
import type { MMDMesh } from '@takahirox/three-mmd';
import { materialPmxBuffer, pmdBuffer, vmdBuffer } from './fixtures.ts';
import { linear, referenceMaterial, referenceSamplerControls } from './material-morph-reference.ts';

function setup() {

	const data = new Parser().parsePmx( materialPmxBuffer(), true );
	const loader = new MMDLoader(); const shared = new Texture<HTMLImageElement>();
	loader.meshBuilder.materialBuilder.textureLoader.load = () => shared;
	return { data, loader, shared, mesh: loader.meshBuilder.build( data, '' ) };

}
function near( actual: number[], expected: number[], tolerance = 1e-6 ) {

	assert.equal( actual.length, expected.length );
	actual.forEach( ( v, i ) => assert.ok( Math.abs( v - expected[ i ] ) < tolerance, `${actual} != ${expected}` ) );

}
function check( mesh: MMDMesh, weights = mesh.morphTargetInfluences! ) {

	mesh.material.forEach( ( m, i ) => {

		const expected = referenceMaterial( weights, i );
		const state = m.userData.MMD.materialMorph;
		for ( const key of Object.keys( expected ) as ( keyof typeof expected )[] ) {

			const e = expected[ key ], a = state[ key ];
			near( typeof a === 'number' ? [ a ] : a, typeof e === 'number' ? [ e ] : e, 1e-5 );

		}
		near( m.color.toArray(), expected.diffuse.slice( 0, 3 ).map( linear ) );
		near( [ m.opacity, m.shininess ], [ expected.diffuse[ 3 ], expected.shininess ], 1e-5 );
		near( m.specular.toArray(), expected.specular.map( linear ) );
		near( m.ambient.toArray(), expected.ambient.map( linear ) );
		const controls = referenceSamplerControls( weights, i );
		for ( const [ key, name ] of [ [ 'textureColor', 'mmdTextureColor' ], [ 'sphereTextureColor', 'mmdSphereColor' ], [ 'toonColor', 'mmdToonColor' ] ] as const ) {

			near( m[ name ].toArray(), controls[ key ].multiply );
			near( m[ `${name}Add` ].toArray(), controls[ key ].add );

		}
		const outline = m.userData.outlineParameters;
		near( outline.color, expected.edgeColor.slice( 0, 3 ) );
		near( [ outline.alpha, outline.thickness ], [ expected.edgeColor[ 3 ], expected.edgeSize / 300 ] );
		assert.equal( outline.visible, expected.edgeSize > 0 );
		assert.equal( m.transparent, true );

	} );

}

test( 'published parser retains every material channel, original indices and immutable independent bases', () => {

	const { mesh, data, shared } = setup();
	assert.deepEqual( data.morphs.map( m => m.type ), [ 3, 8, 8, 8, 0, 0, 0, 8 ] );
	assert.equal( mesh.morphTargetInfluences!.length, 8 );
	data.morphs.forEach( ( m, i ) => assert.equal( mesh.morphTargetDictionary![ m.name ], i ) );
	for ( const m of mesh.geometry.userData.MMD.materialMorphs! ) {

		assert.deepEqual( m.elements, data.morphs[ m.index ].elements );
		assert.notEqual( m.elements[ 0 ].diffuse, ( data.morphs[ m.index ].elements[ 0 ] as { diffuse: number[] } ).diffuse );

	}
	assert.equal( mesh.material[ 0 ].map, shared ); assert.equal( mesh.material[ 1 ].map, shared );
	assert.equal( mesh.material[ 0 ].matcap, mesh.material[ 1 ].matcap );
	assert.equal( mesh.material[ 2 ].map, null );
	const helper = new MMDAnimationHelper(); helper.add( mesh, { physics: false } ).update( 0 ); check( mesh );
	const base = mesh.material[ 0 ].userData.MMD.materialBase;
	assert.ok( Object.isFrozen( base ) && Object.isFrozen( base.diffuse ) );
	assert.notEqual( base.diffuse, data.materials[ 0 ].diffuse );
	data.materials[ 0 ].diffuse[ 0 ] = 0; helper.update( 0 ); check( mesh );
	const clone = mesh.material[ 0 ].clone(); clone.mmdTextureColor.x = 0; clone.mmdTextureColorAdd.x = 0.5;
	assert.equal( mesh.material[ 0 ].mmdTextureColorAdd.x, 0 );
	assert.equal( mesh.material[ 0 ].mmdTextureColor.x, 1 ); assert.equal( clone.map, shared );

} );

for ( const pmxAnimation of [ false, true ] ) {

	test( `all channels match authored equations with independent multiply/add accumulation, groups and helper controls (${pmxAnimation})`, () => {

		const { mesh, shared } = setup(); const helper = new MMDAnimationHelper( { pmxAnimation } );
		helper.add( mesh, { physics: false } );
		const texture = { version: shared.version, matrix: shared.matrix.toArray(), colorSpace: shared.colorSpace, image: shared.image };
		const versions = mesh.material.map( m => m.version );
		for ( const weight of [ 0, 0.5, 1, - 0.5, 1.5, 0 ] ) for ( const active of [ [ 1 ], [ 2 ], [ 3 ], [ 1, 2 ], [ 1, 2, 3 ], [ 4 ], [ 4, 5 ], [ 1, 2, 3, 4, 5, 6 ], [ 0, 7 ] ] ) {

			mesh.morphTargetInfluences!.fill( 0 ); active.forEach( i => mesh.morphTargetInfluences![ i ] = weight );
			const publicWeights = mesh.morphTargetInfluences!.slice();
			for ( let i = 0; i < 4; i ++ ) { helper.update( 0 ); check( mesh ); }
			assert.deepEqual( mesh.morphTargetInfluences, publicWeights );
			helper.enable( 'materialMorph', false ).update( 0 ); check( mesh, [] );
			helper.enable( 'materialMorph', true ).update( 0 ); check( mesh );
			helper.pose( mesh, { metadata: { boneCount: 0, parentFile: '', coordinateSystem: 'right' }, bones: [] } ); check( mesh );
			helper.remove( mesh ); check( mesh, [] );
			const next = new MMDAnimationHelper( { pmxAnimation: ! pmxAnimation } ); next.add( mesh, { physics: false } ).update( 0 ); check( mesh ); next.remove( mesh );
			helper.add( mesh, { physics: false } ).update( 0 ); check( mesh );

		}
		mesh.morphTargetInfluences!.fill( 0 ); helper.update( 0 ); check( mesh );
		assert.deepEqual( mesh.material.map( m => m.version ), versions );
		assert.deepEqual( { version: shared.version, matrix: shared.matrix.toArray(), colorSpace: shared.colorSpace, image: shared.image }, texture );

	} );

	test( `named VMD materials and groups survive pause, seek, loop, stop/restart and zero reset (${pmxAnimation})`, () => {

		const { mesh, loader } = setup();
		const clip = loader.animationBuilder.build( new Parser().parseVmd( vmdBuffer( { morphs: [ 'multiply-all', 'material-group' ].flatMap( morphName => [ { morphName, frameNum: 0, weight: 0 }, { morphName, frameNum: 30, weight: 1 } ] ) } ), true ), mesh );
		assert.ok( clip.tracks.some( t => t.name === '.morphTargetInfluences[1]' ) );
		assert.ok( clip.tracks.some( t => t.name === '.morphTargetInfluences[4]' ) );
		const helper = new MMDAnimationHelper( { pmxAnimation, sync: false } ); helper.add( mesh, { animation: clip, physics: false } );
		const mixer = helper.objects.get( mesh )!.mixer!, action = mixer.clipAction( clip );
		const at = ( time: number ) => { near( [ mesh.morphTargetInfluences![ 1 ], mesh.morphTargetInfluences![ 4 ] ], [ time, time ] ); check( mesh ); };
		mesh.morphTargetInfluences![ 3 ] = 0.25;
		helper.update( 0.5 ); at( 0.5 ); action.paused = true;
		for ( let i = 0; i < 4; i ++ ) { helper.update( 0.2 ); at( 0.5 ); }
		mesh.morphTargetInfluences![ 3 ] = 0.5; helper.update( 0 ); at( 0.5 ); action.paused = false;
		for ( const time of [ 0.2, 0.8, 0.2 ] ) { mixer.setTime( time ); helper.update( 0 ); at( time ); }
		mixer.setTime( 0.8 ); helper.update( 0.4 ); at( 0.2 );
		helper.enable( 'animation', false ).update( 0.4 ); at( 0.2 ); helper.enable( 'animation', true );
		mixer.stopAllAction(); helper.update( 0 ); at( 0 );
		action.reset().play(); helper.update( 0.5 ); at( 0.5 ); action.stop(); helper.update( 0 ); at( 0 );
		mesh.morphTargetInfluences!.fill( 0 ); helper.update( 0 ); check( mesh );

	} );

}

test( 'draw-scoped nonfinite weights preserve finite vertex deformation, public arrays and nested draws', () => {

	const { mesh } = setup();
	const weights = mesh.morphTargetInfluences!;
	const rest = mesh.getVertexPosition( 0, new Vector3() );
	const target = mesh.geometry.morphAttributes.position![ 0 ];
	target.setX( 0, target.getX( 0 ) + 1 );
	const before = () => mesh.onBeforeRender( null!, null!, null!, mesh.geometry, mesh.material[ 0 ], null! );
	const after = () => mesh.onAfterRender( null!, null!, null!, mesh.geometry, mesh.material[ 0 ], null! );
	for ( const vertexWeight of [ - 0.25, 1.5 ] ) for ( const invalid of [ NaN, Infinity, - Infinity ] ) {

		weights.fill( 0 ); weights[ 0 ] = vertexWeight; weights[ 1 ] = invalid; weights[ 4 ] = invalid;
		const saved = weights.slice();
		before();
		assert.notEqual( mesh.morphTargetInfluences, weights );
		assert.equal( mesh.morphTargetInfluences![ 0 ], vertexWeight );
		near( mesh.getVertexPosition( 0, new Vector3() ).toArray(), [ rest.x + vertexWeight, rest.y, rest.z ] );
		const renderingWeights = mesh.morphTargetInfluences;
		before(); after();
		assert.equal( mesh.morphTargetInfluences, renderingWeights );
		after();
		assert.equal( mesh.morphTargetInfluences, weights );
		assert.deepEqual( weights, saved );

	}
	weights.fill( 0 ); before();
	assert.equal( mesh.morphTargetInfluences, weights );
	near( mesh.getVertexPosition( 0, new Vector3() ).toArray(), rest.toArray() );
	after();
	assert.equal( mesh.morphTargetInfluences, weights );

} );

test( 'invalid material indices/modes, nonfinite components and public weights are harmless; PMD remains unchanged', () => {

	const { mesh } = setup(); const helper = new MMDAnimationHelper(); helper.add( mesh, { physics: false } );
	mesh.morphTargetInfluences![ 1 ] = NaN; mesh.morphTargetInfluences![ 2 ] = Infinity; mesh.morphTargetInfluences![ 4 ] = Infinity; mesh.morphTargetInfluences![ 7 ] = 1;
	helper.update( 0 ); check( mesh, [] );
	const invalid = mesh.geometry.userData.MMD.materialMorphs!.find( m => m.index === 7 )!;
	invalid.elements[ 0 ].index = 0.5; invalid.elements[ 1 ].index = NaN;
	invalid.elements[ 2 ].type = 1;
	for ( const key of [ 'diffuse', 'specular', 'ambient', 'edgeColor', 'textureColor', 'sphereTextureColor', 'toonColor' ] as const ) invalid.elements[ 2 ][ key ].fill( NaN );
	invalid.elements[ 2 ].shininess = Infinity; invalid.elements[ 2 ].edgeSize = - Infinity;
	helper.update( 0 ); check( mesh, [] );
	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	const pmd = loader.meshBuilder.build( new Parser().parsePmd( pmdBuffer(), true ), '' );
	const before = pmd.material.map( m => [ m.color.toArray(), m.opacity, m.ambient.toArray(), m.emissive.toArray() ] );
	helper.add( pmd, { physics: false } ).update( 0 );
	assert.deepEqual( pmd.material.map( m => [ m.color.toArray(), m.opacity, m.ambient.toArray(), m.emissive.toArray() ] ), before );

} );

test( 'additive -1 updates every material and an initially zero enabled edge can become visible', () => {

	const data = new Parser().parsePmx( materialPmxBuffer( { allAdd: true } ), true );
	data.materials[ 1 ].edgeSize = 0;
	data.materials[ 2 ].flag &= ~0x10;
	const add = data.morphs[ 2 ]; if ( add.type !== 8 ) throw new Error( 'fixture' );
	add.elements[ 0 ].edgeSize = 3;
	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	const mesh = loader.meshBuilder.build( data, '' ), helper = new MMDAnimationHelper(); helper.add( mesh, { physics: false } );
	for ( const weight of [ 0, 0.5, 1, 0 ] ) {

		mesh.morphTargetInfluences![ 2 ] = weight; helper.update( 0 );
		mesh.material.forEach( ( m, i ) => {

			near( [ m.opacity, m.shininess ], [ 1 - 0.5 * weight, 20 + 10 * weight ] );
			near( m.color.toArray(), ( i === 2 ? [ 0.4 + 0.2 * weight, 0.2 - 0.2 * weight, 0.8 + 0.4 * weight ] : [ 0.8 + 0.2 * weight, 0.6 - 0.2 * weight, 0.4 + 0.4 * weight ] ).map( linear ) );
			const edge = m.userData.outlineParameters;
			near( [ edge.thickness ], [ ( ( i === 1 ? 0 : 3 ) + 3 * weight ) / 300 ] );
			assert.equal( edge.visible, i === 2 ? false : i === 1 ? weight > 0 : true );

		} );

	}

} );

test( 'alpha preclassification uses mode identities and ignores invalid targets/modes', () => {

	for ( const mode of [ 0, 1 ] ) for ( const channel of [ 'diffuse', 'edgeColor', 'textureColor', 'sphereTextureColor', 'toonColor' ] as const ) {

		const data = new Parser().parsePmx( materialPmxBuffer(), true );
		const source = data.morphs[ 1 ]; if ( source.type !== 8 ) throw new Error( 'fixture' );
		const e = source.elements[ 0 ]; e.type = mode; e.index = 0;
		for ( const key of [ 'diffuse', 'edgeColor', 'textureColor', 'sphereTextureColor', 'toonColor' ] as const ) e[ key ][ 3 ] = mode === 0 ? 1 : 0;
		data.morphs = [ source ]; data.metadata.morphCount = 1;
		const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
		assert.equal( loader.meshBuilder.build( data, '' ).material[ 0 ].transparent, false, 'identity flagged' );
		e[ channel ][ 3 ] = mode === 0 ? 0 : - 1;
		const opacityChannel = channel === 'diffuse' || channel === 'edgeColor';
		const mesh = loader.meshBuilder.build( data, '' ); assert.equal( mesh.material[ 0 ].transparent, opacityChannel, channel );
		assert.equal( mesh.material[ 1 ].transparent, false, 'unrelated target flagged' );
		e.index = - 1; assert.equal( loader.meshBuilder.build( data, '' ).material[ 1 ].transparent, opacityChannel );
		for ( const index of [ - 2, 120, 0.5, NaN ] ) { e.index = index; assert.ok( loader.meshBuilder.build( data, '' ).material.every( m => ! m.transparent ) ); }
		e.index = - 1; e.type = 2; assert.ok( loader.meshBuilder.build( data, '' ).material.every( m => ! m.transparent ) );

	}

} );

test( 'multiply/add authored order is immaterial across morphs and repeated elements', () => {

	const { mesh } = setup();
	const helper = new MMDAnimationHelper(); helper.add( mesh, { physics: false } );
	for ( const weight of [ -0.5, 0.25, 1, 1.5 ] ) {

		mesh.morphTargetInfluences!.fill( 0 );
		for ( const i of [ 1, 2, 3, 4, 5 ] ) mesh.morphTargetInfluences![ i ] = weight;
		helper.update( 0 ); check( mesh );
		const snapshot = mesh.material.map( m => JSON.stringify( m.userData.MMD.materialMorph ) );
		mesh.geometry.userData.MMD.materialMorphs!.reverse();
		for ( const morph of mesh.geometry.userData.MMD.materialMorphs! ) morph.elements.reverse();
		helper.update( 0 ); check( mesh );
		mesh.material.forEach( ( m, i ) => {

			const before = JSON.parse( snapshot[ i ] );
			for ( const key of Object.keys( before ) ) {

				const actual = m.userData.MMD.materialMorph[ key ];
				near( Array.isArray( actual ) ? actual : [ actual ], Array.isArray( before[ key ] ) ? before[ key ] : [ before[ key ] ] );

			}

		} );

	}

} );


test( 'source material RGB is composed before linear conversion; sampler controls stay raw', () => {

	const { mesh } = setup();
	const helper = new MMDAnimationHelper(); helper.add( mesh, { physics: false } );
	mesh.morphTargetInfluences![ 1 ] = 0.5; mesh.morphTargetInfluences![ 2 ] = 0.5;
	helper.update( 0 );
	const m = mesh.material[ 0 ];
	// Authored diffuse red: .8 * (1 + (.5 - 1) * .5) + .2 * .5 = .7.
	near( [ m.color.r, m.opacity ], [ linear( 0.7 ), 0.25 ] );
	assert.ok( Math.abs( m.color.r - ( linear( 0.8 ) * linear( 0.75 ) + linear( 0.1 ) ) ) > 0.05 );
	near( m.mmdTextureColor.toArray(), [ 0.75, 1.25, 0.625, 0.75 ] );
	near( m.mmdTextureColorAdd.toArray(), [ -0.25, -0.125, 0, -0.25 ] );

} );
