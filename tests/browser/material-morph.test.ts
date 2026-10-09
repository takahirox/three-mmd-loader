import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { materialPmxBuffer } from '../fixtures.ts';
import { referenceMaterial } from '../material-morph-reference.ts';
import { removeBrowserDirectory, runBrowser } from './browser.ts';

const weights = [ [], [ 0, 0.5 ], [ 0, 1 ], [ 0, 0, 0.5 ], [ 0, 0, 1 ], [ 0, 0, 0, 0, 0.5 ], [ 0, 0, 0, 0, 1 ], [ 0, 0.2, 0.1, 0.3, 0.4, 0.2 ], [], [ 0, 0, 2 ], [ 0, 0, 0, 0, 1.6 ] ];
const cases = weights.map( w => ( { weights: w, expected: [ 0, 1, 2 ].map( i => referenceMaterial( w, i ) ) } ) );

test( 'PMX material morph surface RGBA, sampler factors, outlines and zero-alpha shadows render on both TSL backends', { timeout: 120000 }, async t => {

	const html = `<!doctype html><script type="importmap">{"imports":{
"mmd-parser":"/node_modules/mmd-parser/build/mmdparser.module.mjs",
"three":"/node_modules/three/build/three.module.js",
"three/webgpu":"/node_modules/three/build/three.webgpu.js",
"three/tsl":"/node_modules/three/build/three.tsl.js",
"three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<pre id="result">pending</pre><script>
window.addEventListener('error',e=>document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({errors:[e.message+' '+e.filename+':'+e.lineno],backends:[]})));
window.addEventListener('unhandledrejection',e=>document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({errors:[String(e.reason)],backends:[]})));
</script><script type="module">
import { Color, DataTexture, DirectionalLight, Float32BufferAttribute, LinearSRGBColorSpace, Mesh, OrthographicCamera, PlaneGeometry, Scene, SphereGeometry, SRGBColorSpace, Uint16BufferAttribute } from 'three';
import { RenderTarget, WebGPURenderer, MeshBasicNodeMaterial } from 'three/webgpu';
import { MMDLoader, MMDAnimationHelper, MMDOutlineEffect } from '/src/index.js';
import { Parser } from 'mmd-parser';
const result={errors:[],backends:[],webgpu:false};
console.error=(...args)=>result.errors.push(args.map(String).join(' '));
const check=(v,m)=>{if(!v)throw new Error(m);};
const linear=v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;
const cases=${JSON.stringify( cases )};
function solid(r,g,b,a=255){const t=new DataTexture(new Uint8Array([r,g,b,a]),1,1);t.colorSpace=SRGBColorSpace;t.needsUpdate=true;return t;}
try {
 const adapter=await navigator.gpu?.requestAdapter(); result.webgpu=!!adapter;
 for(const backend of adapter?['webgl','webgpu']:['webgl']) {
  const renderer=new WebGPURenderer({forceWebGL:backend==='webgl',antialias:false});await renderer.init();renderer.setSize(128,128);renderer.setClearColor(0,0);
  check(backend==='webgl'?renderer.backend.isWebGLBackend:renderer.backend.isWebGPUBackend,'incorrect backend');
  const target=new RenderTarget(128,128);target.texture.colorSpace=LinearSRGBColorSpace;renderer.setRenderTarget(target);
  const scene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0.1,10);camera.position.z=4;
  const light=new DirectionalLight(0xffffff,Math.PI);light.position.z=3;scene.add(light);
  const shared=solid(128,192,224,192);
  const loader=new MMDLoader();loader.meshBuilder.materialBuilder.textureLoader.load=()=>shared;
  const mesh=loader.meshBuilder.build(new Parser().parsePmx(new Uint8Array(${JSON.stringify( Array.from( new Uint8Array( materialPmxBuffer() ) ) )}).buffer,true),'');
  mesh.rotation.y=Math.PI;mesh.frustumCulled=false;scene.add(mesh);
  const helper=new MMDAnimationHelper();helper.add(mesh,{physics:false});
  const effect=new MMDOutlineEffect(renderer);effect.enabled=false;
  async function pixels(){await new Promise(requestAnimationFrame);effect.render(scene,camera);return new Uint8Array(await renderer.readRenderTargetPixelsAsync(target,0,0,128,128));}
  const center=p=>Array.from(p.slice((64*128+64)*4,(64*128+64)*4+4));
  function near(actual,expected,label,tolerance=3){actual.forEach((v,i)=>check(Math.abs(v-expected[i])<=tolerance,label+' '+actual+' expected '+expected));}
  let samples=0;
  const modes=['emissive','diffuse','map','toon','sphere-multiply','sphere-add','all','specular'];
  for(const mode of modes) {

   for(let index=0;index<3;index++) {
    mesh.material.forEach((m,i)=>m.visible=i===index);
    const m=mesh.material[index];
    m.map=(mode==='map'||mode==='all')&&index!==2?shared:null;
    m.gradientMap=mode==='toon'||mode==='all'?shared:null;
    m.matcap=(mode.startsWith('sphere')||mode==='all')&&index!==2?shared:null;
    m.matcapCombine=mode==='sphere-add'?2:mode==='sphere-multiply'?0:index===1?2:0;
    m.needsUpdate=true;
    for(const c of cases) {
     mesh.morphTargetInfluences.fill(0);c.weights.forEach((w,i)=>mesh.morphTargetInfluences[i]=w);helper.update(0);
     const e=c.expected[index],spec=mode==='specular',lit=['diffuse','map','toon','all','specular'].includes(mode);
     light.visible=lit;light.intensity=Math.PI*(spec?0.05:1);
     if(lit)m.emissive.setRGB(0,0,0);if(!spec)m.specular.setRGB(0,0,0);
     const map=m.map?[128/255,192/255,224/255].map(linear):[1,1,1];
     const toon=m.gradientMap?[128/255,192/255,224/255].map(linear):[1,1,1];
     let alpha=e.diffuse[3]*(m.map?192/255*e.textureColor[3]:1)*(m.matcap?e.sphereTextureColor[3]:1)*(m.gradientMap?e.toonColor[3]:1);
     let rgb=lit?e.diffuse.slice(0,3).map((v,i)=>linear(v)*map[i]*(m.map?linear(e.textureColor[i]):1)*toon[i]*(m.gradientMap?linear(e.toonColor[i]):1)*(spec?0.05:1)) : e.ambient.map(v=>linear(v)*(m.map?0.2:1));
     if(spec)rgb=rgb.map((v,i)=>v+linear(e.specular[i])*0.05*(Math.max(e.shininess,0.0001)*0.5+1)/4);
     if(m.matcap)rgb=rgb.map((v,i)=>m.matcapCombine===0?v*linear([128/255,192/255,224/255][i])*linear(e.sphereTextureColor[i]):v+linear([128/255,192/255,224/255][i])*linear(e.sphereTextureColor[i]));
     const expected=[...rgb.map(v=>Math.round(Math.max(0,Math.min(1,v))*alpha*255)),Math.round(alpha*alpha*255)];
     near(center(await pixels()),expected,backend+' '+mode+' material '+index+' weights '+c.weights);samples++;
    }
   }
  }
  // Zero-alpha surfaces must not write depth ahead of later transparent draws.
  mesh.material.forEach((m,i)=>m.visible=i===0);const m=mesh.material[0];m.map=m.matcap=m.gradientMap=null;m.needsUpdate=true;
  mesh.morphTargetInfluences.fill(0);mesh.morphTargetInfluences[1]=1;helper.update(0);
  const behind=new Mesh(new PlaneGeometry(2,2),new MeshBasicNodeMaterial({color:0x00ff00,transparent:true}));behind.position.z=-0.2;behind.renderOrder=10;scene.add(behind);
  near(center(await pixels()),[0,255,0,255],'zero-alpha depth occlusion');scene.remove(behind);behind.geometry.dispose();behind.material.dispose();
  // Cached hull responds to PMX edge values and group weights, including zero.
  const oldGeometry=mesh.geometry,geometry=new SphereGeometry(0.45,32,24),count=geometry.attributes.position.count;
  geometry.setAttribute('skinIndex',new Uint16BufferAttribute(new Uint16Array(count*4),4));const skin=new Float32Array(count*4);for(let i=0;i<count;i++)skin[i*4]=1;
  geometry.setAttribute('skinWeight',new Float32BufferAttribute(skin,4));geometry.setAttribute('mmdEdgeRatio',new Float32BufferAttribute(new Float32Array(count).fill(1),1));
  // Keep controller metadata/indices while replacing only the drawable probe.
  geometry.userData=oldGeometry.userData;geometry.morphTargets=oldGeometry.morphTargets;geometry.clearGroups();geometry.addGroup(0,geometry.index.count,0);mesh.geometry=geometry;
  effect.enabled=true;light.visible=false;
  const rings=[];
  for(const c of [cases[0],cases[1],cases[5],cases[2],cases[3],cases[0]]) {
   mesh.morphTargetInfluences.fill(0);c.weights.forEach((w,i)=>mesh.morphTargetInfluences[i]=w);helper.update(0);m.emissive.setRGB(0,0,0);m.specular.setRGB(0,0,0);m.color.setRGB(0,0,0);
   const p=await pixels(),e=c.expected[0],points=[];
   for(let i=0;i<p.length;i+=4){const x=i/4%128+0.5-64,y=Math.floor(i/4/128)+0.5-64;if(Math.hypot(x,y)>0.45*64&&p[i]+p[i+1]+p[i+2]>6)points.push(Array.from(p.slice(i,i+4)));}
   if(e.edgeSize<=0||e.edgeColor[3]<=0)check(points.length===0,'invisible outline left pixels');
   else {check(points.length>4,'outline missing');points.forEach(v=>near(v,[...e.edgeColor.slice(0,3).map(x=>Math.round(x*e.edgeColor[3]*255)),Math.round(e.edgeColor[3]*255)],'outline color/alpha',4));}
   rings.push(points.length);
  }
  check(rings[1]<rings[0]&&rings[2]<rings[0]&&rings[5]===rings[0],'outline width/reset failed '+rings);
  // r186's standard shadow pass is binary for partial opacity. Zero alpha must
  // remove the caster; outlines never enter the shadow render function.
  effect.enabled=false;renderer.shadowMap.enabled=true;light.visible=true;light.intensity=Math.PI;light.castShadow=true;light.shadow.mapSize.set(128,128);light.shadow.camera.left=-1;light.shadow.camera.right=1;light.shadow.camera.top=1;light.shadow.camera.bottom=-1;light.shadow.camera.near=0.1;light.shadow.camera.far=10;
  mesh.castShadow=true;mesh.position.set(0.7,0,0.7);light.position.set(2,0,3);
  const receiver=new Mesh(new PlaneGeometry(2,2),mesh.material[2].clone());
  // Use an MMD surface to receive actual lighting/shadow evaluation.
  receiver.material.map=receiver.material.matcap=receiver.material.gradientMap=null;receiver.material.color.setRGB(1,1,1);receiver.material.emissive.setRGB(0,0,0);receiver.material.specular.setRGB(0,0,0);receiver.material.opacity=1;receiver.material.visible=true;receiver.material.transparent=false;receiver.material.needsUpdate=true;receiver.receiveShadow=true;scene.add(receiver);
  const shadowSamples=[];
  for(const weight of [0,0.5,1,0]) {mesh.morphTargetInfluences.fill(0);mesh.morphTargetInfluences[1]=weight;helper.update(0);const p=await pixels();shadowSamples.push(Array.from(p.slice((64*128+64)*4,(64*128+64)*4+3)));}
  check(shadowSamples[2][0]>shadowSamples[0][0]+100,'zero-alpha caster shadow persists '+JSON.stringify(shadowSamples));
  near(shadowSamples[3],shadowSamples[0],'shadow reset');
  result.backends.push({backend,samples,rings,shadowSamples});
  scene.remove(receiver);receiver.geometry.dispose();receiver.material.dispose();effect.dispose();helper.remove(mesh);geometry.dispose();oldGeometry.dispose();mesh.material.forEach(m=>m.dispose());shared.dispose();target.dispose();renderer.dispose();
 }
}catch(error){result.errors.push(error.stack||String(error));}
document.getElementById('result').textContent=encodeURIComponent(JSON.stringify(result));
</script>`;
	const server = createServer( async ( request, response ) => {

		const url = new URL( request.url || '/', 'http://localhost' );
		const path = url.pathname;
		if ( path === '/' ) { response.setHeader( 'Content-Type', 'text/html' ); response.end( html ); return; }
		if ( ! /^(\/src\/|\/node_modules\/(?:three|mmd-parser)\/).+\.(?:mjs|js)$/.test( path ) ) { response.writeHead( 404 ).end(); return; }
		try {

			response.setHeader( 'Content-Type', 'text/javascript' );
			response.end( await readFile( new URL( '../../' + path.slice( 1 ).replace( /^src\//, 'dist/' ), import.meta.url ) ) );

		} catch { response.writeHead( 404 ).end(); }

	} );
	const profile = await mkdtemp( join( tmpdir(), 'mmd-material-browser-' ) );
	try {

		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const result = await runBrowser<{ errors: string[]; webgpu: boolean; backends: { backend: string; samples: number; rings: number[]; shadowSamples: number[][] }[] }>( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/`, profile, 'light', 100000 );
		assert.deepEqual( result.errors, [] ); assert.equal( result.backends[ 0 ]?.backend, 'webgl' );
		if ( result.webgpu ) assert.equal( result.backends[ 1 ]?.backend, 'webgpu' );
		else t.diagnostic( 'Native WebGPU adapter unavailable; mandatory WebGL2 passed.' );
		for ( const b of result.backends ) { assert.equal( b.samples, 264 ); t.diagnostic( `${b.backend}: ${b.samples} independent surface RGBA assertions; outline pixel counts ${b.rings}; shadows ${JSON.stringify( b.shadowSamples )}` ); }

	} finally {

		await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( profile );

	}

} );
