import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Parser } from 'mmd-parser';
import { Color, SRGBColorSpace, Texture } from 'three';
import { vec3 } from 'three/tsl';
import { MMDAnimationHelper, MMDLoader, MMDToonMaterial } from '@takahirox/three-mmd';
import { pmdBuffer, pmxBuffer, materialPmxBuffer } from './fixtures.ts';
import { referenceMMDColor } from './mmd-color-reference.ts';

test( 'PMD and PMX preserve original ambient independently of map presence and emissive', () => {

	for ( const format of [ 'pmd', 'pmx' ] ) for ( const mapped of [ false, true ] ) {

		const parser = new Parser();
		const data = format === 'pmd' ? parser.parsePmd( pmdBuffer(), true ) : parser.parsePmx( pmxBuffer(), true );
		data.materials[ 0 ].ambient = [ 1, 0.6, 0.2 ];
		if ( 'fileName' in data.materials[ 0 ] ) data.materials[ 0 ].fileName = mapped ? 'color.png' : '';
		else { data.materials[ 0 ].textureIndex = mapped ? 0 : - 1; if ( 'textures' in data ) data.textures = [ 'color.png' ]; }
		const loader = new MMDLoader();
		loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
		const m = loader.meshBuilder.build( data, '' ).material[ 0 ];
		assert.equal( !! m.map, mapped );
		assert.deepEqual( m.ambient.toArray(), new Color().setRGB( 1, 0.6, 0.2, SRGBColorSpace ).toArray() );
		assert.deepEqual( m.emissive.toArray(), [ 0, 0, 0 ] );
		const clone = m.clone();
		assert.deepEqual( clone.ambient, m.ambient );
		clone.ambient.setRGB( 0, 0, 0 );
		assert.equal( m.ambient.r, 1 );

	}

} );

test( 'ambient morph evaluation preserves user emission, intensity, nodes and source metadata', () => {

	const loader = new MMDLoader();
	loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	const mesh = loader.meshBuilder.build( new Parser().parsePmx( materialPmxBuffer(), true ), '' );
	const material = mesh.material[ 0 ];
	material.emissive.setRGB( 0.1, 0.2, 0.3 ); material.emissiveIntensity = 2.5;
	const node = vec3( 0.1, 0.2, 0.3 ); material.emissiveNode = node;
	const colorNode = vec3( 0.3, 0.4, 0.5 ); material.colorNode = colorNode;
	const base = JSON.stringify( material.userData.MMD.materialBase );
	const helper = new MMDAnimationHelper(); helper.add( mesh, { physics: false } );
	for ( const weight of [ 0, 0.5, 1, 0 ] ) {

		mesh.morphTargetInfluences![ 4 ] = weight; helper.update( 0 );
		assert.deepEqual( material.emissive.toArray(), [ 0.1, 0.2, 0.3 ] );
		assert.equal( material.emissiveIntensity, 2.5 );
		assert.equal( material.emissiveNode, node );
		assert.equal( material.colorNode, colorNode );
		assert.equal( JSON.stringify( material.userData.MMD.materialBase ), base );

	}
	helper.remove( mesh );
	assert.equal( new MMDToonMaterial().ambient.getHex(), 0 );

} );

test( 'reference equation modulates ambient and diffuse once, with separate specular and absent-map factors', () => {

	const base = { ambient: [ 1, 1, 1 ], diffuse: [ 0.2, 0.4, 0.6 ], lights: [ { irradiance: [ 1, 1, 1 ], ramp: [ 1, 1, 1 ] } ], specular: [ 0.1, 0.1, 0.1 ] };
	const near = ( a: number[], b: number[] ) => a.forEach( ( v, i ) => assert.ok( Math.abs( v - b[ i ] ) < 1e-12 ) );
	near( referenceMMDColor( base ), [ 0.8, 1, 1.2 ] );
	near( referenceMMDColor( { ...base, texture: [ 0, 0, 0 ] } ), [ 0.1, 0.1, 0.1 ] );
	near( referenceMMDColor( { ...base, texture: [ 0.1, 0.2, 0.5 ] } ), [ 0.17, 0.28, 0.65 ] );
	near( referenceMMDColor( { ...base, textureFactor: [ 0, 0, 0 ] } ), referenceMMDColor( base ) );
	near( referenceMMDColor( { ...base, lights: [] } ), [ 0.6, 0.6, 0.6 ] );

} );
