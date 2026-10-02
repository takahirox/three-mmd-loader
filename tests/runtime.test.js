import assert from 'node:assert/strict';
import { test } from 'node:test';
import AmmoFactory from 'ammojs-typed';
import {
	Bone, BufferGeometry, DoubleSide, FrontSide, Loader, LoadingManager,
	MeshBasicMaterial, ShaderChunk, Skeleton, SkinnedMesh, Texture, Vector3
} from 'three';
import {
	CCDIKSolver, MMDAnimationHelper, MMDExporter, MMDLoader, MMDParser, MMDPhysics,
	MMDToonShader
} from 'three-mmd-loader';
import { pmdBuffer, pmxBuffer, vmdBuffer } from './fixtures.js';

function modelLoader() {

	const loader = new MMDLoader();
	// Image decoding requires a browser; keep the actual geometry/material builders.
	loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	return loader;

}

function buildMesh( format = 'pmd' ) {

	const parser = new MMDParser.Parser();
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
		assert.deepEqual( Array.from( mesh.geometry.index.array ), [ 2, 1, 0 ] );
		assert.equal( mesh.geometry.attributes.skinWeight.getX( 0 ), 1 );
		assert.equal( mesh.geometry.attributes.skinIndex.itemSize, 4 );
		assert.equal( mesh.skeleton.bones[ 0 ].name, 'root' );
		assert.equal( mesh.geometry.userData.MMD.format, format );
		assert.equal( mesh.geometry.morphAttributes.position, undefined );
		const material = mesh.material[ 0 ];
		assert.equal( material.isMMDToonMaterial, true );
		assert.equal( material.lights, true );
		assert.equal( material.side, format === 'pmx' ? DoubleSide : FrontSide );
		assert.equal( material.fragmentShader, MMDToonShader.fragmentShader );
		assert.equal( material.uniforms.gradientMap.value, material.gradientMap );
		assert.equal( material.uniforms.shininess.value, 30 );
		assert.equal( material.userData.outlineParameters.visible, true );
		assert.doesNotThrow( () => material.clone() );

	} );

}

test( 'PMX vertex morphs retain their positions and mesh influences', () => {

	const data = new MMDParser.Parser().parsePmx( pmxBuffer(), true );
	data.metadata.morphCount = 1;
	data.morphs = [ {
		name: 'smile', type: 1, elementCount: 1,
		elements: [ { index: 0, position: [ 0.25, 0, 0 ] } ]
	} ];
	const mesh = modelLoader().meshBuilder.build( data, '' );
	assert.equal( mesh.geometry.morphAttributes.position.length, 1 );
	assert.equal( mesh.geometry.morphAttributes.position[ 0 ].getX( 0 ), 0.25 );
	assert.equal( mesh.geometry.morphAttributes.position[ 0 ].getZ( 0 ), - 1 );
	assert.equal( mesh.morphTargetDictionary.smile, 0 );
	assert.deepEqual( mesh.morphTargetInfluences, [ 0 ] );

} );

test( 'public loader loads a PMD buffer through Three.js FileLoader', async () => {

	// FileLoader uses this browser event while streaming the response.
	const original = globalThis.ProgressEvent;
	globalThis.ProgressEvent ??= class extends Event {

		constructor( type, properties ) { super( type ); Object.assign( this, properties ); }

	};
	try {

		const url = `data:application/octet-stream;base64,${Buffer.from( pmdBuffer() ).toString( 'base64' )}`;
		const loader = modelLoader();
		const mesh = await loader.loadAsync( url );
		assert.ok( mesh instanceof SkinnedMesh );
		assert.equal( mesh.skeleton.bones.length, 1 );

	} finally {

		if ( original === undefined ) delete globalThis.ProgressEvent;
		else globalThis.ProgressEvent = original;

	}

} );

test( 'parsed VMD animates a loaded bone with physics disabled', () => {

	const mesh = buildMesh();
	const vmd = new MMDParser.Parser().parseVmd( vmdBuffer(), true );
	const animation = new MMDLoader().animationBuilder.build( vmd, mesh );
	assert.equal( animation.duration, 1 );
	assert.equal( animation.tracks.length, 2 );
	assert.equal( animation.validate(), true );
	const helper = new MMDAnimationHelper( { sync: false } );
	assert.equal( helper.add( mesh, { animation, physics: false } ), helper );
	helper.update( 0.5 );
	assert.ok( Math.abs( mesh.skeleton.bones[ 0 ].position.x - 1 ) < 1e-5 );
	assert.equal( helper.objects.get( mesh ).physics, undefined );
	assert.equal( helper.remove( mesh ), helper );
	assert.equal( helper.meshes.length, 0 );

} );

test( 'public loadAnimation skips VMD morphs on models without morph targets', async ( t ) => {

	const original = globalThis.ProgressEvent;
	globalThis.ProgressEvent ??= class extends Event {

		constructor( type, properties ) { super( type ); Object.assign( this, properties ); }

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
				const animation = await new Promise( ( resolve, reject ) => {

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

		if ( original === undefined ) delete globalThis.ProgressEvent;
		else globalThis.ProgressEvent = original;

	}

} );

test( 'VPD exporter round trips a posed bone through the bundled parser', () => {

	const mesh = buildMesh();
	const bone = mesh.skeleton.bones[ 0 ];
	bone.name = 'センター';
	bone.position.set( 1, 2, 3 );
	const exporter = new MMDExporter();
	const text = exporter.parseVpd( mesh );
	assert.deepEqual( bone.position.toArray(), [ 1, 2, 3 ] );
	const parser = new MMDParser.Parser();
	const pose = parser.parseVpd( text, true );
	assert.equal( pose.bones[ 0 ].name, 'センター' );
	assert.deepEqual( pose.bones[ 0 ].translation, [ 1, 2, 3 ] );
	const bytes = exporter.parseVpd( mesh, true );
	assert.ok( bytes instanceof Uint8Array );
	assert.equal( new MMDParser.CharsetEncoder().s2u( bytes ), text );
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

test( 'toon shader resolves against the targeted Three.js shader chunks', () => {

	function resolve( source ) {

		return source.replace( /#include <(\w+)>/g, ( _, name ) => {

			assert.equal( typeof ShaderChunk[ name ], 'string', `Missing shader chunk: ${name}` );
			return resolve( ShaderChunk[ name ] );

		} );

	}
	assert.ok( resolve( MMDToonShader.vertexShader ).includes( 'gl_Position' ) );
	const fragment = resolve( MMDToonShader.fragmentShader );
	assert.match( fragment, /getGradientIrradiance\( geometryNormal, directLight.direction \)/ );
	assert.match( fragment, /outgoingLight \*= matcapColor.rgb/ );
	assert.match( fragment, /outgoingLight \+= matcapColor.rgb/ );
	assert.equal( MMDToonShader.uniforms.matcap.value, null );
	assert.equal( MMDToonShader.uniforms.gradientMap.value, null );

} );

test( 'MMDPhysics steps real Ammo rigid bodies and updates a Three.js bone', async () => {

	const mesh = buildMesh();
	assert.throws( () => new MMDPhysics( mesh, [] ), /Import ammo.js/ );
	globalThis.Ammo = await AmmoFactory();
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

	} finally {

		delete globalThis.Ammo;

	}

} );
