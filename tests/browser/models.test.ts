import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { importModels } from '../../scripts/import-models.ts';
import { createSdefServer } from '../../scripts/serve-sdef.ts';
import { physicsLayersPmxBuffer, sdefPmxBuffer, vmdBuffer } from '../fixtures.ts';
import { removeBrowserDirectory, runBrowser } from './browser.ts';

for ( const webgl of [ true, false ] ) test( `imported model picker loads Unicode PMX/texture/VMD and truthful diagnostics (${webgl ? 'WebGL' : 'WebGPU'})`, { timeout: 60000 }, async () => {

	const temporary = await mkdtemp( join( tmpdir(), 'mmd-picker-' ) ), source = join( temporary, 'source' ), root = join( temporary, 'private' ), profile = join( temporary, 'profile' );
	await mkdir( join( source, '包/tex' ), { recursive: true } );
	await writeFile( join( source, '包/モデル.pmx' ), Buffer.from( sdefPmxBuffer( { texturePath: 'tex/色.png', groupMorphs: true } ) ) );
	await writeFile( join( source, '包/tex/色.png' ), Buffer.from( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64' ) );
	await writeFile( join( source, '包/motion.vmd' ), Buffer.from( vmdBuffer( { boneName: 'bone0' } ) ) );
	await writeFile( join( source, '包/README.txt' ), 'Generated model terms: fixture only.' );
	await writeFile( join( source, '包/physics.pmx' ), Buffer.from( physicsLayersPmxBuffer() ) );
	await importModels( source, { root } );
	const local = createSdefServer( { modelsDirectory: join( root, 'models' ), installedExamplesDirectory: join( temporary, 'missing' ) } );
	const html = await readFile( new URL( '../../local-viewer/index.html', import.meta.url ), 'utf8' ) + `
<pre id="result">pending</pre><script type="module">
import {MMDAnimationHelper} from 'three-mmd-loader';
const result=document.getElementById('result'),errors=[];console.error=(...args)=>errors.push(args.map(String).join(' '));
let mesh;const original=MMDAnimationHelper.prototype.update;
MMDAnimationHelper.prototype.update=function(delta){const value=original.call(this,delta);mesh=this.meshes[0];return value;};
async function until(check){const start=performance.now();while(!check()){if(performance.now()-start>15000)throw new Error('picker timed out: '+document.getElementById('status').textContent);await new Promise(resolve=>setTimeout(resolve,30));}}
function check(value,message){if(!value)throw new Error(message);}
try {
 const picker=document.getElementById('installed-model');
 await until(()=>document.getElementById('load').onclick && Array.from(picker.options).some(o=>o.textContent.includes('包/モデル.pmx')));
 picker.value=Array.from(picker.options).find(o=>o.textContent.includes('包/モデル.pmx')).value;picker.dispatchEvent(new Event('change'));
 check(document.getElementById('asset-directory').value==='models','private directory not selected');
 check(document.getElementById('model').value.includes('包/モデル.pmx'),'Unicode model path lost');
 check(document.getElementById('model-notices').textContent.includes('Generated model terms'),'terms missing');
 const report=document.getElementById('model-report').textContent;
 check(report.includes('visual test not performed') && report.includes('not demonstrated') && report.includes('motion.vmd'),'truthful report/motion missing');
 document.getElementById('load').click();await until(()=>mesh?.geometry.attributes.mmdSkinningType && document.getElementById('status').textContent.includes('9 SDEF vertices'));
 await until(()=>mesh.material[0].map?.image?.width===1);
 check(document.getElementById('morph').options.length===3,'bone controls missing');
 check(!document.getElementById('group').disabled,'group controls missing');
 document.getElementById('play').click();await until(()=>document.getElementById('status').textContent.includes('Playing private motion'));
 document.getElementById('stop').click();
 picker.value=Array.from(picker.options).find(o=>o.textContent.includes('包/physics.pmx')).value;picker.dispatchEvent(new Event('change'));
 document.getElementById('load').click();await until(()=>mesh?.geometry.userData.MMD.rigidBodies?.length>0 && document.getElementById('status').textContent.includes('Select an elbow'));
 const physics=document.getElementById('physics');physics.checked=true;physics.dispatchEvent(new Event('change'));
 await until(()=>document.getElementById('physics-info').textContent.includes('postDynamic'));
 document.getElementById('physics-step').click();check(document.getElementById('physics-info').textContent.includes('mode'),'imported physics controls missing');
 result.textContent=encodeURIComponent(JSON.stringify({selected:true,texture:true,motion:true,errors}));
} catch(error){result.textContent=encodeURIComponent(JSON.stringify({error:error.stack||String(error)}));}
</script>`;
	const server = createServer( ( request, response ) => {

		if ( request.url?.startsWith( '/local-sdef/?' ) ) { response.setHeader( 'Content-Type', 'text/html' ); response.end( html ); }
		else local.emit( 'request', request, response );

	} );
	try {

		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const result = await runBrowser<{ error?: string; selected: boolean; texture: boolean; motion: boolean; errors: string[] }>( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/local-sdef/?${webgl ? 'webgl' : 'webgpu'}`, profile );
		assert.equal( result.error, undefined, result.error ); assert.equal( result.selected, true ); assert.equal( result.texture, true ); assert.equal( result.motion, true ); assert.deepEqual( result.errors, [] );

	} finally { await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( profile ); await rm( temporary, { recursive: true, force: true } ); }

} );
