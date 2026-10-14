import { mmdAdditionalUV } from './MMDUV.js';
import { hasSdef, setupMMDPosition } from '../skinning/MMDSdef.js';
import { AddOperation, Color, MultiplyOperation, Vector4 } from 'three';
import type { Combine, Texture } from 'three';
import { MeshPhongNodeMaterial, PhongLightingModel } from 'three/webgpu';
import type { MeshPhongNodeMaterialParameters, Node, NodeBuilder, NodeMaterial } from 'three/webgpu';
import type { LightingModelDirectInput, LightingModelReflectedLight } from 'three/src/nodes/core/LightingModel.js';
import {
	BRDF_Lambert, F_Schlick, Fn, diffuseColor, float, materialColor, materialReference, reference,
	materialEmissive, materialSpecularStrength, matcapUV, mix, normalView, positionViewDirection,
	property, shininess, smoothstep, specularColor, vec2, vec3, vec4
} from 'three/tsl';

const samplerFactor = ( name: string ) => materialReference( name, 'vec4' ) as unknown as Node<'vec4'>;

export interface MMDOutlineParameters {
	thickness: number;
	color: number[];
	alpha: number;
	visible: boolean;
}

export interface MMDToonMaterialParameters extends MeshPhongNodeMaterialParameters {
	diffuse?: Color;
	/** MMD ambient in Three's linear working space; independent of emissive. */
	ambient?: Color;
	gradientMap?: Texture | null;
	matcap?: Texture | null;
	matcapCombine?: Combine;
	/** PMX mode 3 uses an additional UV1 RGBA layer before specular lighting. */
	matcapMode?: 'sphere' | 'subtexture';
}

// Adapted from r186 ToonLightingModel and PhongLightingModel. Keep Three's
// indirect lighting, shadows, light maps and AO. Ambient and sphere composition
// are MMD-specific; see docs/material-shading.md for the reference and extensions.
// Casts below supply the vector types omitted by some r186 TSL declarations;
// the underlying values are Three's nodes, with no custom shader source.
class MMDLightingModel extends PhongLightingModel {

	private ambientRamp = property( 'vec3' );
	private directCount = 0;

	start( builder: NodeBuilder ) {

		this.directCount = 0;
		this.ambientRamp.assign( vec3( 0 ) );
		super.start( builder );

	}

	direct( { lightDirection, lightColor, reflectedLight }: LightingModelDirectInput, builder: NodeBuilder ) {

		const direction = vec3( lightDirection as Node<'vec3'> );
		const coord = vec2( normalView.dot( direction ).mul( 0.5 ).add( 0.5 ), 0 );
		const material = builder.material as MMDToonMaterial;
		const fw = coord.fwidth().mul( 0.5 );
		const gradient = material.gradientMap
			? ( materialReference( 'gradientMap', 'texture' ) as unknown as Node<'vec4'> ).context( { getUV: () => coord } ).rgb.mul( samplerFactor( 'mmdToonColor' ).rgb )
			: mix( float( 0.7 ), float( 1 ), smoothstep( float( 0.7 ).sub( fw.x ), float( 0.7 ).add( fw.x ), coord.x ) );
		this.ambientRamp.addAssign( gradient );
		this.directCount ++;
		const irradiance = gradient.mul( vec3( lightColor as Node<'vec3'> ) );
		( reflectedLight.directDiffuse as Node<'vec3'> ).addAssign( irradiance.mul( BRDF_Lambert( { diffuseColor: diffuseColor.rgb } ) as unknown as Node<'vec3'> ) );

		// Specular is separate from the base texture, ambient and toon ramp.
		const halfDir = direction.add( positionViewDirection ).normalize();
		const dotNH = normalView.dot( halfDir ).clamp();
		const dotVH = positionViewDirection.dot( halfDir ).clamp();
		const fresnel = F_Schlick( { f0: specularColor, f90: float( 1 ), dotVH } ) as unknown as Node<'vec3'>;
		const distribution = shininess.mul( 0.5 ).add( 1 ).mul( 1 / Math.PI ).mul( dotNH.pow( shininess ) );
		( reflectedLight.directSpecular as Node<'vec3'> ).addAssign( vec3( lightColor as Node<'vec3'> ).mul( fresnel ).mul( 0.25 ).mul( distribution ).mul( materialSpecularStrength ) );

	}

	finish( builder: NodeBuilder ) {

		const material = builder.material as MMDToonMaterial;
		const { reflectedLight, outgoingLight } = builder.context as { reflectedLight: LightingModelReflectedLight; outgoingLight: Node<'vec3'> };
		// MMD has one global directional light. Average ramps for Three's
		// multiple-light extension so ambient is added exactly once.
		const ramp = this.directCount ? this.ambientRamp.div( this.directCount ) : vec3( 1 );
		const specular = vec3( reflectedLight.directSpecular as Node<'vec3'> ).add( vec3( reflectedLight.indirectSpecular as Node<'vec3'> ) );
		const surface = outgoingLight.sub( specular ).add( material.setupMMDAmbient().mul( ramp ) );
		outgoingLight.assign( material.setupMMDSphere( surface, ramp ).add( specular ) );
		super.finish( builder );

	}

}

/** MMD toon diffuse, Phong specular and sphere mapping on both TSL backends. */
class MMDToonMaterial extends MeshPhongNodeMaterial {

	static get type() { return 'MMDToonMaterial'; }

	readonly isMMDToonMaterial = true;
	/** Original MMD ambient, converted to the linear working space. */
	ambient = new Color( 0, 0, 0 );
	gradientMap: Texture | null = null;
	matcap: Texture | null = null;
	matcapCombine: Combine = AddOperation;
	matcapMode: 'sphere' | 'subtexture' = 'sphere';
	/** Linear working-space sampler factors; PMX evaluation happens in source sRGB. */
	mmdTextureColor = new Vector4( 1, 1, 1, 1 );
	mmdSphereColor = new Vector4( 1, 1, 1, 1 );
	mmdToonColor = new Vector4( 1, 1, 1, 1 );
	// r186 provides this runtime property; its published typings omit it.
	emissiveNode: Node | null = null;
	private mmdShadowMask: Node;

	constructor( parameters?: MMDToonMaterialParameters ) {

		super();
		this.mmdShadowMask = this.createShadowMask();
		this.maskShadowNode = this.mmdShadowMask;
		this.setValues( parameters );

	}

	set needsUpdate( value: boolean ) {

		// Shadow Fn graphs capture sampler presence. Rebuild our mask when Three
		// invalidates the material, so map/alphaMap replacement cannot retain a
		// reference to a removed texture. Preserve application-supplied masks.
		if ( value && this.mmdShadowMask && this.maskShadowNode === this.mmdShadowMask ) {

			this.maskShadowNode = this.mmdShadowMask = this.createShadowMask();

		}
		super.needsUpdate = value;

	}

	// Retain the loader's historical diffuse alias while exposing standard color.
	get diffuse(): Color { return this.color; }
	set diffuse( value: Color ) { this.color = value; }

	setupPosition( builder: NodeBuilder ) {

		return hasSdef( builder ) ? setupMMDPosition( this, builder ) : super.setupPosition( builder );

	}

	setupLightingModel(): PhongLightingModel { return new MMDLightingModel(); }

	private createShadowMask() {

		// r186 uses an override NodeMaterial for shadows and does not forward
		// source opacity. Explicit source references keep zero-alpha casters and
		// alpha-tested sampler factors correct without replacing that pass.
		return Fn( () => {

			let alpha: Node<'float'> = reference( 'opacity', 'float', this ) as unknown as Node<'float'>;
			if ( this.map ) alpha = alpha.mul( ( reference( 'map', 'texture', this ) as unknown as Node<'vec4'> ).a ).mul( ( reference( 'mmdTextureColor', 'vec4', this ) as unknown as Node<'vec4'> ).a );
			if ( this.matcap ) {

				alpha = alpha.mul( ( reference( 'mmdSphereColor', 'vec4', this ) as unknown as Node<'vec4'> ).a );
				if ( this.matcapMode === 'subtexture' ) alpha = alpha.mul( ( reference( 'matcap', 'texture', this ) as unknown as Node<'vec4'> ).context( { getUV: () => mmdAdditionalUV( 1 ).xy } ).a );

			}
			if ( this.gradientMap ) alpha = alpha.mul( ( reference( 'mmdToonColor', 'vec4', this ) as unknown as Node<'vec4'> ).a );
			if ( this.alphaMap ) alpha = alpha.mul( ( reference( 'alphaMap', 'texture', this ) as unknown as Node<'vec4'> ).g );
			return alpha.greaterThan( reference( 'alphaTest', 'float', this ) as unknown as Node<'float'> );

		} )();

	}

	/** Keep r186's override from filtering alpha again after the source mask. */
	setupShadowDiffuseColor( material: NodeMaterial, builder: NodeBuilder, setup: ( builder: NodeBuilder ) => void ) {

		const opacityNode = material.opacityNode, alphaTest = material.alphaTest;
		if ( this.maskShadowNode === this.mmdShadowMask ) {

			// Our source mask already evaluates opacity, sampler factors and alpha
			// test together. The override's default alphaMap path uses red and can
			// also reject valid samples boosted by source material morph factors.
			material.opacityNode = float( 1 ); material.alphaTest = 0;

		} else if ( this.alphaMap && ! opacityNode ) {

			material.opacityNode = ( materialReference( 'alphaMap', 'texture' ) as unknown as Node<'vec4'> ).g;

		}
		try { setup.call( material, builder ); }
		finally { material.opacityNode = opacityNode; material.alphaTest = alphaTest; }

	}

	setupDiffuseColor( builder: NodeBuilder ) {

		// Supply factors before Three's opacity/alpha-test/shadow processing.
		// Restore user nodes immediately: these are build-local expressions.
		const colorNode = this.colorNode;
		const opacityNode = this.opacityNode;
		let color: Node<'vec4'> = vec4( ( colorNode ?? materialColor ) as Node<'vec4'> );
		if ( this.map ) color = color.mul( samplerFactor( 'mmdTextureColor' ) );
		// SubTexture is a second RGBA layer, not the view-based sphere operation.
		// Nanoem's model_color SubTexture branch multiplies before specular.
		if ( this.matcap && this.matcapMode === 'subtexture' ) color = color.mul( this.subtextureSample() ).mul( vec4( samplerFactor( 'mmdSphereColor' ).rgb, 1 ) );
		// Sample alphaMap.g explicitly so surface and shadow use the same channel.
		let opacity: Node<'float'> = opacityNode ? float( opacityNode as Node<'float'> ) : materialReference( 'opacity', 'float' ) as unknown as Node<'float'>;
		if ( this.alphaMap && ! opacityNode ) opacity = opacity.mul( ( materialReference( 'alphaMap', 'texture' ) as unknown as Node<'vec4'> ).g );
		if ( this.matcap ) opacity = opacity.mul( samplerFactor( 'mmdSphereColor' ).a );
		if ( this.gradientMap ) opacity = opacity.mul( samplerFactor( 'mmdToonColor' ).a );
		this.colorNode = color; this.opacityNode = opacity;
		try {

			super.setupDiffuseColor( builder );
			// A zero-alpha material must not leave invisible depth/shadow occluders.
			if ( this.transparent ) diffuseColor.a.lessThanEqual( 0 ).discard();

		}
		finally { this.colorNode = colorNode; this.opacityNode = opacityNode; }

	}

	copy( source: this ): this {

		super.copy( source );
		this.ambient.copy( source.ambient );
		this.gradientMap = source.gradientMap;
		this.matcap = source.matcap;
		this.matcapCombine = source.matcapCombine;
		this.matcapMode = source.matcapMode;
		this.mmdTextureColor.copy( source.mmdTextureColor );
		this.mmdSphereColor.copy( source.mmdSphereColor );
		this.mmdToonColor.copy( source.mmdToonColor );
		if ( source.maskShadowNode === source.mmdShadowMask ) this.maskShadowNode = this.mmdShadowMask = this.createShadowMask();
		return this;

	}

	private subtextureSample(): Node<'vec4'> {

		return ( materialReference( 'matcap', 'texture' ) as unknown as Node<'vec4'> ).context( { getUV: () => mmdAdditionalUV( 1 ).xy } );

	}

	/** Texture-modulated MMD ambient; 0.5 follows babylon-mmd's documented MMD coefficient. */
	setupMMDAmbient(): Node<'vec3'> {

		let ambient = ( materialReference( 'ambient', 'color' ) as unknown as Node<'vec3'> ).mul( 0.5 );
		if ( this.map ) ambient = ambient.mul( ( materialReference( 'map', 'texture' ) as unknown as Node<'vec4'> ).rgb ).mul( samplerFactor( 'mmdTextureColor' ).rgb );
		if ( this.matcap && this.matcapMode === 'subtexture' ) ambient = ambient.mul( this.subtextureSample().rgb ).mul( samplerFactor( 'mmdSphereColor' ).rgb );
		return ambient;

	}

	setupOutgoingLight() {

		// Three skips the lighting model entirely when there are no scene lights.
		return this.setupMMDSphere( vec3( super.setupOutgoingLight() as Node<'vec3'> ).add( this.setupMMDAmbient() ) );

	}

	setupLighting( builder: NodeBuilder ) {

		const emissiveNode = this.emissiveNode;
		if ( this.matcap && this.matcapMode === 'subtexture' ) {

			this.emissiveNode = vec3( ( emissiveNode ?? materialEmissive ) as Node<'vec3'> ).mul( this.subtextureSample().rgb ).mul( samplerFactor( 'mmdSphereColor' ).rgb );

		}
		if ( this.matcap && this.matcapMode === 'sphere' && this.matcapCombine === MultiplyOperation ) {

			// Preserve user emission's existing sphere-multiply behavior.
			this.emissiveNode = this.setupMMDSphere( vec3( ( emissiveNode ?? materialEmissive ) as Node<'vec3'> ) );

		}
		try { return super.setupLighting( builder ); }
		finally { this.emissiveNode = emissiveNode; }

	}

	/** Sphere modes affect the surface before separate specular lighting. */
	setupMMDSphere( surface: Node<'vec3'>, ramp: Node<'vec3'> = vec3( 1 ) ): Node<'vec3'> {
		if ( this.matcap && this.matcapMode === 'sphere' ) {

			const sphere = ( materialReference( 'matcap', 'texture' ) as unknown as Node<'vec4'> ).context( { getUV: () => matcapUV } ).rgb.mul( samplerFactor( 'mmdSphereColor' ).rgb );
			return this.matcapCombine === MultiplyOperation ? surface.mul( sphere ) : surface.add( sphere.mul( ramp ) );

		}
		return surface;

	}

}

export { MMDToonMaterial };
