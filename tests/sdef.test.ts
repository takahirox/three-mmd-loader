import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Parser } from 'mmd-parser';
import { InterleavedBufferAttribute, Matrix4, Quaternion, Texture, Vector3 } from 'three';
import { MMDLoader } from 'three-mmd-loader';
import { referenceSdef } from './sdef-reference.ts';
import { sdefCenter, sdefNormal, sdefPmxBuffer, sdefProbeVertices, sdefR0, sdefR1 } from './fixtures.ts';

function near( actual: number[], expected: number[], tolerance = 1e-6 ) {

	for ( let i = 0; i < actual.length; i ++ ) assert.ok( Math.abs( actual[ i ] - expected[ i ] ) < tolerance, `${actual} != ${expected}` );

}
const input = { position: [ 0.6, 0.3, 0.2 ], normal: sdefNormal, c: sdefCenter, r0: sdefR0, r1: sdefR1, weight: 0.35 };

test( 'published parser preserves SDEF type and converts original C/R0/R1 exactly once', () => {

	const parser = new Parser();
	const left = parser.parsePmx( sdefPmxBuffer(), false );
	const right = parser.parsePmx( sdefPmxBuffer(), true );
	assert.deepEqual( right.vertices.map( v => v.type ), sdefProbeVertices.flatMap( v => [ v.type, v.type, v.type ] ) );
	for ( const [ i, vertex ] of left.vertices.entries() ) {

		if ( vertex.type !== 3 ) continue;
		const converted = right.vertices[ i ];
		assert.equal( converted.type, 3 );
		if ( converted.type !== 3 ) throw new Error( 'SDEF type lost' );
		for ( const key of [ 'skinC', 'skinR0', 'skinR1' ] as const ) near( converted[ key ], [ vertex[ key ][ 0 ], vertex[ key ][ 1 ], - vertex[ key ][ 2 ] ] );

	}
	const loader = new MMDLoader();
	loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	const mesh = loader.meshBuilder.build( right, '' );
	const attrs = mesh.geometry.attributes;
	assert.ok( attrs.mmdSdefC instanceof InterleavedBufferAttribute );
	assert.ok( attrs.mmdSdefR0 instanceof InterleavedBufferAttribute );
	assert.ok( attrs.mmdSdefR1 instanceof InterleavedBufferAttribute );
	assert.ok( attrs.mmdSkinningType instanceof InterleavedBufferAttribute );
	assert.equal( attrs.mmdSdefC.data, attrs.mmdSkinningType.data );
	assert.equal( attrs.mmdSdefR0.data, attrs.mmdSkinningType.data );
	assert.equal( attrs.mmdSdefR1.data, attrs.mmdSkinningType.data );
	assert.deepEqual( Array.from( { length: attrs.mmdSkinningType.count }, ( _, i ) => attrs.mmdSkinningType.getX( i ) ), right.vertices.map( v => v.type ) );
	for ( let i = 0; i < right.vertices.length; i ++ ) {

		const v = right.vertices[ i ];
		for ( const [ attribute, key ] of [ [ 'mmdSdefC', 'skinC' ], [ 'mmdSdefR0', 'skinR0' ], [ 'mmdSdefR1', 'skinR1' ] ] as const ) {

			near( [ attrs[ attribute ].getX( i ), attrs[ attribute ].getY( i ), attrs[ attribute ].getZ( i ) ], v.type === 3 ? v[ key ] : [ 0, 0, 0 ] );

		}
		assert.equal( attrs.skinIndex.getX( i ), 0 );
		assert.equal( attrs.skinIndex.getY( i ), v.type === 0 ? 0 : 1 );

	}
	assert.equal( mesh.geometry.morphAttributes.position!.length, 1 );
	assert.equal( mesh.geometry.morphTargetsRelative, false );
	mesh.geometry.dispose(); mesh.material.forEach( m => m.dispose() );

} );

test( 'CPU SDEF reference preserves rest pose and degenerates to each single bone', () => {

	const identity = new Matrix4();
	near( referenceSdef( input, [ identity, identity ] ).position, input.position );
	near( referenceSdef( input, [ identity, identity ] ).normal, input.normal );
	const bones = [ new Matrix4().makeRotationX( 1.1 ).setPosition( 0.3, - 0.2, 0.4 ), new Matrix4().makeRotationZ( - 0.9 ).setPosition( - 0.1, 0.5, 0.2 ) ];
	for ( const weight of [ 0, 1 ] ) {

		const result = referenceSdef( { ...input, weight }, bones );
		const bone = bones[ weight === 1 ? 0 : 1 ];
		near( result.position, new Vector3().fromArray( input.position ).applyMatrix4( bone ).toArray() );
		near( result.normal, new Vector3().fromArray( input.normal ).transformDirection( bone ).toArray() );

	}

} );

test( 'CPU SDEF two-bone rotation follows the spherical arc and transforms normals', () => {

	const rotation = new Matrix4().makeRotationZ( Math.PI / 2 );
	const result = referenceSdef( { position: [ 1, 0, 0 ], normal: [ 1, 0, 0 ], c: [ 0, 0, 0 ], r0: [ 0, 0, 0 ], r1: [ 0, 0, 0 ], weight: 0.5 }, [ new Matrix4(), rotation ] );
	near( result.position, [ Math.SQRT1_2, Math.SQRT1_2, 0 ] );
	near( result.normal, result.position );

} );

test( 'CPU SDEF is equivariant under PMX handedness conversion and bind transforms', () => {

	const bones = [ new Matrix4().makeRotationY( 0.9 ).setPosition( 0.2, 0.1, 0.4 ), new Matrix4().makeRotationX( - 0.6 ) ];
	const reflect = new Matrix4().makeScale( 1, 1, - 1 );
	const flip = ( value: number[] ) => [ value[ 0 ], value[ 1 ], - value[ 2 ] ];
	const left = referenceSdef( input, bones );
	const right = referenceSdef( { ...input, position: flip( input.position ), normal: flip( input.normal ), c: flip( input.c ), r0: flip( input.r0 ), r1: flip( input.r1 ) }, bones.map( m => reflect.clone().multiply( m ).multiply( reflect ) ) );
	near( right.position, flip( left.position ) ); near( right.normal, flip( left.normal ) );
	const bind = new Matrix4().compose( new Vector3( 0.3, - 0.1, 0.2 ), new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), 0.4 ), new Vector3( 1, 1, 1 ) );
	near( referenceSdef( input, [ new Matrix4(), new Matrix4() ], bind ).position, input.position );

} );
