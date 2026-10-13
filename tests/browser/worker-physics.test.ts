import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeGeneratedExampleAssets } from '../../scripts/generated-example-assets.ts';
import { createExamplesServer } from '../../scripts/serve-examples.ts';
import { physicsLayersPmxBuffer } from '../fixtures.ts';
import { removeBrowserDirectory, runBrowser } from './browser.ts';

const fixture = Array.from( new Uint8Array( physicsLayersPmxBuffer() ) );
const harness = `<!doctype html><pre id="result">pending</pre>
<script>addEventListener('error',event=>document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({error:event.message})));addEventListener('unhandledrejection',event=>document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({error:String(event.reason)})));</script>
<script src="/node_modules/ammojs-typed/ammo/ammo.js"></script>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/tsl":"/node_modules/three/build/three.tsl.js","three/webgpu":"/node_modules/three/build/three.webgpu.js","three/addons/":"/node_modules/three/examples/jsm/","mmd-parser":"/node_modules/mmd-parser/build/mmdparser.module.mjs"}}</script>
<script type="module">
import { Texture, Vector3 } from 'three';
import { Parser } from 'mmd-parser';
import { MMDAnimationHelper, MMDLoader } from '/src/index.js';
const checks = {};
const wait = () => new Promise(resolve => setTimeout(resolve, 5));
function check(name, value) { if (!value) throw new Error(name); checks[name] = true; }
function near(a,b) {return a.length===b.length && a.every((v,i)=>Math.abs(v-b[i])<1e-4);}
function model() {
 const loader = new MMDLoader();loader.meshBuilder.materialBuilder.textureLoader.load=()=>new Texture();
 return loader.meshBuilder.build(new Parser().parsePmx(new Uint8Array(${JSON.stringify( fixture )}).buffer,true),'');
}
async function complete(p, sequence) {
 const deadline = performance.now()+8000;
 while ((p.workerStatus?.completedSequence ?? 0) < sequence) {
  if (p.physicsMode !== 'worker') throw new Error('unexpected fallback: '+p.initializationError);
  if(performance.now()>deadline) throw new Error('worker step timeout');
  await wait();
 }
}
try {
 globalThis.Ammo = await Ammo();
 const helper = new MMDAnimationHelper(), sync = new MMDAnimationHelper(); helper.sharedPhysics=true;
 const first=model(), second=model(), reference=model(); second.position.z=20;
 const options={physicsMode:'worker',workerPhysics:{ammoURL:new URL('/node_modules/ammojs-typed/ammo/ammo.js',location.href).href},warmup:0,animationWarmup:false,gravity:new Vector3()};
 helper.add(first,options); helper.add(second,options);
 sync.add(reference,{warmup:0,animationWarmup:false,gravity:new Vector3()});
 const p=helper.objects.get(first).physics, q=helper.objects.get(second).physics;
 await Promise.all([p.ready,q.ready]);
 check('workerInitialized',p.physicsMode==='worker' && p.world===null && p.bodies.length===0);
 check('transport',p.transport === (crossOriginIsolated ? 'shared' : 'transferable'));
 check('sharedWorld',p.workerAdapter.group===q.workerAdapter.group);
 const savedAmmo=globalThis.Ammo; globalThis.Ammo=undefined;
 for(let i=1;i<=8;i++) {
  // Worker stepping must not touch main-thread Ammo.
  helper.update(1/60);
  for(let spin=0;spin<30;spin++) helper.update(0);
  await complete(p,i); helper.update(0);
  globalThis.Ammo=savedAmmo;sync.update(1/60);globalThis.Ammo=undefined;
  check('coherent'+i,p.workerStatus.completedSequence===q.workerStatus.completedSequence);
  check('dynamicPostIK'+i,near(first.skeleton.bones[1].quaternion.toArray(),reference.skeleton.bones[1].quaternion.toArray()));
 }
 globalThis.Ammo=savedAmmo;
 const debug=p.createHelper();debug.updateMatrixWorld(true);check('debugBodies',debug.children.length===first.geometry.userData.MMD.rigidBodies.length);debug.dispose();
 helper.update(1/60);p.reset();const reset=JSON.stringify(p.bodyResults);
 await wait();check('resetRace',JSON.stringify(p.bodyResults)===reset);
 helper.enable('physics',false);helper.update(1/60);helper.enable('physics',true);
 helper.remove(first);while(q.workerStatus.inFlight) await wait();helper.update(1/60);await complete(q,10);helper.remove(second);sync.remove(reference);
 const fallback=new MMDAnimationHelper(), failed=model(); let reason='';
 fallback.add(failed,{...options,workerPhysics:{ammoURL:location.origin+'/missing-ammo.js',onFallback:r=>reason=r}});
 const f=fallback.objects.get(failed).physics;await f.ready;
 check('startupFallback',f.physicsMode==='sync' && !!f.world && !!reason);fallback.update(1/60);fallback.remove(failed);
 document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({checks,isolated:crossOriginIsolated}));
} catch(error) {document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({error:String(error),checks}));}
</script>`;

for ( const isolated of [ false, true ] ) test( `real bundled classic Worker / Ammo integration, isolation=${isolated}`, { timeout: 60000 }, async t => {

	const profile = await mkdtemp( join( tmpdir(), 'mmd-worker-browser-' ) );
	const files = createExamplesServer();
	const server = createServer( ( request, response ) => {

		if ( isolated ) { response.setHeader( 'Cross-Origin-Opener-Policy', 'same-origin' ); response.setHeader( 'Cross-Origin-Embedder-Policy', 'require-corp' ); }
		if ( request.url === '/worker-test' ) { response.setHeader( 'Content-Type', 'text/html' ); response.end( harness ); }
		else files.emit( 'request', request, response );

	} );
	await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
	try {

		const address = server.address(); assert.ok( address && typeof address !== 'string' );
		const result = await runBrowser<{ error?: string; checks: Record<string, boolean>; isolated: boolean }>( `http://127.0.0.1:${address.port}/worker-test`, profile );
		assert.equal( result.error, undefined, JSON.stringify( result ) );
		assert.ok( Object.values( result.checks ).every( Boolean ) );
		if ( isolated && ! result.isolated ) t.diagnostic( 'Browser isolation unavailable: transferable integration passed; atomic publication covered in deterministic tests.' );
		else assert.equal( result.isolated, isolated );

	} finally { await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( profile ); }

} );


const demoHarness = `<!doctype html><pre id="result">pending</pre><script type="module">
const frame=document.createElement('iframe');frame.width=800;frame.height=600;document.body.appendChild(frame);
function loaded() {return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('demo load timeout')),15000);frame.onload=()=>{clearTimeout(timer);resolve();};});}
async function context() {const module=await frame.contentWindow.eval("import('/examples/webgl_loader_mmd.js')");return module.ready;}
try {
 let load=loaded();frame.src='/examples/webgl_loader_mmd.html?physicsMode=worker';await load;
 let c=await context();await c.helper.objects.get(c.mesh).physics.ready;
 await new Promise(resolve=>setTimeout(resolve,800));
 const p=c.helper.objects.get(c.mesh).physics;
 const worker=p.physicsMode==='worker' && p.transport==='transferable';
 const measurement=frame.contentDocument.getElementById('status').textContent.includes('main-thread helper update:');
 const controller=c.gui.controllers.find(controller=>controller.property==='physicsMode');
 load=loaded();controller.setValue('sync');await load;c=await context();c.renderer.setAnimationLoop(null);
 const sync=c.helper.objects.get(c.mesh).physics.physicsMode==='sync';
 c.helper.remove(c.mesh);
 document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({worker,measurement,sync,url:frame.contentWindow.location.search}));
} catch(error) {document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({error:String(error)}));}
</script>`;

test( 'animation demo mode selector reloads Worker/sync scenes and displays measured main-thread time', { timeout: 60000 }, async () => {

	const directory = await mkdtemp( join( tmpdir(), 'mmd-worker-demo-' ) );
	await writeGeneratedExampleAssets( join( directory, 'assets' ) );
	const files = createExamplesServer( { assetRoot: join( directory, 'assets' ) } );
	const server = createServer( ( request, response ) => {

		if ( request.url === '/demo-test' ) { response.setHeader( 'Content-Type', 'text/html' ); response.end( demoHarness ); }
		else files.emit( 'request', request, response );

	} );
	await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
	try {

		const address = server.address(); assert.ok( address && typeof address !== 'string' );
		const result = await runBrowser<{ error?: string; worker: boolean; measurement: boolean; sync: boolean; url: string }>( `http://127.0.0.1:${address.port}/demo-test`, join( directory, 'profile' ) );
		assert.equal( result.error, undefined, JSON.stringify( result ) );
		assert.equal( result.worker, true ); assert.equal( result.measurement, true ); assert.equal( result.sync, true ); assert.equal( result.url, '?physicsMode=sync' );

	} finally { await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( join( directory, 'profile' ) ); await rm( directory, { recursive: true, force: true } ); }

} );
