import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runBrowser } from './browser.ts';
import { pmdBuffer, pmxBuffer } from '../fixtures.ts';

const root = fileURLToPath( new URL( '../../', import.meta.url ) );

// All assertions operate on actual render-target pixels, on both backends when
// a native GPU adapter is available. WebGL2 TSL remains mandatory everywhere.
test( 'MMD TSL shading and inverted hull outlines render on WebGL2 and available WebGPU', { timeout: 60000 }, async t => {

	const fixtures = { pmd: Array.from( new Uint8Array( pmdBuffer() ) ), pmx: Array.from( new Uint8Array( pmxBuffer() ) ) };
	const html = `<!doctype html>
<script type="importmap">{"imports":{
	"mmd-parser":"/node_modules/mmd-parser/build/mmdparser.module.mjs",
	"three":"/node_modules/three/build/three.module.js",
	"three/webgpu":"/node_modules/three/build/three.webgpu.js",
	"three/tsl":"/node_modules/three/build/three.tsl.js",
	"three/addons/":"/node_modules/three/examples/jsm/"
}}</script>
<pre id="result">pending</pre>
<script type="module">
import {
	AddOperation, Bone, Color, DataTexture, DirectionalLight, DoubleSide,
	Float32BufferAttribute, Fog, Mesh, MultiplyOperation, NearestFilter, OrthographicCamera,
	PlaneGeometry, Scene, Skeleton, SkinnedMesh, SphereGeometry, Uint16BufferAttribute
} from 'three';
import { RenderTarget, WebGPURenderer } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MMDLoader, MMDToonMaterial, MMDOutlineEffect } from '/src/index.js';
import { Parser } from 'mmd-parser';

const result = { backends: [], errors: [], webgpu: 'unavailable' };
const originalError = console.error;
console.error = (...args) => { result.errors.push(args.map(String).join(' ')); originalError(...args); };
function check(value, message) { if(!value) throw new Error(message); }
function solid(r, g, b, a = 255) {
	const texture = new DataTexture(new Uint8Array([r,g,b,a]), 1, 1);
	texture.needsUpdate = true;
	return texture;
}
try {
	const adapter = await navigator.gpu?.requestAdapter();
	const backends = adapter ? ['webgl', 'webgpu'] : ['webgl'];
	if(adapter) result.webgpu = 'available';
	for(const backend of backends) {
		const renderer = new WebGPURenderer({ forceWebGL: backend === 'webgl', antialias: false });
		await renderer.init();
		check(backend === 'webgl' ? renderer.backend.isWebGLBackend : renderer.backend.isWebGPUBackend, 'wrong backend');
		renderer.setSize(128,128);
		renderer.debug.onShaderError = () => result.errors.push('shader compilation failed');
		const target = new RenderTarget(128,128);
		renderer.setRenderTarget(target);
		const camera = new OrthographicCamera(-1.6,1.6,1.6,-1.6,0.1,20);
		camera.position.z = 4;
		const scene = new Scene();
		scene.background = new Color(0,0,0);
		const light = new DirectionalLight(0xffffff, Math.PI);
		light.position.z = 3;
		scene.add(light);
		const effect = new MMDOutlineEffect(renderer);
		async function pixels() {
			// Three updates frame-scoped skeleton data on its animation clock.
			await new Promise(requestAnimationFrame);
			effect.render(scene,camera);
			return new Uint8Array(await renderer.readRenderTargetPixelsAsync(target,0,0,128,128));
		}
		const center = p => Array.from(p.slice((64*128+64)*4,(64*128+64)*4+4));
		const material = new MMDToonMaterial({ color: 0x808080, specular: 0x000000, emissive: 0x000000 });
		const plane = new Mesh(new PlaneGeometry(2,2),material);
		scene.add(plane);
		const baseline = center(await pixels());
		check(baseline[0] > 20, 'toon surface missing');
		const ramp = new DataTexture(new Uint8Array([64,64,64,255,255,255,255,255]),2,1);
		ramp.minFilter = ramp.magFilter = NearestFilter; ramp.needsUpdate = true;
		material.gradientMap = ramp; material.needsUpdate = true;
		light.position.z = -3;
		const dark = center(await pixels());
		light.position.z = 3;
		const bright = center(await pixels());
		check(bright[0] > dark[0] * 1.5, 'toon gradient not sampled');
		material.map = solid(128,64,32); material.needsUpdate = true;
		const textured = center(await pixels());
		check(textured[0] < bright[0] && textured[0] > textured[1] && textured[1] > textured[2], 'diffuse texture missing');
		material.map = null;
		material.matcap = solid(80,80,80);
		material.matcapCombine = MultiplyOperation; material.needsUpdate = true;
		const multiply = center(await pixels());
		material.matcapCombine = AddOperation; material.needsUpdate = true;
		const add = center(await pixels());
		check(multiply[0] < bright[0] && add[0] > bright[0], 'sphere add/multiply incorrect');
		material.matcap = null; material.specular.setRGB(1,0,0); material.shininess = 0; material.needsUpdate = true;
		const specular = center(await pixels());
		check(specular[0] > bright[0] && specular[0] > specular[1], 'Phong specular missing');
		material.specular.setRGB(0,0,0); material.emissive.setRGB(0,0.25,0);
		light.visible = false;
		const emissive = center(await pixels());
		check(emissive[1] > 0 && emissive[0] === 0, 'emissive missing');
		material.opacity = 0.25; material.transparent = true; material.needsUpdate = true;
		const translucent = center(await pixels());
		check(translucent[1] < emissive[1], 'opacity missing');
		material.opacity = 1; material.map = solid(255,255,255,64); material.needsUpdate = true;
		check(center(await pixels())[1] < emissive[1], 'diffuse texture alpha missing');
		material.map = null;
		material.alphaMap = solid(0,0,0); material.needsUpdate = true;
		check(center(await pixels())[1] === 0, 'alpha map missing');
		material.alphaMap = null; material.alphaTest = 0.5; material.opacity = 0.25; material.needsUpdate = true;
		check(center(await pixels())[1] === 0, 'alpha test missing');
		material.alphaTest = 0; material.opacity = 1; material.transparent = false;
		plane.rotation.y = Math.PI; material.needsUpdate = true;
		check(center(await pixels())[1] === 0, 'front side culling missing');
		material.side = DoubleSide; material.needsUpdate = true;
		check(center(await pixels())[1] > 0, 'double side missing');
		plane.rotation.y = 0;
		material.normalMap = solid(128,128,255); material.bumpMap = solid(128,128,128);
		material.displacementMap = solid(0,0,0); material.displacementScale = 0.1; material.needsUpdate = true;
		await renderer.compileAsync(scene,camera); await pixels();
		material.normalMap = null; material.needsUpdate = true;
		await renderer.compileAsync(scene,camera); await pixels();
		scene.remove(plane); plane.geometry.dispose(); material.dispose();
		light.visible = true;
		let loaderCases = 0;
		const loader = new MMDLoader();
		const white = solid(255,255,255);
		loader.meshBuilder.materialBuilder.textureLoader.load = () => white;
		for(const [format, bytes] of Object.entries(${JSON.stringify(fixtures)})) {
			for(const morph of [false,true]) {
				for(const variant of ['toon','textured','sphere-add','sphere-multiply']) {
					const parser = new Parser();
					const data = format === 'pmd' ? parser.parsePmd(new Uint8Array(bytes).buffer,true) : parser.parsePmx(new Uint8Array(bytes).buffer,true);
					if(morph) {
						const smile = {name:'smile',englishName:'',panel:1,type:1,elementCount:1,elements:[{index:0,position:[0.25,0,0]}]};
						data.morphs = format === 'pmx' ? [smile] : [{name:'base',type:0,elementCount:1,elements:[{index:0,position:data.vertices[0].position}]},smile];
						data.metadata.morphCount = data.morphs.length;
					}
					const mesh = loader.meshBuilder.build(data,'');
					mesh.rotation.y = Math.PI; mesh.frustumCulled = false;
					if(morph) mesh.morphTargetInfluences[mesh.morphTargetDictionary.smile] = 0.5;
					const m = mesh.material[0];
					if(variant !== 'toon') m.map = white;
					if(variant.startsWith('sphere')) { m.matcap = white; m.matcapCombine = variant === 'sphere-add' ? AddOperation : MultiplyOperation; }
					scene.add(mesh);
					await renderer.compileAsync(scene,camera); await pixels();
					loaderCases++;
					scene.remove(mesh); mesh.geometry.dispose(); m.dispose();
				}
			}
		}
		// Two independently outlined materials on one skinned, morphed mesh.
		const halves = [-0.7,0.7].map(x => new SphereGeometry(0.42,24,16).translate(x,0,0));
		const geometry = mergeGeometries(halves,true); halves.forEach(g => g.dispose());
		const count = geometry.attributes.position.count;
		geometry.setAttribute('skinIndex',new Uint16BufferAttribute(new Uint16Array(count*4),4));
		const weights = new Float32Array(count*4); for(let i=0;i<count;i++) weights[i*4]=1;
		geometry.setAttribute('skinWeight',new Float32BufferAttribute(weights,4));
		geometry.setAttribute('mmdEdgeRatio',new Float32BufferAttribute(new Float32Array(count).fill(1),1));
		const morph = geometry.attributes.position.clone();
		for(let i=0;i<count;i++) morph.setX(i,morph.getX(i)+0.2);
		geometry.morphAttributes.position=[morph];
		const materials = [0,1].map(i => {
			const m = new MMDToonMaterial({color:0x000000,emissive:0xffffff,specular:0x000000});
			m.userData.outlineParameters={visible:true,thickness:i ? 0.05 : 0.025,color:i ? [0,0,1] : [1,0,0],alpha:i ? 0.5 : 1};
			return m;
		});
		const mesh = new SkinnedMesh(geometry,materials);
		const bone = new Bone(); mesh.add(bone); mesh.bind(new Skeleton([bone])); mesh.frustumCulled = false;
		scene.add(mesh);
		function colored(p,channel) {
			const points=[];
			for(let i=0;i<p.length;i+=4) if(p[i+channel]>20 && p[i+(channel===0?2:0)]<10 && p[i+1]<10) points.push([i/4%128,Math.floor(i/4/128),p[i+channel]]);
			return points;
		}
		const both = await pixels();
		const red = colored(both,0), blue = colored(both,2);
		check(red.length>20 && blue.length>red.length, 'different outline color/thickness missing');
		check(blue.every(p => p[2]<230), 'outline alpha ignored');
		// Reuse the cached outline through shader-affecting setting changes.
		materials[0].userData.outlineParameters.alpha=0.5;
		const faded = colored(await pixels(),0);
		check(faded.length>20 && faded.every(p => p[2]<230), 'cached outline opaque-to-transparent alpha ignored: '+backend);
		materials[0].userData.outlineParameters.alpha=1;
		const opaque = colored(await pixels(),0);
		check(opaque.length===red.length && opaque.every(p => p[2]===255), 'cached outline transparent-to-opaque alpha ignored: '+backend);
		materials[0].transparent=true; materials[0].needsUpdate=true;
		await pixels();
		materials[0].userData.outlineParameters.alpha=0.5;
		const sourceTransparent = colored(await pixels(),0);
		check(sourceTransparent.length>20 && sourceTransparent.every(p => p[2]<230), 'cached outline source transparency ignored: '+backend);
		materials[0].transparent=false; materials[0].needsUpdate=true;
		materials[0].userData.outlineParameters.alpha=1;
		const displacement = solid(255,255,255);
		materials[0].displacementMap=displacement; materials[0].displacementScale=0.15; materials[0].needsUpdate=true;
		const displaced = colored(await pixels(),0);
		check(displaced.length>20 && displaced.length!==red.length, 'cached outline displacement map addition failed: '+backend);
		materials[0].displacementScale=0;
		check(colored(await pixels(),0).length===red.length, 'cached outline displacement scale update failed: '+backend);
		materials[0].displacementMap=null; materials[0].needsUpdate=true;
		check(colored(await pixels(),0).length===red.length, 'cached outline displacement map removal failed: '+backend);
		displacement.dispose();
		scene.fog = new Fog(0xffffff,0,0.1);
		materials[0].fog=false;
		check(colored(await pixels(),0).length>20, 'cached outline fog disable failed: '+backend);
		materials[0].fog=true;
		check(colored(await pixels(),0).length===0, 'cached outline fog enable failed: '+backend);
		scene.fog=null;
		materials[1].userData.outlineParameters.visible=false;
		const disabled = await pixels();
		check(colored(disabled,2).length===0 && colored(disabled,0).length>20, 'per-material visibility ignored');
		materials[0].userData.outlineParameters.alpha=0;
		check(colored(await pixels(),0).length===0, 'zero outline alpha ignored');
		materials[0].userData.outlineParameters.alpha=1;
		materials[1].userData.outlineParameters.visible=true;
		geometry.attributes.mmdEdgeRatio.array.fill(0); geometry.attributes.mmdEdgeRatio.needsUpdate=true;
		const noRatio = await pixels();
		check(colored(noRatio,0).length===0 && colored(noRatio,2).length===0, 'edge ratio zero ignored');
		geometry.attributes.mmdEdgeRatio.array.fill(0.5); geometry.attributes.mmdEdgeRatio.needsUpdate=true;
		check(colored(await pixels(),0).length<red.length, 'edge ratio thickness ignored');
		geometry.attributes.mmdEdgeRatio.array.fill(1); geometry.attributes.mmdEdgeRatio.needsUpdate=true;
		bone.position.x=0.2;
		const skinned = colored(await pixels(),0);
		mesh.morphTargetInfluences[0]=1;
		const moved = colored(await pixels(),0);
		const mean = points => points.reduce((sum,p)=>sum+p[0],0)/points.length;
		check(mean(skinned)>mean(red)+5, 'outline did not follow skinning: '+backend);
		check(mean(moved)>mean(skinned)+5, 'outline did not follow morph: '+backend);
		effect.enabled=false;
		check(colored(await pixels(),0).length===0, 'global outline toggle ignored');
		effect.enabled=true;
		// Geometries supplied by applications can omit the optional edge attribute.
		const plainGeometry = geometry.clone(); plainGeometry.deleteAttribute('mmdEdgeRatio');
		const plainMaterials = materials.map(m => m.clone());
		const plain = new Mesh(plainGeometry,plainMaterials);
		scene.remove(mesh); scene.add(plain);
		check(colored(await pixels(),0).length>20, 'missing edge attribute fallback failed');
		scene.remove(plain); scene.add(mesh);
		plainGeometry.dispose(); plainMaterials.forEach(m => m.dispose());
		// Preserve hooks even when rendering throws.
		const previous=function(){check(this===renderer,'callback receiver lost'); throw new Error('sentinel');}; renderer.setRenderObjectFunction(previous);
		try { effect.render(scene,camera); } catch(error) { check(error.message==='sentinel','wrong error'); }
		check(renderer.getRenderObjectFunction()===previous,'renderer hook not restored');
		renderer.setRenderObjectFunction(null);
		await pixels();
		effect.dispose();
		check(colored(await pixels(),0).length>20, 'outline resources cannot be recreated');
		result.backends.push({backend,loaderCases,red:red.length,blue:blue.length});
		effect.dispose(); geometry.dispose(); materials.forEach(m=>m.dispose()); target.dispose(); renderer.dispose();
	}
} catch(error) { result.errors.push(error.stack); }
document.getElementById('result').textContent=encodeURIComponent(JSON.stringify(result));
</script>`;
	const server = createServer( async ( request, response ) => {

		const path = new URL( request.url || '/', 'http://localhost' ).pathname;
		if ( path === '/' ) { response.setHeader( 'Content-Type', 'text/html' ); response.end( html ); return; }
		if ( ! /^(\/src\/|\/node_modules\/(?:three|mmd-parser)\/).+\.(?:mjs|js)$/.test( path ) ) { response.writeHead( 404 ).end(); return; }
		try {

			const source = await readFile( join( root, path.slice( 1 ).replace( /^src\//, 'dist/' ) ) );
			response.setHeader( 'Content-Type', 'text/javascript' ); response.end( source );

		} catch { response.writeHead( 404 ).end(); }

	} );
	const profile = await mkdtemp( join( tmpdir(), 'three-mmd-tsl-test-' ) );
	try {

		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const result = await runBrowser<{ errors: string[]; webgpu: string; backends: { backend: string; loaderCases: number; red: number; blue: number }[] }>(
			`http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/`, profile
		);
		assert.deepEqual( result.errors, [] );
		assert.equal( result.backends[ 0 ]?.backend, 'webgl' );
		for ( const backend of result.backends ) {

			assert.equal( backend.loaderCases, 16 );
			t.diagnostic( `${backend.backend}: shading and outline pixel assertions passed (${backend.red} red / ${backend.blue} blue outline pixels)` );

		}
		if ( result.webgpu === 'available' ) assert.equal( result.backends[ 1 ]?.backend, 'webgpu' );
		else t.diagnostic( 'Native WebGPU adapter unavailable; capability-gated GPU rendering skipped. WebGL2 TSL rendering remains required.' );

	} finally {

		await new Promise( resolve => server.close( resolve ) );
		await rm( profile, { recursive: true, force: true } );

	}

} );
