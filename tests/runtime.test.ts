import { Parser, CharsetEncoder } from 'mmd-parser';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import type { AnimationClip } from 'three';
import type { AmmoAPI } from '../dist/ammo.js';
import {
	AddOperation, Audio, Bone, BufferGeometry, DataTexture, DoubleSide, FrontSide, Loader, LoadingManager,
	MeshBasicMaterial, MultiplyOperation, PerspectiveCamera, Skeleton, SkinnedMesh, Texture, Vector3
} from 'three';
import {
	CCDIKSolver, MMDAnimationHelper, MMDExporter, MMDLoader, MMDPhysics,
	MMDToonMaterial
} from 'three-mmd-loader';
import { pmdBuffer, pmxBuffer, vmdBuffer } from './fixtures.ts';

const AmmoFactory = createRequire( import.meta.url )( 'ammojs-typed' ) as () => Promise<AmmoAPI>;
const ammoGlobal = globalThis as typeof globalThis & { Ammo?: AmmoAPI };

function modelLoader() {

	const loader = new MMDLoader();
	// Image decoding requires a browser; keep the actual geometry/material builders.
	loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	return loader;

}

function buildMesh( format = 'pmd' ) {

	const parser = new Parser();
	const data = format === 'pmd'
		? parser.parsePmd( pmdBuffer(), true )
		: parser.parsePmx( pmxBuffer(), true );
	return modelLoader().meshBuilder.build( data, '' );

}

test( 'MMDLoader uses the consumer Three.js instance and loading manager', () => {

	const manager = new LoadingManager();
	const loader = new MMDLoader( manager );
	assert.ok( loader instanceof Loader );
	assert.equal( loader.manager, manager );
	assert.equal( loader.loader.manager, manager );
	assert.equal( loader.setAnimationPath( 'motions/' ), loader );

} );

for ( const format of [ 'pmd', 'pmx' ] ) {

	test( `${format.toUpperCase()} parses into a skinned mesh and toon material`, () => {

		const mesh = buildMesh( format );
		assert.ok( mesh instanceof SkinnedMesh );
		assert.ok( mesh.geometry instanceof BufferGeometry );
		assert.equal( mesh.geometry.attributes.position.count, 3 );
		assert.equal( mesh.geometry.attributes.position.getZ( 0 ), - 1 );
		assert.equal( mesh.geometry.attributes.normal.getZ( 0 ), - 1 );
		assert.deepEqual( Array.from( mesh.geometry.index!.array ), [ 2, 1, 0 ] );
		assert.equal( mesh.geometry.attributes.skinWeight.getX( 0 ), 1 );
		assert.equal( mesh.geometry.attributes.skinIndex.itemSize, 4 );
		assert.equal( mesh.skeleton.bones[ 0 ].name, 'root' );
		assert.equal( mesh.geometry.userData.MMD.format, format );
		assert.equal( mesh.geometry.morphAttributes.position, undefined );
		const material = mesh.material[ 0 ];
		assert.equal( material.isMMDToonMaterial, true );
		assert.equal( material.lights, true );
		assert.equal( material.side, format === 'pmx' ? DoubleSide : FrontSide );
		assert.equal( material.isNodeMaterial, true );
		assert.equal( mesh.geometry.attributes.mmdEdgeRatio.getX( 0 ), 1 );
		assert.ok( material.gradientMap instanceof Texture );
		assert.equal( material.shininess, 30 );
		assert.equal( material.userData.outlineParameters.visible, true );
		assert.doesNotThrow( () => material.clone() );

	} );

}

test( 'installed mmd-parser reads PMX additional UV morphs without losing following data alignment', () => {

	const data = new Parser().parsePmx( pmxBuffer( { additionalUvMorphs: true } ) );
	assert.equal( data.metadata.additionalUvNum, 4 );
	assert.equal( data.metadata.morphCount, 5 );
	assert.deepEqual( data.morphs.slice( 0, 4 ), [ 4, 5, 6, 7 ].map( type => ( {
		name: `additional-uv-${type}`, englishName: '', panel: 4, type, elementCount: 2,
		elements: [
			{ index: 0, uv: [ type / 4, - 0.5, 0.25, 1 ] },
			{ index: 2, uv: [ - 1, type / 2, 0.5, - 0.25 ] }
		]
	} ) ) );
	assert.deepEqual( data.morphs[ 4 ], {
		name: 'following-vertex', englishName: '', panel: 1, type: 1, elementCount: 1,
		elements: [ { index: 1, position: [ 0.25, 0.5, 0.75 ] } ]
	} );
	assert.equal( data.metadata.frameCount, 1 );
	assert.deepEqual( data.frames, [ {
		name: 'following-frame', englishName: '', type: 0, elementCount: 2,
		elements: [ { target: 0, index: 0 }, { target: 1, index: 4 } ]
	} ] );
	assert.equal( data.metadata.rigidBodyCount, 0 );
	assert.equal( data.metadata.constraintCount, 0 );
	assert.deepEqual( data.rigidBodies, [] );
	assert.deepEqual( data.constraints, [] );

} );

test( 'PMX vertex morphs retain their positions and mesh influences', () => {

	const data = new Parser().parsePmx( pmxBuffer(), true );
	data.metadata.morphCount = 1;
	data.morphs = [ {
		name: 'smile', englishName: '', panel: 1, type: 1, elementCount: 1,
		elements: [ { index: 0, position: [ 0.25, 0, 0 ] } ]
	} ];
	const mesh = modelLoader().meshBuilder.build( data, '' );
	assert.equal( mesh.geometry.morphAttributes.position!.length, 1 );
	assert.equal( mesh.geometry.morphAttributes.position![ 0 ].getX( 0 ), 0.25 );
	assert.equal( mesh.geometry.morphAttributes.position![ 0 ].getZ( 0 ), - 1 );
	assert.equal( mesh.morphTargetDictionary!.smile, 0 );
	assert.deepEqual( mesh.morphTargetInfluences, [ 0 ] );

} );

test( 'PMX grants are ordered from parents to children', () => {

	const data = new Parser().parsePmx( pmxBuffer(), true );
	data.bones = [ 'child', 'parent', 'root' ].map( ( name, index ) => ( {
		name, englishName: '', flag: 0, position: [ 0, 0, 0 ], parentIndex: - 1, transformationClass: 0,
		...index < 2 ? { grant: {
			parentIndex: index + 1, ratio: 0.5, isLocal: false,
			affectRotation: true, affectPosition: false
		} } : {}
	} ) );
	data.metadata.boneCount = data.bones.length;
	const mesh = modelLoader().meshBuilder.build( data, '' );
	assert.deepEqual( mesh.geometry.userData.MMD.grants.map( grant => grant.index ), [ 1, 0 ] );

} );

test( 'public loader loads a PMD buffer through Three.js FileLoader', async () => {

	// FileLoader uses this browser event while streaming the response.
	const original = globalThis.ProgressEvent;
	globalThis.ProgressEvent ??= class extends Event {

		lengthComputable: boolean;
		loaded: number;
		total: number;
		constructor( type: string, properties: ProgressEventInit = {} ) {
			super( type );
			this.lengthComputable = properties.lengthComputable ?? false;
			this.loaded = properties.loaded ?? 0;
			this.total = properties.total ?? 0;
		}

	};
	try {

		const url = `data:application/octet-stream;base64,${Buffer.from( pmdBuffer() ).toString( 'base64' )}`;
		const loader = modelLoader();
		const mesh = await loader.loadAsync( url );
		assert.ok( mesh instanceof SkinnedMesh );
		assert.equal( mesh.skeleton.bones.length, 1 );

	} finally {

		if ( original === undefined ) Reflect.deleteProperty( globalThis, 'ProgressEvent' );
		else globalThis.ProgressEvent = original;

	}

} );

test( 'parsed VMD animates a loaded bone with physics disabled', () => {

	const mesh = buildMesh();
	const vmd = new Parser().parseVmd( vmdBuffer(), true );
	const animation = new MMDLoader().animationBuilder.build( vmd, mesh );
	assert.equal( animation.duration, 1 );
	assert.equal( animation.tracks.length, 2 );
	assert.equal( animation.validate(), true );
	const helper = new MMDAnimationHelper( { sync: false } );
	assert.equal( helper.add( mesh, { animation, physics: false } ), helper );
	helper.update( 0.5 );
	assert.ok( Math.abs( mesh.skeleton.bones[ 0 ].position.x - 1 ) < 1e-5 );
	assert.equal( helper.objects.get( mesh )!.physics, undefined );
	assert.equal( helper.remove( mesh ), helper );
	assert.equal( helper.meshes.length, 0 );

} );

test( 'helper replaces cameras and audio and advances its audio elapsed time', () => {

	const helper = new MMDAnimationHelper( { sync: false } );
	const firstCamera = new PerspectiveCamera();
	const secondCamera = new PerspectiveCamera();
	helper.add( firstCamera ).add( secondCamera );
	assert.equal( helper.camera, secondCamera );
	assert.equal( firstCamera.children.length, 0 );
	assert.equal( helper.objects.has( firstCamera ), false );
	assert.equal( helper.cameraTarget.parent, secondCamera );
	helper.remove( secondCamera );
	// Audio construction uses a browser AudioContext. Keep the real Audio
	// prototype and supply only the playback state needed by AudioManager.
	function audio(): Audio {

		return Object.assign( Object.create( Audio.prototype ), {
			type: 'Audio', name: 'test', buffer: { duration: 1 }, isPlaying: false,
			play( this: { isPlaying: boolean } ) { this.isPlaying = true; }, stop( this: { isPlaying: boolean } ) { this.isPlaying = false; }
		} );

	}
	const firstAudio = audio();
	const secondAudio = audio();
	helper.add( firstAudio ).add( secondAudio, { delayTime: 0.25 } );
	assert.equal( helper.audio, secondAudio );
	helper.update( 0.125 );
	assert.equal( helper.audioManager!.elapsedTime, 0.125 );
	assert.equal( secondAudio.isPlaying, false );
	helper.update( 0.125 );
	assert.equal( secondAudio.isPlaying, true );
	helper.remove( secondAudio );
	assert.equal( helper.audioManager, null );

} );

test( 'public loadAnimation skips VMD morphs on models without morph targets', async ( t ) => {

	const original = globalThis.ProgressEvent;
	globalThis.ProgressEvent ??= class extends Event {

		lengthComputable: boolean;
		loaded: number;
		total: number;
		constructor( type: string, properties: ProgressEventInit = {} ) {
			super( type );
			this.lengthComputable = properties.lengthComputable ?? false;
			this.loaded = properties.loaded ?? 0;
			this.total = properties.total ?? 0;
		}

	};
	try {

		const buffer = vmdBuffer( { morphs: [
			{ morphName: 'smile', frameNum: 0, weight: 0 },
			{ morphName: 'smile', frameNum: 30, weight: 1 }
		] } );
		const url = `data:application/octet-stream;base64,${Buffer.from( buffer ).toString( 'base64' )}`;
		for ( const format of [ 'pmd', 'pmx' ] ) {

			await t.test( format.toUpperCase(), async () => {

				const mesh = buildMesh( format );
				assert.equal( mesh.morphTargetDictionary, undefined );
				const animation = await new Promise<AnimationClip>( ( resolve, reject ) => {

					new MMDLoader().loadAnimation( url, mesh, resolve, undefined, reject );

				} );
				assert.deepEqual( animation.tracks.map( track => track.name ), [
					'.bones[root].position', '.bones[root].quaternion'
				] );
				assert.equal( animation.duration, 1 );
				assert.equal( animation.validate(), true );
				const helper = new MMDAnimationHelper( { sync: false } );
				helper.add( mesh, { animation, physics: false } );
				helper.update( 0.5 );
				assert.ok( Math.abs( mesh.skeleton.bones[ 0 ].position.x - 1 ) < 1e-5 );
				helper.remove( mesh );

			} );

		}

	} finally {

		if ( original === undefined ) Reflect.deleteProperty( globalThis, 'ProgressEvent' );
		else globalThis.ProgressEvent = original;

	}

} );

test( 'VPD exporter round trips a posed bone through the installed mmd-parser', () => {

	const mesh = buildMesh();
	const bone = mesh.skeleton.bones[ 0 ];
	bone.name = 'センター';
	bone.position.set( 1, 2, 3 );
	const exporter = new MMDExporter();
	const text = exporter.parseVpd( mesh );
	assert.ok( text !== null );
	assert.deepEqual( bone.position.toArray(), [ 1, 2, 3 ] );
	const parser = new Parser();
	const pose = parser.parseVpd( text, true );
	assert.equal( pose.bones[ 0 ].name, 'センター' );
	assert.deepEqual( pose.bones[ 0 ].translation, [ 1, 2, 3 ] );
	const bytes = exporter.parseVpd( mesh, true );
	assert.ok( bytes instanceof Uint8Array );
	assert.equal( new CharsetEncoder().s2u( bytes ), text );
	bone.position.set( 0, 0, 0 );
	new MMDAnimationHelper().pose( mesh, pose, { ik: false, grant: false } );
	assert.deepEqual( bone.position.toArray(), [ 1, 2, 3 ] );

} );

test( 'CCDIKSolver moves an effector towards its target', () => {

	const mesh = new SkinnedMesh( new BufferGeometry(), new MeshBasicMaterial() );
	const link = new Bone();
	const effector = new Bone();
	const target = new Bone();
	effector.position.set( 0, 1, 0 );
	target.position.set( 1, 0, 0 );
	link.add( effector );
	mesh.add( link, target );
	mesh.bind( new Skeleton( [ link, effector, target ] ) );
	mesh.updateMatrixWorld( true );
	const solver = new CCDIKSolver( mesh, [ { target: 2, effector: 1, links: [ { index: 0 } ], iteration: 2 } ] );
	assert.equal( solver.update(), solver );
	assert.ok( effector.getWorldPosition( new Vector3() ).distanceTo( target.getWorldPosition( new Vector3() ) ) < 1e-5 );
	const helper = solver.createHelper();
	assert.equal( helper.isObject3D, true );
	helper.updateMatrixWorld( true );
	helper.dispose();

} );

test( 'node material clones MMD shading and outline properties independently', () => {

	const source = buildMesh( 'pmx' ).material[ 0 ];
	source.matcap = new Texture();
	source.matcapCombine = 0;
	source.displacementMap = new Texture();
	source.normalScale.set( 2, 3 );
	const clone = source.clone();
	assert.ok( clone instanceof MMDToonMaterial );
	assert.equal( clone.matcap, source.matcap );
	assert.equal( clone.gradientMap, source.gradientMap );
	assert.equal( clone.matcapCombine, source.matcapCombine );
	assert.equal( clone.displacementMap, source.displacementMap );
	assert.deepEqual( clone.normalScale.toArray(), [ 2, 3 ] );
	clone.color.setRGB( 0, 0, 0 );
	assert.notDeepEqual( clone.color, source.color );
	clone.userData.outlineParameters.color[ 0 ] = 1;
	assert.equal( source.userData.outlineParameters.color[ 0 ], 0 );

} );

test( 'loader preserves PMD flags and PMX per-vertex edge ratios and per-material edges', () => {

	const parser = new Parser();
	const pmd = parser.parsePmd( pmdBuffer(), true );
	pmd.vertices[ 0 ].edgeFlag = 1;
	pmd.materials[ 0 ].edgeFlag = 0;
	const pmdMesh = modelLoader().meshBuilder.build( pmd, '' );
	assert.equal( pmdMesh.geometry.attributes.mmdEdgeRatio.getX( 0 ), 0 );
	assert.equal( pmdMesh.material[ 0 ].userData.outlineParameters.visible, false );
	const pmx = parser.parsePmx( pmxBuffer(), true );
	pmx.vertices[ 0 ].edgeRatio = 0;
	pmx.vertices[ 1 ].edgeRatio = 0.5;
	pmx.vertices[ 2 ].edgeRatio = 2;
	pmx.materials[ 0 ].edgeSize = 3;
	pmx.materials[ 0 ].edgeColor = [ 1, 0.25, 0.5, 0.4 ];
	pmx.materials.push( { ...pmx.materials[ 0 ], flag: 0, edgeSize: 0, faceCount: 0 } );
	pmx.metadata.materialCount = 2;
	const mesh = modelLoader().meshBuilder.build( pmx, '' );
	assert.deepEqual( Array.from( mesh.geometry.attributes.mmdEdgeRatio.array ), [ 0, 0.5, 2 ] );
	assert.deepEqual( mesh.material[ 0 ].userData.outlineParameters, {
		thickness: 0.01, color: [ 1, 0.25, 0.5 ], alpha: 0.4, visible: true
	} );
	assert.equal( mesh.material[ 1 ].userData.outlineParameters.visible, false );

} );

test( 'PMD filenames and PMX environment flags select the sphere blend mode', () => {

	const parser = new Parser();
	for ( const [ fileName, blend, hasMap ] of [
		[ 'sphere.sph', MultiplyOperation, false ],
		[ 'sphere.spa', AddOperation, false ],
		[ 'diffuse.png*sphere.sph', MultiplyOperation, true ],
		[ 'sphere.spa*diffuse.png', AddOperation, true ]
	] as const ) {

		const data = parser.parsePmd( pmdBuffer(), true );
		data.materials[ 0 ].fileName = fileName;
		const material = modelLoader().meshBuilder.build( data, '' ).material[ 0 ];
		assert.ok( material.matcap instanceof Texture, fileName );
		assert.equal( material.matcapCombine, blend, fileName );
		assert.equal( material.map !== null, hasMap, fileName );

	}
	for ( const envFlag of [ 1, 2 ] ) {

		const data = parser.parsePmx( pmxBuffer(), true );
		data.textures = [ 'sphere.png' ];
		data.materials[ 0 ].envTextureIndex = 0;
		data.materials[ 0 ].envFlag = envFlag;
		const material = modelLoader().meshBuilder.build( data, '' ).material[ 0 ];
		assert.ok( material.matcap instanceof Texture );
		assert.equal( material.matcapCombine, envFlag === 1 ? MultiplyOperation : AddOperation );

	}

} );

test( 'decoded diffuse texture alpha enables node material transparency', () => {

	const data = new Parser().parsePmx( pmxBuffer(), true );
	data.textures = [ 'diffuse.png' ];
	data.materials[ 0 ].textureIndex = 0;
	const loader = modelLoader();
	class FixtureTextureLoader extends Loader<Texture> {

		load() { return new DataTexture( new Uint8Array( [ 255, 255, 255, 128 ] ), 1, 1 ); }

	}
	loader.manager.addHandler( /diffuse\.png$/, new FixtureTextureLoader() );
	const material = loader.meshBuilder.build( data, '' ).material[ 0 ];
	assert.equal( material.transparent, false );
	const texture = material.map as Texture & { readyCallbacks: ( ( texture: Texture ) => void )[] };
	for ( const callback of texture.readyCallbacks ) callback( texture );
	assert.equal( material.transparent, true );

} );

test( 'MMDPhysics steps real Ammo rigid bodies and updates a Three.js bone', async () => {

	const mesh = buildMesh();
	assert.throws( () => new MMDPhysics( mesh, [] ), /Import ammo.js/ );
	ammoGlobal.Ammo = await AmmoFactory();
	try {

		const physics = new MMDPhysics( mesh, [ {
			boneIndex: 0, type: 1, shapeType: 0, width: 0.1,
			position: [ 0, 0, 0 ], rotation: [ 0, 0, 0 ],
			weight: 1, friction: 0.5, restitution: 0,
			positionDamping: 0, rotationDamping: 0,
			groupIndex: 0, groupTarget: 65535
		} ] );
		assert.equal( physics.bodies.length, 1 );
		assert.equal( physics.setGravity( new Vector3( 0, - 10, 0 ) ), physics );
		assert.equal( physics.warmup( 10 ), physics );
		assert.ok( mesh.skeleton.bones[ 0 ].position.y < 0 );
		const helper = physics.createHelper();
		assert.equal( helper.children.length, 1 );
		helper.updateMatrixWorld( true );
		helper.dispose();
		mesh.skeleton.bones[ 0 ].position.set( 0, 0, 0 );
		assert.equal( physics.reset(), physics );
		assert.equal( physics.update( 1 / 60 ), physics );
		const animationHelper = new MMDAnimationHelper( { sync: false } );
		animationHelper.sharedPhysics = true;
		const secondMesh = buildMesh();
		animationHelper.add( mesh, { warmup: 0 } ).add( secondMesh, { warmup: 0 } );
		const firstPhysics = animationHelper.objects.get( mesh )!.physics!;
		const secondPhysics = animationHelper.objects.get( secondMesh )!.physics!;
		assert.equal( firstPhysics.world, secondPhysics.world );
		assert.equal( animationHelper.update( 1 / 60 ), animationHelper );

	} finally {

		delete ammoGlobal.Ammo;

	}

} );
