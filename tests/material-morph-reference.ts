// PMX_spec.txt material morph section: base * product(weighted multipliers)
// + sum(weighted additions). Late multipliers never multiply additions.
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
		diffuse: [ diffuse[ 0 ] * ( 1 - 0.5 * a ) * half + 0.2 * b, diffuse[ 1 ] * ( 1 + 0.5 * a ) - 0.2 * b, diffuse[ 2 ] * ( 1 - 0.75 * a ) * half + 0.4 * b, 1 - a - 0.5 * b ],
		specular: [ 0.2 * ( 1 + a ) * half + 0.1 * b, 0.4 * ( 1 - 0.5 * a ) + 0.2 * b, 0.6 * ( 1 + 0.5 * a ) * half - 0.1 * b ],
		shininess: 20 * ( 1 - 0.5 * a ) * twice + 10 * b,
		ambient: [ 0.4 * ( 1 - 0.5 * a ) * half + 0.1 * b, 0.6 * ( 1 + 0.5 * a ) - 0.2 * b, 0.8 * ( 1 - 0.75 * a ) * half + 0.2 * b ],
		edgeColor: [ 0.2 * ( 1 + a ) * half + 0.4 * b, 0.4 * ( 1 - 0.5 * a ) + 0.1 * b, 0.6 * ( 1 + 0.5 * a ) * half - 0.2 * b, 1 - a - 0.5 * b ],
		edgeSize: 3 * ( 1 - a ) * twice - 3 * b,
		textureColor: [ ( 1 - 0.5 * a ) * half - 0.5 * b, 1 + 0.5 * a - 0.25 * b, ( 1 - 0.75 * a ) * half, 1 - 0.5 * a - 0.5 * b ],
		sphereTextureColor: [ ( 1 + 0.5 * a ) * half, 1 - 0.75 * a - 0.5 * b, ( 1 - 0.5 * a ) * half - 0.25 * b, 1 - 0.25 * a - 0.25 * b ],
		toonColor: [ ( 1 - 0.75 * a ) * half - 0.25 * b, 1 - 0.5 * a, ( 1 + 0.5 * a ) * half - 0.5 * b, 1 - 0.5 * a - 0.5 * b ]
	};

}

// IEC sRGB conversion, without Three's Color implementation.
export function linear( value: number ) { return value <= 0.04045 ? value / 12.92 : ( ( value + 0.055 ) / 1.055 ) ** 2.4; }

// Independently authored sampler accumulators for the same generated PMX bytes.
export function referenceSamplerControls( w: number[], material: number ) {

	const at = ( i: number ) => Number.isFinite( w[ i ] ) ? w[ i ] : 0;
	const a = at( 1 ) + 0.375 * at( 4 ) - 0.25 * at( 5 ) + 0.5 * at( 6 );
	const b = material === 0 ? at( 2 ) + 0.5 * at( 4 ) + 0.25 * at( 5 ) : 0;
	const c = material === 0 ? at( 3 ) + 0.5 * at( 5 ) : 0;
	const h = ( 1 - 0.5 * c ) ** 2;
	return {
		textureColor: { multiply: [ ( 1 - 0.5 * a ) * h, 1 + 0.5 * a, ( 1 - 0.75 * a ) * h, 1 - 0.5 * a ], add: [ -0.5 * b, -0.25 * b, 0, -0.5 * b ] },
		sphereTextureColor: { multiply: [ ( 1 + 0.5 * a ) * h, 1 - 0.75 * a, ( 1 - 0.5 * a ) * h, 1 - 0.25 * a ], add: [ 0, -0.5 * b, -0.25 * b, -0.25 * b ] },
		toonColor: { multiply: [ ( 1 - 0.75 * a ) * h, 1 - 0.5 * a, ( 1 + 0.5 * a ) * h, 1 - 0.5 * a ], add: [ -0.25 * b, 0, -0.5 * b, -0.5 * b ] }
	};

}
