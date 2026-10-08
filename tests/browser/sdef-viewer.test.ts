import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSdefServer } from '../../scripts/serve-sdef.ts';
import { sdefPmxBuffer } from '../fixtures.ts';
import { referenceBonePose } from '../bone-morph-reference.ts';
import { runBrowser } from './browser.ts';

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
		await rm( directory, { recursive: true, force: true } ); await rm( profile, { recursive: true, force: true } );

	}

} );


test( 'private bone morph viewer enumerates real payloads, loads relative textures, controls weights and diagnoses absent morphs', { timeout: 60000 }, async () => {

	const directory = await mkdtemp( join( tmpdir(), 'mmd-bone-viewer-' ) );
	const profile = await mkdtemp( join( tmpdir(), 'mmd-bone-viewer-profile-' ) );
	await mkdir( join( directory, 'umbrella/tex' ), { recursive: true } );
	await writeFile( join( directory, 'umbrella/傘.pmx' ), Buffer.from( sdefPmxBuffer( { boneMorphs: true, texturePath: 'tex/色.png' } ) ) );
	await writeFile( join( directory, 'empty.pmx' ), Buffer.from( sdefPmxBuffer() ) );
	await writeFile( join( directory, 'umbrella/tex/色.png' ), Buffer.from( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64' ) );
	const local = createSdefServer( { boneMorphDirectory: directory } );
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
 document.getElementById('asset-directory').value='bone-morph';
 document.getElementById('model').value='umbrella/傘.pmx';document.getElementById('load').click();
 await until(()=>mesh?.geometry.userData.MMD.boneMorphs?.length===3);
 const select=document.getElementById('morph'),weight=document.getElementById('weight'),info=document.getElementById('morph-info');
 check(select.options.length===3 && !weight.disabled,'type 2 selection missing');
 check(info.textContent.includes('bone-a') && info.textContent.includes('bone-b') && info.textContent.includes('Bone 1: bone1') && info.textContent.includes('translation:') && info.textContent.includes('rotation (xyzw):'),'actual payload report missing');
 await until(()=>mesh.material[0].map?.image?.width===1);
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
 check(weight.disabled && select.disabled,'absent morph controls enabled');
 check(info.textContent.includes('not implemented'),'unsupported morphs falsely claimed');
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
		await rm( directory, { recursive: true, force: true } ); await rm( profile, { recursive: true, force: true } );

	}

} );
