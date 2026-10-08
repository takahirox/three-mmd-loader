import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSdefServer } from '../../scripts/serve-sdef.ts';
import { sdefPmxBuffer } from '../fixtures.ts';
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
