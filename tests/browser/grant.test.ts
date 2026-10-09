import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { removeBrowserDirectory, runBrowser } from './browser.ts';
import { sdefCenter, sdefMorph, sdefNormal, sdefProbeVertices, sdefR0, sdefR1 } from '../fixtures.ts';
import { referenceBdef, referenceSdef } from '../sdef-reference.ts';

import { createRequire } from 'node:module';
import { Texture } from 'three';
import type { AmmoAPI } from '@takahirox/three-mmd';
import { MMDAnimationHelper } from '@takahirox/three-mmd';
import { product } from '../bone-morph-reference.ts';
import { Parser } from 'mmd-parser';
import { MMDLoader } from '@takahirox/three-mmd';
import { grantPmxBuffer, physicsLayersPmxBuffer, vmdBuffer } from '../fixtures.ts';
import { accumulated, authoredGrantPose, identity, power, referenceGrants } from '../grant-reference.ts';

const root = new URL( '../../', import.meta.url );
const flip = ( v: number[] ) => [ v[ 0 ], v[ 1 ], - v[ 2 ] ];
const loader = new MMDLoader();
const data = loader.meshBuilder.geometryBuilder.build( new Parser().parsePmx( grantPmxBuffer(), true ) ).userData.MMD;
const rest = data.bones.map( b => ( { position: b.pos, rotation: identity() } ) );
const rests = data.bones.map( ( _, i ) => accumulated( data.bones, rest, i ).position );
function palette( strength: number ) {

	const pose = referenceGrants( data.bones, authoredGrantPose( data.bones, strength ) );
	return data.bones.map( ( _, i ) => {

		const b = accumulated( data.bones, pose, i );
		return new Matrix4().compose( new Vector3().fromArray( b.position ), new Quaternion().fromArray( b.rotation ), new Vector3( 1, 1, 1 ) ).multiply( new Matrix4().makeTranslation( ...rests[ i ] as [ number, number, number ] ).invert() );

	} );

}
const poses = [ 0, 0.25, 1, - 0.5, 1.5, 0 ].map( strength => {

	const authored = authoredGrantPose( data.bones, strength );
	const bones = palette( strength );
	const expected = sdefProbeVertices.map( v => v.type === 3
		? referenceSdef( { position: flip( v.position ), normal: flip( sdefNormal ), c: flip( sdefCenter ), r0: flip( sdefR0 ), r1: flip( sdefR1 ), weight: Math.fround( v.weight ) }, bones )
		: referenceBdef( flip( v.position ), flip( sdefNormal ), bones, v.type === 0 ? [ 1 ] : v.type === 1 ? [ Math.fround( v.weight ), 1 - Math.fround( v.weight ) ] : [ 0.2, 0.3, 0.1, 0.4 ] ) );
	return { name: 'grant strength ' + strength, strength, quaternions: authored.map( b => b.rotation ), positions: authored.map( b => b.position ), morph: 0, bindMatrix: new Matrix4().toArray(), expected };

} );

// The GPU oracle composes post layers from raw Ammo body outputs using scalar
// quaternion algebra and an independent SDEF reference. The helper's final
// skeleton is never used to construct the expected palette.
async function physicsReference() {

	const host = globalThis as typeof globalThis & { Ammo?: AmmoAPI };
	host.Ammo = await ( createRequire( import.meta.url )( 'ammojs-typed' ) as () => Promise<AmmoAPI> )();
	try {

		const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
		const parsed = new Parser().parsePmx( physicsLayersPmxBuffer(), true );
		delete parsed.bones[ 9 ].ik;
		const mesh = loader.meshBuilder.build( parsed, '' ), metadata = mesh.geometry.userData.MMD;
		const helper = new MMDAnimationHelper( { sync: false } );
		const clip = loader.animationBuilder.build( new Parser().parseVmd( vmdBuffer( { boneName: 'bone0' } ), true ), mesh );
		helper.add( mesh, { animation: clip, warmup: 0, animationWarmup: false, gravity: new Vector3(), unitStep: 1 / 60 } );
		const mixer = helper.objects.get( mesh )!.mixer!; mixer.setTime( 0.25 ); mixer.clipAction( clip ).paused = true;
		mesh.skeleton.bones[ 6 ].position.x = 0.2; mesh.skeleton.bones[ 6 ].quaternion.set( 0, 0, Math.sin( 0.2 ), Math.cos( 0.2 ) );
		mesh.morphTargetInfluences![ 1 ] = 0.5;
		const rest = metadata.bones.map( b => ( { position: b.pos, rotation: identity() } ) );
		const rests = metadata.bones.map( ( _, i ) => accumulated( metadata.bones, rest, i ).position );
		const referencePose = rest.map( b => ( { position: b.position.slice(), rotation: b.rotation.slice() } ) );
		const poses = [];
		for ( const frames of [ 1, 3, 12 ] ) {

			for ( let frame = poses.length ? [ 1, 3 ][ poses.length - 1 ] : 0; frame < frames; frame ++ ) helper.update( 1 / 60 );
			const bodies = helper.objects.get( mesh )!.physics!.bodies;
			for ( const body of bodies ) if ( body.params.type === 1 ) {

				const transform = body.body.getCenterOfMassTransform(), p = transform.getOrigin(), q = transform.getRotation(), index = body.params.boneIndex;
				referencePose[ index ] = { position: [ p.x(), p.y(), p.z() ], rotation: [ q.x(), q.y(), q.z(), q.w() ] };

			}
			const morph = metadata.boneMorphs![ 0 ];
			for ( const index of [ 0, 1 ] ) {

				const e = morph.elements[ index ];
				const bodyPosition = index === 0 ? [ 0.5, 0, 0 ] : [ 2, 0, 0 ];
				referencePose[ index ].position = bodyPosition.map( ( v, c ) => v + e.position[ c ] * 0.5 + ( c === 0 ? 0.2 * ( index === 0 ? 0.5 : 0.25 ) : 0 ) );
				referencePose[ index ].rotation = product( power( e.rotation, 0.5 ), [ 0, 0, Math.sin( index === 0 ? 0.1 : 0.05 ), Math.cos( index === 0 ? 0.1 : 0.05 ) ] );

			}
			referencePose[ 2 ].position = rest[ 2 ].position.map( ( v, c ) => v + ( c === 0 ? 0.05 : 0 ) );
			// Mode2's rotation is Bullet output, NOT the prior rendered grant.
			const mode2Q = bodies[ 2 ].body.getCenterOfMassTransform().getRotation();
			referencePose[ 2 ].rotation = product( [ mode2Q.x(), mode2Q.y(), mode2Q.z(), mode2Q.w() ], [ 0, 0, Math.sin( 0.05 ), Math.cos( 0.05 ) ] );
			const palette = metadata.bones.map( ( _, i ) => {

				const b = accumulated( metadata.bones, referencePose, i );
				return new Matrix4().compose( new Vector3().fromArray( b.position ), new Quaternion().fromArray( b.rotation ), new Vector3( 1, 1, 1 ) ).multiply( new Matrix4().makeTranslation( ...rests[ i ] as [ number, number, number ] ).invert() );

			} );
			poses.push( { name: 'physics frame ' + frames, frames, strength: 0, quaternions: rest.map( b => b.rotation ), positions: rest.map( b => b.position ), morph: 0, bindMatrix: new Matrix4().toArray(), expected: sdefProbeVertices.map( v => skinReference( v, flip( v.position ), palette ) ), palette } );

		}
		return { poses, rests };

	} finally { delete host.Ammo; }

}
function skinReference( v: typeof sdefProbeVertices[number], position: number[], bones: Matrix4[] ) {

	return v.type === 3 ? referenceSdef( { position, normal: flip( sdefNormal ), c: flip( sdefCenter ), r0: flip( sdefR0 ), r1: flip( sdefR1 ), weight: Math.fround( v.weight ) }, bones ) : referenceBdef( position, flip( sdefNormal ), bones, v.type === 0 ? [ 1 ] : v.type === 1 ? [ Math.fround( v.weight ), 1 - Math.fround( v.weight ) ] : [ 0.2, 0.3, 0.1, 0.4 ] );

}

for ( const physicsMode of [ false, true ] ) test( `PMX ${physicsMode ? 'post-physics layers' : 'all four grants'} deform actual BDEF/SDEF positions/normals, toon, outlines and shadows`, { timeout: 60000 }, async t => {

	const physics = physicsMode ? await physicsReference() : undefined;
	const testPoses = physics?.poses ?? poses;
	const testRests = physics?.rests ?? rests;
	const bytes = physicsMode ? physicsLayersPmxBuffer() : grantPmxBuffer();

	const html = `<!doctype html><script type="importmap">{"imports":{
"mmd-parser":"/node_modules/mmd-parser/build/mmdparser.module.mjs",
"three":"/node_modules/three/build/three.module.js",
"three/webgpu":"/node_modules/three/build/three.webgpu.js",
"three/tsl":"/node_modules/three/build/three.tsl.js",
"three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script src="/node_modules/ammojs-typed/ammo/ammo.js"></script><pre id="result">pending</pre><script type="module">
import { Vector3, AmbientLight, DataTexture, DirectionalLight, Float32BufferAttribute, FloatType, Mesh, OrthographicCamera, Scene, Texture } from 'three';
import { RenderTarget, WebGPURenderer } from 'three/webgpu';
import { Fn, attribute, normalLocal, positionLocal, varying, vec4 } from 'three/tsl';
import { MMDAnimationHelper, MMDLoader, MMDOutlineEffect } from '/src/index.js';
const poses = ${JSON.stringify( testPoses )};
const rests = ${JSON.stringify( testRests )};
const physicsMode=${physicsMode};
if(physicsMode)window.Ammo=await window.Ammo();
const result = { backends: [], errors: [], webgpu: 'unavailable' };
console.error = (...args) => result.errors.push(args.map(String).join(' '));
function check(value, message) { if(!value) throw new Error(message); }
try {
 const adapter = await navigator.gpu?.requestAdapter();
 if(adapter) result.webgpu = 'available';
 for(const backend of adapter ? ['webgl','webgpu'] : ['webgl']) for(const pmxAnimation of [false,true]) {
  const renderer = new WebGPURenderer({forceWebGL: backend === 'webgl', antialias:false});
  await renderer.init();
  if(backend==='webgpu') renderer.backend.device.addEventListener('uncapturederror',event=>result.errors.push(event.error.message));
  check(backend==='webgl' ? renderer.backend.isWebGLBackend : renderer.backend.isWebGPUBackend, 'wrong backend');
  renderer.setSize(128,128); renderer.debug.onShaderError = () => result.errors.push('shader compilation failed');
  const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
  const mesh = await loader.loadAsync('data:application/octet-stream;base64,${Buffer.from( bytes ).toString( 'base64' )}');
  mesh.frustumCulled=false; mesh.bindMode='detached';
  const helper=new MMDAnimationHelper({pmxAnimation,sync:false});
  let physicsClip;
  if(physicsMode) {
   const ik=mesh.geometry.userData.MMD.bones[9].ik;
   mesh.geometry.userData.MMD.iks=mesh.geometry.userData.MMD.iks.filter(value=>value!==ik);delete mesh.geometry.userData.MMD.bones[9].ik;
   const motion=await new Promise((resolve,reject)=>loader.loadAnimation('data:application/octet-stream;base64,${Buffer.from( vmdBuffer( { boneName: 'bone0' } ) ).toString( 'base64' )}',mesh,resolve,undefined,reject));
   physicsClip=motion;
  }
  helper.add(mesh,{physics:physicsMode,animation:physicsClip,warmup:0,animationWarmup:false,gravity:new Vector3(),unitStep:1/60});
  const physicsState=helper.objects.get(mesh);
  let previousFrames=0;
  const scene = new Scene(); scene.add(mesh);
  const camera = new OrthographicCamera(-2,2,2,-2,0.1,20); camera.position.z=5;
  const material = mesh.material[0]; const originalFragment=material.fragmentNode, originalVertex=material.vertexNode;
  const clips=[];
  for(let i=0;i<6;i++) {
   const left=-1+i/3, right=left+1/3;
   clips.push(left,-1, right,-1, (left+right)/2,1);
  }
  mesh.geometry.setAttribute('probeClip',new Float32BufferAttribute(clips,2));
  material.vertexNode=Fn(()=>vec4(attribute('probeClip','vec2'),0,1))();
  const target=new RenderTarget(6,1,{type:FloatType}); renderer.setRenderTarget(target);
  async function render() { await new Promise(requestAnimationFrame); renderer.render(scene,camera); }
  let maxError=0;
  function poseMesh(pose) {
   if(physicsMode) {
    if(pose.frames<=previousFrames) { physicsState.mixer.clipAction(physicsClip).stop();helper.pose(mesh,{metadata:{boneCount:0},bones:[]},{ik:false,grant:false});mesh.morphTargetInfluences.fill(0);helper.update(0);physicsState.physics.reset();physicsState.mixer.clipAction(physicsClip).reset().play();previousFrames=0; }
    physicsState.mixer.clipAction(physicsClip).paused=false;physicsState.mixer.setTime(0.25);physicsState.mixer.clipAction(physicsClip).paused=true;
    mesh.skeleton.bones[6].position.x=0.2;mesh.skeleton.bones[6].quaternion.set(0,0,Math.sin(0.2),Math.cos(0.2));mesh.morphTargetInfluences[1]=0.5;
    for(let frame=previousFrames;frame<pose.frames;frame++)helper.update(1/60);
    previousFrames=pose.frames;return;
   }
   helper.pose(mesh,{metadata:{boneCount:0},bones:[]},{ik:false,grant:false});
   mesh.skeleton.bones.forEach((bone,i)=>{bone.position.fromArray(pose.positions[i]);bone.quaternion.fromArray(pose.quaternions[i]);});
   helper.update(0);helper.update(0);
   mesh.morphTargetInfluences[0]=pose.morph;
   mesh.bindMatrix.fromArray(pose.bindMatrix);mesh.bindMatrixInverse.copy(mesh.bindMatrix).invert();
  }
  for(const output of ['position','normal']) {
   material.fragmentNode=Fn(()=>vec4(varying(output==='position' ? positionLocal : normalLocal),1))();material.needsUpdate=true;
   for(const pose of poses) {
    poseMesh(pose); await render();
    const data=await renderer.readRenderTargetPixelsAsync(target,0,0,6,1);
    for(let i=0;i<6;i++) for(let c=0;c<3;c++) {
     const error=Math.abs(data[i*4+c]-pose.expected[i][output][c]); maxError=Math.max(maxError,error);
     check(Number.isFinite(error) && error<0.0005, backend+' '+pose.name+' '+output+' vertex '+i+' component '+c+': '+data[i*4+c]+' vs '+pose.expected[i][output][c]);
    }
   }
  }
  // Compare real rasterized toon/outline and shadow geometry to CPU-baked mesh.
  // Expand each authored point to a triangle; no probe clip override is used.
  material.fragmentNode=originalFragment;material.vertexNode=originalVertex;material.gradientMap=null;material.color.setRGB(0.5,0.5,0.5);material.specular.setRGB(0,0,0);material.needsUpdate=true;
  // Three caches morph textures by geometry identity; use a fresh geometry
  // when changing the authored morph target data after the numeric probes.
  const probeGeometry=mesh.geometry;mesh.geometry=probeGeometry.clone();probeGeometry.dispose();
  const position=mesh.geometry.attributes.position;
  for(let i=0;i<position.count;i++) { position.setX(i,position.getX(i)+[-0.25,0.25,0][i%3]);position.setY(i,position.getY(i)+[-0.18,-0.18,0.36][i%3]); }
  position.needsUpdate=true;
  // Keep absolute morph targets consistent with the expanded base geometry.
  for(const morph of mesh.geometry.morphAttributes.position) {
   for(let i=0;i<morph.count;i++){morph.setX(i,morph.getX(i)+[-0.25,0.25,0][i%3]);morph.setY(i,morph.getY(i)+[-0.18,-0.18,0.36][i%3]);} morph.needsUpdate=true;
  }
  // Expected expanded positions: independently generated on the server below.
  const expanded=${JSON.stringify( sdefProbeVertices.flatMap( v => [ [ - 0.25, - 0.18, 0 ], [ 0.25, - 0.18, 0 ], [ 0, 0.36, 0 ] ].map( delta => {
	const pose = testPoses[ 2 ];
	const bones = physics?.poses[ 2 ].palette ?? palette( pose.strength );
	const position = new Vector3().fromArray( flip( v.position ) ).add( new Vector3().fromArray( delta ) ).addScaledVector( new Vector3().fromArray( flip( sdefMorph ) ), pose.morph ).toArray();
	return v.type === 3 ? referenceSdef( { position, normal: flip( sdefNormal ), c: flip( sdefCenter ), r0: flip( sdefR0 ), r1: flip( sdefR1 ), weight: v.weight }, bones ) : referenceBdef( position, flip( sdefNormal ), bones, v.type === 0 ? [ 1 ] : v.type === 1 ? [ v.weight, 1 - v.weight ] : [ 0.2, 0.3, 0.1, 0.4 ] );
} ) ) )};
  poseMesh(poses[2]);
  const bakedGeometry=mesh.geometry.clone();bakedGeometry.morphAttributes={};
  bakedGeometry.setAttribute('position',new Float32BufferAttribute(expanded.flatMap(v=>v.position),3));
  bakedGeometry.setAttribute('normal',new Float32BufferAttribute(expanded.flatMap(v=>v.normal),3));
  const baked=new Mesh(bakedGeometry,mesh.material);baked.frustumCulled=false;
  const light=new DirectionalLight(0xffffff,Math.PI);light.position.set(1,1,5);scene.add(light,new AmbientLight(0xffffff,1));
  const map=new DataTexture(new Uint8Array([128,192,224,255]),1,1);map.needsUpdate=true;material.map=map;material.needsUpdate=true;
  const pixelsTarget=new RenderTarget(128,128);renderer.setRenderTarget(pixelsTarget);
  const effect=new MMDOutlineEffect(renderer);
  material.userData.outlineParameters={visible:true,thickness:0.015,color:[1,0,0],alpha:1};
  async function pixels(object,outline=true) {
   scene.remove(mesh,baked);scene.add(object);await new Promise(requestAnimationFrame);
   if(outline) effect.render(scene,camera);else renderer.render(scene,camera);
   return new Uint8Array(await renderer.readRenderTargetPixelsAsync(pixelsTarget,0,0,128,128));
  }
  function compare(a,b,label) {
   let mismatch=0,covered=0,expectedCoverage=0;
   for(let i=0;i<b.length;i+=4) if(b[i]+b[i+1]+b[i+2]>0) expectedCoverage++;
   for(let i=0;i<a.length;i+=4) { if(a[i]+a[i+1]+a[i+2]>0) covered++; if(Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]-b[i+c])))>3)mismatch++; }
   check(covered>20,label+' missing geometry '+covered);check(mismatch<=5,label+' mismatched '+mismatch+' pixels, actual '+covered+' expected '+expectedCoverage);return covered;
  }
  const surface=compare(await pixels(mesh,false),await pixels(baked,false),'toon '+backend);
  const outline=compare(await pixels(mesh),await pixels(baked),'outline '+backend);
  // Read actual shadow map color: r186 shadow pass outputs alpha for occluders.
  renderer.shadowMap.enabled=true;light.castShadow=true;light.shadow.mapSize.set(128,128);
  Object.assign(light.shadow.camera,{left:-2,right:2,top:2,bottom:-2,near:0.1,far:20});light.shadow.camera.updateProjectionMatrix();
  mesh.castShadow=baked.castShadow=true;mesh.receiveShadow=baked.receiveShadow=true;material.needsUpdate=true;
  async function shadow(object) {
   await pixels(object,false);
   const map=light.shadow.map;
   check(map,'shadow map absent');
   return new Uint8Array(await renderer.readRenderTargetPixelsAsync(map,0,0,128,128));
  }
  const sa=await shadow(mesh),sb=await shadow(baked);let shadowMismatch=0,shadowCoverage=0;
  for(let i=3;i<sa.length;i+=4) { if(sa[i]>0)shadowCoverage++;if(Math.abs(sa[i]-sb[i])>3)shadowMismatch++; }
  check(shadowCoverage>10 && shadowMismatch<=5,'shadow mismatch '+backend+' coverage '+shadowCoverage+' different '+shadowMismatch);
  result.backends.push({backend,pmxAnimation,maxError,poses:poses.length,surface,outline,shadowCoverage});
  effect.dispose();target.dispose();pixelsTarget.dispose();mesh.skeleton.dispose();mesh.geometry.dispose();bakedGeometry.dispose();material.dispose();map.dispose();renderer.dispose();
 }
} catch(error) { result.error=error.stack||String(error); }
document.getElementById('result').textContent=encodeURIComponent(JSON.stringify(result));
</script>`;
	const profile = await mkdtemp( join( tmpdir(), 'mmd-sdef-browser-' ) );
	const server = createServer( async ( request, response ) => {

		if ( request.url === '/' ) { response.setHeader( 'Content-Type', 'text/html' ); response.end( html ); return; }
		const path = request.url?.replace( /^\/src\//, 'dist/' ).replace( /^\//, '' );
		if ( ! path || ! /^(?:node_modules|dist)\//.test( path ) || path.includes( '..' ) ) { response.writeHead( 404 ).end(); return; }
		try { response.setHeader( 'Content-Type', 'text/javascript' ); response.end( await readFile( new URL( path, root ) ) ); }
		catch { response.writeHead( 404 ).end(); }

	} );
	try {

		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const result = await runBrowser<{ error?: string; errors: string[]; webgpu: string; backends: { backend: string; pmxAnimation: boolean; maxError: number; poses: number; shadowCoverage: number }[] }>( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/`, profile );
		assert.equal( result.error, undefined, result.error );
		assert.deepEqual( result.errors, [] );
		assert.equal( result.backends[ 0 ]?.backend, 'webgl' );
		for ( const backend of result.backends ) t.diagnostic( `${backend.backend} pmx=${backend.pmxAnimation}: ${backend.poses} CPU-reference poses, maximum error ${backend.maxError}, shadow coverage ${backend.shadowCoverage}` );
		if ( result.webgpu === 'available' ) assert.equal( result.backends[ 2 ]?.backend, 'webgpu' );
		else t.diagnostic( 'Native WebGPU unavailable; mandatory WebGL2 passed.' );

	} finally { await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( profile ); }

} );
