import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AddOperation, MultiplyOperation, Texture } from 'three';
import { Parser } from 'mmd-parser';
import { MMDLoader, MMDToonMaterial, updateMMDUVs } from '../src/index.ts';
import { subtexturePmxBuffer, subtexturePngBuffer, subtextureTexels } from './fixtures.ts';

const parsed = ( options = {} ) => new Parser().parsePmx( subtexturePmxBuffer( options ), true );
function setup( options = {} ) {

	const loader = new MMDLoader();
	const paths: string[] = [];
	loader.meshBuilder.materialBuilder.textureLoader.load = path => { paths.push( path ); return new Texture(); };
	return { loader, paths, mesh: loader.meshBuilder.build( parsed( options ), 'generated/' ) };

}
test( 'published parser and loader preserve sphere modes, additional UV1 and shared SubTexture', () => {

	const data = parsed();
	assert.deepEqual( data.materials.map( m => m.envFlag ), [ 0, 1, 2, 3 ] );
	assert.equal( data.metadata.additionalUvNum, 1 );
	assert.deepEqual( data.vertices[ 9 ].uv, [ 0.875, 0.75 ] );
	assert.deepEqual( data.vertices[ 9 ].auvs[ 0 ].slice( 0, 2 ), [ 0.125, 0.75 ] );
	assert.deepEqual( data.morphs.map( m => m.type ), [ 4, 0, 3, 8 ] );
	assert.deepEqual( subtexturePngBuffer().subarray( 0, 8 ), Buffer.from( [ 137, 80, 78, 71, 13, 10, 26, 10 ] ) );
	assert.equal( new Set( subtextureTexels.map( p => p.join() ) ).size, 8 );
	const { mesh, paths } = setup();
	const materials = mesh.material;
	assert.deepEqual( materials.map( m => m.userData.MMD.envFlag ), [ 0, 1, 2, 3 ] );
	assert.equal( materials[ 0 ].matcap, null );
	assert.equal( materials[ 1 ].matcapCombine, MultiplyOperation );
	assert.equal( materials[ 2 ].matcapCombine, AddOperation );
	assert.equal( materials[ 3 ].matcapMode, 'subtexture' );
	assert.equal( materials[ 3 ].userData.MMD.matcapFileName, 'generated-subtexture.png' );
	assert.equal( materials[ 3 ].matcap, materials[ 1 ].matcap );
	assert.equal( materials[ 3 ].matcap, materials[ 2 ].matcap );
	assert.equal( paths.filter( p => p === 'generated/generated-subtexture.png' ).length, 1 );
	assert.equal( materials[ 3 ].transparent, true );
	const clone = materials[ 3 ].clone();
	assert.equal( clone.matcapMode, 'subtexture' ); assert.equal( clone.matcap, materials[ 3 ].matcap );
	assert.notEqual( clone.mmdSphereColor, materials[ 3 ].mmdSphereColor );
	assert.equal( new MMDToonMaterial().matcapMode, 'sphere' );

} );

test( 'invalid sphere references and missing additional UV declarations/data remain deterministic', () => {

	for ( const sphereIndex of [ - 1, - 2, 120 ] ) {

		const { mesh } = setup( { sphereIndex } );
		assert.equal( mesh.material[ 3 ].matcap, null );
		assert.equal( mesh.material[ 3 ].userData.MMD.envFlag, 3 );

	}
	for ( const invalid of [ undefined, '', null ] ) {

		const data = parsed(); data.textures[ 0 ] = invalid as unknown as string;
		const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
		assert.equal( loader.meshBuilder.build( data, '' ).material[ 3 ].matcap, null );

	}
	for ( const index of [ undefined, NaN, Infinity, 0.5 ] ) {

		const data = parsed(); data.materials[ 3 ].envTextureIndex = index as number;
		const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
		assert.equal( loader.meshBuilder.build( data, '' ).material[ 3 ].matcap, null );

	}
	const missingTable = parsed(); missingTable.textures = undefined!;
	const missingLoader = new MMDLoader(); missingLoader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	assert.equal( missingLoader.meshBuilder.build( missingTable, '' ).material[ 3 ].matcap, null );
	const { mesh } = setup( { additionalUVCount: 0 } );
	assert.equal( mesh.geometry.hasAttribute( 'mmdAdditionalUV1' ), false );
	assert.equal( mesh.material[ 3 ].matcapMode, 'subtexture' );
	for ( const count of [ 1, undefined, NaN ] ) {

		const data = parsed(); data.metadata.additionalUvNum = count as number;
		for ( const vertex of data.vertices ) vertex.auvs = undefined!;
		const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
		const mesh = loader.meshBuilder.build( data, '' );
		mesh.morphTargetInfluences!.fill( NaN ); updateMMDUVs( mesh );
		for ( const attribute of Object.values( mesh.geometry.attributes ) ) assert.ok( Array.from( attribute.array ).every( Number.isFinite ) );

	}

} );

test( 'shared failed SubTexture loads detach each mode-3 layer and preserve diagnostics', () => {

	const loader = new MMDLoader(); let rejectTexture: ( error: unknown ) => void = () => {};
	loader.meshBuilder.materialBuilder.textureLoader.load = ( path, _ready, _progress, error ) => {

		if ( path.endsWith( 'generated-subtexture.png' ) ) rejectTexture = error!;
		return new Texture();

	};
	const data = parsed(); data.materials[ 1 ].envFlag = 3;
	const mesh = loader.meshBuilder.build( data, '' );
	rejectTexture( new Error( 'missing generated image' ) );
	assert.equal( mesh.material[ 1 ].matcap, null ); assert.equal( mesh.material[ 3 ].matcap, null );
	assert.equal( mesh.material[ 3 ].userData.MMD.envFlag, 3 );
	assert.notEqual( mesh.material[ 2 ].matcap, null );

} );
