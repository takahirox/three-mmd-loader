import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { sdefPmxBuffer } from '../fixtures.ts';
import { referenceUV } from '../uv-morph-reference.ts';
import { runBrowser, removeBrowserDirectory } from './browser.ts';

const weights = [ [], [ 0, 0.5 ], [ 0, 1 ], [ 0, - 0.5, 1.5, - 0.5, 0.5, 1.5 ], [ 0, 0, 0, 0, 0, 0, 0.5 ], [ 0, 0, 0, 0, 0, 0, 1 ], [ 0.2, 0.3, 0.5, - 0.2, 0.7, 1.2, 0.4, - 0.5, 0.3 ], [] ];
const cases = weights.map( weights => ( { weights, expected: Array.from( { length: 5 }, ( _, c ) => referenceUV( c, 3, weights ) ) } ) );

test( 'UV texture RGBA/depth/shadow and extra xyzw GPU readback stress mixed SDEF on both TSL backends', { timeout: 120000 }, async t => {

	const html = `<!doctype html><script type="importmap">{"imports":{
"mmd-parser":"/node_modules/mmd-parser/build/mmdparser.module.mjs",
"three":"/node_modules/three/build/three.module.js","three/webgpu":"/node_modules/three/build/three.webgpu.js",
"three/tsl":"/node_modules/three/build/three.tsl.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<pre id="result">pending</pre><script type="module">
import { DataTexture, DirectionalLight, Float32BufferAttribute, LinearSRGBColorSpace, NearestFilter, OrthographicCamera, Scene, Mesh, PlaneGeometry, RepeatWrapping, ClampToEdgeWrapping, DoubleSide, NoBlending } from 'three';
import { RenderTarget, WebGPURenderer, MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, vec4, uv } from 'three/tsl';
import { MMDLoader, MMDAnimationHelper, mmdAdditionalUV } from '/src/index.js';
import { Parser } from 'mmd-parser';
const result={errors:[],backends:[],webgpu:false,stage:'init'};const watchdog=setTimeout(()=>{result.errors.push('GPU timeout at '+result.stage);document.getElementById('result').textContent=encodeURIComponent(JSON.stringify(result));},90000);console.error=(...a)=>result.errors.push(a.map(String).join(' '));
const check=(v,m)=>{if(!v)throw new Error(m);};
const near=(a,e,m,t=3)=>a.forEach((v,k)=>check(Math.abs(v-e[k])<=t,m+' '+a+' expected '+e));
try {
 const adapter=await navigator.gpu?.requestAdapter();result.webgpu=!!adapter;
 for(const backend of adapter?['webgl','webgpu']:['webgl']) {
  const renderer=new WebGPURenderer({forceWebGL:backend==='webgl',antialias:false});await renderer.init();renderer.setSize(64,64);renderer.setClearColor(0,0);
  if(backend==='webgpu')renderer.backend.device.addEventListener('uncapturederror',e=>result.errors.push(e.error.message));
  result.stage=backend;
  check(backend==='webgl'?renderer.backend.isWebGLBackend:renderer.backend.isWebGPUBackend,'backend mismatch');
  const target=new RenderTarget(64,64);target.texture.colorSpace=LinearSRGBColorSpace;renderer.setRenderTarget(target);
  const scene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0.1,10);camera.position.z=4;
  const light=new DirectionalLight(0xffffff,Math.PI);light.position.z=3;scene.add(light);
  const loader=new MMDLoader();loader.meshBuilder.materialBuilder.textureLoader.load=()=>new DataTexture(new Uint8Array([255,255,255,255]),1,1);
  const mesh=loader.meshBuilder.build(new Parser().parsePmx(new Uint8Array(${JSON.stringify( Array.from( new Uint8Array( sdefPmxBuffer( { uvMorphs: true } ) ) ) )}).buffer,true),'');
  mesh.frustumCulled=false;scene.add(mesh);mesh.skeleton.bones[0].rotation.y=0.3;mesh.skeleton.bones[1].rotation.z=-0.4;
  const helper=new MMDAnimationHelper();helper.add(mesh,{physics:false});
  const m=mesh.material[0];m.blending=NoBlending;m.gradientMap=null;m.side=DoubleSide;m.specular.setRGB(0,0,0);m.emissive.setRGB(0,0,0);m.color.setRGB(1,1,1);
  // Second triangle is the readback probe. Still evaluate SDEF/BDEF, normals,
  // vertex morphs and tangents; final positioning makes expected pixels stable.
  const clip=new Float32Array(18*3).fill(10);
  [[-0.8,-0.8,0],[0.8,-0.8,0],[0,0.8,0]].forEach((p,i)=>clip.set(p,(3+i)*3));
  mesh.geometry.setAttribute('probeClip',new Float32BufferAttribute(clip,3));
  mesh.geometry.setAttribute('tangent',new Float32BufferAttribute(new Float32Array(18*4).fill(0.1),4));
  m.positionNode=attribute('probeClip','vec3');
  const texels=[[255,32,16,255],[16,255,64,255],[32,64,255,0],[224,160,32,255]];
  let map=new DataTexture(new Uint8Array(texels.flat()),2,2);map.minFilter=map.magFilter=NearestFilter;map.generateMipmaps=false;map.needsUpdate=true;
  async function pixels(){await new Promise(requestAnimationFrame);renderer.render(scene,camera);return new Uint8Array(await renderer.readRenderTargetPixelsAsync(target,0,0,64,64));}
  const center=p=>Array.from(p.slice((32*64+32)*4,(32*64+32)*4+4));
  const set=w=>{mesh.morphTargetInfluences.fill(0);w.forEach((v,i)=>mesh.morphTargetInfluences[i]=v);helper.update(0);};
  let extraSamples=0,textureSamples=0;
  for(let c=1;c<=4;c++) {result.stage=backend+' extra '+c;
   // Touch all four channels, normal, tangent, edge, UV and clip alongside SDEF:
   // sixteen attribute locations, eight buffers including the test clip buffer.
   let stress=attribute('normal','vec3').x.add(attribute('tangent','vec4').x).add(attribute('mmdEdgeRatio','float')).add(uv().x);
   for(let j=1;j<=4;j++)stress=stress.add(mmdAdditionalUV(j).x);
   m.fragmentNode=mmdAdditionalUV(c).mul(0.2).add(0.4).add(stress.mul(1e-7));m.needsUpdate=true;
   for(const test of ${JSON.stringify( cases )}) {
    set(test.weights);near(center(await pixels()),test.expected[c].map(v=>Math.round((v*0.2+0.4)*255)),backend+' extra UV'+c);extraSamples++;
   }
  }
  // Missing channels must produce a finite zero node without fabricated attributes.
  const absent=loader.meshBuilder.build(new Parser().parsePmx(new Uint8Array(${JSON.stringify( Array.from( new Uint8Array( sdefPmxBuffer( { uvMorphs: true, additionalUVCount: 0 } ) ) ) )}).buffer,true),'');
  absent.geometry.setAttribute('probeClip',new Float32BufferAttribute(clip,3));absent.material[0].blending=NoBlending;absent.material[0].positionNode=attribute('probeClip','vec3');absent.material[0].fragmentNode=mmdAdditionalUV(4).add(0.25);absent.frustumCulled=false;scene.remove(mesh);scene.add(absent);
  near(center(await pixels()),[64,64,64,64],'absent extra UV');check(!absent.geometry.hasAttribute('mmdAdditionalUV4'),'fabricated absent channel');scene.remove(absent);scene.add(mesh);
  result.stage=backend+' textures';m.fragmentNode=null;m.map=map;m.transparent=false;m.alphaTest=0.5;m.needsUpdate=true;
  // Deliberately asymmetric deltas and RGBA texture: both V origins and wrapping.
  for(const flipY of [false,true]) for(const wrapping of [ClampToEdgeWrapping,RepeatWrapping]) {
   const oldMap=map;map=new DataTexture(new Uint8Array(texels.flat()),2,2);map.minFilter=map.magFilter=NearestFilter;map.generateMipmaps=false;map.flipY=flipY;map.wrapS=map.wrapT=wrapping;map.needsUpdate=true;m.map=map;m.needsUpdate=true;oldMap.dispose();
   for(const test of ${JSON.stringify( cases )}) {
    set(test.weights);const p=test.expected[0];const wrap=v=>wrapping===RepeatWrapping?((v%1)+1)%1:Math.max(0,Math.min(0.99999,v));
    const x=Math.min(1,Math.floor(wrap(p[0])*2)),y=Math.min(1,Math.floor((flipY?1-wrap(p[1]):wrap(p[1]))*2));
    const color=texels[y*2+x];near(center(await pixels()),color[3]===0?[0,0,0,0]:color,backend+' UV color/alpha '+flipY+' '+test.weights);textureSamples++;
   }
  }
  // Lighting-coordinate toon and view-derived sphere sampling stay fixed.
  let coordinateSamples=0;map.flipY=false;map.needsUpdate=true;m.map=null;m.alphaTest=0;m.color.setRGB(0.2,0.2,0.2);
  for(const mode of ['toon','sphere']) {
   m.gradientMap=mode==='toon'?map:null;m.matcap=mode==='sphere'?map:null;m.needsUpdate=true;
   set([]);const baseline=center(await pixels());
   for(const w of [0.5,1]) {set([0,w]);near(center(await pixels()),baseline,backend+' fixed '+mode+' sampling');coordinateSamples++;}
  }
  m.gradientMap=m.matcap=null;m.map=map;m.color.setRGB(1,1,1);m.alphaTest=0.5;m.needsUpdate=true;
  // alphaMap uses the same effective UV0 (its green component).
  let alphaMapSamples=0;m.alphaMap=map;m.needsUpdate=true;
  for(const w of [0,0.5,1,0]) {
   set([0,w]);const p=${JSON.stringify( cases[ 0 ].expected[ 0 ] )};p[0]+=0.6*w;p[1]+=0.35*w;
   const color=texels[Math.floor(p[1]*2)*2+Math.floor(p[0]*2)];const alpha=color[3]/255*color[1]/255;
   near(center(await pixels()),alpha<=0.5?[0,0,0,0]:[...color.slice(0,3),Math.round(alpha*255)],backend+' UV alphaMap');alphaMapSamples++;
  }
  m.alphaMap=null;m.needsUpdate=true;
  // Renderer callbacks refresh UVs without a helper tick, and recover nonfinite weights.
  map.dispose();map=new DataTexture(new Uint8Array(texels.flat()),2,2);map.minFilter=map.magFilter=NearestFilter;map.flipY=false;map.wrapS=map.wrapT=ClampToEdgeWrapping;map.needsUpdate=true;m.map=map;m.needsUpdate=true;
  set([]);mesh.morphTargetInfluences[1]=1;near(center(await pixels()),texels[3],'standalone changed weights');
  for(const invalid of [NaN,Infinity,-Infinity]) {mesh.morphTargetInfluences[1]=invalid;near(center(await pixels()),texels[0],'nonfinite direct weight');}
  // Transparent texel discards surface depth so a later draw behind is visible.
  set([0,0.5]);map.flipY=true;map.needsUpdate=true;
  const behind=new Mesh(new PlaneGeometry(2,2),new MeshBasicNodeMaterial({color:0x00ff00}));behind.position.z=-0.2;behind.renderOrder=10;scene.add(behind);
  near(center(await pixels()),[0,255,0,255],'UV alpha depth consistency');scene.remove(behind);
  // Actual shadow override consumes exactly the same morphed UV and map alpha.
  map.flipY=false;map.image.data[7]=0;map.needsUpdate=true;m.positionNode=null;m.needsUpdate=true;const pos=mesh.geometry.getAttribute('position');
  for(let i=0;i<18;i++)pos.setXYZ(i,10,10,0);
  [[-0.65,-0.65,0],[0.65,-0.65,0],[0,0.65,0]].forEach((p,i)=>pos.setXYZ(3+i,...p));pos.needsUpdate=true;
  // Remove the placeholder position morph's authored positions from this shadow probe.
  mesh.geometry.morphAttributes.position.forEach(a=>{for(let i=0;i<18;i++)a.setXYZ(i,pos.getX(i),pos.getY(i),pos.getZ(i));a.needsUpdate=true;});
  mesh.skeleton.bones.forEach(b=>b.rotation.set(0,0,0));mesh.rotation.y=Math.PI;mesh.position.set(0.45,0,0.7);mesh.castShadow=true;
  renderer.shadowMap.enabled=true;light.castShadow=true;light.position.set(2,0,3);light.shadow.mapSize.set(128,128);Object.assign(light.shadow.camera,{left:-1,right:1,top:1,bottom:-1,near:0.1,far:10});
  const receiver=new Mesh(new PlaneGeometry(2,2),m.clone());receiver.material.map=null;receiver.material.alphaTest=0;receiver.material.opacity=1;receiver.material.needsUpdate=true;receiver.receiveShadow=true;scene.add(receiver);
  result.stage=backend+' shadows';const shadows=[];for(const w of [0,0.8,1,0]){set([0,w]);shadows.push(center(await pixels())[0]);}
  check(shadows[1]>shadows[0]+100,'UV alpha shadow missing '+shadows);near([shadows[3]],[shadows[0]],'shadow reset');
  m.map=null;m.alphaMap=map;m.needsUpdate=true;map.image.data[7]=255;map.needsUpdate=true;
  const alphaShadows=[];for(const w of [0,0.8,1,0]){set([0,w]);alphaShadows.push(center(await pixels())[0]);}
  check(alphaShadows[0]>alphaShadows[1]+100,'UV alphaMap shadow mismatch '+alphaShadows);near([alphaShadows[3]],[alphaShadows[0]],'alphaMap shadow reset');
  set([]);m.opacity=5;const boostedShadow=center(await pixels())[0];check(alphaShadows[0]>boostedShadow+100,'source alpha factor rejected twice');set([]);
  result.backends.push({backend,extraSamples,textureSamples,coordinateSamples,alphaMapSamples,shadows,alphaShadows});
  helper.remove(mesh);mesh.geometry.dispose();mesh.material.forEach(x=>x.dispose());absent.geometry.dispose();absent.material.forEach(x=>x.dispose());map.dispose();target.dispose();renderer.dispose();
 }
}catch(e){result.errors.push(e.stack||String(e));}
clearTimeout(watchdog);document.getElementById('result').textContent=encodeURIComponent(JSON.stringify(result));
</script>`;
	const server = createServer( async ( request, response ) => {

		const path = new URL( request.url || '/', 'http://localhost' ).pathname;
		if ( path === '/' ) { response.setHeader( 'Content-Type', 'text/html' ); response.end( html ); return; }
		if ( ! /^(\/src\/|\/node_modules\/(?:three|mmd-parser)\/).+\.(?:mjs|js)$/.test( path ) ) { response.writeHead( 404 ).end(); return; }
		try { response.setHeader( 'Content-Type', 'text/javascript' ); response.end( await readFile( new URL( '../../' + path.slice( 1 ).replace( /^src\//, 'dist/' ), import.meta.url ) ) ); }
		catch { response.writeHead( 404 ).end(); }

	} );
	const profile = await mkdtemp( join( tmpdir(), 'mmd-uv-browser-' ) );
	try {

		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const result = await runBrowser<{ errors: string[]; webgpu: boolean; backends: { backend: string; extraSamples: number; textureSamples: number; coordinateSamples: number; alphaMapSamples: number; shadows: number[]; alphaShadows: number[] }[] }>( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/`, profile, 'light', 100000 );
		assert.deepEqual( result.errors, [] ); assert.equal( result.backends[ 0 ]?.backend, 'webgl' );
		if ( result.webgpu ) assert.equal( result.backends[ 1 ]?.backend, 'webgpu' ); else t.diagnostic( 'Native WebGPU adapter unavailable; mandatory WebGL2 passed.' );
		for ( const b of result.backends ) { assert.equal( b.extraSamples, 32 ); assert.equal( b.textureSamples, 32 ); assert.equal( b.coordinateSamples, 4 ); assert.equal( b.alphaMapSamples, 4 ); t.diagnostic( `${b.backend}: ${b.extraSamples} vec4 readbacks, ${b.textureSamples} texture RGBA readbacks, shadow pixels ${b.shadows}; alphaMap shadows ${b.alphaShadows}` ); }

	} finally { await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( profile ); }

} );
