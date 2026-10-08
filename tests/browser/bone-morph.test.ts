import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { referenceBonePose, weightedRotation } from '../bone-morph-reference.ts';
import { referenceBdef, referenceSdef } from '../sdef-reference.ts';
import { authoredBoneMorphs, sdefCenter, sdefMorph, sdefNormal, sdefPmxBuffer, sdefProbeVertices, sdefR0, sdefR1, vmdBuffer } from '../fixtures.ts';
import { runBrowser } from './browser.ts';

const flip = ( values: number[] ) => values.map( ( v, i ) => Math.fround( i === 2 ? - v : v ) );
const animationRotation = authoredBoneMorphs[ 0 ].elements[ 1 ].rotation;
const motion = vmdBuffer( { boneName: 'bone0', rotation: animationRotation, morphs: [ 'vertex-morph', 'bone-a', 'bone-b' ].flatMap( morphName => [ { morphName, frameNum: 0, weight: 0 }, { morphName, frameNum: 30, weight: 1 } ] ) } );
const cases = [
	{ name: 'rest', weights: [ 0, 0, 0 ], vertex: 0 },
	{ name: 'full direct', weights: [ 1, 0, 0 ], vertex: 0 },
	{ name: 'shortest path', weights: [ 0, 0.5, 0 ], vertex: 0 },
	{ name: 'composed intermediate', weights: [ 0.25, 0.7, 0.5 ], vertex: 0.6 },
	{ name: 'full composed', weights: [ 1, 1, 1 ], vertex: 1 },
	{ name: 'disabled', weights: [ 1, 1, 1 ], vertex: 0.3, disabled: true },
	{ name: 'back to rest', weights: [ 0, 0, 0 ], vertex: 0 },
	{ name: 'VMD midpoint', weights: [ 0.5, 0.5, 0 ], vertex: 0.5, time: 0.5 },
	{ name: 'VMD seek backward', weights: [ 0.2, 0.2, 0 ], vertex: 0.2, time: 0.2 },
	{ name: 'VMD seek forward', weights: [ 0.8, 0.8, 0 ], vertex: 0.8, time: 0.8 },
	{ name: 'VMD loop', weights: [ 0.2, 0.2, 0 ], vertex: 0.2, time: 0.2, loop: true }
].map( c => {

	const base = referenceBonePose( [] );
	if ( 'time' in c && c.time !== undefined ) { base[ 0 ].position[ 0 ] = c.time * 2; base[ 0 ].rotation = weightedRotation( animationRotation, c.time ); }
	const bones = referenceBonePose( 'disabled' in c && c.disabled ? [] : c.weights, base );
	const palette = bones.map( ( b, i ) => new Matrix4().compose( new Vector3().fromArray( b.position ), new Quaternion().fromArray( b.rotation ), new Vector3( 1, 1, 1 ) ).multiply( new Matrix4().makeTranslation( ...referenceBonePose( [] )[ i ].position as [ number, number, number ] ).invert() ) );
	const expected = sdefProbeVertices.map( v => {

		const position = flip( v.position ).map( ( value, i ) => value + flip( sdefMorph )[ i ] * c.vertex );
		return v.type === 3
			? referenceSdef( { position, normal: flip( sdefNormal ), c: flip( sdefCenter ), r0: flip( sdefR0 ), r1: flip( sdefR1 ), weight: Math.fround( v.weight ) }, palette )
			: referenceBdef( position, flip( sdefNormal ), palette, v.type === 0 ? [ 1 ] : v.type === 1 ? [ Math.fround( v.weight ), 1 - Math.fround( v.weight ) ] : [ 0.2, 0.3, 0.1, 0.4 ] );

	} );
	return { ...c, expected };

} );

test( 'bone morph and VMD playback deform actual MMDLoader BDEF/SDEF positions and normals on both TSL backends', { timeout: 60000 }, async t => {

	const html = `<!doctype html><script type="importmap">{"imports":{
"mmd-parser":"/node_modules/mmd-parser/build/mmdparser.module.mjs",
"three":"/node_modules/three/build/three.module.js",
"three/webgpu":"/node_modules/three/build/three.webgpu.js",
"three/tsl":"/node_modules/three/build/three.tsl.js",
"three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<pre id="result">pending</pre><script type="module">
import {Float32BufferAttribute,FloatType,OrthographicCamera,Scene,Texture} from 'three';
import {RenderTarget,WebGPURenderer} from 'three/webgpu';
import {Fn,attribute,normalLocal,positionLocal,varying,vec4} from 'three/tsl';
import {MMDAnimationHelper,MMDLoader} from '/src/index.js';
const cases=${JSON.stringify( cases )};
const result={backends:[],errors:[],webgpu:'unavailable'};
console.error=(...args)=>result.errors.push(args.map(String).join(' '));
function check(value,message){if(!value)throw new Error(message);}
try {
 const adapter=await navigator.gpu?.requestAdapter();if(adapter)result.webgpu='available';
 for(const backend of adapter?['webgl','webgpu']:['webgl']) {
  const renderer=new WebGPURenderer({forceWebGL:backend==='webgl'});await renderer.init();renderer.setSize(6,1);
  check(backend==='webgl'?renderer.backend.isWebGLBackend:renderer.backend.isWebGPUBackend,'wrong backend');
  if(backend==='webgpu')renderer.backend.device.addEventListener('uncapturederror',event=>result.errors.push(event.error.message));
  renderer.debug.onShaderError=()=>result.errors.push('shader compilation failed');
  const target=new RenderTarget(6,1,{type:FloatType});renderer.setRenderTarget(target);
  let maxError=0,assertions=0;
  for(const pmxAnimation of [false,true]) {
   const loader=new MMDLoader();loader.meshBuilder.materialBuilder.textureLoader.load=()=>new Texture();
   const mesh=await loader.loadAsync('data:application/octet-stream;base64,${Buffer.from( sdefPmxBuffer( { boneMorphs: true } ) ).toString( 'base64' )}');
   check(mesh.geometry.userData.MMD.boneMorphs.length===3,'payload missing');
   mesh.frustumCulled=false;
   const scene=new Scene();scene.add(mesh);const camera=new OrthographicCamera(-2,2,2,-2,0.1,20);camera.position.z=5;
   const clips=[];for(let i=0;i<6;i++){const left=-1+i/3,right=left+1/3;clips.push(left,-1,right,-1,(left+right)/2,1);}
   mesh.geometry.setAttribute('probeClip',new Float32BufferAttribute(clips,2));
   const material=mesh.material[0];material.vertexNode=Fn(()=>vec4(attribute('probeClip','vec2'),0,1))();
   const clip=await new Promise((resolve,reject)=>loader.loadAnimation('data:application/octet-stream;base64,${Buffer.from( motion ).toString( 'base64' )}',mesh,resolve,undefined,reject));
   check(clip.tracks.length===5,'VMD tracks missing');
   for(const output of ['position','normal']) {
    mesh.pose();mesh.morphTargetInfluences.fill(0);
    material.fragmentNode=Fn(()=>vec4(varying(output==='position'?positionLocal:normalLocal),1))();material.needsUpdate=true;
    const helper=new MMDAnimationHelper({pmxAnimation,sync:false});helper.add(mesh,{physics:false});let playing=false;
    for(const c of cases) {
     helper.enable('boneMorph',!c.disabled);
     if(c.time!==undefined) {
      if(!playing){helper.remove(mesh);mesh.pose();mesh.morphTargetInfluences.fill(0);helper.add(mesh,{physics:false,animation:clip});playing=true;}
      const mixer=helper.objects.get(mesh).mixer;
      if(c.loop)helper.update(0.4);else mixer.setTime(c.time);
      helper.update(0);
     } else {mesh.morphTargetInfluences[0]=c.vertex;c.weights.forEach((w,i)=>mesh.morphTargetInfluences[i+1]=w);helper.update(0);}
     // Repeated zero updates must leave actual GPU output unchanged.
     for(let repeat=0;repeat<2;repeat++) {
      helper.update(0);await new Promise(requestAnimationFrame);renderer.render(scene,camera);
      const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,6,1);
      for(let i=0;i<6;i++)for(let component=0;component<3;component++) {
       const error=Math.abs(pixels[i*4+component]-c.expected[i][output][component]);maxError=Math.max(maxError,error);assertions++;
       check(Number.isFinite(error)&&error<0.0005,backend+' pmx='+pmxAnimation+' '+c.name+' '+output+' '+i+'/'+component+': '+pixels[i*4+component]+' vs '+c.expected[i][output][component]);
      }
     }
    }
    helper.remove(mesh);
   }
   mesh.geometry.dispose();mesh.skeleton.dispose();mesh.material.forEach(m=>m.dispose());
  }
  result.backends.push({backend,maxError,assertions});target.dispose();renderer.dispose();
 }
} catch(error){result.error=error.stack||String(error);}
document.getElementById('result').textContent=encodeURIComponent(JSON.stringify(result));
</script>`;
	const server = createServer( async ( request, response ) => {

		if ( request.url === '/' ) { response.setHeader( 'Content-Type', 'text/html' ); response.end( html ); return; }
		const path = request.url?.replace( /^\/src\//, 'dist/' ).replace( /^\//, '' );
		if ( ! path || ! /^(?:node_modules|dist)\//.test( path ) || path.includes( '..' ) ) { response.writeHead( 404 ).end(); return; }
		try { response.setHeader( 'Content-Type', 'text/javascript' ); response.end( await readFile( new URL( '../../' + path, import.meta.url ) ) ); }
		catch { response.writeHead( 404 ).end(); }

	} );
	const profile = await mkdtemp( join( tmpdir(), 'mmd-bone-morph-browser-' ) );
	try {

		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const result = await runBrowser<{ error?: string; errors: string[]; webgpu: string; backends: { backend: string; maxError: number; assertions: number }[] }>( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/`, profile );
		assert.equal( result.error, undefined, result.error ); assert.deepEqual( result.errors, [] );
		assert.equal( result.backends[ 0 ]?.backend, 'webgl' );
		for ( const b of result.backends ) { assert.equal( b.assertions, 1584 ); t.diagnostic( `${b.backend}: ${b.assertions} CPU position/normal comparisons, maximum error ${b.maxError}` ); }
		if ( result.webgpu === 'available' ) assert.equal( result.backends[ 1 ]?.backend, 'webgpu' );
		else t.diagnostic( 'Native WebGPU unavailable; mandatory WebGL2 passed.' );

	} finally { await new Promise( resolve => server.close( resolve ) ); await rm( profile, { recursive: true, force: true } ); }

} );
