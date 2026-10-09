import { DynamicDrawUsage } from 'three';
import type { InterleavedBufferAttribute, Material } from 'three';
import type { NodeMaterial } from 'three/webgpu';
import type { MMDMesh } from '../types.js';

const controllers = new WeakMap<MMDMesh, MMDUVMorphController>();

/** Absolute, sparse UV evaluation. The renderer consumes these attributes in TSL. */
class MMDUVMorphController {

	enabled = true;
	private weights: Float64Array;
	private previous: Float64Array;
	private values: Float64Array[];

	constructor( private mesh: MMDMesh ) {

		this.weights = new Float64Array( mesh.geometry.morphTargets.length );
		this.previous = new Float64Array( this.weights.length ).fill( NaN );
		this.values = mesh.geometry.userData.MMD.uvBases!.map( base => new Float64Array( base ) );
		( mesh.geometry.getAttribute( 'uv' ) as InterleavedBufferAttribute ).data.setUsage( DynamicDrawUsage );

	}

	apply( enabled = this.enabled ) {

		const geometry = this.mesh.geometry;
		const { uvBases, uvMorphs = [], groupMorphs = [] } = geometry.userData.MMD;
		if ( ! uvBases ) return;
		this.weights.fill( 0 );
		if ( enabled ) {

			for ( const morph of uvMorphs ) {

				const weight = this.mesh.morphTargetInfluences?.[ morph.index ] ?? 0;
				if ( Number.isFinite( weight ) ) this.weights[ morph.index ] = weight;

			}
			for ( const group of groupMorphs ) {

				const weight = this.mesh.morphTargetInfluences?.[ group.index ] ?? 0;
				if ( ! Number.isFinite( weight ) || weight === 0 ) continue;
				for ( const e of group.elements ) {

					if ( e.type === null || e.type < 3 || e.type > 7 || ! Number.isInteger( e.index ) || e.index < 0 || e.index >= this.weights.length ) continue;
					const contribution = weight * e.ratio, total = this.weights[ e.index ] + contribution;
					if ( Number.isFinite( contribution ) && Number.isFinite( total ) ) this.weights[ e.index ] = total;

				}

			}

		}
		if ( this.weights.every( ( w, i ) => w === this.previous[ i ] ) ) return;
		this.previous.set( this.weights );
		this.values.forEach( ( values, c ) => values.set( uvBases[ c ] ) );
		for ( const morph of uvMorphs ) {

			const values = this.values[ morph.channel ], weight = this.weights[ morph.index ];
			if ( ! values || weight === 0 ) continue;
			for ( const e of morph.elements ) {

				if ( ! Number.isInteger( e.index ) || e.index < 0 || e.index >= values.length / 4 ) continue;
				for ( let k = 0; k < 4; k ++ ) {

					const offset = e.index * 4 + k, value = values[ offset ] + weight * e.uv[ k ];
					// A finite JS double can overflow its GPU float32 representation.
					if ( Number.isFinite( value ) && Number.isFinite( Math.fround( value ) ) ) values[ offset ] = value;

				}

			}

		}
		this.values.forEach( ( values, c ) => {

			const attribute = geometry.getAttribute( c === 0 ? 'uv' : `mmdAdditionalUV${c}` ) as InterleavedBufferAttribute;
			for ( let i = 0; i < attribute.count; i ++ ) {

				attribute.setXY( i, values[ i * 4 ], values[ i * 4 + 1 ] );
				if ( c > 0 ) { attribute.setZ( i, values[ i * 4 + 2 ] ); attribute.setW( i, values[ i * 4 + 3 ] ); }

			}

		} );
		( geometry.getAttribute( 'uv' ) as InterleavedBufferAttribute ).data.needsUpdate = true;

	}

}

/** Update attributes immediately for CPU inspection; standalone draws also update automatically. */
export function updateMMDUVs( mesh: MMDMesh, enabled = true ) {

	let controller = controllers.get( mesh );
	if ( ! controller && mesh.geometry.userData.MMD.uvMorphs?.length ) {

		controller = new MMDUVMorphController( mesh ); controllers.set( mesh, controller );

	}
	if ( controller ) { controller.enabled = enabled; controller.apply(); }

}

export function installMMDUVUpdates( mesh: MMDMesh ) {

	if ( ! mesh.geometry.userData.MMD.uvMorphs?.length ) return;
	updateMMDUVs( mesh );
	const before = mesh.onBeforeRender, shadow = mesh.onBeforeShadow, afterShadow = mesh.onAfterShadow;
	let restoreDiffuse: ( () => void ) | undefined;
	const shadowVersions = new WeakMap<Material, WeakMap<Material, number>>();
	mesh.onBeforeRender = function ( ...args ) {

		controllers.get( mesh )?.apply(); before.apply( this, args );

	};
	mesh.onBeforeShadow = function ( ...args ) {

		controllers.get( mesh )?.apply();
		// r186 caches render objects against the shared shadow override's version,
		// which does not automatically follow changes to source sampler presence.
		// r186 declares this geometry group as Object3D.Group.
		const group = args[ 6 ] as unknown as { materialIndex?: number } | null;
		const shadowMaterial = args[ 5 ], source = mesh.material[ group?.materialIndex ?? 0 ];
		if ( ! source?.isMMDToonMaterial ) { shadow.apply( this, args ); return; }
		let versions = shadowVersions.get( shadowMaterial );
		if ( ! versions ) { versions = new WeakMap(); shadowVersions.set( shadowMaterial, versions ); }
		if ( versions.get( source ) !== source.version ) {

			shadowMaterial.needsUpdate = true; versions.set( source, source.version );

		}
		const material = shadowMaterial as NodeMaterial, setup = material.setupDiffuseColor;
		material.setupDiffuseColor = function ( builder ) { source.setupShadowDiffuseColor( this, builder, setup ); };
		restoreDiffuse = () => { material.setupDiffuseColor = setup; };
		shadow.apply( this, args );

	};
	mesh.onAfterShadow = function ( ...args ) {

		restoreDiffuse?.(); restoreDiffuse = undefined; afterShadow.apply( this, args );

	};

}
