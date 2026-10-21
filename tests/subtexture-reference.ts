// Independent coordinate/composition oracle. PMX mode 3 is a multiplicative
// RGBA texture layer (Nanoem model_color.hlsl, isSphereTextureAsSubTexture).
// Never call the loader's UV evaluator or construct a TSL graph here.
import { referenceSampler, srgbToLinear } from './mmd-color-reference.ts';
import { subtextureTexels } from './fixtures.ts';
export function referenceSubtexture( weight: number, { flipY = false, repeat = true, offset = [ 0, 0 ], scale = [ 1, 1 ] } = {} ) {

	const raw = [ 0.125 + 0.8 * weight, 0.75 - 0.6 * weight ];
	const wrap = ( v: number ) => repeat ? v - Math.floor( v ) : Math.max( 0, Math.min( 1 - 1e-6, v ) );
	const [ u, v ] = raw.map( ( value, i ) => wrap( value * scale[ i ] + offset[ i ] ) );
	const x = Math.min( 3, Math.floor( u * 4 ) ), y = Math.min( 1, Math.floor( ( flipY ? 1 - v : v ) * 2 ) );
	return subtextureTexels[ y * 4 + x ];

}
export function referenceSubtextureColor( texel: number[], color = [ 0.8, 0.6, 0.4 ], opacity = 0.8, factor = [ 1, 1, 1, 1 ] ) {

	const encode = ( v: number ) => v <= 0.0031308 ? 12.92 * v : 1.055 * v ** ( 1 / 2.4 ) - 0.055;
	const rgb = referenceSampler( texel.slice( 0, 3 ).map( v => encode( v / 255 ) ), factor ).map( srgbToLinear );
	return [ ...color.map( ( v, i ) => v * rgb[ i ] * 255 ), opacity * texel[ 3 ] ].map( Math.round );

}
