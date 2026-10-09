// Authored fixture equations, independent of parser payloads and runtime loops.
// a = multiply-all, b = add-first, c = duplicated late-multiply elements.
export function referenceMaterial( w: number[], material: number ) {

	const at = ( i: number ) => Number.isFinite( w[ i ] ) ? w[ i ] : 0;
	const a = at( 1 ) + 0.375 * at( 4 ) - 0.25 * at( 5 ) + 0.5 * at( 6 );
	const b = material === 0 ? at( 2 ) + 0.5 * at( 4 ) + 0.25 * at( 5 ) : 0;
	const c = material === 0 ? at( 3 ) + 0.5 * at( 5 ) : 0;
	const half = ( 1 - 0.5 * c ) ** 2;
	const twice = ( 1 + c ) ** 2;
	const diffuse = material === 2 ? [ 0.4, 0.2, 0.8 ] : [ 0.8, 0.6, 0.4 ];
	return {
		diffuse: [ ( diffuse[ 0 ] * ( 1 - 0.5 * a ) + 0.2 * b ) * half, diffuse[ 1 ] * ( 1 + 0.5 * a ) - 0.2 * b, ( diffuse[ 2 ] * ( 1 - 0.75 * a ) + 0.4 * b ) * half, 1 - a - 0.5 * b ],
		specular: [ ( 0.2 * ( 1 + a ) + 0.1 * b ) * half, 0.4 * ( 1 - 0.5 * a ) + 0.2 * b, ( 0.6 * ( 1 + 0.5 * a ) - 0.1 * b ) * half ],
		shininess: ( 20 * ( 1 - 0.5 * a ) + 10 * b ) * twice,
		ambient: [ ( 0.4 * ( 1 - 0.5 * a ) + 0.1 * b ) * half, 0.6 * ( 1 + 0.5 * a ) - 0.2 * b, ( 0.8 * ( 1 - 0.75 * a ) + 0.2 * b ) * half ],
		edgeColor: [ ( 0.2 * ( 1 + a ) + 0.4 * b ) * half, 0.4 * ( 1 - 0.5 * a ) + 0.1 * b, ( 0.6 * ( 1 + 0.5 * a ) - 0.2 * b ) * half, 1 - a - 0.5 * b ],
		edgeSize: ( 3 * ( 1 - a ) - 3 * b ) * twice,
		textureColor: [ ( 1 - 0.5 * a - 0.5 * b ) * half, 1 + 0.5 * a - 0.25 * b, ( 1 - 0.75 * a ) * half, 1 - 0.5 * a - 0.5 * b ],
		sphereTextureColor: [ ( 1 + 0.5 * a ) * half, 1 - 0.75 * a - 0.5 * b, ( 1 - 0.5 * a - 0.25 * b ) * half, 1 - 0.25 * a - 0.25 * b ],
		toonColor: [ ( 1 - 0.75 * a - 0.25 * b ) * half, 1 - 0.5 * a, ( 1 + 0.5 * a - 0.5 * b ) * half, 1 - 0.5 * a - 0.5 * b ]
	};

}

// IEC sRGB conversion, without Three's Color implementation.
export function linear( value: number ) { return value <= 0.04045 ? value / 12.92 : ( ( value + 0.055 ) / 1.055 ) ** 2.4; }
