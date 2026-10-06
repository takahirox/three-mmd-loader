import { AddOperation, MultiplyOperation } from 'three';
import type { Color, Combine, Texture } from 'three';
import { MeshPhongNodeMaterial, PhongLightingModel } from 'three/webgpu';
import type { MeshPhongNodeMaterialParameters, Node, NodeBuilder } from 'three/webgpu';
import type { LightingModelDirectInput } from 'three/src/nodes/core/LightingModel.js';
import {
	BRDF_Lambert, F_Schlick, diffuseColor, float, materialReference,
	materialSpecularStrength, matcapUV, mix, normalView, positionViewDirection,
	shininess, smoothstep, specularColor, vec2, vec3, vec4
} from 'three/tsl';

export interface MMDOutlineParameters {
	thickness: number;
	color: number[];
	alpha: number;
	visible: boolean;
}

export interface MMDToonMaterialParameters extends MeshPhongNodeMaterialParameters {
	diffuse?: Color;
	gradientMap?: Texture | null;
	matcap?: Texture | null;
	matcapCombine?: Combine;
}

// Adapted from r186 ToonLightingModel and PhongLightingModel. Keep Three's
// indirect lighting, shadows, light maps and AO; only quantize direct irradiance.
// Casts below supply the vector types omitted by some r186 TSL declarations;
// the underlying values are Three's nodes, with no custom shader source.
class MMDLightingModel extends PhongLightingModel {

	direct( { lightDirection, lightColor, reflectedLight }: LightingModelDirectInput, builder: NodeBuilder ) {

		const direction = vec3( lightDirection as Node<'vec3'> );
		const coord = vec2( normalView.dot( direction ).mul( 0.5 ).add( 0.5 ), 0 );
		const material = builder.material as MMDToonMaterial;
		const fw = coord.fwidth().mul( 0.5 );
		const gradient = material.gradientMap
			? ( materialReference( 'gradientMap', 'texture' ) as unknown as Node<'vec4'> ).context( { getUV: () => coord } ).r
			: mix( float( 0.7 ), float( 1 ), smoothstep( float( 0.7 ).sub( fw.x ), float( 0.7 ).add( fw.x ), coord.x ) );
		const irradiance = gradient.mul( vec3( lightColor as Node<'vec3'> ) );
		( reflectedLight.directDiffuse as Node<'vec3'> ).addAssign( irradiance.mul( BRDF_Lambert( { diffuseColor: diffuseColor.rgb } ) as unknown as Node<'vec3'> ) );

		// Three's Blinn-Phong BRDF, using the same toon irradiance as diffuse.
		const halfDir = direction.add( positionViewDirection ).normalize();
		const dotNH = normalView.dot( halfDir ).clamp();
		const dotVH = positionViewDirection.dot( halfDir ).clamp();
		const fresnel = F_Schlick( { f0: specularColor, f90: float( 1 ), dotVH } ) as unknown as Node<'vec3'>;
		const distribution = shininess.mul( 0.5 ).add( 1 ).mul( 1 / Math.PI ).mul( dotNH.pow( shininess ) );
		( reflectedLight.directSpecular as Node<'vec3'> ).addAssign( irradiance.mul( fresnel ).mul( 0.25 ).mul( distribution ).mul( materialSpecularStrength ) );

	}

}

/** MMD toon diffuse, Phong specular and sphere mapping on both TSL backends. */
class MMDToonMaterial extends MeshPhongNodeMaterial {

	static get type() { return 'MMDToonMaterial'; }

	readonly isMMDToonMaterial = true;
	gradientMap: Texture | null = null;
	matcap: Texture | null = null;
	matcapCombine: Combine = AddOperation;

	constructor( parameters?: MMDToonMaterialParameters ) {

		super();
		this.setValues( parameters );

	}

	// Retain the loader's historical diffuse alias while exposing standard color.
	get diffuse(): Color { return this.color; }
	set diffuse( value: Color ) { this.color = value; }

	setupLightingModel(): PhongLightingModel { return new MMDLightingModel(); }

	setupOutput( builder: NodeBuilder, outputNode: Node ) {

		let result: Node<'vec4'> = vec4( outputNode as Node<'vec4'> );
		if ( this.matcap ) {

			const sphere = ( materialReference( 'matcap', 'texture' ) as unknown as Node<'vec4'> ).context( { getUV: () => matcapUV } ).rgb;
			const rgb = this.matcapCombine === MultiplyOperation ? result.rgb.mul( sphere ) : result.rgb.add( sphere );
			result = vec4( rgb, result.a );

		}
		return super.setupOutput( builder, result );

	}

}

export { MMDToonMaterial };
