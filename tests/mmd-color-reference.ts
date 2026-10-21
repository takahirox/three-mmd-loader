// CPU oracle for docs/material-shading.md, independent of TSL and renderer code.
// Saba mmd.frag: ambient + diffuse, then base/sphere/toon, then specular.
// babylon-mmd's material documentation supplies the MMD ambient coefficient 0.5.
export const srgbToLinear = ( v: number ) => v <= 0.04045 ? v / 12.92 : ( ( v + 0.055 ) / 1.055 ) ** 2.4;

export interface ColorComposition {
	ambient: number[];
	diffuse: number[];
	texture?: number[];
	textureFactor?: number[];
	// Direct light color/intensity, including Three's shadow attenuation (no pi).
	lights: { irradiance: number[]; ramp: number[] }[];
	indirect?: number[];
	sphere?: { mode: 'multiply' | 'add' | 'subtexture'; color: number[] };
	specular?: number[];
}

export function referenceMMDColor( input: ColorComposition ) {

	return input.ambient.map( ( ambient, i ) => {

		const texture = input.texture ? input.texture[ i ] * ( input.textureFactor?.[ i ] ?? 1 ) : 1;
		const ramp = input.lights.length ? input.lights.reduce( ( sum, l ) => sum + l.ramp[ i ], 0 ) / input.lights.length : 1;
		const illumination = input.lights.reduce( ( sum, l ) => sum + l.irradiance[ i ] * l.ramp[ i ], input.indirect?.[ i ] ?? 0 );
		let surface = ( input.diffuse[ i ] * illumination + 0.5 * ambient * ramp ) * texture;
		if ( input.sphere ) surface = input.sphere.mode === 'add' ? surface + input.sphere.color[ i ] * ramp : surface * input.sphere.color[ i ];
		return surface + ( input.specular?.[ i ] ?? 0 );

	} );

}

// full.fx v2.0 reconstruction in PMX/source RGB, with additive sphere's
// black neutral. A interpolates RGB, while texture A is a separate operand.
export function referenceSampler( sample: number[], multiply = [ 1, 1, 1, 1 ], add = [ 0, 0, 0, 0 ], neutral = 1 ) {

	return sample.map( ( t, i ) => neutral + ( t * multiply[ i ] + add[ i ] - neutral ) * ( multiply[ 3 ] + add[ 3 ] ) );

}

// Scalar Blinn-Phong reference: no Fresnel, pi, distribution or geometry term.
// Zero power is explicitly the constant authored specular (full.fx power law).
export function referenceDirectSpecular( normal: number[], light: number[], view: number[], power: number, color: number[], intensity: number[] ) {

	const sum = light.map( ( v, i ) => v + view[ i ] );
	const length = Math.hypot( ...sum );
	const nh = length ? Math.max( 0, normal.reduce( ( dot, v, i ) => dot + v * sum[ i ] / length, 0 ) ) : 0;
	return color.map( ( v, i ) => v * intensity[ i ] * ( power > 0 ? nh ** power : 1 ) );

}
