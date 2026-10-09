import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { subtexturePmxBuffer, subtexturePngBuffer, subtextureTexels, vmdBuffer } from '../fixtures.ts';
import { referenceSubtexture, referenceSubtextureColor } from '../subtexture-reference.ts';
import { runBrowser, removeBrowserDirectory } from './browser.ts';

const sampleCases = [ 0, 0.5, 1, 0, - 0.5, 1.5 ].flatMap( weight => [ false, true ].flatMap( flipY => [ false, true ].map( repeat => ( {
	weight, flipY, repeat, expected: referenceSubtextureColor( referenceSubtexture( weight, { flipY, repeat } ) )
} ) ) ) );
const transformCases = [ 0, 0.5, 1, 0 ].map( weight => ( { weight, expected: referenceSubtextureColor( referenceSubtexture( weight, { offset: [ 0.3, - 0.2 ], scale: [ 1.3, 0.8 ] } ) ) } ) );

test( 'SubTexture UV1 RGBA, morph/VMD, depth/shadow/outline pixels on WebGL2 and available native WebGPU', { timeout: 120000 }, async t => {

	const html = `<!doctype html><script type="importmap">{"imports":{
"mmd-parser":"/node_modules/mmd-parser/build/mmdparser.module.mjs","three":"/node_modules/three/build/three.module.js",
"three/webgpu":"/node_modules/three/build/three.webgpu.js","three/tsl":"/node_modules/three/build/three.tsl.js",
"three/addons/":"/node_modules/three/examples/jsm/"}}</script><pre id="result">pending</pre><script type="module">
import { AddOperation, MultiplyOperation, CustomBlending, DataTexture, DirectionalLight, Float32BufferAttribute, LinearSRGBColorSpace, LoadingManager, Mesh, NearestFilter, NoBlending, OrthographicCamera, PlaneGeometry, RepeatWrapping, ClampToEdgeWrapping, Scene, SphereGeometry, DoubleSide } from 'three';
import { WebGPURenderer, RenderTarget, MeshBasicNodeMaterial } from 'three/webgpu';
import { MMDToonMaterial, MMDLoader, MMDAnimationHelper, MMDOutlineEffect } from '/src/index.js';
import { Parser } from 'mmd-parser';
const result={errors:[],backends:[],webgpu:false,stage:'init'};
const watchdog=setTimeout(()=>{result.errors.push('GPU timeout at '+result.stage);document.getElementById('result').textContent=encodeURIComponent(JSON.stringify(result));},95000);
console.error=(...a)=>result.errors.push(a.map(String).join(' '));
const check=(v,m)=>{if(!v)throw new Error(m);};
const near=(a,e,m,t=3)=>a.forEach((v,i)=>check(Math.abs(v-e[i])<=t,m+' '+a+' expected '+e));
const texels=${JSON.stringify( subtextureTexels )};
function texture(flipY=false,repeat=true){const t=new DataTexture(new Uint8Array(texels.flat()),4,2);t.flipY=flipY;t.wrapS=t.wrapT=repeat?RepeatWrapping:ClampToEdgeWrapping;t.minFilter=t.magFilter=NearestFilter;t.generateMipmaps=false;t.needsUpdate=true;return t;}
try {
 const adapter=await navigator.gpu?.requestAdapter();result.webgpu=!!adapter;
 for(const backend of adapter?['webgl','webgpu']:['webgl']) {
  result.stage=backend;const renderer=new WebGPURenderer({forceWebGL:backend==='webgl',antialias:false});await renderer.init();renderer.setSize(64,64);renderer.setClearColor(0,0);
  check(backend==='webgl'?renderer.backend.isWebGLBackend:renderer.backend.isWebGPUBackend,'backend mismatch');
  if(backend==='webgpu')renderer.backend.device.addEventListener('uncapturederror',e=>result.errors.push(e.error.message));
  const target=new RenderTarget(64,64);target.texture.colorSpace=LinearSRGBColorSpace;renderer.setRenderTarget(target);
  const scene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0.1,10);camera.position.z=4;
  const geometry=new PlaneGeometry(2,2);const extra=new Float32BufferAttribute(new Float32Array(geometry.attributes.position.count*4),4);geometry.setAttribute('mmdAdditionalUV1',extra);
  const m=new MMDToonMaterial({matcapMode:'subtexture',matcapCombine:AddOperation,transparent:true,blending:NoBlending});m.lights=false;m.color.setRGB(0.8,0.6,0.4);m.opacity=0.8;
  let map=texture();m.matcap=map;
  const probe=new Mesh(geometry,m);scene.add(probe);
  const coord=w=>{for(let i=0;i<extra.count;i++)extra.setXYZW(i,0.125+0.8*w,0.75-0.6*w,7,-9);extra.needsUpdate=true;};
  const effect=new MMDOutlineEffect(renderer);effect.enabled=false;
  const pixels=async()=>{await new Promise(requestAnimationFrame);effect.render(scene,camera);return new Uint8Array(await renderer.readRenderTargetPixelsAsync(target,0,0,64,64));};
  const center=p=>Array.from(p.slice((32*64+32)*4,(32*64+32)*4+4));
  let samples=0;
  for(const c of ${JSON.stringify( sampleCases )}) {
   result.stage=backend+' sampler';const old=map;map=texture(c.flipY,c.repeat);m.matcap=map;m.needsUpdate=true;old.dispose();coord(c.weight);
   near(center(await pixels()),c.expected[3]===0?[0,0,0,0]:c.expected,'standalone UV1 '+JSON.stringify(c));samples++;
  }
  map.dispose();map=texture();m.matcap=map;m.needsUpdate=true;coord(0);
  const normal=geometry.attributes.normal;
  // Lights disabled: normals and view change only sphere coordinates, never UV1.
  for(const n of [[0,0,1],[0.8,0,0.6],[-0.3,0.6,0.74]]) for(const x of [-0.15,0,0.15]) {
   for(let i=0;i<normal.count;i++)normal.setXYZ(i,...n);normal.needsUpdate=true;
   camera.position.x=x;camera.lookAt(0,0,0);
   near(center(await pixels()),${JSON.stringify( referenceSubtextureColor( referenceSubtexture( 0 ) ) )},'normal/camera invariance');samples++;
  }
  camera.position.set(0,0,4);camera.lookAt(0,0,0);for(let i=0;i<normal.count;i++)normal.setXYZ(i,0,0,1);normal.needsUpdate=true;
  map.offset.set(0.3,-0.2);map.repeat.set(1.3,0.8);
  for(const c of ${JSON.stringify( transformCases )}){coord(c.weight);near(center(await pixels()),c.expected[3]===0?[0,0,0,0]:c.expected,'texture transform');samples++;}
  map.offset.set(0,0);map.repeat.set(1,1);coord(0);
  m.mmdSphereColor.set(0.5,0.25,0.75,0.5);near(center(await pixels()),${JSON.stringify( referenceSubtextureColor( referenceSubtexture( 0 ), [ 0.8, 0.6, 0.4 ], 0.8, [ 0.5, 0.25, 0.75, 0.5 ] ) )},'sphere color factor once');m.mmdSphereColor.set(1,1,1,1);
  // Base map and SubTexture may share the image but must use different UVs.
  const uv0=geometry.attributes.uv;for(let i=0;i<uv0.count;i++)uv0.setXY(i,0.875,0.75);uv0.needsUpdate=true;m.map=map;m.needsUpdate=true;
  near(center(await pixels()),${JSON.stringify( referenceSubtextureColor( subtextureTexels[ 4 ], [ 0.8 * 200 / 255, 0.6 * 120 / 255, 0.4 * 20 / 255 ], 0.8 * 64 / 255 ) )},'shared image separate UV0/UV1');m.map=null;m.needsUpdate=true;
  // Ambient/emissive is modulated, whereas specular is added after the layer.
  m.emissive.setRGB(0.1,0.2,0.3);near(center(await pixels()),${JSON.stringify( referenceSubtextureColor( subtextureTexels[ 4 ], [ 0.9, 0.8, 0.7 ] ) )},'SubTexture emissive');m.emissive.setRGB(0,0,0);
  const specularLight=new DirectionalLight(0xffffff,Math.PI);specularLight.position.z=3;scene.add(specularLight);m.lights=true;m.color.setRGB(0,0,0);m.specular.setRGB(0.1,0.2,0.3);m.shininess=8;m.matcap=null;m.needsUpdate=true;
  const specular=center(await pixels());check(specular[2]>10,'specular probe dark');m.matcap=map;m.needsUpdate=true;near(center(await pixels()),specular,'SubTexture does not multiply specular');
  scene.remove(specularLight);m.lights=false;m.specular.setRGB(0,0,0);m.color.setRGB(0.8,0.6,0.4);m.needsUpdate=true;
  geometry.deleteAttribute('mmdAdditionalUV1');m.needsUpdate=true;
  near(center(await pixels()),${JSON.stringify( referenceSubtextureColor( subtextureTexels[ 0 ] ) )},'absent UV1 samples (0,0)');geometry.setAttribute('mmdAdditionalUV1',extra);m.needsUpdate=true;
  m.matcap=null;m.mmdSphereColor.set(0,0,0,0);m.needsUpdate=true;near(center(await pixels()),[204,153,102,204],'missing layer ignores factors');m.mmdSphereColor.set(1,1,1,1);
  // A solid sphere exposes the separate RGB/alpha rule for every mode.
  const solid=new DataTexture(new Uint8Array([64,128,192,128]),1,1);solid.needsUpdate=true;
  const regression=[];
  for(const mode of [0,1,2,3]){m.matcap=mode===0?null:solid;m.matcapMode=mode===3?'subtexture':'sphere';m.matcapCombine=mode===1?MultiplyOperation:AddOperation;m.needsUpdate=true;regression.push(center(await pixels()));}
  near(regression[0],[204,153,102,204],'mode0');near(regression[1],[51,77,77,204],'mode1');near(regression[2],[255,255,255,204],'mode2');near(regression[3],[51,77,77,102],'mode3 RGBA');
  // Texture alpha is evaluated before alphaTest, and zero alpha discards depth.
  m.matcap=map;m.matcapMode='subtexture';m.alphaTest=0.5;m.needsUpdate=true;coord(0.5);near(center(await pixels()),[0,0,0,0],'partial alphaTest');m.alphaTest=0;m.needsUpdate=true;coord(1);
  const behind=new Mesh(new PlaneGeometry(2,2),new MeshBasicNodeMaterial({color:0x00ff00}));behind.position.z=-0.2;behind.renderOrder=10;scene.add(behind);near(center(await pixels()),[0,255,0,255],'zero alpha leaves no depth');scene.remove(behind);
  scene.remove(probe);
  for(const path of ['/missing-uv.pmx','/invalid-map.pmx','/missing-map.pmx']) {
   const manager=new LoadingManager(),ready=new Promise(resolve=>manager.onLoad=resolve),loader=new MMDLoader(manager);
   const fallback=await loader.loadAsync(path);await ready;fallback.rotation.y=Math.PI;fallback.position.x=1.8;fallback.frustumCulled=false;fallback.material.forEach((v,i)=>v.visible=i===3);
   const fm=fallback.material[3];fm.gradientMap=null;fm.lights=false;fm.color.setRGB(0.8,0.6,0.4);fm.opacity=0.8;fm.transparent=true;fm.blending=NoBlending;fm.needsUpdate=true;
   if(fm.matcap){fm.matcap.colorSpace=LinearSRGBColorSpace;fm.matcap.minFilter=fm.matcap.magFilter=NearestFilter;fm.matcap.needsUpdate=true;}
   scene.add(fallback);near(center(await pixels()),path==='/missing-uv.pmx'?${JSON.stringify( referenceSubtextureColor( subtextureTexels[ 0 ] ) )}:[204,153,102,204],'loader fallback '+path);
   if(path!=='/missing-uv.pmx')check(fm.matcap===null,'failed layer still present');scene.remove(fallback);fallback.geometry.dispose();fallback.material.forEach(v=>v.dispose());
  }
  // Real PMX and PNG decode through the loader. All sphere materials share a map.
  scene.remove(probe);const manager=new LoadingManager();const loaded=new Promise(resolve=>manager.onLoad=resolve);
  const loader=new MMDLoader(manager);const mesh=await loader.loadAsync('/model.pmx');await loaded;mesh.rotation.y=Math.PI;mesh.frustumCulled=false;scene.add(mesh);
  check(mesh.material[3].matcap===mesh.material[1].matcap&&mesh.material[3].matcap===mesh.material[2].matcap,'shared loaded texture');
  check(mesh.material[3].matcap.flipY===false&&mesh.material[3].matcap.wrapS===RepeatWrapping,'loader sampler');
  mesh.position.x=1.8; // rotation moves the mode-3 triangle's x=1.8 to -1.8.
  mesh.material.forEach((v,i)=>v.visible=i===3);const pm=mesh.material[3];pm.gradientMap=null;pm.lights=false;pm.color.setRGB(0.8,0.6,0.4);pm.emissive.setRGB(0,0,0);pm.opacity=0.8;pm.blending=NoBlending;pm.matcap.minFilter=pm.matcap.magFilter=NearestFilter;pm.matcap.colorSpace=LinearSRGBColorSpace;pm.matcap.needsUpdate=true;pm.needsUpdate=true;
  let morphSamples=0;
  const reset=()=>mesh.morphTargetInfluences.fill(0);
  const expected=${JSON.stringify( [ 0, 0.5, 1, 0 ].map( w => referenceSubtextureColor( referenceSubtexture( w ) ) ) )};
  for(const index of [0,1]) for(const [j,w] of [0,0.5,1,0].entries()) {
   reset();mesh.morphTargetInfluences[index]=w;near(center(await pixels()),expected[j][3]===0?[0,0,0,0]:expected[j],'direct/group callback '+index+' '+w);morphSamples++;
  }
  // Combined direct/group weights sum to .5, never applied twice.
  reset();mesh.morphTargetInfluences[0]=0.25;mesh.morphTargetInfluences[1]=0.25;
  for(let i=0;i<3;i++){near(center(await pixels()),expected[1],'combined no drift');morphSamples++;}
  reset();mesh.morphTargetInfluences[2]=1;near(center(await pixels()),expected[0],'UV0 does not move SubTexture');reset();
  reset();mesh.morphTargetInfluences[0]=0.5;pm.blending=CustomBlending;pm.needsUpdate=true;
  near(center(await pixels()),expected[1].map(v=>Math.round(v*(0.8*128/255))),'loader source-alpha blending');pm.blending=NoBlending;pm.needsUpdate=true;reset();
  const version=pm.version;
  for(const name of ['subtexture-uv1','subtexture-grp']) for(const pmxAnimation of [false,true]) {
   result.stage=backend+' VMD '+name;
   const vmd=new Parser().parseVmd(await (await fetch('/motion-'+name+'.vmd')).arrayBuffer(),true);
   const clip=loader.animationBuilder.build(vmd,mesh),helper=new MMDAnimationHelper({pmxAnimation,sync:false});helper.add(mesh,{animation:clip,physics:false});
   const mixer=helper.objects.get(mesh).mixer,action=mixer.clipAction(clip);action.clampWhenFinished=true;action.setLoop(2200,1);
   for(const [j,time] of [0,0.5,1,0].entries()){action.reset().play();mixer.setTime(time);helper.update(0);pm.color.setRGB(0.8,0.6,0.4);pm.opacity=0.8;near(center(await pixels()),expected[j][3]===0?[0,0,0,0]:expected[j],'VMD seek '+time+' mode '+pmxAnimation);morphSamples++;}
   action.stop();helper.update(0);pm.color.setRGB(0.8,0.6,0.4);pm.opacity=0.8;near(center(await pixels()),expected[0],'VMD stop reset');helper.remove(mesh);reset();
  }
  check(pm.version===version,'UV/VMD recompiled material');
  const helper=new MMDAnimationHelper();helper.add(mesh,{physics:false});reset();mesh.morphTargetInfluences[3]=1;helper.update(0);pm.color.setRGB(0.8,0.6,0.4);pm.opacity=0.8;
  const linear=v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;
  near(center(await pixels()),[0.8*220*linear(0.5),0.6*160*linear(0.25),0.4*60*linear(0.75),0.8*255*0.5].map(Math.round),'material morph sampler');reset();helper.update(0);pm.color.setRGB(0.8,0.6,0.4);pm.opacity=0.8;
  // Shadow opacity must sample the same additional UV1, including partial alpha.
  result.stage=backend+' shadows';pm.lights=true;pm.alphaTest=0.5;pm.needsUpdate=true;mesh.castShadow=true;mesh.position.set(2.25,0,0.7);
  const light=new DirectionalLight(0xffffff,Math.PI);light.position.set(2,0,3);light.castShadow=true;light.shadow.mapSize.set(128,128);Object.assign(light.shadow.camera,{left:-1,right:1,top:1,bottom:-1,near:0.1,far:10});scene.add(light);renderer.shadowMap.enabled=true;
  const receiver=new Mesh(new PlaneGeometry(2,2),new MMDToonMaterial({color:0xffffff}));receiver.material.specular.setRGB(0,0,0);receiver.receiveShadow=true;scene.add(receiver);
  const shadows=[];for(const w of [0,0.5,1,0]){reset();mesh.morphTargetInfluences[0]=w;helper.update(0);pm.color.setRGB(0.8,0.6,0.4);pm.opacity=0.8;shadows.push(center(await pixels())[0]);}
  check(shadows[1]>shadows[0]+100&&shadows[2]>shadows[0]+100,'SubTexture shadow alpha '+shadows);near([shadows[3]],[shadows[0]],'shadow reset');
  // Outlines retain PMX edge alpha (independent of texture alpha), without errors.
  scene.remove(receiver);renderer.shadowMap.enabled=false;light.castShadow=false;mesh.castShadow=false;mesh.position.set(1.8,0,0);pm.alphaTest=0;pm.lights=false;pm.needsUpdate=true;reset();helper.update(0);pm.color.setRGB(0.8,0.6,0.4);pm.opacity=0.8;
  scene.remove(mesh);const sphere=new Mesh(new SphereGeometry(0.45,16,12),pm.clone());sphere.material.userData.outlineParameters.thickness=0.04;
  const sphereUV=new Float32BufferAttribute(new Float32Array(sphere.geometry.attributes.position.count*4),4);for(let i=0;i<sphereUV.count;i++)sphereUV.setXYZW(i,0.125,0.75,0,0);sphere.geometry.setAttribute('mmdAdditionalUV1',sphereUV);scene.add(sphere);
  effect.enabled=false;const plain=await pixels();effect.enabled=true;const outlined=await pixels();check(outlined.some((v,i)=>v!==plain[i]),'outline produced no pixels');sphere.geometry.dispose();sphere.material.dispose();
  result.backends.push({backend,samples,morphSamples,regression,shadows,outline:true});
  helper.remove(mesh);effect.dispose();geometry.dispose();m.dispose();solid.dispose();map.dispose();mesh.geometry.dispose();mesh.material.forEach(v=>v.dispose());target.dispose();renderer.dispose();
 }
}catch(e){result.errors.push(e.stack||String(e));}
clearTimeout(watchdog);document.getElementById('result').textContent=encodeURIComponent(JSON.stringify(result));
</script>`;
	const server = createServer( async ( request, response ) => {

		const path = new URL( request.url || '/', 'http://localhost' ).pathname;
		if ( path === '/' ) { response.setHeader( 'Content-Type', 'text/html' ); response.end( html ); return; }
		if ( path === '/model.pmx' ) { response.end( Buffer.from( subtexturePmxBuffer() ) ); return; }
		if ( path === '/missing-uv.pmx' || path === '/invalid-map.pmx' || path === '/missing-map.pmx' ) {

			response.end( Buffer.from( subtexturePmxBuffer( { additionalUVCount: path === '/missing-uv.pmx' ? 0 : 1, sphereIndex: path === '/invalid-map.pmx' ? 120 : 0, spherePath: path === '/missing-map.pmx' ? 'absent.png' : 'generated-subtexture.png' } ) ) ); return;

		}
		if ( path === '/generated-subtexture.png' ) { response.setHeader( 'Content-Type', 'image/png' ); response.end( subtexturePngBuffer() ); return; }
		const motion = /^\/motion-(subtexture-uv1|subtexture-grp)\.vmd$/.exec( path );
		if ( motion ) { response.end( Buffer.from( vmdBuffer( { boneName: 'no-bone', morphs: [ { morphName: motion[ 1 ], frameNum: 0, weight: 0 }, { morphName: motion[ 1 ], frameNum: 30, weight: 1 } ] } ) ) ); return; }
		if ( ! /^(\/src\/|\/node_modules\/(?:three|mmd-parser)\/).+\.(?:mjs|js)$/.test( path ) ) { response.writeHead( 404 ).end(); return; }
		try { response.setHeader( 'Content-Type', 'text/javascript' ); response.end( await readFile( new URL( '../../' + path.slice( 1 ).replace( /^src\//, 'dist/' ), import.meta.url ) ) ); }
		catch { response.writeHead( 404 ).end(); }

	} );
	const profile = await mkdtemp( join( tmpdir(), 'mmd-subtexture-browser-' ) );
	try {

		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const result = await runBrowser<{ errors: string[]; webgpu: boolean; stage: string; backends: { backend: string; samples: number; morphSamples: number; shadows: number[]; outline: boolean }[] }>( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/`, profile, 'light', 105000 );
		assert.deepEqual( result.errors, [], result.stage ); assert.equal( result.backends[ 0 ]?.backend, 'webgl' );
		if ( result.webgpu ) assert.equal( result.backends[ 1 ]?.backend, 'webgpu' ); else t.diagnostic( 'Native WebGPU adapter unavailable; mandatory WebGL2 passed.' );
		for ( const b of result.backends ) { assert.equal( b.samples, 37 ); assert.equal( b.morphSamples, 27 ); assert.equal( b.outline, true ); t.diagnostic( `${b.backend}: ${b.samples} coordinate/composition and ${b.morphSamples} morph/VMD readbacks; shadow pixels ${b.shadows}` ); }

	} finally { await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( profile ); }

} );
