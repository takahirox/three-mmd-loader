import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createExamplesServer } from '../../scripts/serve-examples.ts';
import { linkedCollisionBuffer } from '../fixtures.ts';
import { removeBrowserDirectory, runBrowser } from './browser.ts';

const fixtures = ( [ 'pmd', 'pmx' ] as const ).map( format => ( { format, bytes: Array.from( new Uint8Array( linkedCollisionBuffer( format, { masks: [ 0, 0 ], timeProbe: true } ) ) ) } ) );
const harness = `<!doctype html><pre id="result">pending</pre>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/tsl":"/node_modules/three/build/three.tsl.js","three/webgpu":"/node_modules/three/build/three.webgpu.js","three/addons/":"/node_modules/three/examples/jsm/","mmd-parser":"/node_modules/mmd-parser/build/mmdparser.module.mjs"}}</script>
<script type="module">
import { ammoURL, initializeAmmoWasm } from "/examples/ammo-runtime.js";
import { Parser } from 'mmd-parser';
import { Texture, Vector3 } from 'three';
import { MMDAnimationHelper, MMDLoader } from '/src/index.js';
const checks={};
function check(name,value) {if(!value) throw new Error(name);checks[name]=true;}
function near(a,b) {return a.length===b.length && a.every((v,i)=>Math.abs(v-b[i])<5e-4);}
const wait=()=>new Promise(resolve=>setTimeout(resolve,2));
try {
 globalThis.Ammo=await initializeAmmoWasm();
 for(const fixture of ${JSON.stringify( fixtures )}) for(const override of [undefined,1/65]) for(const cap of [undefined,3]) {
  const key=fixture.format+' step='+override+' cap='+cap, h=override??1/60, held=[];
  // Real bundled Worker and real transfers/SAB, with only main-thread result
  // delivery held so batching is deterministic on fast and slow machines.
  let proxy;
  function createWorker() {
   const native=new Worker('/src/animation/MMDPhysicsWorker.js');
   proxy={onmessage:null,onerror:null,onmessageerror:null,
    postMessage:(message,transfer)=>native.postMessage(message,transfer),terminate:()=>native.terminate()};
   native.onmessage=e=>e.data.type==='result'?held.push(()=>proxy.onmessage?.(e)):proxy.onmessage?.(e);
   native.onerror=e=>proxy.onerror?.(e);native.onmessageerror=e=>proxy.onmessageerror?.(e);
   return proxy;
  }
  function model(i) {
   const parser=new Parser(),buffer=new Uint8Array(fixture.bytes).buffer;
   const data=fixture.format==='pmd'?parser.parsePmd(buffer,true):parser.parsePmx(buffer,true);
   const loader=new MMDLoader();loader.meshBuilder.materialBuilder.textureLoader.load=()=>new Texture();
   const mesh=loader.meshBuilder.build(data,'');mesh.position.z=i*20;return mesh;
  }
  const helper=new MMDAnimationHelper({sync:false}),sync=new MMDAnimationHelper({sync:false});helper.sharedPhysics=sync.sharedPhysics=true;
  const models=[model(0),model(1)],refs=[model(0),model(1)];
  const params={unitStep:override,maxStepNum:cap,warmup:0,animationWarmup:false,gravity:new Vector3(0,0,10)};
  for(let i=0;i<2;i++) {
   helper.add(models[i],{...params,physicsMode:'worker',workerPhysics:{ammoURL,createWorker}});
   sync.add(refs[i],params);
  }
  const physics=models.map(m=>helper.objects.get(m).physics),native=refs.map(m=>sync.objects.get(m).physics);
  try {
   await Promise.all(physics.map(p=>p.ready));
   check(key+' transport',physics.every(p=>p.physicsMode==='worker' && p.transport===(crossOriginIsolated?'shared':'transferable')));
   check(key+' shared world',physics[0].workerAdapter.group===physics[1].workerAdapter.group);
   check(key+' cap and timestep',physics.every(p=>p.maxStepNum===(cap??10) && p.unitStep===h && p.workerAdapter.model.unitStep===h));
   const initialZ=physics.map(p=>p.bodyResults[2].position[2]);
   let steps=0,elapsed=0,sequence=0,currentY=0;
   for(const driver of [helper,sync])driver.onBeforePhysics=mesh=>{mesh.skeleton.bones[0].position.y=currentY;mesh.updateMatrixWorld(true);};
   async function finish(delta) {
    const deadline=performance.now()+8000;
    while(!held.length) {if(performance.now()>deadline)throw new Error('Worker result timeout');await wait();}
    held.shift()();sequence++;
    check(key+' publication '+sequence,physics.every(p=>p.workerStatus.completedSequence===sequence));
    let completed;
    const world=native[0].world,step=world.stepSimulation;
    world.stepSimulation=function(...args) {const requested=step.apply(this,args);completed=Math.min(requested,args[1]);return requested;};
    try {sync.update(delta);}finally {world.stepSimulation=step;}
    steps+=completed;elapsed+=delta;
    check(key+' elapsed '+sequence,steps*h<=elapsed+2e-6 && completed<=(cap??10));
    for(let i=0;i<2;i++) {
     physics[i].workerAdapter.project();
     check(key+' clock '+sequence+' model '+i,Math.abs(physics[i].bodyResults[2].position[2]-initialZ[i]-10*h*h*steps*(steps+1)/2)<5e-4);
     check(key+' native parity '+sequence+' model '+i,near(physics[i].bodyResults.flatMap(r=>r.position.concat(r.quaternion)),native[i].bodyResults.flatMap(r=>r.position.concat(r.quaternion))));
     check(key+' skeletal boundary '+sequence+' model '+i,models[i].skeleton.bones.every((b,j)=>near(b.position.toArray().concat(b.quaternion.toArray()),refs[i].skeleton.bones[j].position.toArray().concat(refs[i].skeleton.bones[j].quaternion.toArray()))));
    }
    return completed;
   }
   for(const delta of [1/144,1/120,1/60,1/30,0.05,0.1,0.25,1/120]) {
    currentY+=0.001;helper.update(delta);
    const completed=await finish(delta);
    if(delta===1/144)check(key+' zero substeps',completed===0);
    if(delta===0.1)check(key+' 100ms',cap===3?completed===3:completed>=6 && completed<=7);
    if(delta===0.25)check(key+' long bound',completed===(cap??10));
   }
   for(const batch of [0.1,0.25]) {
    helper.update(h);
    const before=JSON.stringify(physics.map(p=>p.bodyResults));
    if(batch===0.1)for(let i=0;i<3;i++)helper.update(0.03);
    else for(let i=0;i<20;i++)helper.update(1/60);
    check(key+' delayed '+batch,JSON.stringify(physics.map(p=>p.bodyResults))===before);
    await finish(h);
    helper.update(batch===0.1?0.01:1/60);
    const completed=await finish(batch);
    check(key+' batched '+batch,batch===0.1 && cap===undefined?completed>=6 && completed<=7:completed===(cap??10));
   }
  } finally {for(const mesh of models)helper.remove(mesh);for(const mesh of refs)sync.remove(mesh);}
 }
 document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({checks,isolated:crossOriginIsolated}));
} catch(error) {document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({error:String(error),checks}));}
</script>`;

for ( const isolated of [ false, true ] ) test( `bundled Worker native substeps and bounded batching, isolation=${isolated}`, { timeout: 60000 }, async () => {

	const profile = await mkdtemp( join( tmpdir(), 'mmd-substeps-browser-' ) );
	const files = createExamplesServer();
	const server = createServer( ( request, response ) => {

		if ( isolated ) { response.setHeader( 'Cross-Origin-Opener-Policy', 'same-origin' ); response.setHeader( 'Cross-Origin-Embedder-Policy', 'require-corp' ); }
		if ( request.url === '/substeps-test' ) response.writeHead( 200, { 'Content-Type': 'text/html' } ).end( harness );
		else files.emit( 'request', request, response );

	} );
	await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
	try {

		const address = server.address(); assert.ok( address && typeof address !== 'string' );
		const result = await runBrowser<{ error?: string; checks: Record<string, boolean>; isolated: boolean }>( `http://127.0.0.1:${address.port}/substeps-test`, profile );
		assert.equal( result.error, undefined, JSON.stringify( result ) );
		assert.equal( result.isolated, isolated );
		assert.ok( Object.keys( result.checks ).length > 200 );
		assert.ok( Object.values( result.checks ).every( Boolean ) );

	} finally { await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( profile ); }

} );
