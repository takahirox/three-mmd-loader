import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { referenceMMDColor, srgbToLinear } from '../mmd-color-reference.ts';
import { removeBrowserDirectory, runBrowser } from './browser.ts';

const ambient = [ 1, 0.8, 0.6 ];
const diffuse = [ 0.3, 0.4, 0.2 ];
const textures = [ null, [ 255, 255, 255 ], [ 192, 128, 64 ], [ 16, 24, 32 ], [ 0, 0, 0 ] ];
const factor = [ 0.6, 0.8, 0.5 ];
const sphereColor = [ 0.2, 0.3, 0.4 ];
const rampColor = [ 0.4, 0.6, 0.8 ];
const cases = textures.flatMap( texture => [ 'none', 'direct', 'ramp', 'indirect', 'multiple' ].flatMap( lighting =>
	[ 'none', 'multiply', 'add', 'subtexture' ].map( mode => {

		const ramp = lighting === 'ramp' ? rampColor : [ 1, 1, 1 ];
		const lights = lighting === 'none' || lighting === 'indirect' ? [] : [ { irradiance: [ 0.25, 0.25, 0.25 ], ramp } ];
		if ( lighting === 'multiple' ) lights.push( { irradiance: [ 0.25, 0.25, 0.25 ], ramp: [ 0.7, 0.7, 0.7 ] } );
		const sphere = mode === 'none' ? undefined : { mode: mode as 'multiply' | 'add' | 'subtexture', color: sphereColor };
		const expected = referenceMMDColor( {
			ambient: ambient.map( srgbToLinear ), diffuse: diffuse.map( srgbToLinear ),
			texture: texture?.map( v => srgbToLinear( v / 255 ) ), textureFactor: factor, lights,
			indirect: lighting === 'indirect' ? [ 0.1, 0.1, 0.1 ] : undefined, sphere
		} );
		return { texture, lighting, mode, expected };

	} )
) );

test( 'MMD ambient/base/sphere/toon equation and separate specular match the CPU oracle on both backends', { timeout: 120000 }, async t => {

	const html = `<!doctype html><script type="importmap">{"imports":{
"three":"/node_modules/three/build/three.module.js",
"three/webgpu":"/node_modules/three/build/three.webgpu.js",
"three/tsl":"/node_modules/three/build/three.tsl.js"}}</script>
<pre id="result">pending</pre><script type="module">
import { AddOperation, AmbientLight, DataTexture, DirectionalLight, LinearSRGBColorSpace, Mesh, MultiplyOperation, NoBlending, OrthographicCamera, PlaneGeometry, Scene, SRGBColorSpace } from 'three';
import { RenderTarget, WebGPURenderer } from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { MMDToonMaterial } from '/dist/materials/MMDToonMaterial.js';
const result={errors:[],backends:[],webgpu:false};
console.error=(...args)=>result.errors.push(args.map(String).join(' '));
const check=(v,m)=>{if(!v)throw new Error(m);};
const near=(actual,expected,label)=>actual.slice(0,3).forEach((v,i)=>check(Math.abs(v-expected[i]*255)<=3,label+' '+actual+' expected '+expected));
function solid(rgb,srgb=false){const tex=new DataTexture(new Uint8Array([...rgb.map(v=>Math.round(v)),255]),1,1);tex.colorSpace=srgb?SRGBColorSpace:LinearSRGBColorSpace;tex.needsUpdate=true;return tex;}
try {
 const adapter=await navigator.gpu?.requestAdapter();result.webgpu=!!adapter;
 for(const backend of adapter?['webgl','webgpu']:['webgl']) {
  const renderer=new WebGPURenderer({forceWebGL:backend==='webgl',antialias:false});await renderer.init();renderer.setSize(32,32);
  check(backend==='webgl'?renderer.backend.isWebGLBackend:renderer.backend.isWebGPUBackend,'wrong backend');
  if(backend==='webgpu')renderer.backend.device.addEventListener('uncapturederror',e=>result.errors.push(e.error.message));
  const target=new RenderTarget(32,32);target.texture.colorSpace=LinearSRGBColorSpace;renderer.setRenderTarget(target);
  const scene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0.1,10);camera.position.z=4;
  const light=new DirectionalLight(0xffffff,Math.PI*0.25);light.position.z=3;
  const second=new DirectionalLight(0xffffff,Math.PI*0.25);second.position.z=-3;
  const indirect=new AmbientLight(0xffffff,Math.PI*0.1);scene.add(light,second,indirect);
  const material=new MMDToonMaterial({blending:NoBlending,specular:0x000000});
  material.ambient.setRGB(...${JSON.stringify( ambient )},SRGBColorSpace);material.color.setRGB(...${JSON.stringify( diffuse )},SRGBColorSpace);
  material.mmdTextureColor.set(...${JSON.stringify( factor )},1);
  const plane=new Mesh(new PlaneGeometry(2,2),material);scene.add(plane);
  const sphere=solid(${JSON.stringify( sphereColor.map( v => v * 255 ) )});
  const ramp=solid(${JSON.stringify( rampColor.map( v => v * 255 ) )});
  const textures=${JSON.stringify( textures )}.map(rgb=>rgb?solid(rgb,true):null);
  async function pixel(){await new Promise(requestAnimationFrame);renderer.render(scene,camera);const p=new Uint8Array(await renderer.readRenderTargetPixelsAsync(target,0,0,32,32));return Array.from(p.slice((16*32+16)*4,(16*32+16)*4+4));}
  let samples=0;
  for(const c of ${JSON.stringify( cases )}) {
   material.map=textures[${JSON.stringify( textures )}.findIndex(v=>JSON.stringify(v)===JSON.stringify(c.texture))];
   light.visible=['direct','ramp','multiple'].includes(c.lighting);second.visible=c.lighting==='multiple';indirect.visible=c.lighting==='indirect';
   material.gradientMap=c.lighting==='ramp'?ramp:null;
   material.matcap=c.mode==='none'?null:sphere;material.matcapMode=c.mode==='subtexture'?'subtexture':'sphere';material.matcapCombine=c.mode==='add'?AddOperation:MultiplyOperation;
   material.needsUpdate=true;near(await pixel(),c.expected,backend+' '+JSON.stringify(c));samples++;
  }
  // Black base and toon textures must leave independently lit specular visible,
  // including sphere multiply and SubTexture modes. Differences isolate specular
  // from sphere-add and ambient instead of comparing subjective brightness.
  material.ambient.setRGB(0,0,0);material.color.setRGB(0,0,0);material.map=textures[4];material.gradientMap=textures[4];
  light.visible=true;second.visible=indirect.visible=false;material.shininess=8;
  for(const mode of ['none','multiply','add','subtexture']) {
   material.matcap=mode==='none'?null:sphere;material.matcapMode=mode==='subtexture'?'subtexture':'sphere';material.matcapCombine=mode==='add'?AddOperation:MultiplyOperation;material.needsUpdate=true;
   material.specular.setRGB(0,0,0);const baseline=await pixel();material.specular.setRGB(0.2,0.3,0.4);const lit=await pixel();
   near(lit.map((v,i)=>v-baseline[i]),[0.2,0.3,0.4].map(v=>v*0.25*(8*0.5+1)/4),backend+' separate specular '+mode);samples++;
  }
  // User emission remains a separate Three channel, including custom nodes.
  light.visible=false;material.map=textures[4];material.matcap=material.gradientMap=null;material.specular.setRGB(0,0,0);material.emissive.setRGB(0.1,0.2,0.3);material.emissiveIntensity=2;material.needsUpdate=true;
  near(await pixel(),[0.2,0.4,0.6],backend+' user emissive');
  material.emissiveNode=vec3(0.3,0.1,0.2);material.needsUpdate=true;const custom=material.emissiveNode;near(await pixel(),[0.3,0.1,0.2],backend+' custom emissive');check(custom===material.emissiveNode,'custom emission replaced');
  result.backends.push({backend,samples});textures.forEach(tex=>tex?.dispose());sphere.dispose();ramp.dispose();material.dispose();plane.geometry.dispose();target.dispose();renderer.dispose();
 }
}catch(error){result.errors.push(error.stack||String(error));}
document.getElementById('result').textContent=encodeURIComponent(JSON.stringify(result));
</script>`;
	const server = createServer( async ( request, response ) => {

		const path = new URL( request.url || '/', 'http://localhost' ).pathname;
		if ( path === '/' ) { response.setHeader( 'Content-Type', 'text/html' ); response.end( html ); return; }
		if ( ! /^(\/dist\/|\/node_modules\/three\/).+\.js$/.test( path ) ) { response.writeHead( 404 ).end(); return; }
		try {

			response.setHeader( 'Content-Type', 'text/javascript' );
			response.end( await readFile( new URL( '../../' + path.slice( 1 ), import.meta.url ) ) );

		} catch { response.writeHead( 404 ).end(); }

	} );
	const profile = await mkdtemp( join( tmpdir(), 'mmd-ambient-browser-' ) );
	try {

		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const result = await runBrowser<{ errors: string[]; webgpu: boolean; backends: { backend: string; samples: number }[] }>( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/`, profile, 'light', 110000 );
		assert.deepEqual( result.errors, [] ); assert.equal( result.backends[ 0 ]?.backend, 'webgl' );
		if ( result.webgpu ) assert.equal( result.backends[ 1 ]?.backend, 'webgpu' );
		else t.diagnostic( 'Native WebGPU unavailable; mandatory WebGL2 passed.' );
		for ( const b of result.backends ) { assert.equal( b.samples, cases.length + 4 ); t.diagnostic( `${b.backend}: ${b.samples} numerical ambient/texture/toon/sphere/specular assertions and user emission checks` ); }

	} finally {

		await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( profile );

	}

} );
