import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createExamplesServer } from '../../scripts/serve-examples.ts';
import { rotationPhysicsBuffer } from '../fixtures.ts';
import { reflectedRotation, rotationCases } from '../rotation-reference.ts';
import { removeBrowserDirectory, runBrowser } from './browser.ts';

const fixtures = ( [ 'pmd', 'pmx' ] as const ).flatMap( format => [ 1, 2 ].flatMap( type => rotationCases.map( fixture => ( {
	format, type, name: fixture.name, rotation: reflectedRotation( fixture.angles ).toArray(),
	jointRotation: reflectedRotation( fixture.angles ).toArray(),
	bytes: Array.from( new Uint8Array( rotationPhysicsBuffer( format, fixture.angles, type, true, fixture.angles ) ) )
} ) ) ) );
const harness = `<!doctype html><pre id="result">pending</pre>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/tsl":"/node_modules/three/build/three.tsl.js","three/webgpu":"/node_modules/three/build/three.webgpu.js","three/addons/":"/node_modules/three/examples/jsm/","mmd-parser":"/node_modules/mmd-parser/build/mmdparser.module.mjs"}}</script>
<script type="module">
import { ammoURL, initializeAmmoWasm } from "/examples/ammo-runtime.js";
import { Parser } from 'mmd-parser';
import { Matrix4, Quaternion, Texture, Vector3 } from 'three';
import { MMDLoader } from '/src/index.js';
import { MMDPhysics } from '/src/animation/MMDPhysics.js';
const checks={};let key='';
function check(name,value) {if(!value)throw new Error(key+' '+name);checks[key+' '+name]=true;}
function near(a,b) {return a.elements.every((v,i)=>Math.abs(v-b.elements[i])<5e-4);}
function matrix(pose) {return new Matrix4().compose(new Vector3().fromArray(pose.position),new Quaternion().fromArray(pose.quaternion),new Vector3(1,1,1));}
function nativeMatrix(form) {
 const p=form.getOrigin(),q=form.getRotation();
 return matrix({position:[p.x(),p.y(),p.z()],quaternion:[q.x(),q.y(),q.z(),q.w()]});
}
const wait=()=>new Promise(resolve=>setTimeout(resolve,2));
try {
 globalThis.Ammo=await initializeAmmoWasm();
 for(const fixture of ${JSON.stringify( fixtures )}) for(const count of [1,2]) {
  key=fixture.format+' type='+fixture.type+' '+fixture.name+' models='+count;
  const refs=[],workers=[],meshes=[],held=[];let proxy;
  const NativeConstraint=Ammo.btGeneric6DofSpringConstraint;
  // Independent main-thread native reference: scalar Ry*Rx*Rz was computed
  // outside this browser from binary angles after handedness conversion.
  // The real Worker constructs its frames through production MMDPhysics.
  Ammo.btGeneric6DofSpringConstraint=class extends NativeConstraint {
   constructor(a,b,actualA,actualB,useA) {
    const joint=new Matrix4().fromArray(fixture.jointRotation).setPosition(Math.fround(0.4),Math.fround(0.3),-Math.fround(-0.2));
    const forms=[a,b].map((body,i)=>{
     const world=nativeMatrix(body.getCenterOfMassTransform());
     const local=world.invert().multiply(joint),actual=i===0?actualA:actualB;
     check('local joint frame '+refs.length+','+i,near(nativeMatrix(actual),local));
     const form=new Ammo.btTransform(),q=new Quaternion().setFromRotationMatrix(local),nativeQ=new Ammo.btQuaternion(q.x,q.y,q.z,q.w);
     form.setIdentity();form.getOrigin().setValue(local.elements[12],local.elements[13],local.elements[14]);form.setRotation(nativeQ);Ammo.destroy(nativeQ);return form;
    });
    super(a,b,forms[0],forms[1],useA);forms.forEach(form=>Ammo.destroy(form));
   }
  };
  function createWorker() {
   const native=new Worker('/src/animation/MMDPhysicsWorker.js');
   proxy={onmessage:null,onerror:null,onmessageerror:null,postMessage:(m,t)=>native.postMessage(m,t),terminate:()=>native.terminate()};
   native.onmessage=e=>e.data.type==='result'?held.push(()=>proxy.onmessage?.(e)):proxy.onmessage?.(e);
   native.onerror=e=>proxy.onerror?.(e);native.onmessageerror=e=>proxy.onmessageerror?.(e);return proxy;
  }
  function model(i) {
   const parser=new Parser(),buffer=new Uint8Array(fixture.bytes).buffer;
   const data=fixture.format==='pmd'?parser.parsePmd(buffer,true):parser.parsePmx(buffer,true);
   const loader=new MMDLoader();loader.meshBuilder.materialBuilder.textureLoader.load=()=>new Texture();
   const mesh=loader.meshBuilder.build(data,'');
   const joint=mesh.geometry.userData.MMD.constraints[0];
   joint.translationLimitation1=[-0.15,-0.07,-0.03];joint.translationLimitation2=[0.15,0.07,0.03];
   joint.rotationLimitation1=[-0.1,-0.2,-0.3];joint.rotationLimitation2=[0.1,0.2,0.3];
   joint.springPosition=[3,5,7];joint.springRotation=[2,4,6];
   mesh.position.z=i*10;mesh.updateMatrixWorld(true);meshes.push(mesh);return mesh;
  }
  function add(list,i,worker) {
   const mesh=model(i),meta=mesh.geometry.userData.MMD;
   list.push(new MMDPhysics(mesh,meta.rigidBodies,meta.constraints,{gravity:new Vector3(2,-5,3),world:worker?undefined:list[0]?.world,
    physicsMode:worker?'worker':'sync',workerPhysics:{ammoURL,createWorker}},worker?list[0]?.workerAdapter.group:undefined));
  }
  async function finish() {
   const deadline=performance.now()+8000;while(!held.length) {if(performance.now()>deadline)throw new Error(key+' result timeout');await wait();}
   held.shift()();for(const p of workers)p.workerAdapter.project();
  }
  function stepSync(delta) {
   for(const p of refs)p._updateRigidBodies();refs[0]._stepSimulation(delta);
   for(const p of refs) {p._captureBodyResults('step');p._updateBones();}
  }
  function parity(stage) {
   for(let i=0;i<count;i++)for(let b=0;b<2;b++) {
    check(stage+' raw '+i+','+b,near(matrix(workers[i].bodyResults[b]),matrix(refs[i].bodyResults[b])));
    check(stage+' bone '+i+','+b,near(workers[i].mesh.skeleton.bones[b].matrixWorld,refs[i].mesh.skeleton.bones[b].matrixWorld));
    if(b===1) {
     const p=workers[i],offset=new Matrix4().fromArray(fixture.rotation).setPosition(new Vector3().fromArray(p.workerAdapter.model.bodies[b].position));
     const expected=matrix(p.bodyResults[b]).multiply(offset.invert()),bone=p.mesh.skeleton.bones[b];
     if(fixture.type===2)expected.setPosition(bone.getWorldPosition(new Vector3()));
     check(stage+' independent projection '+i,near(bone.matrixWorld,expected));
    }
   }
  }
  try {
   for(let i=0;i<count;i++) {add(refs,i,false);add(workers,i,true);}
   await Promise.all(workers.map(p=>p.ready));
   check('transport',workers.every(p=>p.physicsMode==='worker' && p.transport===(crossOriginIsolated?'shared':'transferable')));
   if(count===2)check('shared world',workers[0].workerAdapter.group===workers[1].workerAdapter.group && refs[0].world===refs[1].world);
   for(const phase of ['initial','rotated reset']) {
    for(const list of [refs,workers])for(const p of list) {
     if(phase==='rotated reset') {
      p.mesh.skeleton.bones[0].quaternion.setFromAxisAngle(new Vector3(1,2,3).normalize(),0.53);
      p.mesh.skeleton.bones[1].quaternion.setFromAxisAngle(new Vector3(-2,1,1).normalize(),-0.39);
      p.mesh.updateMatrixWorld(true);
     }
     p.reset();
    }
    // Main-thread initialization/reset and real Worker-native publication must
    // independently match bone-world times the reflected matrix reference.
    const expected=workers.map(p=>p.mesh.skeleton.bones.map((bone,b)=>bone.matrixWorld.clone().multiply(new Matrix4().fromArray(fixture.rotation).setPosition(new Vector3().fromArray(p.workerAdapter.model.bodies[b].position)))));
    for(let i=0;i<count;i++)for(let b=0;b<2;b++)check(phase+' stored '+i+','+b,near(matrix(workers[i].bodyResults[b]),expected[i][b]));
    workers[0].workerAdapter.group.update(0);await finish();
    for(let i=0;i<count;i++)for(let b=0;b<2;b++)check(phase+' native reference '+i+','+b,near(matrix(workers[i].bodyResults[b]),expected[i][b]));
    parity(phase);
   }
   // Real constrained mixed-axis motion, with identical skeletal input poses.
   for(let frame=0;frame<6;frame++) {
    for(const list of [refs,workers])for(const p of list) {
     p.mesh.skeleton.bones[0].position.x=frame*0.002;
     p.mesh.skeleton.bones[0].quaternion.setFromAxisAngle(new Vector3(1,2,-1).normalize(),frame*0.003);p.mesh.updateMatrixWorld(true);
    }
    workers[0].workerAdapter.group.update(1/60);stepSync(1/60);await finish();parity('motion '+frame);
   }
   // Reset the same authored pose before warmup, independent of display lag.
   for(const list of [refs,workers])for(const p of list) {p.mesh.skeleton.pose();p.mesh.updateMatrixWorld(true);p.reset();}
   workers[0].workerAdapter.group.update(0);await finish();
   workers[0].warmup(2);
   // Capture every shared Sync model at the same step boundary as each
   // Worker publication during warmup; dynamic projection never writes bodies.
   for(let frame=0;frame<2;frame++) {stepSync(1/60);await finish();}
   parity('warmup');
  } finally {Ammo.btGeneric6DofSpringConstraint=NativeConstraint;for(const p of [...workers,...refs])p.dispose();for(const mesh of meshes) {mesh.geometry.dispose();mesh.skeleton.dispose();}}
 }
 document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({checks,isolated:crossOriginIsolated}));
} catch(error) {document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({error:String(error),checks}));}
</script>`;

for ( const isolated of [ false, true ] ) test( `YXZ real bundled Worker body/joint frames, independent native trajectories, reset and warmup, isolation=${isolated}`, { timeout: 60000 }, async () => {

	const profile = await mkdtemp( join( tmpdir(), 'mmd-rotation-browser-' ) ), files = createExamplesServer();
	const server = createServer( ( request, response ) => {

		if ( isolated ) { response.setHeader( 'Cross-Origin-Opener-Policy', 'same-origin' ); response.setHeader( 'Cross-Origin-Embedder-Policy', 'require-corp' ); }
		if ( request.url === '/rotation-test' ) response.writeHead( 200, { 'Content-Type': 'text/html' } ).end( harness );
		else files.emit( 'request', request, response );

	} );
	await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
	try {

		const address = server.address(); assert.ok( address && typeof address !== 'string' );
		const result = await runBrowser<{ error?: string; checks: Record<string, boolean>; isolated: boolean }>( `http://127.0.0.1:${address.port}/rotation-test`, profile );
		assert.equal( result.error, undefined, result.error ); assert.equal( result.isolated, isolated );
		assert.ok( Object.keys( result.checks ).length > 5000 ); assert.ok( Object.values( result.checks ).every( Boolean ) );

	} finally { await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( profile ); }

} );
