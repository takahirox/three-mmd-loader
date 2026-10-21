import { fetchGeneLightAssets } from '../../scripts/gene-light-assets.ts';
import { removeBrowserDirectory, runBrowser } from './browser.ts';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { createExamplesServer } from '../../scripts/serve-examples.ts';
import { cameraVmdBuffer, pmdBuffer, vmdBuffer } from '../fixtures.ts';

interface BrowserResult { page?: string; backend?: string; checks?: Record<string, boolean>; error?: string }
// Load the real pages in an iframe, then use their module's ready promise to
// exercise rendered scenes and their controls. No alternate app code path.
const harness = `<!doctype html><meta charset="utf-8"><pre id="result">pending</pre><script type="module">
const results = [];
function progress( stage ) { fetch( '/test-progress?stage=' + encodeURIComponent( stage ) ).catch( () => {} ); }
function checkInfo( page, doc ) {
	const info = doc.getElementById( 'info' );
	const css = page.getComputedStyle( info );
	const body = page.getComputedStyle( doc.body );
	const link = info.querySelector( 'a' );
	const linkCSS = page.getComputedStyle( link );
	const rect = info.getBoundingClientRect();
	return {
		info: doc.querySelectorAll( '#info' ).length === 1 && info.parentElement === doc.body,
		overlay: css.position === 'absolute' && rect.top === 0 && rect.left === 0 && rect.width === page.innerWidth && css.padding === '10px' && css.boxSizing === 'border-box' && css.textAlign === 'center' && css.zIndex === '1',
		passThrough: css.pointerEvents === 'none' && css.userSelect === 'none' && linkCSS.pointerEvents === 'auto',
		typography: body.fontFamily.toLowerCase() === 'monospace' && body.fontSize === '13px' && body.lineHeight === '24px' && body.margin === '0px' && body.overscrollBehavior === 'none',
		colors: body.backgroundColor === 'rgb(255, 255, 255)' && body.color === 'rgb(68, 68, 68)' && linkCSS.color === 'rgb(0, 136, 255)',
		links: linkCSS.textDecorationLine === 'none' && [...info.querySelectorAll( 'a[href^="https:"]' )].every( a => a.target === '_blank' && a.relList.contains( 'noopener' ) ),
		noCards: !doc.querySelector( '.panel, main, fieldset' ) && css.backgroundColor === 'rgba(0, 0, 0, 0)' && css.borderRadius === '0px',
		sharedCSS: doc.querySelectorAll( 'link[rel="stylesheet"]' ).length === 1 && doc.querySelector( 'link[rel="stylesheet"]' ).getAttribute( 'href' ) === './common.css' && [...doc.querySelectorAll( 'style' )].every( style => style.textContent.startsWith( '.lil-gui{' ) ),
		noHorizontalScroll: doc.documentElement.scrollWidth === page.innerWidth
	};
}
function frameLoaded( frame, transition = 'load' ) {
	return new Promise( ( resolve, reject ) => {
		const timeout = setTimeout( () => reject( new Error( 'Frame load timed out (' + transition + '): ' + ( frame.src || frame.contentWindow.location.href ) ) ), ${process.env.MMD_EXAMPLE_SITE ? 30000 : 8000} );
		frame.onload = () => { clearTimeout( timeout ); resolve(); };
	} );
}
async function resizeFrame( frame, width, height, expectedState ) {
	progress( 'resize ' + width + 'x' + height + ': ' + frame.contentWindow.location.pathname );
	frame.width = width;
	frame.height = height;
	// Resize and media-query change handlers can run after layout is updated.
	// Poll from the parent because Chrome can suspend offscreen iframe animation
	// callbacks. Elapsed time alone must never count as successful synchronization.
	const started = performance.now();
	const page = frame.contentWindow;
	while ( page.innerWidth !== width || page.innerHeight !== height || !expectedState() ) {
		if ( performance.now() - started >= ${process.env.MMD_EXAMPLE_SITE || process.env.MMD_EXAMPLE_ASSETS === '1' ? 15000 : 5000} ) throw new Error( 'Frame resize timed out: expected ' + width + 'x' + height + ' with matching layout/accessibility state; got ' + page.innerWidth + 'x' + page.innerHeight + ' at ' + page.location.pathname );
		await new Promise( resolve => setTimeout( resolve, 25 ) );
	}
	progress( 'resized ' + width + 'x' + height + ': ' + frame.contentWindow.location.pathname );
}
try {
	{
		const index = document.createElement( 'iframe' );
		index.width = 1024;
		index.height = 768;
		const indexLoaded = frameLoaded( index );
		index.src = '/examples/';
		document.body.appendChild( index );
		await indexLoaded;
		const page = index.contentWindow;
		const doc = index.contentDocument;
		await doc.fonts.ready;
		const panel = doc.getElementById( 'panel' );
		const navigation = doc.getElementById( 'contentWrapper' );
		const viewerArea = doc.getElementById( 'viewerArea' );
		const viewer = doc.getElementById( 'viewer' );
		const placeholder = doc.getElementById( 'placeholder' );
		const toggle = doc.getElementById( 'expandButton' );
		const cards = [...doc.querySelectorAll( '.card' )];
		const ids = [ 'webgl_loader_mmd', 'webgl_loader_mmd_audio', 'webgl_loader_mmd_pose', 'webgl_loader_mmd_worker', 'webgl_loader_mmd_pmx_gene' ];
		const css = element => page.getComputedStyle( element );
		function wideLayout( width ) {
			const panelRect = panel.getBoundingClientRect();
			const areaRect = viewerArea.getBoundingClientRect();
			return css( panel ).position === 'fixed' && panelRect.left === 0 && panelRect.top === 0 && panelRect.width === width && panelRect.height === page.innerHeight && areaRect.left === width && areaRect.top === 0 && areaRect.width === page.innerWidth - width && areaRect.height === page.innerHeight;
		}
		function mobileClosed() {
			const area = viewerArea.getBoundingClientRect();
			const frame = viewer.getBoundingClientRect();
			return !panel.classList.contains( 'open' ) && panel.getBoundingClientRect().height === 56 && toggle.getAttribute( 'aria-expanded' ) === 'false' && navigation.inert && !viewerArea.inert && area.left === 0 && area.top === 56 && area.width === page.innerWidth && area.height === page.innerHeight - 56 && frame.width === area.width && frame.height === area.height;
		}
		function mobileOpen() {
			const rect = navigation.getBoundingClientRect();
			return panel.classList.contains( 'open' ) && panel.getBoundingClientRect().height === page.innerHeight && toggle.getAttribute( 'aria-expanded' ) === 'true' && !navigation.inert && viewerArea.inert && rect.right === page.innerWidth && rect.width === Math.min( page.innerWidth - 60, 360 ) && rect.height === page.innerHeight;
		}
		function wideNavigation() {
			return !navigation.inert && !viewerArea.inert && toggle.getAttribute( 'aria-expanded' ) === 'true' && css( toggle ).display === 'none';
		}
		async function settle() { await new Promise( resolve => page.setTimeout( resolve, 30 ) ); }
		// Navigation polling belongs to the harness: a traversed frame can
		// suspend/cancel its timers and prevent its own deadline from running.
		async function pollSelection() { await new Promise( resolve => setTimeout( resolve, 30 ) ); }
		async function checkSelected( id ) {
			const started = performance.now();
			let context;
			// History can replace a restored document again after selection matches.
			// An import in the discarded realm can remain pending forever. Watch
			// from the harness and start over only when the document actually changes.
			while ( performance.now() - started < 15000 ) {
				const current = viewer.contentDocument;
				let timer;
				try {
					context = await Promise.race( [
						viewer.contentWindow.eval( "import('/examples/" + id + ".js')" ).then( module => module.ready ),
						new Promise( resolve => { timer = setInterval( () => {
							if ( viewer.contentDocument !== current || performance.now() - started >= 15000 ) resolve( undefined );
						}, 30 ); } )
					] );
				} catch ( error ) {
					if ( viewer.contentDocument === current ) throw error;
				} finally { clearInterval( timer ); }
				if ( context && viewer.contentDocument === current ) break;
				context = undefined;
				await waitForSelection( id );
			}
			if ( ! context ) throw new Error( 'Selected example readiness timed out: ' + id + ' at ' + viewer.contentWindow.location.href );
			progress( 'ready ' + id );
			context.renderer.setAnimationLoop( null );
			if ( id === 'webgl_loader_mmd' || id === 'webgl_loader_mmd_worker' ) {
				const expectedMode = id.endsWith( '_worker' ) ? 'worker' : 'sync';
				if ( context.helper.objects.get( context.mesh ).physics.requestedPhysicsMode !== expectedMode || context.gui.controllers.some( c => c.property === 'physicsMode' ) ) return false;
			}
			return viewer.contentWindow.location.pathname === '/examples/' + id + '.html' && viewer.contentDocument.body.dataset.state === 'ready' && context.renderer.domElement.getBoundingClientRect().width === viewer.clientWidth && page.location.hash === '#' + id && cards.filter( card => card.classList.contains( 'selected' ) ).length === 1 && doc.querySelector( '.selected' ).dataset.example === id && doc.querySelectorAll( 'a[aria-current="page"]' ).length === 1 && doc.querySelector( '.selected a' ).getAttribute( 'aria-current' ) === 'page' && !viewer.hidden && placeholder.hidden && page.location.pathname === '/examples/';
		}
		const indexChecks = {
			wideLayout: wideLayout( 300 ),
			placeholder: !placeholder.hidden && placeholder.textContent.includes( 'Select an example' ) && viewer.hidden && !viewer.hasAttribute( 'src' ) && !doc.querySelector( '.selected' ),
			cards: cards.length === ids.length && ids.every( ( id, i ) => cards[i].dataset.example === id && cards[i].querySelector( 'a' ).getAttribute( 'href' ) === './' + id + '.html' && cards[i].querySelector( 'a' ).target === 'viewer' && cards[i].querySelector( '.title' ).textContent.trim() ),
			geneTitle: doc.querySelector( '[data-example="webgl_loader_mmd_pmx_gene"] .title' ).textContent === 'PMX — Gene (Light)',
			workerTitle: doc.querySelector( '[data-example="webgl_loader_mmd_worker"] .title' ).textContent === 'Worker Physics',
			category: doc.querySelector( '#content h2' ).textContent === 'webgl / loaders / mmd',
			images: ids.every( ( id, i ) => { const image = cards[i].querySelector( 'img' ); return image.getAttribute( 'src' ) === './screenshots/' + id + '.jpg' && image.complete && image.naturalWidth === 400 && image.naturalHeight === 250 && image.alt.length > 0; } ),
			previewAspect: cards.every( card => { const rect = card.querySelector( '.cover' ).getBoundingClientRect(); return Math.abs( rect.height / rect.width - 9 / 16 ) < 0.001; } ),
			typography: css( doc.body ).fontFamily === '"Roboto Mono", monospace' && css( doc.body ).fontSize === '15px' && css( doc.body ).lineHeight === '25px' && doc.fonts.check( '15px "Roboto Mono"' ),
			lightColors: css( doc.body ).backgroundColor === 'rgb(255, 255, 255)' && css( doc.body ).color === 'rgb(68, 68, 68)' && css( cards[0] ).backgroundColor === 'rgb(247, 247, 247)',
			panelStyling: css( panel ).borderRight === '1px solid rgb(232, 232, 232)' && css( doc.getElementById( 'header' ) ).height === '48px' && css( doc.getElementById( 'content' ) ).paddingLeft === '16px',
			cardStyling: cards.every( card => css( card ).borderRadius === '3px' && css( card ).marginBottom === '16px' && css( card.querySelector( '.title' ) ).padding === '8px 12px 4px' ),
			credits: [ 'README.md', 'assets/mmd/Readme.txt' ].every( href => doc.querySelector( 'a[href="./' + href + '"]' ) ),
			wideNavigation: wideNavigation()
		};
		for ( const id of ids ) {
			progress( 'select ' + id );
			doc.querySelector( '[data-example="' + id + '"] a' ).click();
			await waitForSelection( id );
			indexChecks['select_' + id] = await checkSelected( id );
			indexChecks['highlight_' + id] = css( doc.querySelector( '.selected' ) ).boxShadow === 'rgb(4, 158, 244) 0px 0px 0px 3px' && css( doc.querySelector( '.selected a' ) ).color === 'rgb(4, 158, 244)';
		}
		const selectedDocument = viewer.contentDocument;
		doc.querySelector( '.selected a' ).click();
		await settle();
		indexChecks.repeatSelection = viewer.contentDocument === selectedDocument;
		// Selection and Back/Forward can restore an iframe from bfcache without firing load.
		// Wait for the selected, complete document and hash, then await its ready promise.
		async function waitForSelection( id ) {
			const started = performance.now();
			while ( performance.now() - started < 15000 ) {
				if ( page.location.hash === '#' + id && viewer.contentWindow.location.pathname === '/examples/' + id + '.html' && viewer.contentDocument.readyState === 'complete' && doc.querySelector( '.selected' )?.dataset.example === id ) return;
				await pollSelection();
			}
			throw new Error( 'Gallery selection timed out: ' + id + '; hash=' + page.location.hash + '; frame=' + viewer.contentWindow.location.href + '; state=' + viewer.contentDocument.body?.dataset.state );
		}
		progress( 'history Back' );
		page.history.back();
		await waitForSelection( ids.at( - 2 ) );
		indexChecks.historyBack = await checkSelected( ids.at( - 2 ) );
		progress( 'history Forward' );
		page.history.forward();
		await waitForSelection( ids.at( - 1 ) );
		indexChecks.historyForward = await checkSelected( ids.at( - 1 ) );
		let loaded;
		await resizeFrame( index, 360, 640, mobileClosed );
		indexChecks.mobileClosed = mobileClosed();
		toggle.click();
		await settle();
		indexChecks.mobileOpen = mobileOpen();
		doc.getElementById( 'panelScrim' ).click();
		await settle();
		indexChecks.mobileScrimCloses = mobileClosed();
		toggle.click();
		await settle();
		doc.getElementById( 'closeButton' ).click();
		await settle();
		indexChecks.mobileButtonCloses = mobileClosed() && doc.activeElement === toggle;
		toggle.click();
		await settle();
		doc.dispatchEvent( new page.KeyboardEvent( 'keydown', { key: 'Escape' } ) );
		await settle();
		indexChecks.mobileEscapeCloses = mobileClosed() && doc.activeElement === toggle;
		toggle.click();
		await settle();
		doc.querySelector( '[data-example="' + ids[0] + '"] a' ).click();
		await waitForSelection( ids[0] );
		indexChecks.mobileSelection = mobileClosed() && await checkSelected( ids[0] );
		toggle.click();
		await settle();
		doc.querySelector( '[data-example="webgl_loader_mmd_worker"] a' ).click();
		await waitForSelection( 'webgl_loader_mmd_worker' );
		indexChecks.mobileWorkerSelection = mobileClosed() && await checkSelected( 'webgl_loader_mmd_worker' );
		toggle.click();
		await settle();
		doc.querySelector( '[data-example="webgl_loader_mmd_pmx_gene"] a' ).click();
		await waitForSelection( 'webgl_loader_mmd_pmx_gene' );
		indexChecks.mobileGeneSelection = mobileClosed() && await checkSelected( 'webgl_loader_mmd_pmx_gene' );
		indexChecks.mobileNoScroll = doc.documentElement.scrollWidth === page.innerWidth;
		await resizeFrame( index, 640, 640, mobileClosed );
		indexChecks.breakpointMobile = mobileClosed();
		await resizeFrame( index, 641, 640, () => wideLayout( 300 ) && wideNavigation() );
		indexChecks.breakpointWide = wideLayout( 300 ) && wideNavigation();
		await resizeFrame( index, 1800, 900, () => wideLayout( 360 ) && wideNavigation() && css( doc.body ).fontSize === '17px' );
		indexChecks.extraWide = wideLayout( 360 ) && wideNavigation() && css( doc.body ).fontSize === '17px';
		await resizeFrame( index, 1024, 768, () => wideLayout( 300 ) && wideNavigation() );
		indexChecks.resizedWide = wideLayout( 300 ) && wideNavigation();
		page.location.hash = '#unknown_example';
		// Clearing src navigates the iframe asynchronously; wait for its actual
		// blank document instead of assuming it finishes in a 30 ms timer.
		const clearStarted = performance.now();
		while ( viewer.contentWindow.location.href !== 'about:blank' && performance.now() - clearStarted < 3000 ) await settle();
		await settle();
		indexChecks.invalidHash = viewer.contentWindow.location.href === 'about:blank' && viewer.hidden && !viewer.hasAttribute( 'src' ) && !placeholder.hidden && !doc.querySelector( '.selected' );
		page.location.hash = '';
		await settle();
		indexChecks.emptyHash = viewer.hidden && !placeholder.hidden;
		results.push( { page: 'index', checks: indexChecks } );
		index.remove();
		// Navigate a fresh browser document with a hash, rather than selecting first.
		for ( const id of ids ) {
			progress( 'direct ' + id );
			const direct = document.createElement( 'iframe' );
			direct.width = 360;
			direct.height = 640;
			const loaded = frameLoaded( direct );
			direct.src = '/examples/#' + id;
			document.body.appendChild( direct );
			await loaded;
			const doc = direct.contentDocument;
			const viewer = doc.getElementById( 'viewer' );
			const module = await viewer.contentWindow.eval( "import('/examples/" + id + ".js')" );
			const context = await module.ready;
			context.renderer.setAnimationLoop( null );
			if ( id === 'webgl_loader_mmd' || id === 'webgl_loader_mmd_worker' ) {
				indexChecks['directMode_' + id] = context.helper.objects.get( context.mesh ).physics.requestedPhysicsMode === ( id.endsWith( '_worker' ) ? 'worker' : 'sync' ) && !context.gui.controllers.some( c => c.property === 'physicsMode' );
			}
			indexChecks['direct_' + id] = viewer.contentWindow.location.pathname === '/examples/' + id + '.html' && viewer.contentDocument.body.dataset.state === 'ready' && doc.querySelector( '.selected' ).dataset.example === id && doc.querySelector( '.selected a' ).getAttribute( 'aria-current' ) === 'page' && doc.getElementById( 'placeholder' ).hidden && !doc.getElementById( 'panel' ).classList.contains( 'open' ) && doc.getElementById( 'expandButton' ).getAttribute( 'aria-expanded' ) === 'false';
			direct.remove();
		}
		const initialMobile = document.createElement( 'iframe' );
		initialMobile.width = 360;
		initialMobile.height = 640;
		loaded = frameLoaded( initialMobile );
		initialMobile.src = '/examples/';
		document.body.appendChild( initialMobile );
		await loaded;
		indexChecks.mobileInitialList = initialMobile.contentDocument.getElementById( 'panel' ).classList.contains( 'open' ) && initialMobile.contentDocument.getElementById( 'expandButton' ).getAttribute( 'aria-expanded' ) === 'true';
		initialMobile.remove();
	}
	for ( const backend of [ 'webgl', 'auto' ] ) for ( const suffix of [ '', '_audio', '_pose', '_worker' ] ) {
		progress( 'scene ' + suffix );
		const frame = document.createElement( 'iframe' );
		frame.width = 1024;
		frame.height = 768;
		const loaded = new Promise( resolve => frame.onload = resolve );
		frame.src = '/examples/webgl_loader_mmd' + suffix + '.html?backend=' + backend;
		document.body.appendChild( frame );
		await loaded;
		const page = frame.contentWindow;
		const doc = frame.contentDocument;
		const module = await page.eval( "import('/examples/webgl_loader_mmd" + suffix + ".js')" );
		const context = await module.ready;
		context.renderer.setAnimationLoop( null );
		const { mesh, helper, camera, effect, renderer, scene } = context;
		// Model readiness precedes queued Worker startup warmup. Controls and
		// playback assertions must start after the fixed-time ramp has finished.
		const startupPhysics = helper.objects.get( mesh )?.physics;
		const warmupDeadline = performance.now() + 10000;
		while ( startupPhysics?.workerStatus?.warmupRemaining || startupPhysics?.workerStatus?.inFlight ) {
			if ( performance.now() > warmupDeadline ) throw new Error( 'Worker startup warmup timeout' );
			await new Promise( resolve => setTimeout( resolve, 5 ) );
		}
		const checks = checkInfo( page, doc );
		checks.wasmRuntime = suffix === '_pose' || doc.body.dataset.ammoBackend === 'wasm' && page.Ammo.bulletCommit === 'd3afe76132fc76b0f9b2359cbaef47a3766e7fbb';
		checks.workerRemainsWorker = suffix !== '_worker' || helper.objects.get( mesh ).physics.physicsMode === 'worker';
		const control = name => [...doc.querySelectorAll( '#controls .controller' )].find( c => c.querySelector( '.name' ).textContent === name ).querySelector( 'input, select, button' );
		const info = doc.getElementById( 'info' );
		const gui = doc.getElementById( 'controls' );
		checks.infoContent = info.textContent.includes( doc.title.replace( 'MMD — ', '' ) ) && info.contains( doc.getElementById( 'status' ) ) && doc.getElementById( 'status' ).getAttribute( 'role' ) === 'status' && [ 'MMD / Crypton', 'hino', 'LamazeP', 'doramata / Takahiro', 'KEITEL' ].every( credit => info.querySelector( '.credits' ).textContent.includes( credit ) );
		checks.infoNavigation = [ './', './README.md', './assets/mmd/Readme.txt' ].every( href => info.querySelector( 'a[href="' + href + '"]' ) );
		checks.gui = gui.matches( '.lil-gui.root.autoPlace' ) && gui.parentElement === doc.body && page.getComputedStyle( gui ).zIndex === '2' && gui.getAttribute( 'aria-disabled' ) === 'false' && gui.getAttribute( 'aria-busy' ) === 'false' && [...gui.querySelectorAll( '.controller input, .controller select, .controller button' )].every( input => !input.disabled );
		const canvas = renderer.domElement;
		function checkViewport() {
			const rect = canvas.getBoundingClientRect();
			return rect.x === 0 && rect.y === 0 && rect.width === page.innerWidth && rect.height === page.innerHeight && camera.aspect === page.innerWidth / page.innerHeight && canvas.width === Math.floor( page.innerWidth * renderer.getPixelRatio() ) && canvas.height === Math.floor( page.innerHeight * renderer.getPixelRatio() );
		}
		checks.viewport = canvas.parentElement === doc.body && doc.querySelectorAll( 'canvas' ).length === 1 && checkViewport();
		checks.sceneColor = scene.background.getHex() === 0xffffff;
		const lights = scene.children.filter( child => child.isLight );
		const ambient = lights.find( child => child.isAmbientLight );
		const directional = lights.find( child => child.isDirectionalLight );
		checks.lightIntensities = lights.length === 2 && ambient.intensity === 1 && directional.intensity === 1;
		checks.lightColors = ambient.color.getHex() === 0xAAAAAA && directional.color.getHex() === 0xffffff;
		checks.lightDirection = directional.position.toArray().join( ',' ) === '-1,2,1' && directional.target.position.toArray().join( ',' ) === '0,0,0';
		let guiRect = gui.getBoundingClientRect();
		checks.desktopGUI = guiRect.right === page.innerWidth - 15 && guiRect.top === 0;
		await resizeFrame( frame, 360, 640, checkViewport );
		checks.mobileViewport = checkViewport();
		for ( const [ name, passed ] of Object.entries( checkInfo( page, doc ) ) ) checks['mobile_' + name] = passed;
		guiRect = gui.getBoundingClientRect();
		checks.mobileGUI = guiRect.left === 0 && guiRect.bottom === page.innerHeight && guiRect.width <= page.innerWidth * 0.8 && guiRect.height <= page.innerHeight * 0.5 && page.getComputedStyle( gui ).zIndex === '2';
		const outline = control( 'outline' );
		const outlineRect = outline.getBoundingClientRect();
		checks.mobileControlReachable = doc.elementFromPoint( outlineRect.x + outlineRect.width / 2, outlineRect.y + outlineRect.height / 2 ) === outline;
		await resizeFrame( frame, 1024, 768, checkViewport );
		checks.resizedViewport = checkViewport();
		checks.ready = doc.body.dataset.state === 'ready';
		checks.model = mesh.isSkinnedMesh && mesh.skeleton.bones.length > 0;
		outline.click();
		checks.outline = effect.enabled === false;
		outline.click();
		if ( suffix === '_pose' ) {
			const before = mesh.skeleton.bones.map( b => b.position.toArray().concat( b.quaternion.toArray() ) );
			const pose = control( 'Pose' );
			pose.selectedIndex = 1;
			pose.dispatchEvent( new page.Event( 'change' ) );
			checks.poses = context.poses.length === 11;
			checks.poseChanged = JSON.stringify( before ) !== JSON.stringify( mesh.skeleton.bones.map( b => b.position.toArray().concat( b.quaternion.toArray() ) ) );
			pose.selectedIndex = 0;
			pose.dispatchEvent( new page.Event( 'change' ) );
			checks.resetPose = JSON.stringify( before ) === JSON.stringify( mesh.skeleton.bones.map( b => b.position.toArray().concat( b.quaternion.toArray() ) ) );
			control( 'ik' ).click();
			checks.poseIK = context.gui.controllers.find( c => c.property === 'ik' ).getValue() === false;
			control( 'ik' ).click();
		} else {
			const state = helper.objects.get( mesh );
			checks.physics = !!state.physics;
			if ( suffix === '_worker' ) {
				checks.workerDefault = state.physics.requestedPhysicsMode === 'worker' && state.physics.physicsMode === 'worker' && state.physics.workerStatus.initialized && state.physics.transport === 'transferable';
				checks.actualMode = doc.getElementById( 'status' ).textContent.startsWith( 'worker / transferable' );
			} else checks.syncDefault = state.physics.requestedPhysicsMode === 'sync' && state.physics.physicsMode === 'sync';
			checks.animation = state.mixer._actions[ 0 ].getClip().tracks.length > 0;
			if ( suffix === '' || suffix === '_worker' ) {
				checks.noPhysicsSelector = !context.gui.controllers.some( c => c.property === 'physicsMode' ) && !gui.textContent.includes( 'Physics mode (reload)' );
				for ( const name of [ 'animation', 'ik', 'physics' ] ) {
					const input = control( name );
					input.click();
					checks[name + 'Toggle'] = helper.enabled[name] === false;
					input.click();
				}
				const hidden = scene.children.filter( child => !child.visible );
				control( 'show IK bones' ).click();
				control( 'show rigid bodies' ).click();
				checks.debugHelpers = hidden.length === 2 && hidden.every( child => child.visible );
				control( 'show IK bones' ).click();
				control( 'show rigid bodies' ).click();
			} else {
				checks.audioLoaded = context.audio.buffer.duration > 0 && helper.audioManager.delayTime === 160 / 30;
				checks.paused = !context.audio.isPlaying && helper.audioManager.elapsedTime === 0;
				const play = control( 'Play' );
				play.click();
				await new Promise( resolve => page.setTimeout( resolve, 50 ) );
				checks.play = play.textContent === 'Playing' && play.disabled && doc.getElementById( 'status' ).textContent === 'Playing';
				const before = camera.position.toArray();
				helper.update( 0.5 );
				checks.cameraAnimated = JSON.stringify( before ) !== JSON.stringify( camera.position.toArray() );
				helper.update( 160 / 30 );
				checks.audioPlaying = context.audio.isPlaying;
				context.audio.stop();
				await context.audio.context.close();
			}
			const before = mesh.skeleton.bones.map( b => b.position.toArray().concat( b.quaternion.toArray() ) );
			helper.update( 0.5 );
			checks.playbackClock = helper.objects.get( mesh ).mixer.time > 0;
			checks.bonesAnimated = JSON.stringify( before ) !== JSON.stringify( mesh.skeleton.bones.map( b => b.position.toArray().concat( b.quaternion.toArray() ) ) );
		}
		effect.render( scene, camera );
		checks.render = renderer.info.render.calls > 0 && doc.body.dataset.state === 'ready';
		checks.shaders = renderer.info.render.drawCalls > 0 && ( backend === 'webgl' || ! await page.navigator.gpu?.requestAdapter() ? renderer.backend.isWebGLBackend : renderer.backend.isWebGPUBackend );
		// A runtime failure must also disable controls that already exist.
		renderer.debug.onShaderError();
		checks.failureDisablesGUI = doc.body.dataset.state === 'error' && gui.getAttribute( 'aria-disabled' ) === 'true' && [...gui.querySelectorAll( '.controller input, .controller select, .controller button' )].every( input => input.disabled );
		results.push( { page: backend + ' ' + ( suffix || 'animation' ), backend: renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2', checks } );
		renderer.dispose();
		frame.remove();
	}
	// Exercise the no-query default on the actual served/built animation entries.
	for ( const suffix of [ '', '_worker' ] ) {
		progress( 'default Bullet ' + suffix );
		const frame=document.createElement('iframe');frame.width=800;frame.height=600;
		const loaded=new Promise(resolve=>frame.onload=resolve);
		frame.src='/examples/webgl_loader_mmd'+suffix+'.html';
		document.body.appendChild(frame);await loaded;
		const page=frame.contentWindow,doc=frame.contentDocument;
		const context=await (await page.eval("import('/examples/webgl_loader_mmd"+suffix+".js')")).ready;
		context.renderer.setAnimationLoop(null);
		const physics=context.helper.objects.get(context.mesh).physics;
		for(let frameIndex=0;frameIndex<12;frameIndex++) {
			context.helper.update(1/60);
			const deadline=performance.now()+8000;
			while(physics.workerStatus?.inFlight) {if(performance.now()>deadline)throw new Error('default Worker step timeout');await new Promise(resolve=>setTimeout(resolve,5));}
			context.helper.update(0);
		}
		results.push({page:'default '+(suffix||'sync'),checks:{
			ready:doc.body.dataset.state==='ready',source:doc.body.dataset.bulletBackend==='master-d3afe76132fc' && page.Ammo.bulletCommit==='d3afe76132fc76b0f9b2359cbaef47a3766e7fbb',
			exports:typeof page.Ammo.getWasmExports().emscripten_bind_btDiscreteDynamicsWorld_stepSimulation_3==='function',
			wasm:doc.body.dataset.ammoBackend==='wasm',mode:physics.physicsMode===(suffix?'worker':'sync'),
			settings:physics.unitStep===1/60 && physics.maxStepNum===10,
			finite:physics.bodyResults.every(body=>body.position.concat(body.quaternion).every(Number.isFinite)),
			communication:!suffix || physics.workerStatus.completedSequence>0
		}});
		page.dispatchEvent(new page.Event('pagehide'));frame.remove();
	}
	const missing = document.createElement( 'iframe' );
	const loaded = new Promise( resolve => missing.onload = resolve );
	missing.src = '/examples/webgl_loader_mmd.html?missing=1';
	document.body.appendChild( missing );
	await loaded;
	const module = await missing.contentWindow.eval( "import('/examples/webgl_loader_mmd.js')" );
	let rejected = false;
	try { await module.ready; } catch { rejected = true; }
	const doc = missing.contentDocument;
	results.push( { page: 'missing assets', checks: {
		rejected,
		error: doc.body.dataset.state === 'error',
		setup: doc.getElementById( 'status' ).textContent.includes( 'npm run examples:assets' ),
		disabled: doc.getElementById( 'controls' ).getAttribute( 'aria-disabled' ) === 'true' && [...doc.querySelectorAll( '#controls .controller input, #controls .controller select, #controls .controller button' )].every( input => input.disabled ),
		errorInInfo: doc.getElementById( 'info' ).contains( doc.getElementById( 'status' ) )
	} } );
	missing.remove();
} catch ( error ) {
	results.push( { error: error.stack || String( error ) } );
}
document.getElementById( 'result' ).textContent = encodeURIComponent( JSON.stringify( results ) );
</script>`;

const darkHarness = `<!doctype html><meta charset="utf-8"><pre id="result">pending</pre><script type="module">
const results = [];
try {
	const frame = document.createElement( 'iframe' );
	frame.width = 1024;
	frame.height = 768;
	const loaded = new Promise( resolve => frame.onload = resolve );
	frame.src = '/examples/';
	document.body.appendChild( frame );
	await loaded;
	const page = frame.contentWindow;
	const doc = frame.contentDocument;
	const css = element => page.getComputedStyle( element );
	results.push( { page: 'dark index', checks: {
		scheme: page.matchMedia( '(prefers-color-scheme: dark)' ).matches && css( doc.documentElement ).colorScheme === 'light dark',
		colors: css( doc.body ).backgroundColor === 'rgb(34, 34, 34)' && css( doc.body ).color === 'rgb(187, 187, 187)' && css( doc.querySelector( '.card' ) ).backgroundColor === 'rgb(46, 46, 46)',
		border: css( doc.getElementById( 'panel' ) ).borderRight === '1px solid rgb(68, 68, 68)',
		accent: css( doc.querySelector( '#content h2' ) ).color === 'rgb(4, 158, 244)'
	} } );
} catch ( error ) { results.push( { error: error.stack || String( error ) } ); }
document.getElementById( 'result' ).textContent = encodeURIComponent( JSON.stringify( results ) );
</script>`;

function wavBuffer() {

	const samples = 8000;
	const bytes = Buffer.alloc( 44 + samples * 2 );
	bytes.write( 'RIFF', 0 );
	bytes.writeUInt32LE( bytes.length - 8, 4 );
	bytes.write( 'WAVEfmt ', 8 );
	bytes.writeUInt32LE( 16, 16 );
	bytes.writeUInt16LE( 1, 20 ); // PCM, mono
	bytes.writeUInt16LE( 1, 22 );
	bytes.writeUInt32LE( 8000, 24 );
	bytes.writeUInt32LE( 16000, 28 );
	bytes.writeUInt16LE( 2, 32 );
	bytes.writeUInt16LE( 16, 34 );
	bytes.write( 'data', 36 );
	bytes.writeUInt32LE( samples * 2, 40 );
	return bytes;

}

test( 'example pages match Three.js layout, resize, render, and preserve interactive controls', { timeout: 360000 }, async t => {

	if ( ! process.env.MMD_EXAMPLE_SITE ) await fetchGeneLightAssets();
	const temporary = await mkdtemp( join( tmpdir(), 'three-mmd-examples-' ) );
	const assetRoot = join( temporary, 'assets' );
	for ( const dir of [ 'miku', 'vmds', 'vpds', 'audios' ] ) await mkdir( join( assetRoot, dir ), { recursive: true } );
	await writeFile( join( assetRoot, 'miku/miku_v2.pmd' ), Buffer.from( pmdBuffer() ) );
	await writeFile( join( assetRoot, 'vmds/wavefile_v2.vmd' ), Buffer.from( vmdBuffer() ) );
	await writeFile( join( assetRoot, 'vmds/wavefile_camera.vmd' ), Buffer.from( cameraVmdBuffer() ) );
	// AudioLoader detects the format from the bytes, regardless of the filename.
	await writeFile( join( assetRoot, 'audios/wavefile_short.mp3' ), wavBuffer() );
	for ( let i = 1; i <= 11; i ++ ) {

		await writeFile( join( assetRoot, `vpds/${String( i ).padStart( 2, '0' )}.vpd` ),
			`Vocaloid Pose Data file\n\ntriangle.osm;\n1;\n\nBone0{root\n  ${i}.0,0.0,0.0;\n  0.0,0.0,0.0,1.0;\n}\n` );

	}
	const app = createExamplesServer( process.env.MMD_EXAMPLE_ASSETS === '1' ? {} : { assetRoot } );
	const handler = app.listeners( 'request' )[ 0 ];
	const siteRoot = process.env.MMD_EXAMPLE_SITE && resolve( process.env.MMD_EXAMPLE_SITE );
	const prefix = siteRoot ? '/three-mmd-loader' : '';
	const validationStarted = performance.now();
	let lastStage = 'launch';
	const server = createServer( async ( request, response ) => {

		if ( request.url?.startsWith( '/test-progress?' ) ) {

			lastStage = new URL( request.url, 'http://localhost' ).searchParams.get( 'stage' ) || '';
			if ( siteRoot ) process.stderr.write( `Example progress ${Math.round( performance.now() - validationStarted )} ms: ${lastStage}\n` );
			response.writeHead( 204 ).end();

		} else if ( request.url === '/test' ) response.writeHead( 200, { 'Content-Type': 'text/html' } ).end( harness.replaceAll( '/examples/', prefix + '/examples/' ) );
		else if ( request.url === '/test-dark' ) response.writeHead( 200, { 'Content-Type': 'text/html' } ).end( darkHarness.replaceAll( '/examples/', prefix + '/examples/' ) );
		else if ( request.headers.referer?.includes( 'missing=1' ) && request.url?.startsWith( prefix + '/examples/assets/mmd/' ) ) {

			response.writeHead( 404 ).end();

		}
		else if ( siteRoot ) {

			// Serve only the artifact, at the GitHub Pages project prefix. Requests
			// to origin-root dependencies cannot fall back to the source checkout.
			try {

				let path = decodeURIComponent( new URL( request.url || '/', 'http://localhost' ).pathname );
				if ( ! path.startsWith( prefix + '/' ) ) throw new Error( 'Outside site' );
				if ( path.endsWith( '/' ) ) path += 'index.html';
				const file = resolve( siteRoot, path.slice( prefix.length + 1 ) );
				if ( ! file.startsWith( siteRoot + sep ) ) throw new Error( 'Outside site' );
				const content = await readFile( file );
				const types: Record<string, string> = { '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.bmp': 'image/bmp', '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
				response.writeHead( 200, { 'Content-Type': types[ extname( file ) ] || 'application/octet-stream' } ).end( content );

			} catch {

				response.writeHead( 404 ).end();

			}

		} else handler( request, response );

	} );
	try {

		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		if ( siteRoot ) {

			const landing = await fetch( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}${prefix}/` );
			assert.equal( landing.status, 200 );
			assert.match( await landing.text(), /url=\.\/examples\// );
			t.diagnostic( `Local artifact URL: http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}${prefix}/examples/` );
			const index = await fetch( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}${prefix}/examples/` );
			assert.equal( index.status, 200 );
			assert.match( await index.text(), /webgl_loader_mmd_audio.html/ );

		}
		// Both paths repeatedly initialize the real Gene scene as well as all four
		// Miku pages. Navigation and SwiftShader rendering can exceed two minutes;
		// give the complete five-page session the same bounded five-minute budget.
		const timeoutMs = 300000;
		const started = performance.now();
		const results = await runBrowser<BrowserResult[]>( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/test`, join( temporary, 'profile' ), 'light', timeoutMs ).catch( error => {

			t.diagnostic( `Last example stage: ${lastStage}` );
			throw error;

		} );
		t.diagnostic( `Light example validation: ${Math.round( performance.now() - started )} ms (budget ${timeoutMs} ms)` );
		assert.equal( results.length, 12, JSON.stringify( results ) );
		t.diagnostic( JSON.stringify( results.filter( result => result.backend ).map( result => ( { page: result.page, backend: result.backend } ) ) ) );
		const darkResults = await runBrowser<BrowserResult[]>( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/test-dark`, join( temporary, 'profile-dark' ), 'dark' );
		assert.equal( darkResults.length, 1, JSON.stringify( darkResults ) );
		for ( const result of [ ...results, ...darkResults ] ) {

			assert.equal( result.error, undefined, result.error );
			assert.ok( result.checks, JSON.stringify( results ) );
			for ( const [ check, value ] of Object.entries( result.checks ) ) {

				assert.equal( value, true, `${result.page}: ${check}` );

			}

		}

	} finally {

		server.closeAllConnections();
		await new Promise( resolve => server.close( resolve ) );
		await removeBrowserDirectory( temporary );

	}

} );
