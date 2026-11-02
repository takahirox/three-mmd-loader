import assert from 'node:assert/strict';
import { test } from 'node:test';
import { referenceDirectSpecular, referenceMMDColor, referenceSampler, srgbToLinear } from './mmd-color-reference.ts';

const near = ( actual: number[], expected: number[] ) => actual.forEach( ( v, i ) => assert.ok( Math.abs( v - expected[ i ] ) < 1e-12, `${actual} != ${expected}` ) );

test( 'scalar source sampler oracle interpolates RGB against the operation neutral', () => {

	const texel = [ 0.2, 0.4, 0.6 ];
	near( referenceSampler( texel, [ 0.3, 0.6, 0.9, 0 ] ), [ 1, 1, 1 ] );
	near( referenceSampler( texel, [ 0.3, 0.6, 0.9, 0 ], [ 0, 0, 0, 0 ], 0 ), [ 0, 0, 0 ] );
	near( referenceSampler( texel, [ 0.5, 0.75, 0.25, 0.5 ], [ 0.1, 0.2, 0.05, 0.25 ] ), [ 0.4, 0.625, 0.4 ] );
	near( referenceSampler( texel, [ 0.5, 0.75, 0.25, 0.5 ], [ 0.1, 0.2, 0.05, 0.25 ], 0 ), [ 0.15, 0.375, 0.15 ] );
	near( referenceSampler( texel, [ 1, 1, 1, 1 ], [ 0, 0, 0, -1 ] ), [ 1, 1, 1 ] );
	// Source RGB reconstruction and linear RGB multiplication are distinguishable.
	assert.ok( Math.abs( srgbToLinear( 0.4 ) - srgbToLinear( 0.2 ) * srgbToLinear( 0.5 ) ) > 0.1 );

} );

test( 'scalar unnormalized specular has authored magnitude, angular falloff and explicit zero power', () => {

	const color = [ 0.2, 0.4, 0.6 ], light = [ 0.5, 0.25, 1 ];
	near( referenceDirectSpecular( [ 0, 0, 1 ], [ 0, 0, 1 ], [ 0, 0, 1 ], 32, color, light ), [ 0.1, 0.1, 0.6 ] );
	// H=(1,0,1)/sqrt(2); (N dot H)^8 = 1/16, without pi or normalization.
	near( referenceDirectSpecular( [ 0, 0, 1 ], [ 1, 0, 0 ], [ 0, 0, 1 ], 8, color, light ), [ 0.00625, 0.00625, 0.0375 ] );
	near( referenceDirectSpecular( [ 0, 0, -1 ], [ 0, 0, 1 ], [ 0, 0, 1 ], 8, color, light ), [ 0, 0, 0 ] );
	near( referenceDirectSpecular( [ 0, 0, 1 ], [ 0, 0, -1 ], [ 0, 0, 1 ], 8, color, light ), [ 0, 0, 0 ] );
	for ( const power of [ -2, 0 ] ) near( referenceDirectSpecular( [ 0, 0, 1 ], [ 0, 0, -1 ], [ 0, 0, 1 ], power, color, light ), [ 0.1, 0.1, 0.6 ] );
	for ( const power of [ 0, 1, 8, 32 ] ) near( referenceDirectSpecular( [ 0, 0, 1 ], [ 1, 0, 0 ], [ -1, 0, 0 ], power, [ 0, 0, 0 ], light ), [ 0, 0, 0 ] );

} );

test( 'scalar direct diffuse has no pi and textures cannot tint separate specular', () => {

	const input = { diffuse: [ 0.3, 0.2, 0.1 ], ambient: [ 0, 0, 0 ], lights: [ { irradiance: [ 0.5, 0.4, 0.3 ], ramp: [ 1, 1, 1 ] } ] };
	near( referenceMMDColor( input ), [ 0.15, 0.08, 0.03 ] );
	near( referenceMMDColor( { ...input, texture: [ 0, 0, 0 ], specular: [ 0.1, 0.2, 0.3 ] } ), [ 0.1, 0.2, 0.3 ] );

} );

test( 'native material slots and D3D9 equations independently determine ambient, light and texture order', async () => {

	const { fixedFunctionPrimary, modulateStages, nativeMaterialSlots } = await import( './native-light-reference.ts' );
	const material = nativeMaterialSlots( [ 0.25, 0.5, 0.75 ], [ 0.125, 0.0625, 0.03125 ] );
	const light = { ambient: [ 0.5, 0.25, 0.125 ], diffuse: [ 0, 0, 0 ], ndotl: 1 };
	const primary = fixedFunctionPrimary( material, [ 0.125, 0.125, 0.125 ], [ light ] );
	// Hand-computed dyadic values, independent of Three/TSL and referenceMMDColor.
	near( primary, [ 0.28125, 0.25, 0.21875 ] );
	const stages = [ [ 0.5, 0.25, 1 ], [ 0.5, 1, 0.25 ] ];
	near( modulateStages( primary, stages ), [ 0.0703125, 0.0625, 0.0546875 ] );
	near( referenceMMDColor( { diffuse: material.diffuse, ambient: material.emissive,
		lights: [ { irradiance: light.ambient, ramp: stages[ 0 ] } ], indirect: [ 0.125, 0.125, 0.125 ], texture: stages[ 1 ] } ), modulateStages( primary, stages ) );
	near( fixedFunctionPrimary( material, [ 0, 0, 0 ], [] ), material.emissive );
	near( fixedFunctionPrimary( material, [ 0, 0, 0 ], [ { ...light, ambient: [ 0, 0, 0 ] } ] ), material.emissive );
	near( fixedFunctionPrimary( nativeMaterialSlots( [ 0, 0, 0 ], material.emissive ), [ 1, 1, 1 ], [ light ] ), material.emissive );
	near( fixedFunctionPrimary( nativeMaterialSlots( [ 1, 1, 1 ], [ 0.5, 0.5, 0.5 ] ), [ 0, 0, 0 ], [ { ...light, ambient: [ 1, 1, 1 ] } ] ), [ 1, 1, 1 ] );

} );
