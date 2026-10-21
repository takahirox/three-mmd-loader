import { SRGBColorSpace } from 'three';
import type { MMDMaterialValues, MMDMesh } from '../types.js';
import type { MMDToonMaterial } from '../materials/MMDToonMaterial.js';

export const materialVectorChannels = [ 'diffuse', 'specular', 'ambient', 'edgeColor', 'textureColor', 'sphereTextureColor', 'toonColor' ] as const;
const scalarChannels = [ 'shininess', 'edgeSize' ] as const;
const samplerChannels = [ [ 'textureColor', 'mmdTextureColor' ], [ 'sphereTextureColor', 'mmdSphereColor' ], [ 'toonColor', 'mmdToonColor' ] ] as const;

/** Copy raw PMX values before color-space conversion; never retain parser arrays. */
export function copyMaterialValues( source: MMDMaterialValues ): MMDMaterialValues {

	return { ...source, ...Object.fromEntries( materialVectorChannels.map( key => [ key, source[ key ].slice() ] ) ) };

}

export function freezeMaterialValues( source: MMDMaterialValues ): Readonly<MMDMaterialValues> {

	const values = copyMaterialValues( source );
	for ( const key of materialVectorChannels ) Object.freeze( values[ key ] );
	return Object.freeze( values );

}

/** Absolute evaluation: helper transfer, mixer seeks and update(0) cannot bake in a result. */
export class MMDMaterialMorphController {

	private weights: Float64Array;
	private states: ( { value: MMDMaterialValues; multiply: MMDMaterialValues; add: MMDMaterialValues } | undefined )[];

	constructor( private mesh: MMDMesh ) {

		this.weights = new Float64Array( mesh.geometry.morphTargets.length );
		this.states = mesh.material.map( m => m.userData.MMD?.materialBase ? { value: copyMaterialValues( m.userData.MMD.materialBase ), multiply: copyMaterialValues( m.userData.MMD.materialBase ), add: copyMaterialValues( m.userData.MMD.materialBase ) } : undefined );

	}

	apply( enabled: boolean ) {

		const morphs = this.mesh.geometry.userData.MMD.materialMorphs ?? [];
		this.weights.fill( 0 );
		if ( enabled ) {

			for ( const morph of morphs ) {

				const weight = this.mesh.morphTargetInfluences?.[ morph.index ] ?? 0;
				if ( Number.isFinite( weight ) ) this.weights[ morph.index ] = weight;

			}
			for ( const group of this.mesh.geometry.userData.MMD.groupMorphs ?? [] ) {

				const weight = this.mesh.morphTargetInfluences?.[ group.index ] ?? 0;
				if ( ! Number.isFinite( weight ) || weight === 0 ) continue;
				for ( const element of group.elements ) {

					if ( element.type !== 8 || ! Number.isInteger( element.index ) || element.index < 0 || element.index >= this.weights.length ) continue;
					const contribution = weight * element.ratio;
					const total = this.weights[ element.index ] + contribution;
					if ( Number.isFinite( contribution ) && Number.isFinite( total ) ) this.weights[ element.index ] = total;

				}

			}

		}
		for ( const [ i, material ] of this.mesh.material.entries() ) {

			const accumulators = this.states[ i ];
			if ( ! accumulators ) continue;
			const { value: state, multiply, add } = accumulators;
			const base: MMDMaterialValues = material.userData.MMD.materialBase;
			for ( const key of materialVectorChannels ) for ( let c = 0; c < state[ key ].length; c ++ ) { multiply[ key ][ c ] = 1; add[ key ][ c ] = 0; }
			for ( const key of scalarChannels ) { multiply[ key ] = 1; add[ key ] = 0; }
			for ( const morph of morphs ) {

				const weight = this.weights[ morph.index ];
				if ( weight === 0 ) continue;
				for ( const element of morph.elements ) {

					if ( ! Number.isInteger( element.index ) || ( element.index !== - 1 && element.index !== i ) || ( element.type !== 0 && element.type !== 1 ) ) continue;
					const target = element.type === 0 ? multiply : add;
					const apply = ( value: number, operand: number ) => {

						const result = element.type === 0 ? value * ( 1 + ( operand - 1 ) * weight ) : value + operand * weight;
						return Number.isFinite( result ) ? result : value;

					};
					for ( const key of materialVectorChannels ) for ( let c = 0; c < state[ key ].length; c ++ ) target[ key ][ c ] = apply( target[ key ][ c ], element[ key ][ c ] );
					for ( const key of scalarChannels ) target[ key ] = apply( target[ key ], element[ key ] );

				}

			}
			// PMX: compose only after all independent multiply/add contributions.
			const compose = ( b: number, m: number, a: number ) => Number.isFinite( b * m + a ) ? b * m + a : b;
			for ( const key of materialVectorChannels ) for ( let c = 0; c < state[ key ].length; c ++ ) state[ key ][ c ] = compose( base[ key ][ c ], multiply[ key ][ c ], add[ key ][ c ] );
			for ( const key of scalarChannels ) state[ key ] = compose( base[ key ], multiply[ key ], add[ key ] );
			this.write( material, state, multiply, add );

		}

	}

	private write( material: MMDToonMaterial, state: MMDMaterialValues, multiply: MMDMaterialValues, add: MMDMaterialValues ) {

		material.color.setRGB( state.diffuse[ 0 ], state.diffuse[ 1 ], state.diffuse[ 2 ], SRGBColorSpace );
		material.opacity = state.diffuse[ 3 ];
		material.specular.setRGB( state.specular[ 0 ], state.specular[ 1 ], state.specular[ 2 ], SRGBColorSpace );
		material.shininess = state.shininess;
		material.ambient.setRGB( state.ambient[ 0 ], state.ambient[ 1 ], state.ambient[ 2 ], SRGBColorSpace );
		for ( const [ key, property ] of samplerChannels ) {

			// Sampler operands stay in PMX source space. Their A controls RGB
			// interpolation; it is never a surface/shadow opacity multiplier.
			material[ property ].fromArray( multiply[ key ] );
			material[ `${property}Add` ].fromArray( add[ key ] );

		}
		const outline = material.userData.outlineParameters;
		if ( outline ) {

			for ( let c = 0; c < 3; c ++ ) outline.color[ c ] = state.edgeColor[ c ];
			outline.alpha = state.edgeColor[ 3 ];
			outline.thickness = state.edgeSize / 300;
			outline.visible = material.userData.MMD.edgeEnabled && state.edgeSize > 0;

		}
		material.userData.MMD.materialMorph = state;

	}

}
