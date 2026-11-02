// Independent fixed-function oracle, transcribed from Microsoft's D3D9
// Ambient/Diffuse/Emissive Lighting equations and texture stage MODULATE.
// Native slot writes: MikuDanceStudio fa8914a, ModelMaterialRecord bytes 0..67.
// Inputs are numerical RGB signals, without color conversion. Browser callers
// explicitly supply the library's linear-space compatibility inputs.
export interface D3DMaterial {
	diffuse: number[];
	ambient: number[];
	specular: number[];
	emissive: number[];
}

export function nativeMaterialSlots( diffuse: number[], ambient: number[] ): D3DMaterial {

	// D3DMATERIAL9 offsets: Diffuse=0, Ambient=16, Specular=32, Emissive=48.
	return { diffuse, ambient: diffuse, specular: [ 0, 0, 0 ], emissive: ambient };

}

export function fixedFunctionPrimary( material: D3DMaterial, globalAmbient: number[], lights: { ambient: number[]; diffuse: number[]; ndotl: number }[] ) {

	return [ 0, 1, 2 ].map( c => {

		let value = material.emissive[ c ] + material.ambient[ c ] * globalAmbient[ c ];
		for ( const light of lights ) {

			value += material.ambient[ c ] * light.ambient[ c ];
			value += material.diffuse[ c ] * light.diffuse[ c ] * Math.max( 0, light.ndotl );

		}
		return Math.min( 1, Math.max( 0, value ) );

	} );

}

export function modulateStages( primary: number[], stages: number[][] ) {

	const current = primary.slice();
	for ( const stage of stages ) for ( let c = 0; c < 3; c ++ ) current[ c ] *= stage[ c ];
	return current;

}
