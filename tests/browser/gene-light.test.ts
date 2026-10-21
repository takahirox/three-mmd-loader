import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fetchGeneLightAssets, geneLightManifest } from '../../scripts/gene-light-assets.ts';
import { inspectGeneLight } from '../../scripts/inspect-gene-light.ts';
import { createExamplesServer } from '../../scripts/serve-examples.ts';
import { removeBrowserDirectory, runBrowser } from './browser.ts';

interface Result { checks: Record<string, boolean>; mobileLayout?: unknown; error?: string }
const harness = `<!doctype html><meta charset="utf-8"><pre id="result">pending</pre><script type="module">
const checks = {}, errors = []; let mobileLayout;
const progress=stage=>fetch('/test-progress?stage='+encodeURIComponent(stage)).catch(()=>{});
try {
 progress('loading model');
 const frame = document.createElement('iframe'); frame.width=1024; frame.height=768;
 // Keep the frame visible when a morph controller scrolls into view. Chrome
 // can suspend resize events for an iframe scrolled outside the parent viewport.
 frame.style.cssText='position:fixed;left:0;top:0;border:0';
 const loaded = new Promise(resolve => frame.onload=resolve);
 frame.src='/examples/webgl_loader_mmd_pmx_gene.html'+(new URLSearchParams(location.search).has('bullet')?'?bullet='+new URLSearchParams(location.search).get('bullet'):''); document.body.appendChild(frame); await loaded;
 const page=frame.contentWindow, doc=frame.contentDocument;
 page.addEventListener('error', e=>errors.push(e.message));
 page.addEventListener('unhandledrejection', e=>errors.push(String(e.reason)));
 const context=await (await page.eval("import('/examples/webgl_loader_mmd_pmx_gene.js')")).ready;
 const {mesh, helper, gui, renderer, scene, camera, effect}=context;
 progress('model ready');
 renderer.setAnimationLoop(null);
 const lights=scene.children.filter(c=>c.isLight);
 const ambient=lights.find(c=>c.isAmbientLight), directional=lights.find(c=>c.isDirectionalLight);
 checks.defaultLightIntensities=lights.length===2 && ambient.intensity===1 && directional.intensity===1;
 checks.lightColors=ambient.color.getHex()===0xAAAAAA && directional.color.getHex()===0xffffff;
 checks.lightDirection=directional.position.toArray().join(',')==='-1,2,1' && directional.target.position.toArray().join(',')==='0,0,0';
 const state=helper.objects.get(mesh), data=mesh.geometry.userData.MMD;
 checks.wasmRuntime=doc.body.dataset.ammoBackend==='wasm';
 checks.buildIdentity=new URLSearchParams(location.search).get('bullet')==='legacy' ? !page.Ammo.bulletCommit : page.Ammo.bulletCommit==='d3afe76132fc76b0f9b2359cbaef47a3766e7fbb' && typeof page.Ammo.getWasmExports().emscripten_bind_btGeneric6DofSpringConstraint_setParam_3==='function';
 checks.bulletRuntime=doc.body.dataset.bulletBackend===(new URLSearchParams(location.search).get('bullet')==='legacy'?'ammojs-typed-1.1.0':'master-d3afe76132fc');
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
 // Controlled high-refresh smoke on the actual model and default runtime.
 // This only establishes finite short runs, not long-running visual stability.
 for(const fps of [60,120,144]) {
  const before=state.mixer.time;
  for(let i=0;i<12;i++) {
   helper.update(1/fps);
   if(!state.physics.bodyResults.every(r=>r.position.concat(r.quaternion).every(Number.isFinite)) || !mesh.skeleton.bones.every(b=>b.position.toArray().concat(b.quaternion.toArray()).every(Number.isFinite)))throw new Error('nonfinite Gene physics at '+fps+' FPS');
  }
  checks['finitePhysics'+fps]=true;
  checks['elapsedTime'+fps]=Math.abs(state.mixer.time-before-12/fps)<1e-8;
 }
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
 let pendingResizes=0;
 async function resizeFrame(width,height) {
  frame.width=width;frame.height=height;
  const deadline=performance.now()+5000;
  const wait=async condition=>{
   while(!condition()) {
    if(performance.now()>deadline)throw new Error('Gene resize timeout: '+JSON.stringify({expected:{width,height},pendingResizes,frame:frame.getBoundingClientRect().toJSON(),viewport:{width:page.innerWidth,height:page.innerHeight},canvas:{width:canvas.clientWidth,height:canvas.clientHeight}}));
    await new Promise(r=>setTimeout(r,25));
   }
  };
  // Wait for layout from the parent, whose timers remain active. Chrome can
  // defer a child frame's native resize event after scrollIntoView(), even
  // though its viewport has already changed. Exercise the registered handler
  // explicitly at that viewport instead of depending on event delivery timing.
  await wait(()=>page.innerWidth===width && page.innerHeight===height);
  page.dispatchEvent(new page.Event('resize'));
  await wait(()=>pendingResizes===0 && canvas.clientWidth===width && canvas.clientHeight===height);
 }
 // Mobile: open morph controls remain within the viewport and can be scrolled.
 progress('mobile resize');
 // A slow renderer resize must not race the layout assertions, even when it
 // exceeds the former 100 ms delay (notably with Linux's non-overlay scrollbars).
 const setSize=renderer.setSize;
 renderer.setSize=function(...args){pendingResizes++;setTimeout(()=>{setSize.apply(this,args);pendingResizes--;},400);return this;};
 await resizeFrame(360,640);
 checks.mobileCanvasSize=canvas.clientWidth===360 && canvas.clientHeight===640;
 renderer.setSize=setSize;
 const rect=gui.domElement.getBoundingClientRect();
 mobileLayout={rect:rect.toJSON(),width:page.innerWidth,height:page.innerHeight,clientWidth:doc.documentElement.clientWidth,clientHeight:doc.documentElement.clientHeight,canvas:{width:canvas.clientWidth,height:canvas.clientHeight},css:{top:page.getComputedStyle(gui.domElement).top,maxHeight:page.getComputedStyle(gui.domElement).maxHeight},scroll:{x:page.scrollX,y:page.scrollY}};
 checks.mobile=rect.left===0 && rect.bottom===page.innerHeight && rect.height<=page.innerHeight*0.5 && rect.width<=page.innerWidth*0.8;
 const ctrl=controller('メッシュなし').domElement;ctrl.scrollIntoView();const ir=ctrl.getBoundingClientRect();
 checks.mobileMorphReachable=ir.top>=rect.top && ir.bottom<=rect.bottom;
 await resizeFrame(1024,768);
 checks.desktopCanvasSize=canvas.clientWidth===1024 && canvas.clientHeight===768 && camera.aspect===1024/768;
 progress('desktop resize complete');
 morphFolder.close();
 checks.noIsolation=page.crossOriginIsolated===false;
 checks.noRuntimeErrors=errors.length===0;
 renderer.debug.onShaderError();checks.failure=doc.body.dataset.state==='error' && gui.controllersRecursive().every(c=>c._disabled) && doc.getElementById('status').textContent.includes('npm run examples:assets');
 frame.remove();
 // Missing PMX or textures must fail before enabling controls.
 for(const missing of ['model','texture']){
  progress('missing '+missing);
  const f=document.createElement('iframe');const loaded=new Promise(r=>f.onload=r);
  f.src='/examples/webgl_loader_mmd_pmx_gene.html?backend=webgl&missing='+missing+(new URLSearchParams(location.search).has('bullet')?'&bullet='+new URLSearchParams(location.search).get('bullet'):'');document.body.appendChild(f);await loaded;
  const ready=(await f.contentWindow.eval("import('/examples/webgl_loader_mmd_pmx_gene.js')")).ready;
  let rejected=false;try{await ready;}catch{rejected=true;}
  checks['missing_'+missing]=rejected && f.contentDocument.body.dataset.state==='error' && f.contentDocument.getElementById('controls').getAttribute('aria-disabled')==='true';f.remove();
 }
} catch(error) { document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({checks,mobileLayout,error:error.stack||String(error)})); }
if(document.getElementById('result').textContent==='pending')document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({checks,mobileLayout}));
</script>`;

for ( const bullet of [ '', 'legacy' ] ) test( `licensed pinned Gene Light renders and exercises its actual PMX features without cross-origin isolation, Bullet=${bullet || 'default (no query)'}`, { timeout: 180000, skip: process.env.MMD_EXAMPLE_FIXTURES === '1' ? 'Synthetic artifact only; real pinned Gene is checked by test:browser and the Pages build.' : false }, async t => {

	await fetchGeneLightAssets();
	assert.deepEqual( await inspectGeneLight(), JSON.parse( await readFile( new URL( '../../examples/gene-light-inspection.json', import.meta.url ), 'utf8' ) ) );
	const temporary = await mkdtemp( join( tmpdir(), 'gene-browser-' ) );
	const siteRoot = process.env.MMD_EXAMPLE_SITE && resolve( process.env.MMD_EXAMPLE_SITE );
	const prefix = siteRoot ? '/three-mmd-loader' : '';
	const app = createExamplesServer();
	const handler = app.listeners( 'request' )[ 0 ];
	let stage = 'browser launch';
	const server = createServer( async ( request, response ) => {

		if ( request.url?.startsWith( '/test-progress?' ) ) {

			stage = new URL( request.url, 'http://localhost' ).searchParams.get( 'stage' )!;
			response.writeHead( 204 ).end();

		} else if ( request.url?.startsWith( '/test' ) ) {

			response.writeHead( 200, { 'Content-Type': 'text/html' } ).end( harness.replaceAll( '/examples/', prefix + '/examples/' ) );

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
				const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.md': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
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
		const result = await runBrowser<Result>( base + '/test' + ( bullet ? '?bullet=' + bullet : '' ), join( temporary, 'profile' ), 'light', 150000 ).catch( error => { throw new Error( `${String( error )}; last progress: ${stage}` ); } );
		t.diagnostic( JSON.stringify( result.checks ) );
		t.diagnostic( JSON.stringify( result.mobileLayout ) );
		assert.equal( result.error, undefined, result.error );
		for ( const [ name, passed ] of Object.entries( result.checks ) ) assert.equal( passed, true, name );

	} finally {

		server.closeAllConnections();
		await new Promise<void>( resolve => server.close( () => resolve() ) );
		await removeBrowserDirectory( temporary );

	}

} );
