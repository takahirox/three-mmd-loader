import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { referenceDirectSpecular, referenceSampler, srgbToLinear } from '../mmd-color-reference.ts';
import { removeBrowserDirectory, runBrowser } from './browser.ts';

const normalize = ( v: number[] ) => v.map( x => x / Math.hypot( ...v ) );
const white = [ 255, 255, 255, 255 ];
const angles = [
	{ normal: [ 0, 0, 1 ], light: [ 0, 0, 1 ], view: [ 0, 0, 1 ] },
	{ normal: [ 0, 0, 1 ], light: [ 1, 0, 1 ], view: [ 0, 0, 1 ] },
	{ normal: [ 1, 0, 1 ], light: [ -1, 0, 1 ], view: [ 1, 0, 1 ] },
	{ normal: [ 0, 0, 1 ], light: [ 0, 0, -1 ], view: [ 0, 0, 1 ] },
	{ normal: [ 0, 0, -1 ], light: [ 1, 0, 0 ], view: [ 0, 0, 1 ] },
	{ normal: [ 0, 0, 1 ], light: [ 1, 0, 0.05 ], view: [ -1, 0, 0.05 ] },
	{ normal: [ 1, 0, 0 ], light: [ 1e-8, 0, -1 ], view: [ 1e-8, 0, 1 ] }
].map( a => ( { normal: normalize( a.normal ), light: normalize( a.light ), view: normalize( a.view ) } ) );
const cases = angles.flatMap( angle => [ -2, 0, 0.00001, 1, 8, 32 ].flatMap( power => [ false, true ].flatMap( coloredSpecular =>
	[ white, [ 0, 0, 0, 255 ], [ 192, 128, 64, 255 ] ].map( texture => {

		const diffuse = coloredSpecular ? [ 0, 0, 0 ] : [ 0.3, 0.2, 0.1 ];
		const specular = coloredSpecular ? [ 0.2, 0.3, 0.4 ] : [ 0, 0, 0 ];
		const light = [ 0.5, 0.4, 0.3 ];
		const ambient = [ 0.04, 0.06, 0.08 ];
		const spec = referenceDirectSpecular( angle.normal, angle.light, angle.view, power, specular, light );
		return { ...angle, power, diffuse, specular, lightColor: light, ambient, texture,
			expected: diffuse.map( ( d, i ) => ( d * light[ i ] + 0.5 * ambient[ i ] ) * srgbToLinear( texture[ i ] / 255 ) + spec[ i ] ) };

	} )
) ) );
const samplerCases = [ 'base', 'toon', 'multiply', 'add', 'subtexture' ].flatMap( mode =>
	[ { multiply: [ 0.3, 0.6, 0.9, 0 ], add: [ 0, 0, 0, 0 ] },
		{ multiply: [ 0.5, 0.75, 0.25, 0.5 ], add: [ 0.1, 0.2, 0.05, 0.25 ] },
		{ multiply: [ 1, 1, 1, 1 ], add: [ 0, 0, 0, -1 ] },
		{ multiply: [ 0.75, 0.5, 0.25, 1.2 ], add: [ -0.1, 0.05, 0.1, -0.3 ] }
	].map( controls => {

		const texture = [ 192, 128, 64, 128 ];
		const sample = referenceSampler( texture.slice( 0, 3 ).map( v => v / 255 ), controls.multiply, controls.add, mode === 'add' ? 0 : 1 ).map( srgbToLinear );
		return { mode, ...controls, texture, expected: [ ...sample.map( v => mode === 'add' ? 0.2 + v : 0.2 * v ), 0.8 * ( mode === 'base' || mode === 'subtexture' ? 128 / 255 : 1 ) ] };

	} )
);

test( 'source sampler blending and unnormalized direct light match independent scalar pixels', { timeout: 120000 }, async t => {

	const html = `<!doctype html><script type="importmap">{"imports":{
"three":"/node_modules/three/build/three.module.js","three/webgpu":"/node_modules/three/build/three.webgpu.js","three/tsl":"/node_modules/three/build/three.tsl.js"}}</script>
<pre id="result">pending</pre><script type="module">
import { AddOperation, Color, DataTexture, DirectionalLight, DoubleSide, LinearSRGBColorSpace, Mesh, MultiplyOperation, NoBlending, OrthographicCamera, PlaneGeometry, Scene, SRGBColorSpace } from 'three';
import { RenderTarget, WebGPURenderer } from 'three/webgpu';
import { MMDToonMaterial } from '/dist/materials/MMDToonMaterial.js';
const result={errors:[],backends:[],webgpu:false};console.error=(...a)=>result.errors.push(a.join(' '));
const check=(v,m)=>{if(!v)throw Error(m);};
const near=(a,e,label)=>e.forEach((v,i)=>check(Math.abs(a[i]/255-v)<0.014,label+' '+a+' expected '+e));
const encode=v=>v<=0.0031308?12.92*v:1.055*v**(1/2.4)-0.055;
function solid(rgba){const tex=new DataTexture(new Uint8Array(rgba),1,1);tex.colorSpace=SRGBColorSpace;tex.needsUpdate=true;return tex;}
try{
 const adapter=await navigator.gpu?.requestAdapter();result.webgpu=!!adapter;
 for(const backend of adapter?['webgl','webgpu']:['webgl']){
  const renderer=new WebGPURenderer({forceWebGL:backend==='webgl',antialias:false,preserveDrawingBuffer:true});await renderer.init();renderer.setSize(1,1);
  if(backend==='webgpu')renderer.backend.device.addEventListener('uncapturederror',e=>result.errors.push(e.error.message));
  const target=new RenderTarget(1,1);target.texture.colorSpace=LinearSRGBColorSpace;renderer.setRenderTarget(target);
  const scene=new Scene(),camera=new OrthographicCamera(-0.2,0.2,0.2,-0.2,0.1,10);camera.position.z=4;
  const light=new DirectionalLight();scene.add(light);
  const material=new MMDToonMaterial({blending:NoBlending,side:DoubleSide});
  const geometry=new PlaneGeometry(4,4),plane=new Mesh(geometry,material);plane.frustumCulled=false;scene.add(plane);
  const ramp=solid([255,255,255,255]);material.gradientMap=ramp;
  async function pixel(){await new Promise(requestAnimationFrame);renderer.render(scene,camera);return Array.from(await renderer.readRenderTargetPixelsAsync(target,0,0,1,1));}
  let samples=0;
  for(const c of ${JSON.stringify( cases )}){
   camera.position.fromArray(c.view).multiplyScalar(4);camera.lookAt(0,0,0);
   const normals=geometry.attributes.normal;for(let i=0;i<normals.count;i++)normals.setXYZ(i,...c.normal);normals.needsUpdate=true;
   light.position.fromArray(c.light).multiplyScalar(3);light.color.setRGB(...c.lightColor);light.intensity=1;
   material.color.setRGB(...c.diffuse);material.specular.setRGB(...c.specular);material.ambient.setRGB(...c.ambient);material.shininess=c.power;
   material.map=solid(c.texture);material.needsUpdate=true;
   near(await pixel(),c.expected,backend+' direct '+samples);material.map.dispose();samples++;
  }
  camera.position.set(0,0,4);camera.lookAt(0,0,0);light.position.set(0,0,3);light.color.setRGB(1,1,1);
  for(let i=0;i<geometry.attributes.normal.count;i++)geometry.attributes.normal.setXYZ(i,0,0,1);geometry.attributes.normal.needsUpdate=true;
  material.specular.setRGB(0,0,0);material.color.setRGB(0.2,0.2,0.2);material.ambient.setRGB(0,0,0);material.opacity=0.8;
  for(const c of ${JSON.stringify( samplerCases )}){
   material.map=null;material.matcap=null;material.gradientMap=ramp;material.mmdTextureColor.set(1,1,1,1);material.mmdSphereColor.set(1,1,1,1);material.mmdToonColor.set(1,1,1,1);
   material.mmdTextureColorAdd.set(0,0,0,0);material.mmdSphereColorAdd.set(0,0,0,0);material.mmdToonColorAdd.set(0,0,0,0);
   const tex=solid(c.texture),name=c.mode==='base'?'mmdTextureColor':c.mode==='toon'?'mmdToonColor':'mmdSphereColor';
   if(c.mode==='base')material.map=tex;else if(c.mode==='toon')material.gradientMap=tex;else material.matcap=tex;
   material.matcapMode=c.mode==='subtexture'?'subtexture':'sphere';material.matcapCombine=c.mode==='add'?AddOperation:MultiplyOperation;
   material[name].fromArray(c.multiply);material[name+'Add'].fromArray(c.add);material.needsUpdate=true;
   near(await pixel(),c.expected,backend+' sampler '+JSON.stringify(c));tex.dispose();samples++;
  }
  // Use the renderer's output pass with async GPU readback, avoiding canvas presentation timing.
  // Keep the target's linear storage: outputColorSpace alone must encode the independently expected sRGB bytes.
  material.map=material.matcap=material.gradientMap=null;material.color.setRGB(0.2,0.1,0.05);material.opacity=1;material.needsUpdate=true;
  renderer.setRenderTarget(null);renderer.setOutputRenderTarget(target);renderer.outputColorSpace=SRGBColorSpace;
  near(await pixel(),[...[0.2,0.1,0.05].map(encode),1],backend+' output sRGB');
  result.backends.push({backend,samples});ramp.dispose();material.dispose();geometry.dispose();target.dispose();renderer.dispose();
 }
}catch(e){result.errors.push(e.stack||String(e));}
document.getElementById('result').textContent=encodeURIComponent(JSON.stringify(result));</script>`;
	const server = createServer( async ( request, response ) => {

		const path = new URL( request.url || '/', 'http://localhost' ).pathname;
		if ( path === '/' ) { response.setHeader( 'Content-Type', 'text/html' ); response.end( html ); return; }
		if ( ! /^(\/dist\/|\/node_modules\/three\/).+\.js$/.test( path ) ) { response.writeHead( 404 ).end(); return; }
		try { response.setHeader( 'Content-Type', 'text/javascript' ); response.end( await readFile( new URL( '../../' + path.slice( 1 ), import.meta.url ) ) ); }
		catch { response.writeHead( 404 ).end(); }

	} );
	const profile = await mkdtemp( join( tmpdir(), 'mmd-native-browser-' ) );
	try {

		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const result = await runBrowser<{ errors: string[]; webgpu: boolean; backends: { backend: string; samples: number }[] }>( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/`, profile, 'light', 110000 );
		assert.deepEqual( result.errors, [] ); assert.equal( result.backends[ 0 ]?.backend, 'webgl' );
		if ( result.webgpu ) assert.equal( result.backends[ 1 ]?.backend, 'webgpu' );
		else t.diagnostic( 'Native WebGPU unavailable; mandatory WebGL2 passed.' );
		for ( const b of result.backends ) { assert.equal( b.samples, cases.length + samplerCases.length ); t.diagnostic( `${b.backend}: ${b.samples} scalar pixel assertions plus output color conversion` ); }

	} finally { await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( profile ); }

} );
