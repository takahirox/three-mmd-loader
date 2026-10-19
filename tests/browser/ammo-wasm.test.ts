import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createExamplesServer } from '../../scripts/serve-examples.ts';
import { linkedCollisionBuffer } from '../fixtures.ts';
import { removeBrowserDirectory, runBrowser } from './browser.ts';

const harness = `<!doctype html><pre id="result">pending</pre>
<script>for(const event of ['error','unhandledrejection'])addEventListener(event,e=>document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({error:String(e.reason||e.message)})));</script>
<script src="/node_modules/ammojs-typed/ammo/ammo.wasm.js"></script>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/","three/tsl":"/node_modules/three/build/three.tsl.js","three/webgpu":"/node_modules/three/build/three.webgpu.js","mmd-parser":"/node_modules/mmd-parser/build/mmdparser.module.mjs"}}</script>
<script type="module">
import { ammoURL, experimentalBullet, initializeAmmoWasm } from '/examples/ammo-runtime.js';
import { MMDLoader, MMDPhysics } from '/src/index.js';
import { Texture } from 'three';
import { Parser } from 'mmd-parser';
const checks={};
function check(key,value){if(!value)throw new Error(key);checks[key]=true;}
try {
 const failure=new URLSearchParams(location.search).get('mainFailure');
 if(failure){
  let reason='';try{await initializeAmmoWasm();}catch(error){reason=String(error);}
  check('main failure diagnosed',failure==='api'?reason.includes('API incompatible: btGeneric6DofSpringConstraint'):failure==='identity'?reason.includes('source identity mismatch'):failure==='glue'?reason.includes('glue failed to load'):reason.includes('Ammo WASM initialization failed') && reason.includes('ammo.wasm'));
  check('no initialized runtime',typeof Ammo==='function' && document.body.dataset.ammoBackend!=='wasm');
 }else{
  globalThis.Ammo=await initializeAmmoWasm();
  check('main WASM instance verified',document.body.dataset.ammoBackend==='wasm');
  const binaryResponse=await fetch(new URL(experimentalBullet?'ammo.wasm':'ammo.wasm.wasm',ammoURL));
  check('binary MIME',binaryResponse.ok && binaryResponse.headers.get('Content-Type').split(';')[0]==='application/wasm');
  const parser=new Parser(),data=parser.parsePmd(new Uint8Array(${JSON.stringify( Array.from( new Uint8Array( linkedCollisionBuffer( 'pmd', { masks: [ 0, 0 ] } ) ) ) )}).buffer,true);
  const loader=new MMDLoader();loader.meshBuilder.materialBuilder.textureLoader.load=()=>new Texture();
  for(const variant of ['verified','missing','invalid','timeout','asm']){
   const mesh=loader.meshBuilder.build(data,''),meta=mesh.geometry.userData.MMD;let reason='';
   const p=new MMDPhysics(mesh,meta.rigidBodies,meta.constraints,{physicsMode:'worker',workerPhysics:{ammoURL:new URL('/different/'+variant+'/glue.js',location.href).href,timeout:variant==='timeout'?100:10000,onFallback:r=>reason=r}});
   await p.ready;
   if(variant==='verified'||variant==='asm'){
    check(variant+' remains Worker',p.physicsMode==='worker');
    check(variant+' transport',p.transport===(crossOriginIsolated?'shared':'transferable'));
   }else{
    check(variant+' sync fallback',p.physicsMode==='sync' && !!p.world && !p.initializationError);
    check(variant+' diagnostic',variant==='timeout'?reason.includes('timed out'):reason.includes('wasm')||reason.includes('WebAssembly'));
   }
   p.update(1/60);
   if(p.physicsMode==='worker'){
    const deadline=performance.now()+5000;
    while(!p.workerStatus.completedSequence){if(performance.now()>deadline)throw new Error('step timeout');await new Promise(r=>setTimeout(r,5));}
    p.workerAdapter.project();
   }
   check(variant+' finite motion',p.bodyResults.every(r=>r.position.concat(r.quaternion).every(Number.isFinite)));
   p.dispose();mesh.geometry.dispose();mesh.skeleton.dispose();
  }
 }
 document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({checks}));
}catch(error){document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({error:String(error),checks}));}
</script>`;

for ( const bullet of [ 'default', 'master' ] ) for ( const isolated of [ false, true ] ) test( `WASM instance evidence, glue-relative classic Worker binaries and failure recovery, Bullet=${bullet}, isolation=${isolated}`, { timeout: 60000 }, async () => {

	const profile = await mkdtemp( join( tmpdir(), 'mmd-wasm-browser-' ) );
	const files = createExamplesServer();
	const glue = await readFile( new URL( bullet === 'master' ? '../../examples/vendor/bullet/ammo.js' : '../../node_modules/ammojs-typed/ammo/ammo.wasm.js', import.meta.url ), 'utf8' );
	const asm = await readFile( new URL( '../../node_modules/ammojs-typed/ammo/ammo.js', import.meta.url ) );
	const binaryName = bullet === 'master' ? 'ammo.wasm' : 'ammo.wasm.wasm';
	const binary = await readFile( new URL( bullet === 'master' ? '../../examples/vendor/bullet/ammo.wasm' : '../../node_modules/ammojs-typed/ammo/ammo.wasm.wasm', import.meta.url ) );
	let evidence = 0, binaryRequests = 0;
	// Observe the actual Emscripten instantiation, without replacing its loader.
	const observer = `
globalThis.wasmInstances=[];
for(const key of ['instantiate','instantiateStreaming']){const native=WebAssembly[key];WebAssembly[key]=async function(...args){const result=await native.apply(WebAssembly,args);wasmInstances.push(result.instance||result);return result;};}
`;
	const verify = `
Ammo=((factory)=>async options=>{const runtime=await factory(options);if(!wasmInstances.some(instance=>instance instanceof WebAssembly.Instance && (runtime.asm||runtime.getWasmExports?.())===instance.exports))throw new Error('Worker did not execute WASM exports');await fetch('/wasm-evidence');return runtime;})(Ammo);
`;
	const server = createServer( ( request, response ) => {

		if ( isolated ) { response.setHeader( 'Cross-Origin-Opener-Policy', 'same-origin' ); response.setHeader( 'Cross-Origin-Embedder-Policy', 'require-corp' ); }
		const path = new URL( request.url!, 'http://localhost' ).pathname;
		if ( path === '/test' ) response.writeHead( 200, { 'Content-Type': 'text/html' } ).end( harness );
		else if ( path === '/wasm-evidence' ) { evidence ++; response.writeHead( 204 ).end(); }
		else if ( path.startsWith( '/different/' ) ) {

			if ( path.endsWith( '/glue.js' ) ) {

				response.writeHead( 200, { 'Content-Type': 'text/javascript' } ).end( path.includes( '/timeout/' ) ? 'var Ammo=()=>new Promise(()=>{});' : path.includes( '/asm/' ) ? asm : path.includes( '/verified/' ) ? observer + glue + verify : glue );

			} else if ( path === '/different/verified/' + binaryName ) { binaryRequests ++; response.writeHead( 200, { 'Content-Type': 'application/wasm' } ).end( binary ); }
			else response.writeHead( path.includes( '/invalid/' ) ? 200 : 404, { 'Content-Type': 'application/wasm' } ).end( 'invalid WASM' );

		} else if ( bullet === 'master' && path === '/examples/vendor/bullet/ammo.js' && request.headers.referer?.includes( 'mainFailure=' ) ) {

			const failure = new URL( request.headers.referer ).searchParams.get( 'mainFailure' );
			if ( failure === 'glue' ) response.writeHead( 404 ).end();
			else response.writeHead( 200, { 'Content-Type': 'text/javascript' } ).end( glue + ( failure === 'api' || failure === 'identity' ? `\nAmmo=((factory)=>async options=>{const runtime=await factory(options);${failure === 'api' ? 'delete runtime.btGeneric6DofSpringConstraint.prototype.setParam;' : "runtime.bulletCommit='wrong';"}return runtime;})(Ammo);` : '' ) );

		} else if ( path.endsWith( '/' + binaryName ) && /mainFailure=(missing|invalid)/.test( request.headers.referer ?? '' ) ) {

			response.writeHead( request.headers.referer?.includes( 'missing' ) ? 404 : 200, { 'Content-Type': 'application/wasm' } ).end( 'invalid WASM' );

		} else files.emit( 'request', request, response );

	} );
	await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
	try {

		const address = server.address(); assert.ok( address && typeof address !== 'string' );
		for ( const failure of bullet === 'master' ? [ '', 'missing', 'invalid', 'api', 'identity', 'glue' ] : [ '', 'missing', 'invalid' ] ) {

			const result: { error?: string; checks: Record<string, boolean> } = await runBrowser<{ error?: string; checks: Record<string, boolean> }>( `http://127.0.0.1:${address.port}/test?bullet=${bullet}${failure ? '&mainFailure=' + failure : ''}`, profile );
			assert.equal( result.error, undefined, JSON.stringify( result ) );
			assert.ok( Object.values( result.checks ).every( Boolean ) );

		}
		assert.equal( evidence, 1, 'real Worker must instantiate and use the WASM exports' );
		assert.ok( binaryRequests > 0, 'Worker must fetch the binary relative to its supplied glue URL' );

	} finally { await new Promise( resolve => server.close( resolve ) ); await removeBrowserDirectory( profile ); }

} );
