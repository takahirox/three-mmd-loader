import { hasSdef, setupMMDPosition } from '../skinning/MMDSdef.js';
import { BackSide, Color } from 'three';
import type { Camera, Scene, Texture } from 'three';
import { NodeMaterial } from 'three/webgpu';
import type { NodeBuilder, Renderer } from 'three/webgpu';
import {
	Fn, attribute, cameraProjectionMatrix, float, modelViewMatrix,
	normalLocal, positionLocal, uniform, vec4
} from 'three/tsl';
import { MMDToonMaterial } from '../materials/MMDToonMaterial.js';

class OutlineMaterial extends NodeMaterial {
	displacementMap: Texture | null = null;
	displacementScale = 1;
	displacementBias = 0;

	setupPosition( builder: NodeBuilder ) {

		return hasSdef( builder ) ? setupMMDPosition( this, builder ) : super.setupPosition( builder );

	}
}

function createOutline() {

	const color = uniform( new Color() );
	const thickness = uniform( 0 );
	const alpha = uniform( 1 );
	const material = new OutlineMaterial();
	material.name = 'MMD outline';
	material.side = BackSide;
	// Adapted from Three.js r186 ToonOutlinePassNode. NodeMaterial's normal
	// vertex setup performs morphing, skinning and displacement before this node.
	material.vertexNode = Fn( ( builder ) => {

		const mvp = cameraProjectionMatrix.mul( modelViewMatrix );
		const pos = mvp.mul( vec4( positionLocal, 1 ) );
		const pos2 = mvp.mul( vec4( positionLocal.sub( normalLocal ), 1 ) );
		const ratio = builder.geometry.hasAttribute( 'mmdEdgeRatio' ) ? attribute( 'mmdEdgeRatio', 'float' ) : float( 1 );
		return pos.add( pos.sub( pos2 ).normalize().mul( thickness ).mul( pos.w ).mul( ratio ) );

	} )();
	material.colorNode = color;
	material.opacityNode = alpha;
	return { material, color, thickness, alpha, sourceVersion: - 1 };

}

/** Per-material inverted hull outlines for WebGPURenderer, including forceWebGL. */
class MMDOutlineEffect {

	enabled = true;
	private readonly cache = new Map<MMDToonMaterial, ReturnType<typeof createOutline>>();
	private readonly listeners = new Map<MMDToonMaterial, () => void>();

	constructor( readonly renderer: Renderer ) {}

	render( scene: Scene, camera: Camera ) {

		const renderer = this.renderer;
		if ( ! this.enabled ) { renderer.render( scene, camera ); return; }
		const previous = renderer.getRenderObjectFunction();
		renderer.setRenderObjectFunction( ( object, scene, camera, geometry, material, group, lights, clipping, passId ) => {

			if ( material instanceof MMDToonMaterial && material.visible && ! material.wireframe && material.depthTest ) {

				const parameters = material.userData.outlineParameters;
				if ( parameters?.visible && parameters.thickness > 0 && parameters.alpha > 0 ) {

					let entry = this.cache.get( material );
					if ( ! entry ) {

						entry = createOutline();
						this.cache.set( material, entry );
						const release = () => {

							this.cache.get( material )?.material.dispose();
							this.cache.delete( material );
							material.removeEventListener( 'dispose', release );
							this.listeners.delete( material );

						};
						this.listeners.set( material, release );
						material.addEventListener( 'dispose', release );

					}
					entry.color.value.setRGB( parameters.color[ 0 ], parameters.color[ 1 ], parameters.color[ 2 ] );
					entry.thickness.value = parameters.thickness;
					entry.alpha.value = parameters.alpha;
					const outline = entry.material;
					const transparent = parameters.alpha < 1 || material.transparent;
					// These settings affect the generated nodes, not just uniform values.
					// Forward source invalidation too (e.g. changed texture sampler settings).
					const needsUpdate = entry.sourceVersion !== material.version ||
						outline.transparent !== transparent || outline.fog !== material.fog ||
						outline.displacementMap !== material.displacementMap;
					outline.transparent = transparent;
					outline.depthWrite = material.depthWrite;
					outline.clippingPlanes = material.clippingPlanes;
					outline.clipIntersection = material.clipIntersection;
					outline.fog = material.fog;
					outline.displacementMap = material.displacementMap;
					outline.displacementScale = material.displacementScale;
					outline.displacementBias = material.displacementBias;
					if ( needsUpdate ) outline.needsUpdate = true;
					entry.sourceVersion = material.version;
					renderer.renderObject( object, scene, camera, geometry, outline, group, lights, clipping, 'mmd-outline' );

				}

			}
			if ( previous ) previous.call( renderer, object, scene, camera, geometry, material, group, lights, clipping, passId );
			else renderer.renderObject( object, scene, camera, geometry, material, group, lights, clipping, passId );

		} );
		try { renderer.render( scene, camera ); }
		finally { renderer.setRenderObjectFunction( previous ); }

	}

	dispose() {

		for ( const release of this.listeners.values() ) release();

	}

}

export { MMDOutlineEffect };
