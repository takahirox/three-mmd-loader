import { installMMDUVUpdates } from '../animation/MMDUVMorphController.js';
import { copyMaterialValues, freezeMaterialValues } from '../animation/MMDMaterialMorphController.js';
import { protectMMDMorphWeights } from '../animation/MMDMorphWeights.js';
import { enableSdefShadows } from '../skinning/MMDSdef.js';
import { Camera, InterleavedBuffer, InterleavedBufferAttribute, LoadingManager } from 'three';
import type { Texture, TypedArray, KeyframeTrack } from 'three';
import { Parser } from 'mmd-parser';
import type { Model, Pmd, Pmx, PmdMorph, PmxVertexMorph, Vmd, VmdMotion, VmdMorph, Vpd } from 'mmd-parser';
import type { MMDBone, MMDBoneMorph, MMDGroupMorph, MMDMaterialMorph, MMDUVMorph, MMDGeometry, MMDMesh, IK, IKLink, Grant, RigidBodyParameters, ConstraintParameters } from '../types.js';
import {
	AddOperation,
	AnimationClip,
	Bone,
	BufferGeometry,
	Color,
	CustomBlending,
	DoubleSide,
	DstAlphaFactor,
	Euler,
	FileLoader,
	Float32BufferAttribute,
	FrontSide,
	Interpolant,
	Loader,
	LoaderUtils,
	MultiplyOperation,
	NearestFilter,
	NumberKeyframeTrack,
	OneMinusSrcAlphaFactor,
	Quaternion,
	QuaternionKeyframeTrack,
	RepeatWrapping,
	Skeleton,
	SkinnedMesh,
	SrcAlphaFactor,
	SRGBColorSpace,
	TextureLoader,
	Uint16BufferAttribute,
	Vector3,
	VectorKeyframeTrack,
	RGB_S3TC_DXT1_Format,
	RGB_PVRTC_4BPPV1_Format,
	RGB_PVRTC_2BPPV1_Format,
	RGB_ETC1_Format,
	RGB_ETC2_Format
} from 'three';
import { MMDToonMaterial } from '../materials/MMDToonMaterial.js';
import type { MMDToonMaterialParameters, MMDOutlineParameters } from '../materials/MMDToonMaterial.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';

// The parser discriminates models through their nested metadata.
function isPmd( data: Model ): data is Pmd {

	return data.metadata.format === 'pmd';

}

type OnProgress = ( event: ProgressEvent ) => void;
type OnError = ( error: unknown ) => void;
type MMDTexture = Texture & { readyCallbacks?: ( ( texture: MMDTexture ) => void )[]; transparent?: boolean; isCompressedTexture?: boolean };
type TextureOptions = { isToonTexture?: boolean; isDefaultToonTexture?: boolean };
type MMDMaterialParameters = MMDToonMaterialParameters & {
	map?: MMDTexture;
	userData: { MMD: { mapFileName?: string; matcapFileName?: string }; outlineParameters?: MMDOutlineParameters };
};


/**
 * Dependencies
 *  - mmd-parser https://github.com/takahirox/mmd-parser
 *  - TGALoader
 *  - MMDToonMaterial (TSL / NodeMaterial)
 *
 * MMDLoader creates Three.js Objects from MMD resources as
 * PMD, PMX, VMD, and VPD files.
 *
 * PMD/PMX is a model data format, VMD is a motion data format
 * VPD is a posing data format used in MMD(Miku Miku Dance).
 *
 * MMD official site
 *  - https://sites.google.com/view/evpvp/
 *
 * PMD, VMD format (in Japanese)
 *  - http://blog.goo.ne.jp/torisu_tetosuki/e/209ad341d3ece2b1b4df24abf619d6e4
 *
 * PMX format
 *  - https://gist.github.com/felixjones/f8a06bd48f9da9a4539f
 *
 * TODO
 *  - light motion in vmd support.
 *  - more precise grant skinning support.
 *  - shadow support.
 */

/**
 * @param {THREE.LoadingManager} manager
 */
class MMDLoader extends Loader<MMDMesh> {

	loader: FileLoader;
	parser: Parser | null;
	meshBuilder: MeshBuilder;
	animationBuilder: AnimationBuilder;
	animationPath?: string;

	constructor( manager?: LoadingManager ) {

		super( manager );

		this.loader = new FileLoader( this.manager );

		this.parser = null; // lazy generation
		this.meshBuilder = new MeshBuilder( this.manager );
		this.animationBuilder = new AnimationBuilder();

	}

	/**
	 * @param {string} animationPath
	 * @return {MMDLoader}
	 */
	setAnimationPath( animationPath: string ) {

		this.animationPath = animationPath;
		return this;

	}

	// Load MMD assets as Three.js Object

	/**
	 * Loads Model file (.pmd or .pmx) as a SkinnedMesh.
	 *
	 * @param {string} url - url to Model(.pmd or .pmx) file
	 * @param {function} onLoad
	 * @param {function} onProgress
	 * @param {function} onError
	 */
	load( url: string, onLoad: ( mesh: MMDMesh ) => void, onProgress?: OnProgress, onError?: OnError ) {

		const builder = this.meshBuilder.setCrossOrigin( this.crossOrigin );

		// resource path

		let resourcePath;

		if ( this.resourcePath !== '' ) {

			resourcePath = this.resourcePath;

		} else if ( this.path !== '' ) {

			resourcePath = this.path;

		} else {

			resourcePath = LoaderUtils.extractUrlBase( url );

		}

		const parser = this._getParser();
		const extractModelExtension = this._extractModelExtension;

		this.loader
			.setMimeType( '' )
			.setPath( this.path )
			.setResponseType( 'arraybuffer' )
			.setRequestHeader( this.requestHeader )
			.setWithCredentials( this.withCredentials )
			.load( url, function ( buffer ) {

				try {

					const modelExtension = extractModelExtension( buffer as ArrayBuffer );

					if ( modelExtension !== 'pmd' && modelExtension !== 'pmx' ) {

						if ( onError ) onError( new Error( 'THREE.MMDLoader: Unknown model file extension .' + modelExtension + '.' ) );

						return;

					}

					const data = modelExtension === 'pmd' ? parser.parsePmd( buffer as ArrayBuffer, true ) : parser.parsePmx( buffer as ArrayBuffer, true );

					onLoad( builder.build( data, resourcePath, onProgress, onError ) );

				} catch ( e ) {

					if ( onError ) onError( e );

				}

			}, onProgress, onError );

	}

	/**
	 * Loads Motion file(s) (.vmd) as a AnimationClip.
	 * If two or more files are specified, they'll be merged.
	 *
	 * @param {string|Array<string>} url - url(s) to animation(.vmd) file(s)
	 * @param {SkinnedMesh|THREE.Camera} object - tracks will be fitting to this object
	 * @param {function} onLoad
	 * @param {function} onProgress
	 * @param {function} onError
	 */
	loadAnimation( url: string | string[], object: SkinnedMesh | Camera, onLoad: ( animation: AnimationClip ) => void, onProgress?: OnProgress, onError?: OnError ) {

		const builder = this.animationBuilder;

		this.loadVMD( url, function ( vmd ) {

			onLoad( isCamera( object )
				? builder.buildCameraAnimation( vmd )
				: builder.build( vmd, object ) );

		}, onProgress, onError );

	}

	/**
	 * Loads mode file and motion file(s) as an object containing
	 * a SkinnedMesh and a AnimationClip.
	 * Tracks of AnimationClip are fitting to the model.
	 *
	 * @param {string} modelUrl - url to Model(.pmd or .pmx) file
	 * @param {string|Array{string}} vmdUrl - url(s) to animation(.vmd) file
	 * @param {function} onLoad
	 * @param {function} onProgress
	 * @param {function} onError
	 */
	loadWithAnimation( modelUrl: string, vmdUrl: string | string[], onLoad: ( result: { mesh: MMDMesh; animation: AnimationClip } ) => void, onProgress?: OnProgress, onError?: OnError ) {

		const scope = this;

		this.load( modelUrl, function ( mesh ) {

			scope.loadAnimation( vmdUrl, mesh, function ( animation ) {

				onLoad( {
					mesh: mesh,
					animation: animation
				} );

			}, onProgress, onError );

		}, onProgress, onError );

	}

	// Load MMD assets as Object data parsed by mmd-parser

	/**
	 * Loads .pmd file as an Object.
	 *
	 * @param {string} url - url to .pmd file
	 * @param {function} onLoad
	 * @param {function} onProgress
	 * @param {function} onError
	 */
	loadPMD( url: string, onLoad: ( data: Pmd ) => void, onProgress?: OnProgress, onError?: OnError ) {

		const parser = this._getParser();

		this.loader
			.setMimeType( '' )
			.setPath( this.path )
			.setResponseType( 'arraybuffer' )
			.setRequestHeader( this.requestHeader )
			.setWithCredentials( this.withCredentials )
			.load( url, function ( buffer ) {

				try {

					onLoad( parser.parsePmd( buffer as ArrayBuffer, true ) );

				} catch ( e ) {

					if ( onError ) onError( e );

				}

			}, onProgress, onError );

	}

	/**
	 * Loads .pmx file as an Object.
	 *
	 * @param {string} url - url to .pmx file
	 * @param {function} onLoad
	 * @param {function} onProgress
	 * @param {function} onError
	 */
	loadPMX( url: string, onLoad: ( data: Pmx ) => void, onProgress?: OnProgress, onError?: OnError ) {

		const parser = this._getParser();

		this.loader
			.setMimeType( '' )
			.setPath( this.path )
			.setResponseType( 'arraybuffer' )
			.setRequestHeader( this.requestHeader )
			.setWithCredentials( this.withCredentials )
			.load( url, function ( buffer ) {

				try {

					onLoad( parser.parsePmx( buffer as ArrayBuffer, true ) );

				} catch ( e ) {

					if ( onError ) onError( e );

				}

			}, onProgress, onError );

	}

	/**
	 * Loads .vmd file as an Object. If two or more files are specified
	 * they'll be merged.
	 *
	 * @param {string|Array<string>} url - url(s) to .vmd file(s)
	 * @param {function} onLoad
	 * @param {function} onProgress
	 * @param {function} onError
	 */
	loadVMD( url: string | string[], onLoad: ( data: Vmd ) => void, onProgress?: OnProgress, onError?: OnError ) {

		const urls = Array.isArray( url ) ? url : [ url ];

		const vmds: Vmd[] = [];
		const vmdNum = urls.length;

		const parser = this._getParser();

		this.loader
			.setMimeType( '' )
			.setPath( this.animationPath ?? '' )
			.setResponseType( 'arraybuffer' )
			.setRequestHeader( this.requestHeader )
			.setWithCredentials( this.withCredentials );

		for ( let i = 0, il = urls.length; i < il; i ++ ) {

			this.loader.load( urls[ i ], function ( buffer ) {

				try {

					vmds.push( parser.parseVmd( buffer as ArrayBuffer, true ) );

					if ( vmds.length === vmdNum ) onLoad( parser.mergeVmds( vmds ) );

				} catch ( e ) {

					if ( onError ) onError( e );

				}

			}, onProgress, onError );

		}

	}

	/**
	 * Loads .vpd file as an Object.
	 *
	 * @param {string} url - url to .vpd file
	 * @param {boolean} isUnicode
	 * @param {function} onLoad
	 * @param {function} onProgress
	 * @param {function} onError
	 */
	loadVPD( url: string, isUnicode: boolean, onLoad: ( data: Vpd ) => void, onProgress?: OnProgress, onError?: OnError ) {

		const parser = this._getParser();

		this.loader
			.setMimeType( isUnicode ? '' : 'text/plain; charset=shift_jis' )
			.setPath( this.animationPath ?? '' )
			.setResponseType( 'text' )
			.setRequestHeader( this.requestHeader )
			.setWithCredentials( this.withCredentials )
			.load( url, function ( text ) {

				try {

					onLoad( parser.parseVpd( text as string, true ) );

				} catch ( e ) {

					if ( onError ) onError( e );

				}

			}, onProgress, onError );

	}

	// private methods

	_extractModelExtension( buffer: ArrayBuffer ) {

		const decoder = new TextDecoder( 'utf-8' );
		const bytes = new Uint8Array( buffer, 0, 3 );
		return decoder.decode( bytes ).toLowerCase();

	}

	_getParser() {

		if ( this.parser === null ) {

			this.parser = new Parser();

		}

		return this.parser;

	}

}

function isCamera( object: SkinnedMesh | Camera ): object is Camera {

	return 'isCamera' in object && object.isCamera === true;

}

// Utilities

/*
	 * base64 encoded defalut toon textures toon00.bmp - toon10.bmp.
	 * We don't need to request external toon image files.
	 */
const DEFAULT_TOON_TEXTURES = [
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVRYR+3QQREAAAzCsOFfNJPBJ1XQS9r2hsUAAQIECBAgQIAAAQIECBAgsBZ4MUx/ofm2I/kAAAAASUVORK5CYII=',
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAN0lEQVRYR+3WQREAMBACsZ5/bWiiMvgEBTt5cW37hjsBBAgQIECAwFwgyfYPCCBAgAABAgTWAh8aBHZBl14e8wAAAABJRU5ErkJggg==',
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAOUlEQVRYR+3WMREAMAwDsYY/yoDI7MLwIiP40+RJklfcCCBAgAABAgTqArfb/QMCCBAgQIAAgbbAB3z/e0F3js2cAAAAAElFTkSuQmCC',
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAN0lEQVRYR+3WQREAMBACsZ5/B5ilMvgEBTt5cW37hjsBBAgQIECAwFwgyfYPCCBAgAABAgTWAh81dWyx0gFwKAAAAABJRU5ErkJggg==',
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAOklEQVRYR+3WoREAMAwDsWb/UQtCy9wxTOQJ/oQ8SXKKGwEECBAgQIBAXeDt7f4BAQQIECBAgEBb4AOz8Hzx7WLY4wAAAABJRU5ErkJggg==',
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABPUlEQVRYR+1XwW7CMAy1+f9fZOMysSEOEweEOPRNdm3HbdOyIhAcklPrOs/PLy9RygBALxzcCDQFmgJNgaZAU6Ap0BR4PwX8gsRMVLssMRH5HcpzJEaWL7EVg9F1IHRlyqQohgVr4FGUlUcMJSjcUlDw0zvjeun70cLWmneoyf7NgBTQSniBTQQSuJAZsOnnaczjIMb5hCiuHKxokCrJfVnrctyZL0PkJAJe1HMil4nxeyi3Ypfn1kX51jpPvo/JeCNC4PhVdHdJw2XjBR8brF8PEIhNVn12AgP7uHsTBguBn53MUZCqv7Lp07Pn5k1Ro+uWmUNn7D+M57rtk7aG0Vo73xyF/fbFf0bPJjDXngnGocDTdFhygZjwUQrMNrDcmZlQT50VJ/g/UwNyHpu778+yW+/ksOz/BFo54P4AsUXMfRq7XWsAAAAASUVORK5CYII=',
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACMElEQVRYR+2Xv4pTQRTGf2dubhLdICiii2KnYKHVolhauKWPoGAnNr6BD6CvIVaihYuI2i1ia0BY0MZGRHQXjZj/mSPnnskfNWiWZUlzJ5k7M2cm833nO5Mziej2DWWJRUoCpQKlAntSQCqgw39/iUWAGmh37jrRnVsKlgpiqmkoGVABA7E57fvY+pJDdgKqF6HzFCSADkDq+F6AHABtQ+UMVE5D7zXod7fFNhTEckTbj5XQgHzNN+5tQvc5NG7C6BNkp6D3EmpXHDR+dQAjFLchW3VS9rlw3JBh+B7ys5Cf9z0GW1C/7P32AyBAOAz1q4jGliIH3YPuBnSfQX4OGreTIgEYQb/pBDtPnEQ4CivXYPAWBk13oHrB54yA9QuSn2H4AcKRpEILDt0BUzj+RLR1V5EqjD66NPRBVpLcQwjHoHYJOhsQv6U4mnzmrIXJCFr4LDwm/xBUoboG9XX4cc9VKdYoSA2yk5NQLJaKDUjTBoveG3Z2TElTxwjNK4M3LEZgUdDdruvcXzKBpStgp2NPiWi3ks9ZXxIoFVi+AvHLdc9TqtjL3/aYjpPlrzOcEnK62Szhimdd7xX232zFDTgtxezOu3WNMRLjiKgjtOhHVMd1loynVHvOgjuIIJMaELEqhJAV/RCSLbWTcfPFakFgFlALTRRvx+ok6Hlp/Q+v3fmx90bMyUzaEAhmM3KvHlXTL5DxnbGf/1M8RNNACLL5MNtPxP/mypJAqcDSFfgFhpYqWUzhTEAAAAAASUVORK5CYII=',
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVRYR+3QQREAAAzCsOFfNJPBJ1XQS9r2hsUAAQIECBAgQIAAAQIECBAgsBZ4MUx/ofm2I/kAAAAASUVORK5CYII=',
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVRYR+3QQREAAAzCsOFfNJPBJ1XQS9r2hsUAAQIECBAgQIAAAQIECBAgsBZ4MUx/ofm2I/kAAAAASUVORK5CYII=',
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVRYR+3QQREAAAzCsOFfNJPBJ1XQS9r2hsUAAQIECBAgQIAAAQIECBAgsBZ4MUx/ofm2I/kAAAAASUVORK5CYII=',
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVRYR+3QQREAAAzCsOFfNJPBJ1XQS9r2hsUAAQIECBAgQIAAAQIECBAgsBZ4MUx/ofm2I/kAAAAASUVORK5CYII='
];

const NON_ALPHA_CHANNEL_FORMATS: number[] = [
	RGB_S3TC_DXT1_Format,
	RGB_PVRTC_4BPPV1_Format,
	RGB_PVRTC_2BPPV1_Format,
	RGB_ETC1_Format,
	RGB_ETC2_Format
];

// Builders. They build Three.js object from Object data parsed by mmd-parser.

/**
 * @param {THREE.LoadingManager} manager
 */
class MeshBuilder {

	crossOrigin: string;
	geometryBuilder: GeometryBuilder;
	materialBuilder: MaterialBuilder;

	constructor( manager?: LoadingManager ) {

		this.crossOrigin = 'anonymous';
		this.geometryBuilder = new GeometryBuilder();
		this.materialBuilder = new MaterialBuilder( manager );

	}

	/**
	 * @param {string} crossOrigin
	 * @return {MeshBuilder}
	 */
	setCrossOrigin( crossOrigin: string ) {

		this.crossOrigin = crossOrigin;
		return this;

	}

	/**
	 * @param {Object} data - parsed PMD/PMX data
	 * @param {string} resourcePath
	 * @param {function} onProgress
	 * @param {function} onError
	 * @return {SkinnedMesh}
	 */
	build( data: Model, resourcePath: string, onProgress?: OnProgress, onError?: OnError ) {

		const geometry = this.geometryBuilder.build( data );
		const material = this.materialBuilder
			.setCrossOrigin( this.crossOrigin )
			.setResourcePath( resourcePath )
			.build( data, geometry, onProgress, onError );

		const mesh = new SkinnedMesh( geometry, material );
		if ( geometry.morphTargets.length ) protectMMDMorphWeights( mesh );

		const skeleton = new Skeleton( initBones( mesh ) );
		mesh.bind( skeleton );
		if ( geometry.hasAttribute( 'mmdSdefC' ) ) enableSdefShadows( mesh );
		installMMDUVUpdates( mesh );

		// console.log( mesh ); // for console debug

		return mesh;

	}

}

// TODO: Try to remove this function

function initBones( mesh: MMDMesh ) {

	const geometry = mesh.geometry;

	const bones: Bone[] = [];

	if ( geometry && geometry.bones !== undefined ) {

		// first, create array of 'Bone' objects from geometry data

		for ( let i = 0, il = geometry.bones.length; i < il; i ++ ) {

			const gbone = geometry.bones[ i ];

			// create new 'Bone' object

			const bone = new Bone();
			bones.push( bone );

			// apply values

			bone.name = gbone.name;
			bone.position.fromArray( gbone.pos );
			bone.quaternion.fromArray( gbone.rotq );
			if ( gbone.scl !== undefined ) bone.scale.fromArray( gbone.scl );

		}

		// second, create bone hierarchy

		for ( let i = 0, il = geometry.bones.length; i < il; i ++ ) {

			const gbone = geometry.bones[ i ];

			if ( ( gbone.parent !== - 1 ) && ( gbone.parent !== null ) && ( bones[ gbone.parent ] !== undefined ) ) {

				// subsequent bones in the hierarchy

				bones[ gbone.parent ].add( bones[ i ] );

			} else {

				// topmost bone, immediate child of the skinned mesh

				mesh.add( bones[ i ] );

			}

		}

	}

	// now the bones are part of the scene graph and children of the skinned mesh.
	// let's update the corresponding matrices

	mesh.updateMatrixWorld( true );

	return bones;

}

//

class GeometryBuilder {

	/**
	 * @param {Object} data - parsed PMD/PMX data
	 * @return {BufferGeometry}
	 */
	build( data: Model ) {

		// for geometry
		const positions: number[] = [];
		const normals = [];

		const indices = [];

		const groups = [];

		const bones: MMDBone[] = [];
		const skinIndices = [];
		const skinWeights = [];
		const edgeRatios = [];
		const skinningTypes = [];
		const sdefData = [];
		const hasSdef = data.vertices.some( v => 'type' in v && v.type === 3 );

		const morphTargets = [];
		const boneMorphs: MMDBoneMorph[] = [];
		const groupMorphs: MMDGroupMorph[] = [];
		const materialMorphs: MMDMaterialMorph[] = [];
		const uvMorphs: MMDUVMorph[] = [];
		const morphPositions = [];

		const iks: IK[] = [];
		const grants: Grant[] = [];

		const rigidBodies: RigidBodyParameters[] = [];
		const constraints: ConstraintParameters[] = [];

		// for work
		let offset = 0;
		const boneTypeTable: Record<number, number> = {};

		// positions, normals, uvs, skinIndices, skinWeights

		for ( let i = 0; i < data.metadata.vertexCount; i ++ ) {

			const v = data.vertices[ i ];
			const isSdef = 'type' in v && v.type === 3;
			skinningTypes.push( 'type' in v ? v.type : 1 );
			if ( hasSdef ) sdefData.push( skinningTypes[ i ], ...( isSdef ? [ ...v.skinC, ...v.skinR0, ...v.skinR1 ] : [ 0, 0, 0, 0, 0, 0, 0, 0, 0 ] ) );
			// PMD vertex edgeFlag is inverted: 1 disables an edge.
			edgeRatios.push( 'edgeRatio' in v ? v.edgeRatio : v.edgeFlag === 0 ? 1 : 0 );

			for ( let j = 0, jl = v.position.length; j < jl; j ++ ) {

				positions.push( v.position[ j ] );

			}

			for ( let j = 0, jl = v.normal.length; j < jl; j ++ ) {

				normals.push( v.normal[ j ] );

			}

			for ( let j = 0; j < 4; j ++ ) {

				skinIndices.push( v.skinIndices.length - 1 >= j ? v.skinIndices[ j ] : 0.0 );

			}

			for ( let j = 0; j < 4; j ++ ) {

				skinWeights.push( v.skinWeights.length - 1 >= j ? v.skinWeights[ j ] : 0.0 );

			}

		}

		// indices

		for ( let i = 0; i < data.metadata.faceCount; i ++ ) {

			const face = data.faces[ i ];

			for ( let j = 0, jl = face.indices.length; j < jl; j ++ ) {

				indices.push( face.indices[ j ] );

			}

		}

		// groups

		for ( let i = 0; i < data.metadata.materialCount; i ++ ) {

			const material = data.materials[ i ];

			groups.push( {
				offset: offset * 3,
				count: material.faceCount * 3
			} );

			offset += material.faceCount;

		}

		// bones

		for ( let i = 0; i < data.metadata.rigidBodyCount; i ++ ) {

			const body = data.rigidBodies[ i ];
			let value = boneTypeTable[ body.boneIndex ];

			// keeps greater number if already value is set without any special reasons
			value = value === undefined ? body.type : Math.max( body.type, value );

			boneTypeTable[ body.boneIndex ] = value;

		}

		for ( let i = 0; i < data.metadata.boneCount; i ++ ) {

			const boneData = data.bones[ i ];

			const bone: MMDBone = {
				index: i,
				transformationClass: 'transformationClass' in boneData ? boneData.transformationClass : undefined,
				flag: 'flag' in boneData ? boneData.flag : undefined,
				parent: boneData.parentIndex,
				name: boneData.name,
				pos: boneData.position.slice( 0, 3 ),
				rotq: [ 0, 0, 0, 1 ],
				scl: [ 1, 1, 1 ],
				rigidBodyType: boneTypeTable[ i ] !== undefined ? boneTypeTable[ i ] : - 1
			};

			if ( bone.parent !== - 1 ) {

				bone.pos[ 0 ] -= data.bones[ bone.parent ].position[ 0 ];
				bone.pos[ 1 ] -= data.bones[ bone.parent ].position[ 1 ];
				bone.pos[ 2 ] -= data.bones[ bone.parent ].position[ 2 ];

			}

			bones.push( bone );

		}

		// iks

		// TODO: remove duplicated codes between PMD and PMX
		if ( isPmd( data ) ) {

			for ( let i = 0; i < data.metadata.ikCount; i ++ ) {

				const ik = data.iks[ i ];

				const param: IK = {
					target: ik.target,
					effector: ik.effector,
					iteration: ik.iteration,
					maxAngle: ik.maxAngle * 4,
					links: []
				};

				for ( let j = 0, jl = ik.links.length; j < jl; j ++ ) {

					const link: IKLink = { index: ik.links[ j ].index };
					link.enabled = true;

					if ( data.bones[ link.index ].name.indexOf( 'ひざ' ) >= 0 ) {

						link.limitation = new Vector3( 1.0, 0.0, 0.0 );

					}

					param.links.push( link );

				}

				iks.push( param );

			}

		} else {

			for ( let i = 0; i < data.metadata.boneCount; i ++ ) {

				const ik = data.bones[ i ].ik;

				if ( ik === undefined ) continue;

				const param: IK = {
					target: i,
					effector: ik.effector,
					iteration: ik.iteration,
					maxAngle: ik.maxAngle,
					links: []
				};

				for ( let j = 0, jl = ik.links.length; j < jl; j ++ ) {

					const link: IKLink = { index: ik.links[ j ].index };
					link.enabled = true;

					if ( ik.links[ j ].angleLimitation === 1 ) {

						// Revert if rotationMin/Max doesn't work well
						// link.limitation = new Vector3( 1.0, 0.0, 0.0 );

						const rotationMin = ik.links[ j ].lowerLimitationAngle!;
						const rotationMax = ik.links[ j ].upperLimitationAngle!;

						// Convert Left to Right coordinate by myself because
						// mmd-parser doesn't convert these angle limits.

						const tmp1 = - rotationMax[ 0 ];
						const tmp2 = - rotationMax[ 1 ];
						rotationMax[ 0 ] = - rotationMin[ 0 ];
						rotationMax[ 1 ] = - rotationMin[ 1 ];
						rotationMin[ 0 ] = tmp1;
						rotationMin[ 1 ] = tmp2;

						link.rotationMin = new Vector3().fromArray( rotationMin );
						link.rotationMax = new Vector3().fromArray( rotationMax );

					}

					param.links.push( link );

				}

				iks.push( param );

				// Save the reference even from bone data for efficiently
				// simulating PMX animation system
				bones[ i ].ik = param;

			}

		}

		// grants

		if ( ! isPmd( data ) ) {

			// Keep file metadata, including malformed references, for inspection.
			// Deformation order and validation belong to the solver, not a grant tree.
			for ( let i = 0; i < data.metadata.boneCount; i ++ ) {

				const boneData = data.bones[ i ];
				if ( ! boneData.grant ) continue;
				const param: Grant = { index: i, ...boneData.grant, transformationClass: boneData.transformationClass };
				grants.push( param );
				bones[ i ].grant = param;

			}

		}

		// morph

		function updateAttributes( attribute: Float32BufferAttribute, morph: PmdMorph | PmxVertexMorph, ratio: number ) {

			for ( let i = 0; i < morph.elementCount; i ++ ) {

				const element = morph.elements[ i ];

				let index;

				if ( isPmd( data ) ) {

					index = data.morphs[ 0 ].elements[ element.index ].index;

				} else {

					index = element.index;

				}

				attribute.array[ index * 3 + 0 ] += element.position[  0 ] * ratio;
				attribute.array[ index * 3 + 1 ] += element.position[  1 ] * ratio;
				attribute.array[ index * 3 + 2 ] += element.position[  2 ] * ratio;

			}

		}

		for ( let i = 0; i < data.metadata.morphCount; i ++ ) {

			const params = { name: data.morphs[ i ].name };

			const attribute = new Float32BufferAttribute( data.metadata.vertexCount * 3, 3 );
			attribute.name = params.name;

			for ( let j = 0; j < data.metadata.vertexCount * 3; j ++ ) {

				attribute.array[ j ] = positions[ j ];

			}

			if ( isPmd( data ) ) {

				const morph = data.morphs[ i ];

				if ( i !== 0 ) {

					updateAttributes( attribute, morph, 1.0 );

				}

			} else {

				const morph = data.morphs[ i ];

				if ( morph.type === 0 ) { // group

					groupMorphs.push( {
						index: i, name: morph.name,
						elements: morph.elements.map( element => {

							const target = Number.isInteger( element.index ) ? data.morphs[ element.index ] : undefined;
							return { index: element.index, ratio: element.ratio, type: target?.type ?? null, name: target?.name ?? null };

						} )
					} );
					for ( let j = 0; j < morph.elementCount; j ++ ) {

						const morph2 = data.morphs[ morph.elements[ j ].index ];
						const ratio = morph.elements[ j ].ratio;

						if ( Number.isInteger( morph.elements[ j ].index ) && morph2?.type === 1 && Number.isFinite( ratio ) ) {

							// Bake only direct vertex links. Three.js adds these once,
							// before skinning, without changing public target weights.
							updateAttributes( attribute, morph2, ratio );

						} else {

							// Bone links run in MMDBoneMorphController. Nested groups
							// are ignored for MMD compatibility; UVs use their own evaluator.

						}

					}

				} else if ( morph.type === 1 ) { // vertex

					updateAttributes( attribute, morph, 1.0 );

				} else if ( morph.type === 2 ) { // bone

					boneMorphs.push( {
						index: i, name: morph.name,
						elements: morph.elements.map( element => ( {
							index: element.index,
							position: element.position.slice(),
							rotation: element.rotation.slice()
						} ) )
					} );

				} else if ( morph.type === 3 || morph.type === 4 || morph.type === 5 || morph.type === 6 || morph.type === 7 ) {

					uvMorphs.push( { index: i, name: morph.name, channel: morph.type - 3,
						elements: morph.elements.map( e => ( { index: e.index, uv: e.uv.slice() } ) ) } );

				} else if ( morph.type === 8 ) { // material

					materialMorphs.push( { index: i, name: morph.name, elements: morph.elements.map( e => ( { ...copyMaterialValues( e ), index: e.index, type: e.type } ) ) } );

				}

			}

			morphTargets.push( params );
			morphPositions.push( attribute );

		}

		// rigid bodies from rigidBodies field.

		for ( let i = 0; i < data.metadata.rigidBodyCount; i ++ ) {

			const rigidBody = data.rigidBodies[ i ];
			// MMD physics supports sphere, box, and capsule shape codes.
			const params = { ...rigidBody, shapeType: rigidBody.shapeType as 0 | 1 | 2 };

			/*
				 * RigidBody position parameter in PMX seems global position
				 * while the one in PMD seems offset from corresponding bone.
				 * So unify being offset.
				 */
			if ( ! isPmd( data ) ) {

				if ( params.boneIndex !== - 1 ) {

					const bone = data.bones[ params.boneIndex ];
					params.position[ 0 ] -= bone.position[ 0 ];
					params.position[ 1 ] -= bone.position[ 1 ];
					params.position[ 2 ] -= bone.position[ 2 ];

				}

			}

			rigidBodies.push( params );

		}

		// constraints from constraints field.

		for ( let i = 0; i < data.metadata.constraintCount; i ++ ) {

			const constraint = data.constraints[ i ];
			const params = { ...constraint };

			const bodyA = rigidBodies[ params.rigidBodyIndex1 ];
			const bodyB = rigidBodies[ params.rigidBodyIndex2 ];

			// Refer to http://www20.atpages.jp/katwat/wp/?p=4135
			if ( bodyA.type !== 0 && bodyB.type === 2 ) {

				if ( bodyA.boneIndex !== - 1 && bodyB.boneIndex !== - 1 &&
					     data.bones[ bodyB.boneIndex ].parentIndex === bodyA.boneIndex ) {

					bodyB.type = 1;

				}

			}

			constraints.push( params );

		}

		// build BufferGeometry.

		const geometry = new BufferGeometry() as MMDGeometry;

		geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );
		geometry.setAttribute( 'normal', new Float32BufferAttribute( normals, 3 ) );
		geometry.setAttribute( 'skinIndex', new Uint16BufferAttribute( skinIndices, 4 ) );
		geometry.setAttribute( 'skinWeight', new Float32BufferAttribute( skinWeights, 4 ) );
		const extraCount = isPmd( data ) ? 0 : Math.min( 4, Math.max( 0, data.metadata.additionalUvNum ) );
		const uvBases: number[][] = Array.from( { length: extraCount + 1 }, () => [] );
		const finite = ( value: number | undefined ) => value !== undefined && Number.isFinite( Math.fround( value ) ) ? value : 0;
		for ( const v of data.vertices ) {

			uvBases[ 0 ].push( finite( v.uv[ 0 ] ), finite( v.uv[ 1 ] ), 0, 0 );
			for ( let c = 1; c <= extraCount; c ++ ) for ( let k = 0; k < 4; k ++ ) uvBases[ c ].push( finite( 'auvs' in v ? v.auvs[ c - 1 ]?.[ k ] : 0 ) );

		}
		// UVs and SDEF share one buffer. Even with tangent and four vec4 channels,
		// only seven buffers / fifteen locations are needed by a full SDEF shader.
		const stride = 2 + extraCount * 4 + ( hasSdef ? 10 : 0 );
		const packed = new Float32Array( data.metadata.vertexCount * stride );
		for ( let i = 0; i < data.metadata.vertexCount; i ++ ) {

			packed.set( uvBases[ 0 ].slice( i * 4, i * 4 + 2 ), i * stride );
			for ( let c = 1; c <= extraCount; c ++ ) packed.set( uvBases[ c ].slice( i * 4, i * 4 + 4 ), i * stride + 2 + ( c - 1 ) * 4 );
			if ( hasSdef ) packed.set( sdefData.slice( i * 10, i * 10 + 10 ), i * stride + 2 + extraCount * 4 );

		}
		const vertexData = new InterleavedBuffer( packed, stride );
		geometry.setAttribute( 'uv', new InterleavedBufferAttribute( vertexData, 2, 0 ) );
		for ( let c = 1; c <= extraCount; c ++ ) geometry.setAttribute( `mmdAdditionalUV${c}`, new InterleavedBufferAttribute( vertexData, 4, 2 + ( c - 1 ) * 4 ) );
		if ( hasSdef ) {

			const offset = 2 + extraCount * 4;
			geometry.setAttribute( 'mmdSkinningType', new InterleavedBufferAttribute( vertexData, 1, offset ) );
			geometry.setAttribute( 'mmdSdefC', new InterleavedBufferAttribute( vertexData, 3, offset + 1 ) );
			geometry.setAttribute( 'mmdSdefR0', new InterleavedBufferAttribute( vertexData, 3, offset + 4 ) );
			geometry.setAttribute( 'mmdSdefR1', new InterleavedBufferAttribute( vertexData, 3, offset + 7 ) );

		} else {

			geometry.setAttribute( 'mmdSkinningType', new Float32BufferAttribute( skinningTypes, 1 ) );

		}
		geometry.setAttribute( 'mmdEdgeRatio', new Float32BufferAttribute( edgeRatios, 1 ) );
		geometry.setIndex( indices );

		for ( let i = 0, il = groups.length; i < il; i ++ ) {

			geometry.addGroup( groups[ i ].offset, groups[ i ].count, i );

		}

		geometry.bones = bones;

		geometry.morphTargets = morphTargets;
		// An empty attribute enables morph shaders without a target count in Three.js.
		if ( morphPositions.length > 0 ) {

			geometry.morphAttributes.position = morphPositions;

		}
		geometry.morphTargetsRelative = false;

		geometry.userData.MMD = {
			boneMorphs: boneMorphs,
			groupMorphs: groupMorphs,
			materialMorphs: materialMorphs,
			uvMorphs,
			uvBases: Object.freeze( uvBases.map( base => Object.freeze( base ) ) ),
			bones: bones,
			iks: iks,
			grants: grants,
			rigidBodies: rigidBodies,
			constraints: constraints,
			format: data.metadata.format
		};

		geometry.computeBoundingSphere();

		return geometry;

	}

}

//

/**
 * @param {THREE.LoadingManager} manager
 */
class MaterialBuilder {

	manager: LoadingManager;
	textureLoader: TextureLoader;
	tgaLoader: TGALoader | null;
	crossOrigin: string;
	resourcePath: string | undefined;

	constructor( manager?: LoadingManager ) {

		this.manager = manager ?? new LoadingManager();

		this.textureLoader = new TextureLoader( this.manager );
		this.tgaLoader = null; // lazy generation

		this.crossOrigin = 'anonymous';
		this.resourcePath = undefined;

	}

	/**
	 * @param {string} crossOrigin
	 * @return {MaterialBuilder}
	 */
	setCrossOrigin( crossOrigin: string ) {

		this.crossOrigin = crossOrigin;
		return this;

	}

	/**
	 * @param {string} resourcePath
	 * @return {MaterialBuilder}
	 */
	setResourcePath( resourcePath: string ) {

		this.resourcePath = resourcePath;
		return this;

	}

	/**
	 * @param {Object} data - parsed PMD/PMX data
	 * @param {BufferGeometry} geometry - some properties are dependend on geometry
	 * @param {function} onProgress
	 * @param {function} onError
	 * @return {Array<MMDToonMaterial>}
	 */
	build( data: Model, geometry: MMDGeometry, _onProgress?: OnProgress, _onError?: OnError ) {

		const materials = [];

		const textures: Record<string, MMDTexture> = {};

		this.textureLoader.setCrossOrigin( this.crossOrigin );

		// materials

		for ( let i = 0; i < data.metadata.materialCount; i ++ ) {

			const material = data.materials[ i ];

			const params: MMDMaterialParameters = { userData: { MMD: {} } };

			if ( 'name' in material ) params.name = material.name;

			/*
				 * Color
				 *
				 * MMD         MMDToonMaterial
				 * ambient  -  emissive * a
				 *               (a = 1.0 without map texture or 0.2 with map texture)
				 *
				 * MMDToonMaterial doesn't have ambient. Set it to emissive instead.
				 * It'll be too bright if material has map texture so using coef 0.2.
				 */
			params.diffuse = new Color().setRGB(
				material.diffuse[ 0 ],
				material.diffuse[ 1 ],
				material.diffuse[ 2 ],
				SRGBColorSpace
			);
			params.opacity = material.diffuse[ 3 ];
			params.specular = new Color().setRGB( ...material.specular, SRGBColorSpace );
			params.shininess = material.shininess;
			params.emissive = new Color().setRGB( ...material.ambient, SRGBColorSpace );
			params.transparent = params.opacity !== 1.0;

			//

			params.fog = true;

			// blend

			params.blending = CustomBlending;
			params.blendSrc = SrcAlphaFactor;
			params.blendDst = OneMinusSrcAlphaFactor;
			params.blendSrcAlpha = SrcAlphaFactor;
			params.blendDstAlpha = DstAlphaFactor;

			// side

			if ( ! isPmd( data ) && ( data.materials[ i ].flag & 0x1 ) === 1 ) {

				params.side = DoubleSide;

			} else {

				params.side = params.opacity === 1.0 ? FrontSide : DoubleSide;

			}

			if ( isPmd( data ) ) {

				const material = data.materials[ i ];

				// map, matcap

				if ( material.fileName ) {

					for ( const fileName of material.fileName.split( '*' ) ) {

						const extension = fileName.slice( - 4 ).toLowerCase();
						if ( extension === '.sph' || extension === '.spa' ) {

							params.matcap = this._loadTexture( fileName, textures );
							params.matcapCombine = extension === '.sph' ? MultiplyOperation : AddOperation;

						} else if ( fileName ) {

							params.map = this._loadTexture( fileName, textures );

						}

					}

				}

				// gradientMap

				const toonFileName = ( material.toonIndex === - 1 )
					? 'toon00.bmp'
					: data.toonTextures[ material.toonIndex ].fileName;

				params.gradientMap = this._loadTexture(
					toonFileName,
					textures,
					{
						isToonTexture: true,
						isDefaultToonTexture: this._isDefaultToonTexture( toonFileName )
					}
				);

				// parameters for MMDOutlineEffect

				params.userData.outlineParameters = {
					thickness: material.edgeFlag === 1 ? 0.003 : 0.0,
					color: [ 0, 0, 0 ],
					alpha: 1.0,
					visible: material.edgeFlag === 1
				};

			} else {

				const material = data.materials[ i ];

				// map

				if ( material.textureIndex !== - 1 ) {

					params.map = this._loadTexture( data.textures[ material.textureIndex ], textures );

					// Since PMX spec don't have standard to list map files except color map and env map,
					// we need to save file name for further mapping, like matching normal map file names after model loaded.
					// ref: https://gist.github.com/felixjones/f8a06bd48f9da9a4539f#texture
					params.userData.MMD.mapFileName = data.textures[ material.textureIndex ];

				}

				// matcap TODO: support m.envFlag === 3

				if ( material.envTextureIndex !== - 1 && ( material.envFlag === 1 || material.envFlag == 2 ) ) {

					params.matcap = this._loadTexture(
						data.textures[ material.envTextureIndex ],
						textures
					);

					// Same as color map above, keep file name in userData for further usage.
					params.userData.MMD.matcapFileName = data.textures[ material.envTextureIndex ];

					params.matcapCombine = material.envFlag === 1
						? MultiplyOperation
						: AddOperation;

				}

				// gradientMap

				let toonFileName, isDefaultToon;

				if ( material.toonIndex === - 1 || material.toonFlag !== 0 ) {

					toonFileName = 'toon' + ( '0' + ( material.toonIndex + 1 ) ).slice( - 2 ) + '.bmp';
					isDefaultToon = true;

				} else {

					toonFileName = data.textures[ material.toonIndex ];
					isDefaultToon = false;

				}

				params.gradientMap = this._loadTexture(
					toonFileName,
					textures,
					{
						isToonTexture: true,
						isDefaultToonTexture: isDefaultToon
					}
				);

				// parameters for MMDOutlineEffect
				params.userData.outlineParameters = {
					thickness: material.edgeSize / 300, // TODO: better calculation?
					color: material.edgeColor.slice( 0, 3 ),
					alpha: material.edgeColor[ 3 ],
					visible: ( material.flag & 0x10 ) !== 0 && material.edgeSize > 0.0
				};

			}

			if ( params.map ) {

				// UV morphs can reach alpha texels outside the rest triangle.
				if ( geometry.userData.MMD.uvMorphs?.some( m => m.channel === 0 ) ) params.transparent = true;
				if ( ! params.transparent ) {

					this._checkImageTransparency( params.map, geometry, i );

				}

				params.emissive.multiplyScalar( 0.2 );

			}

			const toonMaterial = new MMDToonMaterial( params );
			if ( ! isPmd( data ) ) {

				const source = data.materials[ i ];
				toonMaterial.userData.MMD.materialBase = freezeMaterialValues( { diffuse: source.diffuse, specular: source.specular, shininess: source.shininess, ambient: source.ambient, edgeColor: source.edgeColor, edgeSize: source.edgeSize, textureColor: [ 1, 1, 1, 1 ], sphereTextureColor: [ 1, 1, 1, 1 ], toonColor: [ 1, 1, 1, 1 ] } );
				toonMaterial.userData.MMD.edgeEnabled = ( source.flag & 0x10 ) !== 0;

			}
			// The image transparency detector runs before this callback. Preserve
			// texture alpha in the node material once asynchronous decoding finishes.
			if ( params.map && ! toonMaterial.transparent ) {

				params.map.readyCallbacks!.push( texture => {

					if ( texture.transparent ) {

						toonMaterial.transparent = true;
						toonMaterial.needsUpdate = true;

					}

				} );

			}
			materials.push( toonMaterial );

		}

		if ( ! isPmd( data ) ) {

			// Keep alpha-capable materials in one blending pipeline for the whole
			// playback. Classify all direct type 8 targets, including -1, both modes
			// and sampler alpha factors. Group targets use the same payloads.
			for ( const morph of data.morphs ) {

				if ( morph.type !== 8 ) continue;
				for ( const element of morph.elements ) {

					if ( ! Number.isInteger( element.index ) || ( element.type !== 0 && element.type !== 1 ) ) continue;
					const identity = element.type === 0 ? 1 : 0;
					for ( const [ index, material ] of materials.entries() ) {

						if ( element.index !== - 1 && element.index !== index ) continue;
						const changesAlpha = [ element.diffuse[ 3 ], element.edgeColor[ 3 ],
							...( material.map ? [ element.textureColor[ 3 ] ] : [] ),
							...( material.matcap ? [ element.sphereTextureColor[ 3 ] ] : [] ),
							...( material.gradientMap ? [ element.toonColor[ 3 ] ] : [] ) ].some( value => Number.isFinite( value ) && value !== identity );
						if ( changesAlpha ) { material.transparent = true; material.side = DoubleSide; }

					}

				}

			}

		}

		return materials;

	}

	// private methods

	_getTGALoader() {

		if ( this.tgaLoader === null ) {

			if ( TGALoader === undefined ) {

				throw new Error( 'THREE.MMDLoader: Import TGALoader' );

			}

			this.tgaLoader = new TGALoader( this.manager );

		}

		return this.tgaLoader;

	}

	_isDefaultToonTexture( name: string ) {

		if ( name.length !== 10 ) return false;

		return /toon(10|0[0-9])\.bmp/.test( name );

	}

	_loadTexture( filePath: string, textures: Record<string, MMDTexture>, params: TextureOptions = {}, onProgress?: OnProgress, onError?: OnError ) {

		params = params || {};

		const scope = this;

		let fullPath;

		if ( params.isDefaultToonTexture === true ) {

			let index;

			try {

				index = parseInt( filePath.match( /toon([0-9]{2})\.bmp$/ )![ 1 ] );

			} catch ( e ) {

				console.warn( 'THREE.MMDLoader: ' + filePath + ' seems like a '
						+ 'not right default texture path. Using toon00.bmp instead.' );

				index = 0;

			}

			fullPath = DEFAULT_TOON_TEXTURES[ index ];

		} else {

			fullPath = this.resourcePath + filePath;

		}

		if ( textures[ fullPath ] !== undefined ) return textures[ fullPath ];

		let loader = this.manager.getHandler( fullPath ) as Loader<MMDTexture> | TextureLoader | TGALoader | null;

		if ( loader === null ) {

			loader = ( filePath.slice( - 4 ).toLowerCase() === '.tga' )
				? this._getTGALoader()
				: this.textureLoader;

		}

		const texture = loader.load( fullPath, function ( t: Texture ) {

			// MMD toon texture is Axis-Y oriented
			// but Three.js gradient map is Axis-X oriented.
			// So here replaces the toon texture image with the rotated one.
			if ( params.isToonTexture === true ) {

				t.image = scope._getRotatedImage( t.image as CanvasImageSource & { width: number; height: number } );

				t.magFilter = NearestFilter;
				t.minFilter = NearestFilter;
				t.generateMipmaps = false;

			}

			t.flipY = false;
			t.wrapS = RepeatWrapping;
			t.wrapT = RepeatWrapping;
			t.colorSpace = SRGBColorSpace;

			for ( let i = 0; i < texture.readyCallbacks!.length; i ++ ) {

				texture.readyCallbacks![ i ]( texture );

			}

			delete texture.readyCallbacks;

		}, onProgress, onError ) as MMDTexture;

		texture.readyCallbacks = [];

		textures[ fullPath ] = texture;

		return texture;

	}

	_getRotatedImage( image: CanvasImageSource & { width: number; height: number } ) {

		const canvas = document.createElement( 'canvas' );
		const context = canvas.getContext( '2d' )!;

		const width = image.width;
		const height = image.height;

		canvas.width = width;
		canvas.height = height;

		context.clearRect( 0, 0, width, height );
		context.translate( width / 2.0, height / 2.0 );
		context.rotate( 0.5 * Math.PI ); // 90.0 * Math.PI / 180.0
		context.translate( - width / 2.0, - height / 2.0 );
		context.drawImage( image, 0, 0 );

		return context.getImageData( 0, 0, width, height );

	}

	// Check if the partial image area used by the texture is transparent.
	_checkImageTransparency( map: MMDTexture, geometry: BufferGeometry, groupIndex: number ) {

		map.readyCallbacks!.push( function ( texture ) {

			// Is there any efficient ways?
			function createImageData( image: CanvasImageSource & { width: number; height: number } ) {

				const canvas = document.createElement( 'canvas' );
				canvas.width = image.width;
				canvas.height = image.height;

				const context = canvas.getContext( '2d' )!;
				context.drawImage( image, 0, 0 );

				return context.getImageData( 0, 0, canvas.width, canvas.height );

			}

			function detectImageTransparency( image: ImageData, uvs: MMDGeometry[ 'attributes' ][ string ], indices: TypedArray ) {

				const width = image.width;
				const height = image.height;
				const data = image.data;
				const threshold = 253;

				if ( data.length / ( width * height ) !== 4 ) return false;

				for ( let i = 0; i < indices.length; i += 3 ) {

					const centerUV = { x: 0.0, y: 0.0 };

					for ( let j = 0; j < 3; j ++ ) {

						const index = indices[ i * 3 + j ];
						const uv = { x: uvs.getX( index ), y: uvs.getY( index ) };

						if ( getAlphaByUv( image, uv ) < threshold ) return true;

						centerUV.x += uv.x;
						centerUV.y += uv.y;

					}

					centerUV.x /= 3;
					centerUV.y /= 3;

					if ( getAlphaByUv( image, centerUV ) < threshold ) return true;

				}

				return false;

			}

			/*
				 * This method expects
				 *   texture.flipY = false
				 *   texture.wrapS = RepeatWrapping
				 *   texture.wrapT = RepeatWrapping
				 * TODO: more precise
				 */
			function getAlphaByUv( image: ImageData, uv: { x: number; y: number } ) {

				const width = image.width;
				const height = image.height;

				let x = Math.round( uv.x * width ) % width;
				let y = Math.round( uv.y * height ) % height;

				if ( x < 0 ) x += width;
				if ( y < 0 ) y += height;

				const index = y * width + x;

				return image.data[ index * 4 + 3 ];

			}

			if ( texture.isCompressedTexture === true ) {

				if ( NON_ALPHA_CHANNEL_FORMATS.includes( texture.format ) ) {

					map.transparent = false;

				} else {

					// any other way to check transparency of CompressedTexture?
					map.transparent = true;

				}

				return;

			}

			const image = texture.image as ImageData | ( CanvasImageSource & { width: number; height: number } );
			const imageData = 'data' in image ? image as ImageData : createImageData( image );

			const group = geometry.groups[ groupIndex ];

			if ( detectImageTransparency(
				imageData,
				geometry.attributes.uv,
				geometry.index!.array.slice( group.start, group.start + group.count ) ) ) {

				map.transparent = true;

			}

		} );

	}

}

//

class AnimationBuilder {

	/**
	 * @param {Object} vmd - parsed VMD data
	 * @param {SkinnedMesh} mesh - tracks will be fitting to mesh
	 * @return {AnimationClip}
	 */
	build( vmd: Vmd, mesh: SkinnedMesh ) {

		// combine skeletal and morph animations

		const tracks = this.buildSkeletalAnimation( vmd, mesh ).tracks;
		const tracks2 = this.buildMorphAnimation( vmd, mesh ).tracks;

		for ( let i = 0, il = tracks2.length; i < il; i ++ ) {

			tracks.push( tracks2[ i ] );

		}

		return new AnimationClip( '', - 1, tracks );

	}

	/**
	 * @param {Object} vmd - parsed VMD data
	 * @param {SkinnedMesh} mesh - tracks will be fitting to mesh
	 * @return {AnimationClip}
	 */
	buildSkeletalAnimation( vmd: Vmd, mesh: SkinnedMesh ) {

		function pushInterpolation( array: number[], interpolation: number[], index: number ) {

			array.push( interpolation[ index + 0 ] / 127 ); // x1
			array.push( interpolation[ index + 8 ] / 127 ); // x2
			array.push( interpolation[ index + 4 ] / 127 ); // y1
			array.push( interpolation[ index + 12 ] / 127 ); // y2

		}

		const tracks = [];

		const motions: Record<string, VmdMotion[]> = {};
		const bones = mesh.skeleton.bones;
		const boneNameDictionary: Record<string, boolean> = {};

		for ( let i = 0, il = bones.length; i < il; i ++ ) {

			boneNameDictionary[ bones[ i ].name ] = true;

		}

		for ( let i = 0; i < vmd.metadata.motionCount; i ++ ) {

			const motion = vmd.motions[ i ];
			const boneName = motion.boneName;

			if ( boneNameDictionary[ boneName ] === undefined ) continue;

			motions[ boneName ] = motions[ boneName ] || [];
			motions[ boneName ].push( motion );

		}

		for ( const key in motions ) {

			const array = motions[ key ];

			array.sort( function ( a, b ) {

				return a.frameNum - b.frameNum;

			} );

			const times = [];
			const positions: number[] = [];
			const rotations = [];
			const pInterpolations: number[] = [];
			const rInterpolations: number[] = [];

			const basePosition = mesh.skeleton.getBoneByName( key )!.position.toArray();

			for ( let i = 0, il = array.length; i < il; i ++ ) {

				const time = array[ i ].frameNum / 30;
				const position = array[ i ].position;
				const rotation = array[ i ].rotation;
				const interpolation = array[ i ].interpolation;

				times.push( time );

				for ( let j = 0; j < 3; j ++ ) positions.push( basePosition[ j ] + position[ j ] );
				for ( let j = 0; j < 4; j ++ ) rotations.push( rotation[ j ] );
				for ( let j = 0; j < 3; j ++ ) pushInterpolation( pInterpolations, interpolation, j );

				pushInterpolation( rInterpolations, interpolation, 3 );

			}

			const targetName = '.bones[' + key + ']';

			tracks.push( this._createTrack( targetName + '.position', VectorKeyframeTrack, times, positions, pInterpolations ) );
			tracks.push( this._createTrack( targetName + '.quaternion', QuaternionKeyframeTrack, times, rotations, rInterpolations ) );

		}

		return new AnimationClip( '', - 1, tracks );

	}

	/**
	 * @param {Object} vmd - parsed VMD data
	 * @param {SkinnedMesh} mesh - tracks will be fitting to mesh
	 * @return {AnimationClip}
	 */
	buildMorphAnimation( vmd: Vmd, mesh: SkinnedMesh ) {

		const tracks = [];

		const morphs: Record<string, VmdMorph[]> = {};
		const morphTargetDictionary = mesh.morphTargetDictionary;

		for ( let i = 0; i < vmd.metadata.morphCount; i ++ ) {

			const morph = vmd.morphs[ i ];
			const morphName = morph.morphName;

			if ( morphTargetDictionary === undefined || morphTargetDictionary[ morphName ] === undefined ) continue;

			morphs[ morphName ] = morphs[ morphName ] || [];
			morphs[ morphName ].push( morph );

		}

		for ( const key in morphs ) {

			const array = morphs[ key ];

			array.sort( function ( a, b ) {

				return a.frameNum - b.frameNum;

			} );

			const times = [];
			const values = [];

			for ( let i = 0, il = array.length; i < il; i ++ ) {

				times.push( array[ i ].frameNum / 30 );
				values.push( array[ i ].weight );

			}

			tracks.push( new NumberKeyframeTrack( '.morphTargetInfluences[' + morphTargetDictionary![ key ] + ']', times, values ) );

		}

		return new AnimationClip( '', - 1, tracks );

	}

	/**
	 * @param {Object} vmd - parsed VMD data
	 * @return {AnimationClip}
	 */
	buildCameraAnimation( vmd: Vmd ) {

		function pushVector3( array: number[], vec: Vector3 ) {

			array.push( vec.x );
			array.push( vec.y );
			array.push( vec.z );

		}

		function pushQuaternion( array: number[], q: Quaternion ) {

			array.push( q.x );
			array.push( q.y );
			array.push( q.z );
			array.push( q.w );

		}

		function pushInterpolation( array: number[], interpolation: number[], index: number ) {

			array.push( interpolation[ index * 4 + 0 ] / 127 ); // x1
			array.push( interpolation[ index * 4 + 1 ] / 127 ); // x2
			array.push( interpolation[ index * 4 + 2 ] / 127 ); // y1
			array.push( interpolation[ index * 4 + 3 ] / 127 ); // y2

		}

		const cameras = vmd.cameras === undefined ? [] : vmd.cameras.slice();

		cameras.sort( function ( a, b ) {

			return a.frameNum - b.frameNum;

		} );

		const times = [];
		const centers: number[] = [];
		const quaternions: number[] = [];
		const positions: number[] = [];
		const fovs = [];

		const cInterpolations: number[] = [];
		const qInterpolations: number[] = [];
		const pInterpolations: number[] = [];
		const fInterpolations: number[] = [];

		const quaternion = new Quaternion();
		const euler = new Euler();
		const position = new Vector3();
		const center = new Vector3();

		for ( let i = 0, il = cameras.length; i < il; i ++ ) {

			const motion = cameras[ i ];

			const time = motion.frameNum / 30;
			const pos = motion.position;
			const rot = motion.rotation;
			const distance = motion.distance;
			const fov = motion.fov;
			const interpolation = motion.interpolation;

			times.push( time );

			position.set( 0, 0, - distance );
			center.set( pos[ 0 ], pos[ 1 ], pos[ 2 ] );

			euler.set( - rot[ 0 ], - rot[ 1 ], - rot[ 2 ] );
			quaternion.setFromEuler( euler );

			position.add( center );
			position.applyQuaternion( quaternion );

			pushVector3( centers, center );
			pushQuaternion( quaternions, quaternion );
			pushVector3( positions, position );

			fovs.push( fov );

			for ( let j = 0; j < 3; j ++ ) {

				pushInterpolation( cInterpolations, interpolation, j );

			}

			pushInterpolation( qInterpolations, interpolation, 3 );

			// use the same parameter for x, y, z axis.
			for ( let j = 0; j < 3; j ++ ) {

				pushInterpolation( pInterpolations, interpolation, 4 );

			}

			pushInterpolation( fInterpolations, interpolation, 5 );

		}

		const tracks = [];

		// I expect an object whose name 'target' exists under THREE.Camera
		tracks.push( this._createTrack( 'target.position', VectorKeyframeTrack, times, centers, cInterpolations ) );

		tracks.push( this._createTrack( '.quaternion', QuaternionKeyframeTrack, times, quaternions, qInterpolations ) );
		tracks.push( this._createTrack( '.position', VectorKeyframeTrack, times, positions, pInterpolations ) );
		tracks.push( this._createTrack( '.fov', NumberKeyframeTrack, times, fovs, fInterpolations ) );

		return new AnimationClip( '', - 1, tracks );

	}

	// private method

	_createTrack( node: string, typedKeyframeTrack: typeof NumberKeyframeTrack | typeof VectorKeyframeTrack | typeof QuaternionKeyframeTrack, times: number[], values: number[], interpolations: number[] ) {

		/*
			 * optimizes here not to let KeyframeTrackPrototype optimize
			 * because KeyframeTrackPrototype optimizes times and values but
			 * doesn't optimize interpolations.
			 */
		if ( times.length > 2 ) {

			times = times.slice();
			values = values.slice();
			interpolations = interpolations.slice();

			const stride = values.length / times.length;
			const interpolateStride = interpolations.length / times.length;

			let index = 1;

			for ( let aheadIndex = 2, endIndex = times.length; aheadIndex < endIndex; aheadIndex ++ ) {

				for ( let i = 0; i < stride; i ++ ) {

					if ( values[ index * stride + i ] !== values[ ( index - 1 ) * stride + i ] ||
							values[ index * stride + i ] !== values[ aheadIndex * stride + i ] ) {

						index ++;
						break;

					}

				}

				if ( aheadIndex > index ) {

					times[ index ] = times[ aheadIndex ];

					for ( let i = 0; i < stride; i ++ ) {

						values[ index * stride + i ] = values[ aheadIndex * stride + i ];

					}

					for ( let i = 0; i < interpolateStride; i ++ ) {

						interpolations[ index * interpolateStride + i ] = interpolations[ aheadIndex * interpolateStride + i ];

					}

				}

			}

			times.length = index + 1;
			values.length = ( index + 1 ) * stride;
			interpolations.length = ( index + 1 ) * interpolateStride;

		}

		const track = new typedKeyframeTrack( node, times, values );

		( track as KeyframeTrack & { createInterpolant: ( result?: TypedArray ) => Interpolant } ).createInterpolant = function InterpolantFactoryMethodCubicBezier( result?: TypedArray ) {

			return new CubicBezierInterpolation( this.times, this.values, this.getValueSize(), result, new Float32Array( interpolations ) );

		};

		return track;

	}

}

// interpolation

class CubicBezierInterpolation extends Interpolant {

	interpolationParams: Float32Array;

	constructor( parameterPositions: TypedArray, sampleValues: TypedArray, sampleSize: number, resultBuffer: TypedArray | undefined, params: Float32Array ) {

		super( parameterPositions, sampleValues, sampleSize, resultBuffer );

		this.interpolationParams = params;

	}

	interpolate_( i1: number, t0: number, t: number, t1: number ) {

		const result = this.resultBuffer;
		const values = this.sampleValues;
		// @types/three declares valueSize as a typed array; Three.js stores a number.
		const stride = this.valueSize as unknown as number;
		const params = this.interpolationParams;

		const offset1 = i1 * stride;
		const offset0 = offset1 - stride;

		// No interpolation if next key frame is in one frame in 30fps.
		// This is from MMD animation spec.
		// '1.5' is for precision loss. times are Float32 in Three.js Animation system.
		const weight1 = ( ( t1 - t0 ) < 1 / 30 * 1.5 ) ? 0.0 : ( t - t0 ) / ( t1 - t0 );

		if ( stride === 4 ) { // Quaternion

			const x1 = params[ i1 * 4 + 0 ];
			const x2 = params[ i1 * 4 + 1 ];
			const y1 = params[ i1 * 4 + 2 ];
			const y2 = params[ i1 * 4 + 3 ];

			const ratio = this._calculate( x1, x2, y1, y2, weight1 );

			// The Three.js typings accept number[], but the runtime also accepts typed arrays.
			( Quaternion.slerpFlat as unknown as ( dst: TypedArray, dstOffset: number, src0: TypedArray, srcOffset0: number, src1: TypedArray, srcOffset1: number, t: number ) => void )( result, 0, values, offset0, values, offset1, ratio );

		} else if ( stride === 3 ) { // Vector3

			for ( let i = 0; i !== stride; ++ i ) {

				const x1 = params[ i1 * 12 + i * 4 + 0 ];
				const x2 = params[ i1 * 12 + i * 4 + 1 ];
				const y1 = params[ i1 * 12 + i * 4 + 2 ];
				const y2 = params[ i1 * 12 + i * 4 + 3 ];

				const ratio = this._calculate( x1, x2, y1, y2, weight1 );

				result[ i ] = values[ offset0 + i ] * ( 1 - ratio ) + values[ offset1 + i ] * ratio;

			}

		} else { // Number

			const x1 = params[ i1 * 4 + 0 ];
			const x2 = params[ i1 * 4 + 1 ];
			const y1 = params[ i1 * 4 + 2 ];
			const y2 = params[ i1 * 4 + 3 ];

			const ratio = this._calculate( x1, x2, y1, y2, weight1 );

			result[ 0 ] = values[ offset0 ] * ( 1 - ratio ) + values[ offset1 ] * ratio;

		}

		return result;

	}

	_calculate( x1: number, x2: number, y1: number, y2: number, x: number ) {

		/*
			 * Cubic Bezier curves
			 *   https://en.wikipedia.org/wiki/B%C3%A9zier_curve#Cubic_B.C3.A9zier_curves
			 *
			 * B(t) = ( 1 - t ) ^ 3 * P0
			 *      + 3 * ( 1 - t ) ^ 2 * t * P1
			 *      + 3 * ( 1 - t ) * t^2 * P2
			 *      + t ^ 3 * P3
			 *      ( 0 <= t <= 1 )
			 *
			 * MMD uses Cubic Bezier curves for bone and camera animation interpolation.
			 *   http://d.hatena.ne.jp/edvakf/20111016/1318716097
			 *
			 *    x = ( 1 - t ) ^ 3 * x0
			 *      + 3 * ( 1 - t ) ^ 2 * t * x1
			 *      + 3 * ( 1 - t ) * t^2 * x2
			 *      + t ^ 3 * x3
			 *    y = ( 1 - t ) ^ 3 * y0
			 *      + 3 * ( 1 - t ) ^ 2 * t * y1
			 *      + 3 * ( 1 - t ) * t^2 * y2
			 *      + t ^ 3 * y3
			 *      ( x0 = 0, y0 = 0 )
			 *      ( x3 = 1, y3 = 1 )
			 *      ( 0 <= t, x1, x2, y1, y2 <= 1 )
			 *
			 * Here solves this equation with Bisection method,
			 *   https://en.wikipedia.org/wiki/Bisection_method
			 * gets t, and then calculate y.
			 *
			 * f(t) = 3 * ( 1 - t ) ^ 2 * t * x1
			 *      + 3 * ( 1 - t ) * t^2 * x2
			 *      + t ^ 3 - x = 0
			 *
			 * (Another option: Newton's method
			 *    https://en.wikipedia.org/wiki/Newton%27s_method)
			 */

		let c = 0.5;
		let t = c;
		let s = 1.0 - t;
		const loop = 15;
		const eps = 1e-5;
		const math = Math;

		let sst3 = 0, stt3 = 0, ttt = 0;

		for ( let i = 0; i < loop; i ++ ) {

			sst3 = 3.0 * s * s * t;
			stt3 = 3.0 * s * t * t;
			ttt = t * t * t;

			const ft = ( sst3 * x1 ) + ( stt3 * x2 ) + ( ttt ) - x;

			if ( math.abs( ft ) < eps ) break;

			c /= 2.0;

			t += ( ft < 0 ) ? c : - c;
			s = 1.0 - t;

		}

		return ( sst3 * y1 ) + ( stt3 * y2 ) + ttt;

	}

}

export { MMDLoader };
export type { MMDToonMaterial };
