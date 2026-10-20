import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createExamplesServer } from '../../scripts/serve-examples.ts';
import { linkedCollisionBuffer } from '../fixtures.ts';
import { removeBrowserDirectory, runBrowser } from './browser.ts';

const fixtures = ( [ 'pmd', 'pmx' ] as const ).map( format => ( { format, bytes: Array.from( new Uint8Array( linkedCollisionBuffer( format, { masks: [ 0, 0 ], timeProbe: true } ) ) ) } ) );
// Observe the real binding inside each realm. These wrappers call through to
// native Bullet; neither transforms nor step counts are simulated by the test.
const instrumentation = `
Ammo=(factory=>async options=>{
 const A=await factory(options),Body=A.btRigidBody,World=A.btDiscreteDynamicsWorld;
 const evidence=globalThis.motionEvidence={calls:0,steps:0,zero:0,moving:0,resets:0};
 const xyz=v=>[v.x(),v.y(),v.z()];
 const pose=t=>{const q=t.getRotation();return xyz(t.getOrigin()).concat(q.x(),q.y(),q.z(),q.w());};
 function near(a,b){if(a.some((v,i)=>!Number.isFinite(v)||Math.abs(v-b[i])>5e-4))throw new Error('native MotionState mismatch: '+a+' != '+b);}
 A.btRigidBody=class extends Body {
  constructor(info){super(info);this.comWrites=0;this.resets=0;}
  setCenterOfMassTransform(t){this.comWrites++;super.setCenterOfMassTransform(t);}
  setInterpolationWorldTransform(t){this.resets++;evidence.resets++;super.setInterpolationWorldTransform(t);}
 };
 A.btDiscreteDynamicsWorld=class extends World {
  constructor(...args){super(...args);this.bodies=new Set();}
  addRigidBody(body,...args){this.bodies.add(body);super.addRigidBody(body,...args);}
  removeRigidBody(body){this.bodies.delete(body);super.removeRigidBody(body);}
  stepSimulation(delta,budget,h){
   const snapshots=[...this.bodies].map(b=>{
    const t=new A.btTransform();b.getMotionState().getWorldTransform(t);const staged=pose(t);A.destroy(t);
    const kinematic=!!(b.getCollisionFlags()&2);
    if(kinematic && b.comWrites!==b.resets)throw new Error('per-render kinematic COM write');
    return {b,staged,kinematic,before:pose(b.getCenterOfMassTransform()),velocity:xyz(b.getLinearVelocity()).concat(xyz(b.getAngularVelocity()))};
   });
   const requested=super.stepSimulation(delta,budget,h),count=Math.min(requested,budget);
   evidence.calls++;evidence.steps+=count;if(!count)evidence.zero++;
   for(const {b,staged,kinematic,before,velocity} of snapshots){
    const after=pose(b.getCenterOfMassTransform());
    if(kinematic){
     near(after,count?staged:before);
     const t=new A.btTransform();b.getMotionState().getWorldTransform(t);near(pose(t),staged);A.destroy(t);
     if(count){near(xyz(b.getLinearVelocity()),after.slice(0,3).map((v,i)=>(v-before[i])/(count*h)));if(Math.hypot(...xyz(b.getLinearVelocity()))>0.01)evidence.moving++;}
     else near(xyz(b.getLinearVelocity()).concat(xyz(b.getAngularVelocity())),velocity);
    }else if(!count)near(after,before);
    if(after.concat(xyz(b.getLinearVelocity()),xyz(b.getAngularVelocity())).some(v=>!Number.isFinite(v)))throw new Error('nonfinite native physics');
   }
   if(typeof document==='undefined')postMessage({type:'motion-evidence',evidence});
   return requested;
  }
 };
 return A;
})(Ammo);`;

const harness = `<!doctype html><pre id="result">pending</pre>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/tsl":"/node_modules/three/build/three.tsl.js","three/webgpu":"/node_modules/three/build/three.webgpu.js","three/addons/":"/node_modules/three/examples/jsm/","mmd-parser":"/node_modules/mmd-parser/build/mmdparser.module.mjs"}}</script>
<script type="module">
import { ammoURL, initializeAmmoWasm } from '/examples/ammo-runtime.js';
import { Texture, Vector3 } from 'three';
import { Parser } from 'mmd-parser';
import { MMDAnimationHelper,MMDLoader } from '/src/index.js';
const checks={};function check(name,value){if(!value)throw new Error(name);checks[name]=true;}
const wait=()=>new Promise(r=>setTimeout(r,1));
try{
 globalThis.Ammo=await initializeAmmoWasm();
 check('pinned native binding',Ammo.bulletCommit==='d3afe76132fc76b0f9b2359cbaef47a3766e7fbb' && typeof Ammo.getWasmExports().emscripten_bind_btMotionState_setWorldTransform_1==='function');
 for(const fixture of ${JSON.stringify( fixtures )})for(const post of fixture.format==='pmx'?[false,true]:[false])for(const fps of [60,120,144,'nonuniform']){
  const key=fixture.format+' post='+post+' fps='+fps;
  let workerEvidence,reason='';
  function createWorker(){
   const native=new Worker('/src/animation/MMDPhysicsWorker.js');
   const proxy={onmessage:null,onerror:null,onmessageerror:null,postMessage:(m,t)=>native.postMessage(m,t),terminate:()=>native.terminate()};
   native.onmessage=e=>{if(e.data.type==='motion-evidence')workerEvidence=e.data.evidence;else proxy.onmessage?.(e);};
   native.onerror=e=>proxy.onerror?.(e);native.onmessageerror=e=>proxy.onmessageerror?.(e);return proxy;
  }
  function model(i){
   const parser=new Parser(),buffer=new Uint8Array(fixture.bytes).buffer;
   const data=fixture.format==='pmd'?parser.parsePmd(buffer,true):parser.parsePmx(buffer,true);
   if(post)data.bones[0].flag|=0x1000;
   const loader=new MMDLoader();loader.meshBuilder.materialBuilder.textureLoader.load=()=>new Texture();
   const mesh=loader.meshBuilder.build(data,'');mesh.position.z=i*20;return mesh;
  }
  const sync=new MMDAnimationHelper({sync:false}),worker=new MMDAnimationHelper({sync:false});sync.sharedPhysics=worker.sharedPhysics=true;
  const refs=[model(0),model(1)],models=[model(0),model(1)],params={warmup:0,animationWarmup:false,gravity:new Vector3(0,0,10)};
  for(let i=0;i<2;i++){sync.add(refs[i],params);worker.add(models[i],{...params,physicsMode:'worker',workerPhysics:{ammoURL,createWorker,onFallback:r=>reason=r}});}
  const native=refs.map(m=>sync.objects.get(m).physics),physics=models.map(m=>worker.objects.get(m).physics);
  try{
   await Promise.all(physics.map(p=>p.ready));
   check(key+' transport '+reason,physics.every(p=>p.physicsMode==='worker' && p.transport===(crossOriginIsolated?'shared':'transferable')));
   let sequence=0,elapsed=0;
   async function advance(delta){
    sync.update(delta);worker.update(delta);sequence++;
    const deadline=performance.now()+8000;
    while(physics[0].workerStatus?.completedSequence<sequence){if(physics[0].physicsMode!=='worker'||performance.now()>deadline)throw new Error('Worker did not complete '+key);await wait();}
    for(let i=0;i<2;i++){
     const a=physics[i].bodyResults.flatMap(r=>r.position.concat(r.quaternion)),b=native[i].bodyResults.flatMap(r=>r.position.concat(r.quaternion));
     const mismatch=a.findIndex((v,j)=>!Number.isFinite(v)||Math.abs(v-b[j])>=5e-4);
     if(mismatch!==-1)throw new Error(key+' parity '+sequence+' index='+mismatch+' worker='+a[mismatch]+' sync='+b[mismatch]);
     check(key+' parity '+sequence,true);
     physics[i].workerAdapter.project();
    }
    if(fixture.format==='pmx'){sync.update(0);worker.update(0);}
   }
   await advance(1/240);
   const initialZ=physics.map(p=>p.bodyResults[2].position[2]),beforeSteps=workerEvidence.steps;
   check(key+' first zero step',beforeSteps===0 && workerEvidence.zero===1);
   const deltas=Array.from({length:fps==='nonuniform'?120:fps},(_,i)=>fps==='nonuniform'?(i%2===0?1/480:7/480):1/fps);
   for(const delta of deltas){
    elapsed+=delta;
    for(const mesh of refs.concat(models)){mesh.skeleton.bones[0].position.y=elapsed*0.2;mesh.skeleton.bones[0].quaternion.setFromAxisAngle(new Vector3(0,0,1),elapsed*0.1);mesh.updateMatrixWorld(true);}
    await advance(delta);
    const n=workerEvidence.steps;
    check(key+' elapsed '+sequence,n/60<=elapsed+1/240+2e-6 && elapsed+1/240-n/60<1/60+2e-6);
    check(key+' native clock '+sequence,physics.every((p,i)=>Math.abs(p.bodyResults[2].position[2]-initialZ[i]-10/3600*n*(n+1)/2)<5e-4));
   }
   check(key+' 60 physical steps',workerEvidence.steps===60 && workerEvidence.moving>0 && workerEvidence.zero>0);
   check(key+' constraint',physics.every(p=>p.bodyResults[1].position[1]>0.1));
   // Loop/seek/reset and warmup are deliberate teleports. The instrumentation
   // requires each native COM write to have a matching interpolation reset.
   for(const driver of [sync,worker])for(const mesh of driver.meshes){
    // Supply the same authored pose at the synthetic loop boundary, as an
    // animation track would. Delayed dynamic display is not authored input.
    mesh.skeleton.bones[1].position.set(0,1,0);mesh.skeleton.bones[1].quaternion.identity();mesh.updateMatrixWorld(true);
    driver.objects.get(mesh).looped=true;
   }
   await advance(1/240);
   for(const p of native.concat(physics))p.reset();
   await advance(1/240);
   physics[0].warmup(3);native[0].warmup(3);
   const deadline=performance.now()+8000;
   while(physics[0].workerStatus.inFlight||physics[0].workerStatus.warmupRemaining){if(performance.now()>deadline)throw new Error('warmup timeout');await wait();}
   check(key+' resets and warmup',workerEvidence.resets>=18 && workerEvidence.steps>=63);
  }finally{for(const m of models)worker.remove(m);for(const m of refs)sync.remove(m);}
 }
 document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({checks,evidence:motionEvidence,isolated:crossOriginIsolated}));
}catch(error){document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({error:String(error),checks}));}
</script>`;

for ( const isolated of [ false, true ] ) test( `real browser MotionState input and bundled Worker, isolation=${isolated}`, { timeout: 60000 }, async () => {

	const profile = await mkdtemp( join( tmpdir(), 'mmd-motion-state-browser-' ) );
	const files = createExamplesServer();
	const glue = await readFile( new URL( '../../examples/vendor/bullet/ammo.js', import.meta.url ), 'utf8' );
	const server = createServer( ( request, response ) => {

		if ( isolated ) { response.setHeader( 'Cross-Origin-Opener-Policy', 'same-origin' ); response.setHeader( 'Cross-Origin-Embedder-Policy', 'require-corp' ); }
		if ( request.url === '/motion-test' ) response.writeHead( 200, { 'Content-Type': 'text/html' } ).end( harness );
		else if ( request.url === '/examples/vendor/bullet/ammo.js' ) response.writeHead( 200, { 'Content-Type': 'text/javascript' } ).end( glue + instrumentation );
		else files.emit( 'request', request, response );

	} );
	await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
	try {

		const address = server.address(); assert.ok( address && typeof address !== 'string' );
		const result = await runBrowser<{ error?: string; isolated: boolean; checks: Record<string, boolean>; evidence: { moving: number; zero: number } }>( `http://127.0.0.1:${address.port}/motion-test`, profile );
		assert.equal( result.error, undefined, JSON.stringify( { error: result.error, lastChecks: Object.keys( result.checks ).slice( -5 ) } ) ); assert.equal( result.isolated, isolated );
		assert.ok( Object.keys( result.checks ).length > 1000 ); assert.ok( Object.values( result.checks ).every( Boolean ) );
		assert.ok( result.evidence.moving > 0 && result.evidence.zero > 0 );

	} finally { await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( profile ); }

} );
