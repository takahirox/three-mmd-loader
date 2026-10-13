import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
 const data=new Parser().parsePmx(new Uint8Array(${JSON.stringify( fixture )}).buffer,true);
 data.rigidBodies[3].type=2; // constrained to mode 0, retaining effective mode 2
 return loader.meshBuilder.build(data,'');
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
  first.skeleton.bones[3].position.x=2+i/10; reference.skeleton.bones[3].position.x=2+i/10;
  // Worker stepping must not touch main-thread Ammo.
  helper.update(1/60);
  for(let spin=0;spin<30;spin++) helper.update(0);
  await complete(p,i); helper.update(0);
  globalThis.Ammo=savedAmmo;sync.update(1/60);globalThis.Ammo=undefined;
  check('coherent'+i,p.workerStatus.completedSequence===q.workerStatus.completedSequence);
  check('dynamicPostIK'+i,near(first.skeleton.bones[1].quaternion.toArray(),reference.skeleton.bones[1].quaternion.toArray()));
  const raw=sync.objects.get(reference).physics.bodyResults;
  check('type2RawBullet'+i,p.bodyResults.every((r,j)=>near(r.position,raw[j].position)&&near(r.quaternion,raw[j].quaternion)));
  check('type2SkeletalPosition'+i,Math.abs(first.skeleton.bones[3].position.x-(2+i/10))<1e-4);
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


const demoHarness = `<!doctype html><meta charset="utf-8"><pre id="result">pending</pre><script type="module">
const checks={};
function check(name,value) {if(!value) throw new Error(name);checks[name]=true;}
try {
 for(const [suffix,expected,stray] of [['','sync','worker'],['_worker','worker','sync']]) {
  const frame=document.createElement('iframe');frame.width=800;frame.height=600;
  const loaded=new Promise(resolve=>frame.onload=resolve);
  const search='?backend=webgl&physicsMode='+stray;
  frame.src='/examples/webgl_loader_mmd'+suffix+'.html'+search+'#fixed-mode';
  document.body.appendChild(frame);await loaded;
  const page=frame.contentWindow,doc=frame.contentDocument;
  const module=await page.eval("import('/examples/webgl_loader_mmd"+suffix+".js')");
  const c=await module.ready,p=c.helper.objects.get(c.mesh).physics;
  check('fixedMode'+suffix,p.requestedPhysicsMode===expected && p.physicsMode===expected);
  check('transport'+suffix,expected==='worker' ? p.transport==='transferable' : !p.transport);
  check('noSelector'+suffix,!c.gui.controllers.some(controller=>controller.property==='physicsMode') && !doc.getElementById('controls').textContent.includes('Physics mode (reload)'));
  const deadline=performance.now()+5000;
  while(!/main-thread helper update: [0-9.]+ ms/.test(doc.getElementById('status').textContent)) {
   if(performance.now()>deadline) throw new Error('measurement timeout');
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  check('actualStatus'+suffix,doc.getElementById('status').textContent.startsWith(expected==='worker' ? 'worker / transferable' : 'sync —'));
  check('backend'+suffix,c.renderer.backend.isWebGLBackend);
  check('url'+suffix,page.location.search===search && page.location.hash==='#fixed-mode');
  page.dispatchEvent(new page.Event('pagehide'));frame.remove();
 }
 document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({checks}));
} catch(error) {document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({error:String(error),checks}));}
</script>`;

test( 'animation entry points ignore conflicting physics queries and retain backend, hash and measured status', { timeout: 60000 }, async () => {

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
		const result = await runBrowser<{ error?: string; checks: Record<string, boolean> }>( `http://127.0.0.1:${address.port}/demo-test`, join( directory, 'profile' ) );
		assert.equal( result.error, undefined, JSON.stringify( result ) );
		assert.ok( Object.values( result.checks ).every( Boolean ) );

	} finally { await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( join( directory, 'profile' ) ); await rm( directory, { recursive: true, force: true } ); }

} );


const standaloneHarness = `<!doctype html><pre id="result">pending</pre><script type="module">
const checks = {};
function check(name, value) { if (!value) throw new Error(name); checks[name] = true; }
const wait = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(predicate) {
 const deadline=performance.now()+10000;
 while(!predicate()) {if(performance.now()>deadline) throw new Error('status timeout'); await wait();}
}
try {
 for(const failure of ['', 'startup', 'runtime']) {
  const frame=document.createElement('iframe');frame.width=800;frame.height=600;
  const loaded=new Promise(resolve=>frame.onload=resolve);
  frame.src='/examples/webgl_loader_mmd_worker.html'+(failure ? '?failure='+failure : '');
  document.body.appendChild(frame);await loaded;
  const page=frame.contentWindow, doc=frame.contentDocument;
  const module=await page.eval("import('/examples/webgl_loader_mmd_worker.js')");
  const c=await module.ready, p=c.helper.objects.get(c.mesh).physics;
  const status=()=>doc.getElementById('status').textContent;
  check('requestedWorker'+failure,p.requestedPhysicsMode==='worker');
  if(failure!=='startup') {
   check('initialized'+failure,p.physicsMode==='worker' && p.workerStatus.initialized && p.transport==='transferable' && !page.crossOriginIsolated);
   check('actualMode'+failure,status().startsWith('worker / transferable'));
  }
  if(failure==='runtime') page.demoWorker.dispatchEvent(new page.Event('error'));
  await until(()=>/main-thread helper update: [0-9.]+ ms/.test(status()) && (!failure || status().startsWith('sync (Worker fallback: ')));
  check('measurement'+failure,/main-thread helper update: [0-9.]+ ms/.test(status()));
  if(failure) {
   check('fallback'+failure,p.physicsMode==='sync' && !!p.world && !p.initializationError && !p.transport);
   check('diagnostic'+failure,status().startsWith('sync (Worker fallback: ') && status().includes('Worker error'));
   await new Promise(resolve=>setTimeout(resolve,550));
   check('persistentDiagnostic'+failure,status().includes('Worker fallback:'));
   c.helper.update(1/60);
   check('syncContinues'+failure,c.mesh.skeleton.bones.every(b=>b.position.toArray().concat(b.quaternion.toArray()).every(Number.isFinite)));
  }
  check('noSelector'+failure,!c.gui.controllers.some(controller=>controller.property==='physicsMode') && !doc.getElementById('controls').textContent.includes('Physics mode (reload)'));
  const debugHelpers=c.scene.children.filter(child=>!child.visible);
  check('debugHelpers'+failure,debugHelpers.length===2);
  for(const name of ['animation','ik','physics','outline','show IK bones','show rigid bodies']) {
   const controller=c.gui.controllers.find(controller=>controller.property===name);
   check('control'+name+failure,!!controller && !controller._disabled);
   const initial=controller.getValue();controller.setValue(!initial);
   if(['animation','ik','physics'].includes(name)) check('toggle'+name+failure,c.helper.enabled[name]===!initial);
   if(name==='outline') check('toggleOutline'+failure,c.effect.enabled===!initial);
   if(name.startsWith('show ')) check('toggleDebug'+name+failure,debugHelpers.filter(child=>child.visible).length===1);
   controller.setValue(initial);
  }
  if(!failure) {
   page.dispatchEvent(new page.PageTransitionEvent('pagehide',{persisted:true}));
   check('cachedSceneRetained',c.helper.objects.has(c.mesh) && !!p.workerAdapter && doc.querySelector('#controls')!==null);
   page.dispatchEvent(new page.Event('pagehide'));
   check('cleanup',!c.helper.objects.has(c.mesh) && !p.workerAdapter && doc.querySelector('#controls')===null);
  }
  frame.remove();
 }
 document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({checks}));
} catch(error) {document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({error:String(error),checks}));}
</script>`;

test( 'standalone Worker page defaults to transferable physics, exposes startup/runtime fallback and cleans up', { timeout: 60000 }, async () => {

	const directory = await mkdtemp( join( tmpdir(), 'mmd-standalone-worker-' ) );
	await writeGeneratedExampleAssets( join( directory, 'assets' ) );
	const files = createExamplesServer( { assetRoot: join( directory, 'assets' ) } );
	const server = createServer( async ( request, response ) => {

		if ( request.url === '/standalone-test' ) response.writeHead( 200, { 'Content-Type': 'text/html' } ).end( standaloneHarness );
		else if ( request.url?.startsWith( '/examples/webgl_loader_mmd_worker.html?failure=' ) ) {

			const failure = new URL( request.url, 'http://localhost' ).searchParams.get( 'failure' );
			const html = await readFile( new URL( '../../examples/webgl_loader_mmd_worker.html', import.meta.url ), 'utf8' );
			// Inject only in the test server, before the real entry point runs.
			const injection = `<script>globalThis.Worker = class extends Worker {
 constructor(url, options) { super(${failure === 'startup' ? "'/missing-worker.js'" : 'url'}, options); globalThis.demoWorker=this; }
};</script>`;
			response.writeHead( 200, { 'Content-Type': 'text/html' } ).end( html.replace( '<script type="module"', injection + '<script type="module"' ) );

		} else files.emit( 'request', request, response );

	} );
	await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
	try {

		const address = server.address(); assert.ok( address && typeof address !== 'string' );
		const result = await runBrowser<{ error?: string; checks: Record<string, boolean> }>( `http://127.0.0.1:${address.port}/standalone-test`, join( directory, 'profile' ) );
		assert.equal( result.error, undefined, JSON.stringify( result ) );
		assert.ok( Object.values( result.checks ).every( Boolean ) );

	} finally {

		await new Promise( resolve => server.close( resolve ) );
		await removeBrowserDirectory( join( directory, 'profile' ) );
		await rm( directory, { recursive: true, force: true } );

	}

} );
