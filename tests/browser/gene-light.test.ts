import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fetchGeneLightAssets, geneLightManifest } from '../../scripts/gene-light-assets.ts';
import { inspectGeneLight } from '../../scripts/inspect-gene-light.ts';
import { createExamplesServer } from '../../scripts/serve-examples.ts';
import { removeBrowserDirectory, runBrowser } from './browser.ts';

interface Result { checks: Record<string, boolean>; error?: string; preview?: string }
const harness = `<!doctype html><meta charset="utf-8"><pre id="result">pending</pre><script type="module">
const checks = {}, errors = [];
let preview;
try {
 const frame = document.createElement('iframe'); frame.width=1024; frame.height=768;
 const loaded = new Promise(resolve => frame.onload=resolve);
 frame.src='/examples/webgl_loader_mmd_pmx_gene.html?backend=webgl'; document.body.appendChild(frame); await loaded;
 const page=frame.contentWindow, doc=frame.contentDocument;
 page.addEventListener('error', e=>errors.push(e.message));
 page.addEventListener('unhandledrejection', e=>errors.push(String(e.reason)));
 const context=await (await page.eval("import('/examples/webgl_loader_mmd_pmx_gene.js')")).ready;
 const {mesh, helper, gui, renderer, scene, camera, effect}=context;
 renderer.setAnimationLoop(null);
 const state=helper.objects.get(mesh), data=mesh.geometry.userData.MMD;
 checks.ready=doc.body.dataset.state==='ready' && doc.getElementById('status').textContent.startsWith('sync');
 checks.model=data.format==='pmx' && mesh.skeleton.bones.length===224 && data.iks.length===6 && data.grants.length===11;
 checks.phases=data.bones.filter(b=>b.flag&0x1000).length===38 && state.sortedBonesData.length===224;
 checks.physics=state.physics.physicsMode==='sync' && state.physics.bodies.length===87 && state.physics.constraints.length===92;
 checks.mode2=data.rigidBodies.filter(b=>b.originalType===2).length===53 && state.physics.bodies.some(b=>b.params.type===2);
 checks.morphTypes=data.groupMorphs.length===3 && data.uvMorphs.length===1 && data.materialMorphs.length===3 && data.boneMorphs.length===0;
 checks.generatedClip=state.mixer._actions[0].getClip().name==='Gene feature demonstration (generated)' && state.mixer._actions[0].getClip().tracks.length===5;
 checks.credits=doc.querySelector('.credits').textContent==='CG-CA Gene (c) 2023 by Nagoya Institute of Technology, Moonshot R&D Goal 1 Avatar Symbiotic Society';
 checks.terms=doc.getElementById('info').textContent.includes('Personal noncommercial') && doc.querySelector('a[href="https://creativecommons.org/licenses/by/4.0/"]')!==null;
 checks.gui=gui.domElement.getAttribute('aria-disabled')==='false' && gui.controllersRecursive().every(c=>!c._disabled);
 const controller = property => gui.controllersRecursive().find(c=>c.property===property);
 const input = property => controller(property).domElement.querySelector('input[type=checkbox]');
 for(const name of ['animation','ik','grant','physics']) { input(name).click(); checks[name+'Toggle']=helper.enabled[name]===false; input(name).click(); }
 // Compare IK and grant results at the same authored time with physics disabled.
 input('physics').click();
 const bone = name=>mesh.skeleton.bones.find(b=>b.name===name);
 const sample=(feature, enabled, name)=>{helper.enable(feature,enabled);state.mixer.setTime(1);helper.update(0);return bone(name).quaternion.toArray();};
 checks.ikEffect=JSON.stringify(sample('ik',false,'左ひざ'))!==JSON.stringify(sample('ik',true,'左ひざ'));
 checks.grantEffect=JSON.stringify(sample('grant',false,'左腕捩連'))!==JSON.stringify(sample('grant',true,'左腕捩連'));
 const before=bone('センター').position.toArray();helper.update(0.5);
 checks.animationMoves=JSON.stringify(before)!==JSON.stringify(bone('センター').position.toArray());
 helper.enable('physics',true);state.physics.reset();helper.update(1/30);
 checks.physicsSteps=state.physics.bodyResultPhase==='step' && state.physics.bodyResults.length===87;
 helper.enable('physics',false);
 const morphFolder=gui.folders[0]; morphFolder.open();
 const blink=mesh.morphTargetDictionary['まばたき'];
 const vertexIndex=mesh.geometry.morphAttributes.position[blink].array.findIndex((v,i)=>v!==mesh.geometry.getAttribute('position').array[i]);
 const {Vector3}=await page.eval("import('three')");
 const vertex = new Vector3();mesh.getVertexPosition(Math.floor(vertexIndex/3),vertex);const rest=vertex.toArray();
 controller('まばたき').setValue(0.75);mesh.getVertexPosition(Math.floor(vertexIndex/3),vertex);
 checks.vertexMorph=mesh.morphTargetInfluences[blink]===0.75 && JSON.stringify(rest)!==JSON.stringify(vertex.toArray());
 controller('まばたき').setValue(0);
 controller('叫び').setValue(0.5);
 checks.groupMorph=mesh.morphTargetInfluences[mesh.morphTargetDictionary['叫び']]===0.5 && mesh.geometry.morphAttributes.position[mesh.morphTargetDictionary['叫び']].array.some((v,i)=>v!==mesh.geometry.getAttribute('position').array[i]);
 controller('叫び').setValue(0);
 const uv=mesh.geometry.getAttribute('uv').array.slice();controller('メッシュなし').setValue(1);
 checks.uvMorph=mesh.geometry.getAttribute('uv').array.some((v,i)=>v!==uv[i]);
 controller('メッシュなし').setValue(0);checks.uvReset=mesh.geometry.getAttribute('uv').array.every((v,i)=>v===uv[i]);
 const opacity=mesh.material.map(m=>m.opacity);controller('青ざめ').setValue(1);
 checks.materialMorph=mesh.material.some((m,i)=>m.opacity!==opacity[i]);controller('青ざめ').setValue(0);
 checks.materialReset=mesh.material.every((m,i)=>m.opacity===opacity[i]);
 const debug=scene.children.filter(c=>!c.visible);
 for (const name of ['show IK bones','show rigid bodies']) { const c=controller(name); input(name).click(); }
 checks.debug=debug.length===2 && debug.every(c=>c.visible);
 effect.render(scene,camera); checks.render=renderer.info.render.drawCalls>0 && doc.body.dataset.state==='ready';
 for(const name of ['show IK bones','show rigid bodies'])input(name).click();
 input('outline').click();checks.outline=effect.enabled===false;input('outline').click();
 const oldCamera=camera.position.clone();const canvas=renderer.domElement;
 canvas.dispatchEvent(new page.WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true}));
 checks.orbit=camera.position.distanceTo(oldCamera)>0;
 // Mobile: open morph controls remain within the viewport and can be scrolled.
 frame.width=360;frame.height=640;await new Promise(r=>page.setTimeout(r,100));
 const rect=gui.domElement.getBoundingClientRect();
 checks.mobile=rect.left===0 && rect.bottom===page.innerHeight && rect.height<=page.innerHeight*0.5 && rect.width<=page.innerWidth*0.8;
 const ctrl=controller('メッシュなし').domElement;ctrl.scrollIntoView();const ir=ctrl.getBoundingClientRect();
 checks.mobileMorphReachable=ir.top>=rect.top && ir.bottom<=rect.bottom;
 frame.width=1024;frame.height=768;await new Promise(r=>page.setTimeout(r,100));
 morphFolder.close();
 checks.noIsolation=page.crossOriginIsolated===false;
 checks.noRuntimeErrors=errors.length===0;
 if (CAPTURE) {
  helper.enable('physics',false);state.mixer.setTime(0);helper.update(0);
  renderer.setSize(400,250);camera.aspect=400/250;camera.position.set(0,10,32);camera.lookAt(0,10,0);camera.updateProjectionMatrix();
  effect.render(scene,camera);preview=canvas.toDataURL('image/jpeg',0.9);
 }
 renderer.debug.onShaderError();checks.failure=doc.body.dataset.state==='error' && gui.controllersRecursive().every(c=>c._disabled) && doc.getElementById('status').textContent.includes('npm run examples:assets');
 frame.remove();
 // Missing PMX or textures must fail before enabling controls.
 for(const missing of ['model','texture']){
  const f=document.createElement('iframe');const loaded=new Promise(r=>f.onload=r);
  f.src='/examples/webgl_loader_mmd_pmx_gene.html?backend=webgl&missing='+missing;document.body.appendChild(f);await loaded;
  const ready=(await f.contentWindow.eval("import('/examples/webgl_loader_mmd_pmx_gene.js')")).ready;
  let rejected=false;try{await ready;}catch{rejected=true;}
  checks['missing_'+missing]=rejected && f.contentDocument.body.dataset.state==='error' && f.contentDocument.getElementById('controls').getAttribute('aria-disabled')==='true';f.remove();
 }
} catch(error) { document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({checks,error:error.stack||String(error)})); }
if(document.getElementById('result').textContent==='pending')document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({checks,preview}));
</script>`;

test( 'licensed pinned Gene Light renders and exercises its actual PMX features without cross-origin isolation', { timeout: 180000, skip: process.env.MMD_EXAMPLE_FIXTURES === '1' ? 'Synthetic artifact only; real pinned Gene is checked by test:browser and the Pages build.' : false }, async t => {

	await fetchGeneLightAssets();
	assert.deepEqual( await inspectGeneLight(), JSON.parse( await readFile( new URL( '../../examples/gene-light-inspection.json', import.meta.url ), 'utf8' ) ) );
	const temporary = await mkdtemp( join( tmpdir(), 'gene-browser-' ) );
	const siteRoot = process.env.MMD_EXAMPLE_SITE && resolve( process.env.MMD_EXAMPLE_SITE );
	const prefix = siteRoot ? '/three-mmd-loader' : '';
	const app = createExamplesServer();
	const handler = app.listeners( 'request' )[ 0 ];
	const server = createServer( async ( request, response ) => {

		if ( request.url === '/test' ) {

			response.writeHead( 200, { 'Content-Type': 'text/html' } ).end( harness.replaceAll( '/examples/', prefix + '/examples/' ).replace( 'CAPTURE', process.env.GENE_CAPTURE_PREVIEW === '1' ? 'true' : 'false' ) );

		} else if ( request.headers.referer?.includes( 'missing=model' ) && request.url?.endsWith( '/Gene_light.pmx' ) ||
			request.headers.referer?.includes( 'missing=texture' ) && request.url?.endsWith( '/light/face.png' ) ) {

			response.writeHead( 404 ).end();

		} else if ( siteRoot ) {

			try {

				let path = decodeURIComponent( new URL( request.url || '/', 'http://localhost' ).pathname );
				if ( ! path.startsWith( prefix + '/' ) ) throw new Error( 'Outside site' );
				if ( path.endsWith( '/' ) ) path += 'index.html';
				const file = resolve( siteRoot, path.slice( prefix.length + 1 ) );
				if ( ! file.startsWith( siteRoot + sep ) ) throw new Error( 'Outside site' );
				const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.md': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
				response.writeHead( 200, { 'Content-Type': types[ extname( file ) ] || 'application/octet-stream' } ).end( await readFile( file ) );

			} catch { response.writeHead( 404 ).end(); }

		} else handler( request, response );

	} );
	try {

		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const base = `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}`;
		for ( const { path, size } of geneLightManifest.files ) {

			const response = await fetch( `${base}${prefix}/examples/assets/gene-light/${path}` );
			assert.equal( response.status, 200, path );
			assert.equal( ( await response.arrayBuffer() ).byteLength, size, path );

		}
		const result = await runBrowser<Result>( base + '/test', join( temporary, 'profile' ), 'light', 150000 );
		assert.equal( result.error, undefined, result.error );
		if ( result.preview ) await writeFile( new URL( '../../examples/screenshots/webgl_loader_mmd_pmx_gene.jpg', import.meta.url ), Buffer.from( result.preview.split( ',' )[ 1 ], 'base64' ) );
		t.diagnostic( JSON.stringify( result.checks ) );
		for ( const [ name, passed ] of Object.entries( result.checks ) ) assert.equal( passed, true, name );

	} finally {

		server.closeAllConnections();
		await new Promise<void>( resolve => server.close( () => resolve() ) );
		await removeBrowserDirectory( temporary );

	}

} );
