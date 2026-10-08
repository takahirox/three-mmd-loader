import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { removeBrowserDirectory, runBrowser } from './browser.ts';
import { sdefCenter, sdefMorph, sdefNormal, sdefPmxBuffer, sdefProbeVertices, sdefR0, sdefR1 } from '../fixtures.ts';
import { referenceBdef, referenceSdef } from '../sdef-reference.ts';

const root = new URL( '../../', import.meta.url );
const flip = ( v: number[] ) => [ v[ 0 ], v[ 1 ], - v[ 2 ] ];
const rests = Array.from( { length: 4 }, ( _, i ) => [ i * 0.2, i * 0.1, i * 0.15 ] );
const poses = [
	{ name: 'rest', angles: [ 0, 0, 0, 0 ], morph: 0, bind: false },
	{ name: 'bend', angles: [ 0.7, - 1.3, 0.5, - 0.8 ], morph: 0, bind: false },
	{ name: 'vertex morph before skin', angles: [ 0.7, - 1.3, 0.5, - 0.8 ], morph: 0.8, bind: false },
	{ name: 'bind rotation and translation', angles: [ 0.7, - 1.3, 0.5, - 0.8 ], morph: 0.8, bind: true },
	{ name: 'matrix quaternion x/y/z branches', angles: [ 3.5, 3.4, 3.6, 3.2 ], morph: 0.5, bind: false },
	{ name: 'shortest-path quaternion sign', angles: [ 3.5, 0.7, 0.5, 0 ], morph: 0.5, bind: false },
	{ name: 'z-dominant rotation extraction', angles: [ 3.5, 3.4, 0, 0 ], morph: 0.5, bind: false },
	{ name: 'nearly identical rotations', angles: [ 0.0001, 0.0002, 0, 0 ], morph: 0, bind: false }
].map( ( pose, poseIndex ) => {

	const axes = [ new Vector3( 1, 0, 0 ), new Vector3( 0, 1, 0 ), new Vector3( 0, 0, 1 ), new Vector3( 1, 1, 0 ).normalize() ];
	const quaternions = pose.angles.map( ( angle, i ) => new Quaternion().setFromAxisAngle( axes[ pose.name === 'z-dominant rotation extraction' && i === 0 ? 2 : i ], angle ) );
	const translations = rests.map( ( _, i ) => poseIndex === 0 ? [ 0, 0, 0 ] : [ 0.08 * ( i + 1 ), - 0.04 * i, 0.03 * i ] );
	const bones = rests.map( ( rest, i ) => new Matrix4().compose( new Vector3().fromArray( rest ).add( new Vector3().fromArray( translations[ i ] ) ), quaternions[ i ], new Vector3( 1, 1, 1 ) ).multiply( new Matrix4().makeTranslation( ...rest as [ number, number, number ] ).invert() ) );
	const bind = pose.bind ? new Matrix4().makeRotationY( 0.4 ).setPosition( 0.3, - 0.1, 0.2 ) : new Matrix4();
	const expected = sdefProbeVertices.map( v => {

		const position = new Vector3().fromArray( flip( v.position ) ).addScaledVector( new Vector3().fromArray( flip( sdefMorph ) ), pose.morph ).toArray();
		if ( v.type === 3 ) return referenceSdef( { position, normal: flip( sdefNormal ), c: flip( sdefCenter ), r0: flip( sdefR0 ), r1: flip( sdefR1 ), weight: v.weight }, bones, bind );
		return referenceBdef( position, flip( sdefNormal ), bones, v.type === 0 ? [ 1 ] : v.type === 1 ? [ v.weight, 1 - v.weight ] : [ 0.2, 0.3, 0.1, 0.4 ], bind );

	} );
	return { ...pose, quaternions: quaternions.map( q => q.toArray() ), translations, bindMatrix: bind.toArray(), expected };

} );

test( 'SDEF TSL matches independent CPU positions/normals and aligned toon, outline and shadows', { timeout: 60000 }, async t => {

	const html = `<!doctype html><script type="importmap">{"imports":{
"mmd-parser":"/node_modules/mmd-parser/build/mmdparser.module.mjs",
"three":"/node_modules/three/build/three.module.js",
"three/webgpu":"/node_modules/three/build/three.webgpu.js",
"three/tsl":"/node_modules/three/build/three.tsl.js",
"three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<pre id="result">pending</pre><script type="module">
import { AmbientLight, Bone, Color, DataTexture, DirectionalLight, DoubleSide, Float32BufferAttribute, FloatType, Matrix4, Mesh, OrthographicCamera, Scene, Skeleton, Texture, Vector3 } from 'three';
import { RenderTarget, WebGPURenderer } from 'three/webgpu';
import { Fn, attribute, normalLocal, positionLocal, varying, vec4 } from 'three/tsl';
import { MMDLoader, MMDOutlineEffect } from '/src/index.js';
const poses = ${JSON.stringify( poses )};
const rests = ${JSON.stringify( rests )};
const result = { backends: [], errors: [], webgpu: 'unavailable' };
console.error = (...args) => result.errors.push(args.map(String).join(' '));
function check(value, message) { if(!value) throw new Error(message); }
try {
 const adapter = await navigator.gpu?.requestAdapter();
 if(adapter) result.webgpu = 'available';
 for(const backend of adapter ? ['webgl','webgpu'] : ['webgl']) {
  const renderer = new WebGPURenderer({forceWebGL: backend === 'webgl', antialias:false});
  await renderer.init();
  if(backend==='webgpu') renderer.backend.device.addEventListener('uncapturederror',event=>result.errors.push(event.error.message));
  check(backend==='webgl' ? renderer.backend.isWebGLBackend : renderer.backend.isWebGPUBackend, 'wrong backend');
  renderer.setSize(128,128); renderer.debug.onShaderError = () => result.errors.push('shader compilation failed');
  const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
  const mesh = await loader.loadAsync('data:application/octet-stream;base64,${Buffer.from( sdefPmxBuffer() ).toString( 'base64' )}');
  mesh.frustumCulled=false; mesh.bindMode='detached';
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
   mesh.skeleton.bones.slice(0,4).forEach((bone,i)=>{bone.position.fromArray(rests[i]).add(new Vector3().fromArray(pose.translations[i]));bone.quaternion.fromArray(pose.quaternions[i]);});
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
  // Force r186's large-skeleton bone-texture path (including repeated updates).
  const first=mesh.skeleton.bones.slice(); const inverses=mesh.skeleton.boneInverses.slice();
  for(let i=4;i<1100;i++) { const bone=new Bone();mesh.add(bone);first.push(bone);inverses.push(new Matrix4()); }
  mesh.skeleton=new Skeleton(first,inverses); material.needsUpdate=true;
  for(const output of ['position','normal']) {
   material.fragmentNode=Fn(()=>vec4(varying(output==='position'?positionLocal:normalLocal),1))();material.needsUpdate=true;
   for(const pose of [poses[1],poses[2]]) {
    poseMesh(pose);await render();
    const data=await renderer.readRenderTargetPixelsAsync(target,0,0,6,1);
    for(let i=0;i<6;i++) for(let c=0;c<3;c++) check(Math.abs(data[i*4+c]-pose.expected[i][output][c])<0.0005,'bone texture '+backend+' '+output+' '+i);
   }
  }
  check(mesh.skeleton.boneTexture!==null,'bone texture path not exercised');
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
  const morph=mesh.geometry.morphAttributes.position[0];
  for(let i=0;i<morph.count;i++){morph.setX(i,morph.getX(i)+[-0.25,0.25,0][i%3]);morph.setY(i,morph.getY(i)+[-0.18,-0.18,0.36][i%3]);} morph.needsUpdate=true;
  // Expected expanded positions: independently generated on the server below.
  const expanded=${JSON.stringify( sdefProbeVertices.flatMap( v => [ [ - 0.25, - 0.18, 0 ], [ 0.25, - 0.18, 0 ], [ 0, 0.36, 0 ] ].map( delta => {
	const pose = poses[ 2 ];
	const bones = rests.map( ( rest, i ) => new Matrix4().compose( new Vector3().fromArray( rest ).add( new Vector3().fromArray( pose.translations[ i ] ) ), new Quaternion().fromArray( pose.quaternions[ i ] ), new Vector3( 1, 1, 1 ) ).multiply( new Matrix4().makeTranslation( ...rest as [ number, number, number ] ).invert() ) );
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
  result.backends.push({backend,maxError,poses:poses.length,surface,outline,shadowCoverage});
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
		const result = await runBrowser<{ error?: string; errors: string[]; webgpu: string; backends: { backend: string; maxError: number; poses: number; shadowCoverage: number }[] }>( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/`, profile );
		assert.equal( result.error, undefined, result.error );
		assert.deepEqual( result.errors, [] );
		assert.equal( result.backends[ 0 ]?.backend, 'webgl' );
		for ( const backend of result.backends ) t.diagnostic( `${backend.backend}: ${backend.poses} CPU-reference poses, maximum error ${backend.maxError}, shadow coverage ${backend.shadowCoverage}` );
		if ( result.webgpu === 'available' ) assert.equal( result.backends[ 1 ]?.backend, 'webgpu' );
		else t.diagnostic( 'Native WebGPU unavailable; mandatory WebGL2 passed.' );

	} finally { await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( profile ); }

} );
