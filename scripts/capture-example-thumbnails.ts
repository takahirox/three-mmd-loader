import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetManifest } from './assets-manifest.ts';
import { geneLightDirectory, geneLightManifest, verifyGeneLightFile } from './gene-light-assets.ts';
import { createExamplesServer } from './serve-examples.ts';
import { removeBrowserDirectory, runBrowser } from '../tests/browser/browser.ts';

const ids = [ 'webgl_loader_mmd', 'webgl_loader_mmd_audio', 'webgl_loader_mmd_pose', 'webgl_loader_mmd_worker', 'webgl_loader_mmd_pmx_gene' ];
const sha256 = ( bytes: Uint8Array ) => createHash( 'sha256' ).update( bytes ).digest( 'hex' );
interface Capture {
	page: string;
	preview: string;
	checks: Record<string, boolean>;
	state: { time: number; pose: number | null; physicsMode: string | null };
}
interface Result { captures: Capture[]; userAgent: string; error?: string }

// Refuse fixture assets even if a previous build used MMD_EXAMPLE_FIXTURES.
assert.notEqual( process.env.MMD_EXAMPLE_FIXTURES, '1', 'Thumbnails require real assets' );
for ( const { path, sha } of assetManifest.files ) {

	const bytes = await readFile( new URL( '../examples/assets/mmd/' + path, import.meta.url ) );
	assert.equal( createHash( 'sha1' ).update( `blob ${bytes.length}\0` ).update( bytes ).digest( 'hex' ), sha, path );

}
for ( const file of geneLightManifest.files ) verifyGeneLightFile( file, await readFile( join( geneLightDirectory, file.path ) ) );
// Reject a stale build that still uses the old conditional lighting.
const sceneSource = await readFile( new URL( '../examples/scene.ts', import.meta.url ) );
const compiledScene = await readFile( new URL( '../dist/example-modules/scene.js', import.meta.url ), 'utf8' );
assert.match( compiledScene, /const ambient = new AmbientLight\(\s*0xffffff\s*\)/ );
assert.match( compiledScene, /const light = new DirectionalLight\(\s*0xffffff\s*\)/ );

const harness = `<!doctype html><meta charset="utf-8"><pre id="result">pending</pre><script type="module">
const captures = [], errors = [];
try {
 for (const id of ${JSON.stringify( ids )}) {
  const frame = document.createElement('iframe'); frame.width=400; frame.height=250;
  const loaded = new Promise(resolve => frame.onload=resolve);
  frame.src='/examples/'+id+'.html?backend=webgl'; document.body.appendChild(frame); await loaded;
  const page=frame.contentWindow, doc=frame.contentDocument;
  page.addEventListener('error', e=>errors.push(e.message));
  page.addEventListener('unhandledrejection', e=>errors.push(String(e.reason)));
  const {mesh, helper, renderer, scene, camera, effect, gui}=await (await page.eval("import('/examples/"+id+".js')")).ready;
  renderer.setAnimationLoop(null);
  renderer.setPixelRatio(1); renderer.setSize(400,250);
  const state=helper.objects.get(mesh), physics=state?.physics;
  const waitWorker=async()=>{
   const started=performance.now();
   while(physics?.workerStatus?.inFlight) {
    if(performance.now()-started>10000)throw new Error('Worker capture timeout');
    await new Promise(r=>page.setTimeout(r,1));
   }
  };
  await waitWorker();
  let pose=null, time=0;
  if(id.endsWith('_pose')) {
   pose=1; gui.controllers.find(c=>c.property==='pose').setValue(pose-1);
  } else {
   state.mixer.setTime(0); helper.update(0); await waitWorker();
   if(id.endsWith('_audio'))helper.objects.get(camera).mixer.setTime(0);
   physics.reset(); await waitWorker();
   // Sample two seconds with IK, outlines and the actual physics backend active.
   for(let i=0;i<120;i++){helper.update(1/60);await waitWorker();}
   time=2;
  }
  effect.render(scene,camera);
  const lights=scene.children.filter(c=>c.isLight);
  const ambient=lights.find(c=>c.isAmbientLight), directional=lights.find(c=>c.isDirectionalLight);
  const checks={
   ready:doc.body.dataset.state==='ready',
   realModel:id.endsWith('_pmx_gene')?mesh.skeleton.bones.length===224:mesh.skeleton.bones.length>100,
   defaultLights:lights.length===2 && ambient.intensity===1 && directional.intensity===1,
   lightColors:ambient.color.getHex()===0xffffff && directional.color.getHex()===0xffffff,
   lightDirection:directional.position.toArray().join(',')==='-1,2,1',
   camera:id.endsWith('_audio') || (camera.position.toArray().every((v,i)=>Math.abs(v-[0,12,35][i])<1e-9) && camera.aspect===400/250),
   outlines:effect.enabled,
   physics:id.endsWith('_pose') || physics.physicsMode===(id.endsWith('_worker')?'worker':'sync'),
   render:renderer.info.render.drawCalls>0,
   noRuntimeErrors:errors.length===0
  };
  captures.push({page:id,preview:renderer.domElement.toDataURL('image/jpeg',0.9),checks,state:{time,pose,physicsMode:physics?.physicsMode??null}});
  frame.remove();
 }
 document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({captures,userAgent:navigator.userAgent}));
} catch(error) {
 document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({captures,error:error.stack||String(error)}));
}
</script>`;

const app = createExamplesServer();
const handler = app.listeners( 'request' )[ 0 ];
const server = createServer( ( request, response ) => {

	if ( request.url === '/capture' ) response.writeHead( 200, { 'Content-Type': 'text/html' } ).end( harness );
	else handler( request, response );

} );
const temporary = await mkdtemp( join( tmpdir(), 'mmd-thumbnail-capture-' ) );
const manifestURL = new URL( '../examples/screenshots/manifest.json', import.meta.url );
const existingManifest = await readFile( manifestURL, 'utf8' ).then( text => JSON.parse( text ) ).catch( error => {

	if ( error.code === 'ENOENT' ) return null;
	throw error;

} );
try {

	await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
	const base = `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}`;
	const result = await runBrowser<Result>( base + '/capture', join( temporary, 'profile' ), 'light', 180000 );
	assert.equal( result.error, undefined, result.error );
	assert.deepEqual( result.captures.map( capture => capture.page ), ids );
	for ( const capture of result.captures ) {

		for ( const [ check, passed ] of Object.entries( capture.checks ) ) assert.equal( passed, true, `${capture.page}: ${check}` );

	}
	const entries = [];
	for ( const capture of result.captures ) {

		const path = capture.page + '.jpg';
		const target = new URL( '../examples/screenshots/' + path, import.meta.url );
		const previous = await readFile( target ).catch( () => null );
		const bytes = Buffer.from( capture.preview.split( ',' )[ 1 ], 'base64' );
		await writeFile( target, bytes );
		// Retain the original replaced image hash across recaptures, which may
		// legitimately encode exactly the same pixels on the same browser.
		const original = existingManifest?.entries.find( ( entry: { page: string } ) => entry.page === capture.page );
		const previousSha256 = original ? original.previousSha256 : previous ? sha256( previous ) : null;
		entries.push( { page: capture.page, path, sha256: sha256( bytes ), previousSha256, ...capture.state, checks: capture.checks } );
		console.log( `Captured ${capture.page} (real assets, default lights, ${bytes.length} bytes)` );

	}
	await writeFile( manifestURL, JSON.stringify( {
		version: 1, capturedAt: new Date().toISOString(), method: 'npm run examples:capture',
		backend: 'WebGL2 / Chrome SwiftShader', userAgent: result.userAgent,
		width: 400, height: 250, pixelRatio: 1, jpegQuality: 0.9,
		sceneSha256: sha256( sceneSource ),
		sources: { miku: { repository: 'mrdoob/three.js', commit: assetManifest.commit }, gene: { repository: geneLightManifest.repository, commit: geneLightManifest.commit } },
		entries
	}, null, 2 ) + '\n' );

} finally {

	server.closeAllConnections();
	await new Promise<void>( resolve => server.close( () => resolve() ) );
	await removeBrowserDirectory( temporary );

}
