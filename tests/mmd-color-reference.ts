// CPU oracle for docs/material-shading.md, independent of TSL and renderer code.
// Saba mmd.frag: ambient + diffuse, then base/sphere/toon, then specular.
// babylon-mmd's material documentation supplies the MMD ambient coefficient 0.5.
export const srgbToLinear = ( v: number ) => v <= 0.04045 ? v / 12.92 : ( ( v + 0.055 ) / 1.055 ) ** 2.4;

export interface ColorComposition {
	ambient: number[];
	diffuse: number[];
	texture?: number[];
	textureFactor?: number[];
	// Irradiance divided by pi, including Three's shadow attenuation.
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
