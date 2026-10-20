import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createExamplesServer } from '../../scripts/serve-examples.ts';
import { linkedCollisionBuffer, physicsLayersPmxBuffer } from '../fixtures.ts';
import { removeBrowserDirectory, runBrowser } from './browser.ts';

const fixtures = [ { format: 'pmd', bytes: Array.from( new Uint8Array( linkedCollisionBuffer( 'pmd', { masks: [ 0, 0 ] } ) ) ) }, { format: 'pmx', bytes: Array.from( new Uint8Array( physicsLayersPmxBuffer() ) ) } ];
const instrumentation = `
Ammo=(factory=>async options=>{
 const A=await factory(options),World=A.btDiscreteDynamicsWorld;
 globalThis.warmupNativeSteps=[];
 A.btDiscreteDynamicsWorld=class extends World {
  stepSimulation(...args){
   globalThis.warmupNativeSteps.push(args);
   if(typeof document==='undefined')postMessage({type:'warmup-native-step',args});
   return super.stepSimulation(...args);
  }
 };
 return A;
})(Ammo);`;
const harness = `<!doctype html><pre id="result">pending</pre>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/tsl":"/node_modules/three/build/three.tsl.js","three/webgpu":"/node_modules/three/build/three.webgpu.js","three/addons/":"/node_modules/three/examples/jsm/","mmd-parser":"/node_modules/mmd-parser/build/mmdparser.module.mjs"}}</script>
<script type="module">
import {ammoURL,initializeAmmoWasm} from '/examples/ammo-runtime.js';
import {AnimationClip,VectorKeyframeTrack,NumberKeyframeTrack,Texture,Vector3} from 'three';
import {Parser} from 'mmd-parser';
import {MMDAnimationHelper,MMDLoader} from '/src/index.js';
const checks={};function check(name,v){if(!v)throw new Error(name);checks[name]=true;}
const wait=()=>new Promise(r=>setTimeout(r,2));
const progress=stage=>fetch('/ramp-progress?stage='+encodeURIComponent(stage)).catch(()=>{});
async function until(predicate){const end=performance.now()+10000;while(!predicate()){if(performance.now()>end)throw new Error('warmup timeout');await wait();}}
try {
 globalThis.Ammo=await initializeAmmoWasm();
 for(const fixture of ${JSON.stringify( fixtures )}) for(const shared of [false,true]) for(const mode of ['sync','worker','fallback']) {
  const label=fixture.format+'/'+shared+'/'+mode; progress(label+'/start');
  const loader=new MMDLoader();loader.meshBuilder.materialBuilder.textureLoader.load=()=>new Texture();
  const parser=new Parser(), bytes=new Uint8Array(fixture.bytes).buffer;
  const mesh=loader.meshBuilder.build(fixture.format==='pmd'?parser.parsePmd(bytes,true):parser.parsePmx(bytes,true),'');
  const index=fixture.format==='pmd'?0:6, bone=mesh.skeleton.bones[index],base=bone.position.toArray(),target=base.map((v,i)=>v+[3,0.6,-0.9][i]);
  const tracks=[new VectorKeyframeTrack('.bones['+bone.name+'].position',[0,2],[...target,...target.map(v=>v+0.5)])];
  if(fixture.format==='pmx')tracks.push(new NumberKeyframeTrack('.morphTargetInfluences[1]',[0,2],[0.8,0.8]));
  const clip=new AnimationClip('fixed start',2,tracks),helper=new MMDAnimationHelper({sync:false});helper.sharedPhysics=shared;
  const observed=[],native=[],fallback=[];globalThis.warmupNativeSteps=[];
  helper.onBeforePhysics=()=>{
   const s=helper.objects.get(mesh),raw=s.poseLayers?.authored.slice(index*7,index*7+3)??bone.position.toArray();
   observed.push({weight:s.initialPose?.weight??1,time:s.mixer.time,raw:Array.from(raw)});
  };
  const workerPhysics={ammoURL:mode==='fallback'?location.origin+'/missing-ammo.js':ammoURL,onFallback:r=>fallback.push(r),createWorker:()=>{
   const worker=new Worker('/src/animation/MMDPhysicsWorker.js');
   worker.addEventListener('message',e=>{if(e.data.type==='warmup-native-step')native.push(e.data.args);});return worker;
  }};
  helper.add(mesh,{animation:clip,physicsMode:mode==='sync'?'sync':'worker',workerPhysics,gravity:new Vector3()});
  const s=helper.objects.get(mesh),p=s.physics;
  await until(()=>p.physicsMode==='sync'||p.workerStatus.initialized); await p.ready; progress(label+'/ready');
  await until(()=>!p.workerAdapter?.group.warmingUp); progress(label+'/warmed');
  check(label+'/mode',p.physicsMode===(mode==='worker'?'worker':'sync'));
  if(mode==='worker')check(label+'/transport',p.transport===(crossOriginIsolated?'shared':'transferable'));
  if(mode==='fallback')check(label+'/fallback',fallback.length===1);
  check(label+'/cycles',observed.length===60);
  const actualSteps=mode==='worker'?native:globalThis.warmupNativeSteps;
  check(label+'/nativeCycles',actualSteps.length===60);
  check(label+'/timestep',actualSteps.every(a=>a[0]===1/60&&a[1]===2&&a[2]===1/60));
  check(label+'/sequence',observed.every((o,i)=>o.time===0&&Math.abs(o.weight-Math.min((i+1)/30,1))<1e-10&&o.raw.every((v,j)=>Math.abs(v-(base[j]+(target[j]-base[j])*o.weight))<1e-5)));
  check(label+'/finished',!s.initialPose&&s.mixer.time===0);
  const complete=p.workerStatus?.completedSequence??0;
  helper.update(1/60);
  if(mode==='worker')await until(()=>p.workerStatus.completedSequence>complete);
  helper.update(0);
  check(label+'/playback',Math.abs(s.mixer.time-1/60)<1e-10&&mesh.skeleton.bones.every(b=>b.position.toArray().concat(b.quaternion.toArray()).every(Number.isFinite)));
  helper.remove(mesh);
 }
 document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({checks,isolated:crossOriginIsolated}));
} catch(error){document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({error:String(error),checks}));}
</script>`;

for ( const isolated of [ false, true ] ) test( `real WASM startup ramp, bundled Worker and fallback, isolation=${isolated}`, { timeout: 60000 }, async () => {

	const profile = await mkdtemp( join( tmpdir(), 'mmd-ramp-browser-' ) ), files = createExamplesServer();
	let stage = 'launch';
	const server = createServer( async ( request, response ) => {

		if ( isolated ) { response.setHeader( 'Cross-Origin-Opener-Policy', 'same-origin' ); response.setHeader( 'Cross-Origin-Embedder-Policy', 'require-corp' ); }
		if ( request.url?.startsWith( '/ramp-progress?' ) ) { stage = new URL( request.url, 'http://localhost' ).searchParams.get( 'stage' )!; response.writeHead( 204 ).end(); }
		else if ( request.url === '/ramp-test' ) response.writeHead( 200, { 'Content-Type': 'text/html' } ).end( harness );
		else if ( request.url === '/examples/vendor/bullet/ammo.js' ) response.writeHead( 200, { 'Content-Type': 'text/javascript' } ).end( await readFile( new URL( '../../examples/vendor/bullet/ammo.js', import.meta.url ), 'utf8' ) + instrumentation );
		else files.emit( 'request', request, response );

	} );
	await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
	try {

		const address = server.address(); assert.ok( address && typeof address !== 'string' );
		const result = await runBrowser<{ error?: string; checks: Record<string, boolean>; isolated: boolean }>( `http://127.0.0.1:${address.port}/ramp-test`, profile ).catch( error => { throw new Error( `${String( error )}; last progress: ${stage}` ); } );
		assert.equal( result.error, undefined, JSON.stringify( result ) ); assert.equal( result.isolated, isolated );
		assert.ok( Object.values( result.checks ).every( Boolean ) ); assert.equal( Object.keys( result.checks ).length, 92 );

	} finally { await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( profile ); }

} );
