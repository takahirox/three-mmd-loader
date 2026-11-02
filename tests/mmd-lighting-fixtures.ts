// Independent hand-calculated D3D9/standard-toon term fixtures, not samples of
// the TSL implementation. See docs/material-shading.md#native-derived-ambient-evidence-issue-113.
// Inputs here are numeric working-space terms; these do not assert native gamma
// or raster parity. E = material.Ambient * light.Ambient + material.Emissive,
// with material.Ambient=D and material.Emissive=A. No light.Diffuse term in toon.
export const mmdLightingFixtures = [
	{ name: 'combined scene/material ambient', diffuse: [ 0.4, 0.2, 0.8 ], ambient: [ 0.1, 0.3, 0.05 ], scene: [ 0.5, 0.75, 0.25 ], expected: [ 0.3, 0.45, 0.25 ] },
	{ name: 'zero authored ambient', diffuse: [ 0.4, 0.2, 0.8 ], ambient: [ 0, 0, 0 ], scene: [ 0.5, 0.75, 0.25 ], expected: [ 0.2, 0.15, 0.2 ] },
	{ name: 'zero diffuse', diffuse: [ 0, 0, 0 ], ambient: [ 0.1, 0.3, 0.05 ], scene: [ 0.5, 0.75, 0.25 ], expected: [ 0.1, 0.3, 0.05 ] },
	{ name: 'zero scene ambient', diffuse: [ 0.4, 0.2, 0.8 ], ambient: [ 0.1, 0.3, 0.05 ], scene: [ 0, 0, 0 ], expected: [ 0.1, 0.3, 0.05 ] },
	{ name: 'changed scene color', diffuse: [ 0.4, 0.2, 0.8 ], ambient: [ 0.1, 0.3, 0.05 ], scene: [ 0.25, 0.5, 0.75 ], expected: [ 0.2, 0.4, 0.65 ] },
	{ name: 'HDR host boundary', diffuse: [ 0.8, 0.4, 0.2 ], ambient: [ 0.6, 0.3, 0.1 ], scene: [ 1, 2, 0.5 ], expected: [ 1.4, 1.1, 0.2 ] }
];
