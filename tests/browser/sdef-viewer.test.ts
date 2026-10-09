import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSdefServer } from '../../scripts/serve-sdef.ts';
import { sdefPmxBuffer, materialPmxBuffer, vmdBuffer } from '../fixtures.ts';
import { referenceGroupPose } from '../group-morph-reference.ts';
import { referenceBonePose } from '../bone-morph-reference.ts';
import { removeBrowserDirectory, runBrowser } from './browser.ts';

test( 'private viewer loads generated PMX with MMDLoader and exposes bend and comparison controls', { timeout: 60000 }, async () => {

	const directory = await mkdtemp( join( tmpdir(), 'mmd-local-viewer-browser-' ) );
	const profile = await mkdtemp( join( tmpdir(), 'mmd-local-viewer-profile-' ) );
	await writeFile( join( directory, 'model.pmx' ), Buffer.from( sdefPmxBuffer() ) );
	const local = createSdefServer( { privateDirectory: directory } );
	const html = await readFile( new URL( '../../local-viewer/index.html', import.meta.url ), 'utf8' ) + `
<pre id="result">pending</pre><script type="module">
const errors=[];console.error=(...args)=>errors.push(args.map(String).join(' '));
const result=document.getElementById('result');
window.addEventListener('unhandledrejection',event=>{result.textContent=encodeURIComponent(JSON.stringify({error:String(event.reason)}));});
async function until(check) { const start=performance.now();while(!check()){if(performance.now()-start>15000)throw new Error('viewer timed out: '+document.getElementById('status').textContent);await new Promise(resolve=>setTimeout(resolve,30));} }
try {
 await until(()=>document.getElementById('load').onclick);
 document.getElementById('load').click();
 await until(()=>document.getElementById('status').textContent.includes('9 SDEF vertices'));
 const status=document.getElementById('status');const bone=document.getElementById('bone');
 if(bone.options.length!==4)throw new Error('bone controls absent');
 bone.value='0';bone.dispatchEvent(new Event('change'));
 const bend=document.getElementById('bend');bend.value='75';bend.dispatchEvent(new Event('input'));
 if(!status.textContent.includes('Bending bone0')||document.getElementById('degrees').textContent!=='75°')throw new Error('bend control disconnected');
 const compare=document.getElementById('bdef');compare.checked=true;compare.dispatchEvent(new Event('change'));
 if(!status.textContent.includes('BDEF2 comparison'))throw new Error('comparison control disconnected');
 document.getElementById('reset').click();
 if(bend.value!=='0')throw new Error('reset disconnected');
 await new Promise(resolve=>setTimeout(resolve,300));
 result.textContent=encodeURIComponent(JSON.stringify({count:9,bones:bone.options.length,errors}));
} catch(error) {result.textContent=encodeURIComponent(JSON.stringify({error:error.stack||String(error)}));}
</script>`;
	const server = createServer( ( request, response ) => {

		if ( request.url?.startsWith( '/local-sdef/?' ) ) { response.setHeader( 'Content-Type', 'text/html' ); response.end( html ); }
		else local.emit( 'request', request, response );

	} );
	try {

		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const result = await runBrowser<{ error?: string; count: number; bones: number; errors: string[] }>( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/local-sdef/?webgl`, profile );
		assert.equal( result.error, undefined, result.error );
		assert.equal( result.count, 9 ); assert.equal( result.bones, 4 ); assert.deepEqual( result.errors, [] );

	} finally {

		await new Promise( resolve => server.close( resolve ) );
		await rm( directory, { recursive: true, force: true } ); await removeBrowserDirectory( profile );

	}

} );


test( 'private group/bone viewer enumerates parsed links, loads textures/VMD, controls weights and diagnoses absent morphs', { timeout: 60000 }, async () => {

	const directory = await mkdtemp( join( tmpdir(), 'mmd-bone-viewer-' ) );
	const profile = await mkdtemp( join( tmpdir(), 'mmd-bone-viewer-profile-' ) );
	await mkdir( join( directory, 'umbrella/tex' ), { recursive: true } );
	await writeFile( join( directory, 'umbrella/傘.pmx' ), Buffer.from( sdefPmxBuffer( { groupMorphs: true, texturePath: 'tex/色.png' } ) ) );
	await writeFile( join( directory, 'material.pmx' ), Buffer.from( materialPmxBuffer() ) );
	await writeFile( join( directory, 'shared.png' ), Buffer.from( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64' ) );
	await writeFile( join( directory, 'material.vmd' ), Buffer.from( vmdBuffer( { morphs: [ { morphName: 'multiply-all', frameNum: 0, weight: 0 }, { morphName: 'multiply-all', frameNum: 30, weight: 1 } ] } ) ) );
	await writeFile( join( directory, 'empty.pmx' ), Buffer.from( sdefPmxBuffer() ) );
	await writeFile( join( directory, 'umbrella/tex/色.png' ), Buffer.from( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64' ) );
	await writeFile( join( directory, 'group.vmd' ), Buffer.from( vmdBuffer( { boneName: 'bone0', morphs: [ { morphName: 'mixed-group', frameNum: 0, weight: 0 }, { morphName: 'mixed-group', frameNum: 30, weight: 1 } ] } ) ) );
	const local = createSdefServer( { boneMorphDirectory: directory, groupMorphDirectory: directory, materialMorphDirectory: directory } );
	const html = await readFile( new URL( '../../local-viewer/index.html', import.meta.url ), 'utf8' ) + `
<pre id="result">pending</pre><script type="module">
import {MMDAnimationHelper} from 'three-mmd-loader';
const result=document.getElementById('result'),errors=[];console.error=(...args)=>errors.push(args.map(String).join(' '));
let mesh;const original=MMDAnimationHelper.prototype.update;
MMDAnimationHelper.prototype.update=function(delta){const value=original.call(this,delta);mesh=this.meshes[0];return value;};
async function until(check){const start=performance.now();while(!check()){if(performance.now()-start>15000)throw new Error('viewer timed out: '+document.getElementById('status').textContent);await new Promise(resolve=>setTimeout(resolve,30));}}
function check(value,message){if(!value)throw new Error(message);}
try {
 await until(()=>document.getElementById('load').onclick);
 document.getElementById('asset-directory').value='group-morph';
 document.getElementById('model').value='umbrella/傘.pmx';document.getElementById('load').click();
 await until(()=>mesh?.geometry.userData.MMD.boneMorphs?.length===3);
 const select=document.getElementById('morph'),weight=document.getElementById('weight'),info=document.getElementById('morph-info');
 check(select.options.length===3 && !weight.disabled,'type 2 selection missing');
 check(info.textContent.includes('bone-a') && info.textContent.includes('bone-b') && info.textContent.includes('Bone 1: bone1') && info.textContent.includes('translation:') && info.textContent.includes('rotation (xyzw):'),'actual payload report missing');
 await until(()=>mesh.material[0].map?.image?.width===1);
 const group=document.getElementById('group'),groupWeight=document.getElementById('group-weight'),target=document.getElementById('group-target'),targetWeight=document.getElementById('target-weight'),groupInfo=document.getElementById('group-info');
 check(group.options.length===6 && !groupWeight.disabled,'group controls absent');
 check(groupInfo.textContent.includes('mixed-group') && groupInfo.textContent.includes('type 2') && groupInfo.textContent.includes('ratio 0.25') && groupInfo.textContent.includes('Bone 1: bone1') && groupInfo.querySelector('.bone-link'),'group metadata/highlights absent');
 group.value='6';group.dispatchEvent(new Event('change'));check(target.options.length===3,'shared targets not deduplicated');
 for(const value of [0,0.5,1,0]) {
  groupWeight.value=String(value);groupWeight.dispatchEvent(new Event('input'));
  await new Promise(resolve=>setTimeout(resolve,40));
  check(Math.abs(mesh.skeleton.bones[0].position.x-(0.3*0.375-0.15*0.5)*value)<1e-6,'group slider disconnected or drifting');
  check(mesh.morphTargetInfluences[1]===0,'public direct weight overwritten');
 }
 groupWeight.value='0.5';groupWeight.dispatchEvent(new Event('input'));
 target.value='1';target.dispatchEvent(new Event('change'));targetWeight.value='0.25';targetWeight.dispatchEvent(new Event('input'));
 await new Promise(resolve=>setTimeout(resolve,100));
 const groupExpected=${JSON.stringify( referenceGroupPose( [ 0, 0.25, 0, 0, 0, 0, 0.5 ] ) )};
 mesh.skeleton.bones.forEach((bone,i)=>bone.position.toArray().forEach((v,c)=>check(Math.abs(v-groupExpected[i].position[c])<1e-6,'group plus direct comparison wrong')));
 document.getElementById('reset').click();check(mesh.morphTargetInfluences.every(v=>v===0),'group reset failed');
 document.getElementById('motion').value='group.vmd';document.getElementById('play').click();
 await until(()=>mesh.morphTargetInfluences[6]>0.05);check(groupInfo.textContent.includes('weight 0.'),'group VMD diagnostics absent');
 document.getElementById('stop').click();check(mesh.morphTargetInfluences.every(v=>v===0),'group VMD stop failed');
 const expected=${JSON.stringify( referenceBonePose( [ 0.5, 0.75, 0 ] ) )};
 select.value='1';select.dispatchEvent(new Event('change'));weight.value='0.5';weight.dispatchEvent(new Event('input'));
 select.value='2';select.dispatchEvent(new Event('change'));weight.value='0.75';weight.dispatchEvent(new Event('input'));
 await new Promise(resolve=>setTimeout(resolve,150));
 mesh.skeleton.bones.forEach((bone,i)=>{bone.position.toArray().forEach((v,c)=>check(Math.abs(v-expected[i].position[c])<1e-6,'viewer translation wrong'));const q=bone.quaternion.toArray(),dot=q.reduce((sum,v,c)=>sum+v*expected[i].rotation[c],0);q.forEach((v,c)=>check(Math.abs(v-expected[i].rotation[c]*(dot<0?-1:1))<1e-6,'viewer rotation wrong'));});
 check(info.textContent.includes('weight 0.50') && info.textContent.includes('weight 0.75'),'weights missing');
 const compare=document.getElementById('bdef');compare.checked=true;compare.dispatchEvent(new Event('change'));
 check(mesh.geometry.attributes.mmdSkinningType.getX(0)===1 && mesh.geometry.attributes.mmdSkinningType.getX(9)===0,'comparison changed BDEF vertices');
 document.getElementById('reset').click();check(mesh.morphTargetInfluences.every(v=>v===0),'reset weights failed');
 document.getElementById('model').value='empty.pmx';document.getElementById('load').click();
 await until(()=>info.textContent.includes('No type 2 bone morph'));
 check(weight.disabled && select.disabled && group.disabled && groupWeight.disabled,'absent morph controls enabled');
 check(groupInfo.textContent.includes('No group → bone relation'),'absent group bone diagnostic missing');
 check(document.getElementById('uv-info').textContent.includes('No type 3–7')&&document.getElementById('uv-weight').disabled,'absent UV morphs falsely claimed');
 const materialSelect=document.getElementById('material-morph'),materialWeight=document.getElementById('material-weight'),materialInfo=document.getElementById('material-info');
 check(materialSelect.disabled&&materialWeight.disabled&&materialInfo.textContent.includes('no type 8'),'missing material warning absent');
 document.getElementById('asset-directory').value='material-morph';document.getElementById('model').value='material.pmx';document.getElementById('load').click();
 await until(()=>mesh?.geometry.userData.MMD.materialMorphs?.length===4);
 check(materialSelect.options.length===4&&!materialWeight.disabled,'material controls absent');
 check(materialInfo.textContent.includes('multiply-all')&&materialInfo.textContent.includes('Material -1: all materials')&&materialInfo.textContent.includes('mode multiply')&&materialInfo.textContent.includes('mode add')&&materialInfo.textContent.includes('Evaluated material / outline parameters'),'material diagnostics absent');
 materialSelect.value='1';materialSelect.dispatchEvent(new Event('change'));
 for(const value of [0,0.5,1,0]) {materialWeight.value=String(value);materialWeight.dispatchEvent(new Event('input'));await new Promise(resolve=>setTimeout(resolve,40));check(Math.abs(mesh.material[0].opacity-(1-value))<1e-6,'material slider drift');check(mesh.material[0].userData.outlineParameters.visible===(value<1),'edge visibility failed');}
 group.value='4';group.dispatchEvent(new Event('change'));check(target.options.length===2,'group material targets absent');
 groupWeight.value='0.5';groupWeight.dispatchEvent(new Event('input'));check(Math.abs(mesh.material[0].opacity-0.6875)<1e-6,'group material weight wrong');
 target.value='1';target.dispatchEvent(new Event('change'));targetWeight.value='0.25';targetWeight.dispatchEvent(new Event('input'));check(Math.abs(mesh.material[0].opacity-0.4375)<1e-6,'direct plus group material weight wrong');
 document.getElementById('reset').click();check(mesh.material[0].opacity===1,'material reset failed');
 document.getElementById('motion').value='material.vmd';document.getElementById('play').click();await until(()=>mesh.material[0].opacity<0.95);check(materialInfo.textContent.includes('weight 0.'),'material VMD report missing');
 document.getElementById('stop').click();check(mesh.material[0].opacity===1&&mesh.morphTargetInfluences.every(v=>v===0),'material stop failed');
 result.textContent=encodeURIComponent(JSON.stringify({morphs:3,texture:true,errors}));
} catch(error){result.textContent=encodeURIComponent(JSON.stringify({error:error.stack||String(error)}));}
</script>`;
	const server = createServer( ( request, response ) => {

		if ( request.url?.startsWith( '/local-sdef/?' ) ) { response.setHeader( 'Content-Type', 'text/html' ); response.end( html ); }
		else local.emit( 'request', request, response );

	} );
	try {

		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const result = await runBrowser<{ error?: string; morphs: number; texture: boolean; errors: string[] }>( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/local-sdef/?webgl`, profile );
		assert.equal( result.error, undefined, result.error ); assert.equal( result.morphs, 3 ); assert.equal( result.texture, true ); assert.deepEqual( result.errors, [] );

	} finally {

		await new Promise( resolve => server.close( resolve ) );
		await rm( directory, { recursive: true, force: true } ); await removeBrowserDirectory( profile );

	}

} );

test( 'generated private UV viewer reports real payloads and independent direct/group sliders without external assets', { timeout: 60000 }, async () => {

	const profile = await mkdtemp( join( tmpdir(), 'mmd-uv-viewer-profile-' ) );
	const local = createSdefServer();
	const html = await readFile( new URL( '../../local-viewer/index.html', import.meta.url ), 'utf8' ) + `
<pre id="result">pending</pre><script type="module">
import { MMDAnimationHelper } from 'three-mmd-loader';
let mesh;const original=MMDAnimationHelper.prototype.update;
MMDAnimationHelper.prototype.update=function(delta){const r=original.call(this,delta);mesh=this.meshes[0];return r;};
const result=document.getElementById('result'),errors=[];console.error=(...args)=>errors.push(args.map(String).join(' '));
const check=(v,m)=>{if(!v)throw new Error(m);};
async function until(fn){const start=performance.now();while(!fn()){if(performance.now()-start>15000)throw new Error('viewer timeout '+document.getElementById('status').textContent);await new Promise(r=>setTimeout(r,30));}}
try {
 await until(()=>document.getElementById('generated-uv').onclick);document.getElementById('generated-uv').click();
 await until(()=>mesh?.geometry.userData.MMD.uvMorphs?.length===5);
 const select=document.getElementById('uv-morph'),slider=document.getElementById('uv-weight'),info=document.getElementById('uv-info');
 check(select.options.length===5&&!slider.disabled,'UV controls absent');
 check(document.getElementById('asset-directory').querySelector('option[value="uv-morph"]'),'UV directory absent');
 check(info.textContent.includes('channel 4')&&info.textContent.includes('offset xyzw')&&info.textContent.includes('base [')&&info.textContent.includes('morphed [')&&info.textContent.includes('uv-group × 0.5'),'actual UV diagnostics absent');
 check(mesh.material[0].map.image.width===8&&document.getElementById('checker').checked,'generated checker absent');
 const position=mesh.geometry.attributes.position;check(position.getX(0)!==position.getX(1),'generated mesh is degenerate');
 const group=document.getElementById('group'),groupWeight=document.getElementById('group-weight');group.value='6';group.dispatchEvent(new Event('change'));
 check(document.getElementById('group-target').options.length===6,'UV group targets absent');
 let assertions=0;
 for(let c=0;c<5;c++) {
  select.value=String(c+1);select.dispatchEvent(new Event('change'));
  for(const direct of [0,0.5,1,0]) for(const g of [0,0.5,1,0]) {
   slider.value=String(direct);slider.dispatchEvent(new Event('input'));groupWeight.value=String(g);groupWeight.dispatchEvent(new Event('input'));
   const a=mesh.geometry.getAttribute(c?'mmdAdditionalUV'+c:'uv');const base=c?[c*0.1,0.2+c*0.01,0.3+c*0.02,0.4+c*0.03]:[0.125,0.2,0,0];
   const delta=c?[c*0.03,-c*0.02,c*0.04,-c*0.05]:[0.6,0.35,0.2,-0.4];const w=direct+g*(c===0?0.75:0.5);
   const actual=c?[a.getX(3),a.getY(3),a.getZ(3),a.getW(3)]:[a.getX(3),a.getY(3)];
   actual.forEach((v,k)=>check(Math.abs(v-base[k]-w*delta[k])<1e-6,'viewer channel '+c+' component '+k));assertions++;
  }
 }
 document.getElementById('reset').click();check(mesh.morphTargetInfluences.every(v=>v===0),'UV reset weights');
 check(Math.abs(mesh.geometry.attributes.uv.getX(3)-0.125)<1e-6,'UV reset base');
 document.getElementById('checker').checked=false;document.getElementById('checker').dispatchEvent(new Event('change'));check(mesh.material[0].map===null,'checker map restore');
 result.textContent=encodeURIComponent(JSON.stringify({errors,assertions}));
}catch(e){result.textContent=encodeURIComponent(JSON.stringify({errors:[e.stack||String(e)]}));}
</script>`;
	const server = createServer( ( request, response ) => {

		if ( request.url?.startsWith( '/local-sdef/?' ) ) { response.setHeader( 'Content-Type', 'text/html' ); response.end( html ); }
		else local.emit( 'request', request, response );

	} );
	try {

		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const result = await runBrowser<{ errors: string[]; assertions: number }>( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/local-sdef/?webgl`, profile );
		assert.deepEqual( result.errors, [] ); assert.equal( result.assertions, 80 );

	} finally { await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( profile ); }

} );

test( 'private generated grant inspector exposes real flags, source controls and absence diagnostics', { timeout: 60000 }, async () => {

	const profile = await mkdtemp( join( tmpdir(), 'mmd-grant-viewer-profile-' ) );
	const local = createSdefServer();
	const html = await readFile( new URL( '../../local-viewer/index.html', import.meta.url ), 'utf8' ) + `
<pre id="result">pending</pre><script type="module">
import {MMDAnimationHelper} from 'three-mmd-loader';
let mesh;const original=MMDAnimationHelper.prototype.update;
MMDAnimationHelper.prototype.update=function(delta){const r=original.call(this,delta);mesh=this.meshes[0];return r;};
const result=document.getElementById('result'),errors=[];console.error=(...args)=>errors.push(args.map(String).join(' '));
const check=(v,m)=>{if(!v)throw new Error(m);};
async function until(fn){const start=performance.now();while(!fn()){if(performance.now()-start>15000)throw new Error('viewer timeout '+document.getElementById('status').textContent);await new Promise(r=>setTimeout(r,30));}}
try {
 await until(()=>document.getElementById('generated-grant').onclick);document.getElementById('generated-grant').click();
 await until(()=>mesh?.geometry.userData.MMD.grants?.length===6);
 const info=document.getElementById('grant-info'),translation=document.getElementById('translation'),bend=document.getElementById('bend');
 check(document.getElementById('asset-directory').querySelector('option[value="grant"]'),'grant directory absent');
 check(info.textContent.includes('isLocal=true')&&info.textContent.includes('position=true')&&info.textContent.includes('rotation=true')&&info.textContent.includes('ratio=-0.5')&&info.textContent.includes('class=3')&&info.textContent.includes('post-physics'),'real metadata absent');
 check(info.querySelectorAll('.bone-link').length===6,'affected targets not highlighted');
 check(!info.textContent.includes('No position grants')&&!info.textContent.includes('No local grants'),'false missing cases');
 const rest=mesh.geometry.userData.MMD.bones.map(b=>b.pos.slice());
 check(document.getElementById('bone').value==='6'&&document.getElementById('grants').checked,'source controls not selected');
 translation.value='1';translation.dispatchEvent(new Event('input'));
 check(Math.abs(mesh.skeleton.bones[0].position.x-rest[0][0]-0.5)<1e-6,'translation grant control');
 bend.value='60';bend.dispatchEvent(new Event('input'));
 check(Math.abs(mesh.skeleton.bones[0].quaternion.x-Math.sin(Math.PI/12))<1e-6,'rotation grant control');
 check(info.textContent.includes('Target position [')&&info.textContent.includes('quaternion ['),'calculated transforms absent');
 document.getElementById('reset').click();
 check(mesh.skeleton.bones.every((b,i)=>b.position.toArray().every((v,c)=>Math.abs(v-rest[i][c])<1e-6)),'reset did not restore bind');
 document.getElementById('generated-uv').click();await until(()=>mesh?.geometry.userData.MMD.grants?.length===0);
 check(info.textContent.includes('No position grants present')&&info.textContent.includes('No local grants present'),'absent flag warning missing');
 result.textContent=encodeURIComponent(JSON.stringify({errors}));
}catch(e){result.textContent=encodeURIComponent(JSON.stringify({errors:[e.stack||String(e)]}));}
</script>`;
	const server = createServer( ( request, response ) => {

		if ( request.url?.startsWith( '/local-sdef/?' ) ) { response.setHeader( 'Content-Type', 'text/html' ); response.end( html ); }
		else local.emit( 'request', request, response );

	} );
	try {

		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const result = await runBrowser<{ errors: string[] }>( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/local-sdef/?webgl`, profile );
		assert.deepEqual( result.errors, [] );

	} finally { await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( profile ); }

} );

test( 'private generated physics viewer runs Ammo, reports actual layers/body modes, steps and resets', { timeout: 60000 }, async () => {

	const profile = await mkdtemp( join( tmpdir(), 'mmd-physics-viewer-profile-' ) );
	const local = createSdefServer();
	const html = await readFile( new URL( '../../local-viewer/index.html', import.meta.url ), 'utf8' ) + `
<pre id="result">pending</pre><script type="module">
import { MMDAnimationHelper } from 'three-mmd-loader';
const result=document.getElementById('result'),errors=[]; console.error=(...args)=>errors.push(args.map(String).join(' '));
let helper;const update=MMDAnimationHelper.prototype.update;MMDAnimationHelper.prototype.update=function(delta){helper=this;return update.call(this,delta);};
function check(value,message){if(!value)throw new Error(message);}
async function until(check){const start=performance.now();while(!check()){if(performance.now()-start>15000)throw new Error('viewer timeout '+document.getElementById('status').textContent);await new Promise(resolve=>setTimeout(resolve,30));}}
try {
 await until(()=>document.getElementById('generated-physics-layers').onclick);document.getElementById('generated-physics-layers').click();
 const info=document.getElementById('physics-info');await until(()=>info.textContent.includes('postKinematic'));
 const mesh=helper.meshes[0],state=helper.objects.get(mesh),physics=state.physics;
 check(physics?.bodies.length===5 && physics.constraints.length===1,'actual Ammo fixture missing');
 for(const text of ['postKinematic":1','postDynamic":1','postMode2":1','flag=0x1380','Grant:','IK:','Authored','Pre','Physics','Final','NEXT-step'])check(info.textContent.includes(text),'missing diagnostic '+text);
 check(document.getElementById('physics').checked,'physics disabled');
 const translation=document.getElementById('translation');translation.value='1';translation.dispatchEvent(new Event('input'));
 check(Math.abs(mesh.skeleton.bones[0].position.x-0.5)<1e-5,'post grant absent');
 check(Math.abs(physics.bodies[0].body.getCenterOfMassTransform().getOrigin().x())<1e-5,'post pose cosmetically teleported body');
 document.getElementById('physics-step').click();
 check(Math.abs(physics.bodies[0].body.getCenterOfMassTransform().getOrigin().x()-0.5)<1e-5,'next-step kinematic input incomplete');
 check(Math.abs(mesh.skeleton.bones[1].position.x-2.25)<1e-5,'dynamic post grant absent');
 check(Math.abs(physics.bodies[1].body.getCenterOfMassTransform().getOrigin().x()-2)<1e-5,'dynamic body teleported');
 document.getElementById('physics-reset').click();check(translation.value==='0','reset pose control');
 check(Math.abs(mesh.skeleton.bones[1].position.y)<1e-6 && Math.abs(physics.bodies[1].body.getCenterOfMassTransform().getOrigin().y())<1e-6,'paused reset left stale rendered/body pose');
 const toggle=document.getElementById('physics');toggle.checked=false;toggle.dispatchEvent(new Event('change'));check(info.textContent.includes('Ammo disabled'),'physics toggle disconnected');
 toggle.checked=true;toggle.dispatchEvent(new Event('change'));document.getElementById('physics-step').click();
 check(info.textContent.includes('simulation snapshot') && info.textContent.includes('paused'),'body diagnostics missing');
 result.textContent=encodeURIComponent(JSON.stringify({bodies:5,errors}));
} catch(error){result.textContent=encodeURIComponent(JSON.stringify({error:error.stack||String(error)}));}
</script>`;
	const server = createServer( ( request, response ) => {

		if ( request.url?.startsWith( '/local-sdef/?' ) ) { response.setHeader( 'Content-Type', 'text/html' ); response.end( html ); }
		else local.emit( 'request', request, response );

	} );
	try {

		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const result = await runBrowser<{ error?: string; bodies: number; errors: string[] }>( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/local-sdef/?webgl`, profile );
		assert.equal( result.error, undefined, result.error ); assert.equal( result.bodies, 5 ); assert.deepEqual( result.errors, [] );

	} finally { await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( profile ); }

} );
