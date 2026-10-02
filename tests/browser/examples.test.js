import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { createExamplesServer } from '../../scripts/serve-examples.js';
import { cameraVmdBuffer, pmdBuffer, vmdBuffer } from '../fixtures.js';

const chrome = process.env.CHROME_BIN || ( process.platform === 'darwin'
	? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
	: process.platform === 'win32'
		? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
		: 'google-chrome' );

// Use Chrome's DevTools pipe so asynchronous audio work can finish on the
// normal browser clock. A virtual clock can stall AudioContext operations.
async function runBrowser( url, profile ) {

	const browser = spawn( chrome, [
		'--headless', '--no-first-run', '--no-default-browser-check',
		'--use-angle=swiftshader', '--enable-unsafe-swiftshader',
		'--autoplay-policy=no-user-gesture-required', '--remote-debugging-pipe',
		`--user-data-dir=${profile}`
	], { stdio: [ 'ignore', 'ignore', 'ignore', 'pipe', 'pipe' ] } );
	const pending = new Map();
	const events = new Map();
	let nextID = 0;
	let buffer = '';
	function rejectPending( error ) {

		for ( const { reject } of pending.values() ) reject( error );
		for ( const { reject } of events.values() ) reject( error );
		pending.clear();
		events.clear();

	}
	browser.on( 'error', rejectPending );
	browser.on( 'exit', () => rejectPending( new Error( 'Chrome exited before validation finished' ) ) );
	browser.stdio[ 4 ].setEncoding( 'utf8' );
	browser.stdio[ 4 ].on( 'data', chunk => {

		buffer += chunk;
		let index;
		while ( ( index = buffer.indexOf( '\0' ) ) !== -1 ) {

			const message = JSON.parse( buffer.slice( 0, index ) );
			buffer = buffer.slice( index + 1 );
			const eventKey = `${message.sessionId}:${message.method}`;
			if ( events.has( eventKey ) ) {

				events.get( eventKey ).resolve( message.params );
				events.delete( eventKey );

			}
			const entry = pending.get( message.id );
			if ( ! entry ) continue;
			pending.delete( message.id );
			if ( message.error ) entry.reject( new Error( message.error.message ) );
			else entry.resolve( message.result );

		}

	} );
	function send( method, params = {}, sessionId ) {

		return new Promise( ( resolve, reject ) => {

			const id = ++ nextID;
			pending.set( id, { resolve, reject } );
			browser.stdio[ 3 ].write( JSON.stringify( { id, method, params, sessionId } ) + '\0' );

		} );

	}
	const timeout = setTimeout( () => {

		rejectPending( new Error( 'Chrome did not finish examples validation within 45 seconds' ) );
		browser.kill();

	}, 45000 );
	try {

		const { targetId } = await send( 'Target.createTarget', { url: 'about:blank' } );
		const { sessionId } = await send( 'Target.attachToTarget', { targetId, flatten: true } );
		await send( 'Page.enable', {}, sessionId );
		const loaded = new Promise( ( resolve, reject ) => {

			events.set( `${sessionId}:Page.loadEventFired`, { resolve, reject } );

		} );
		await send( 'Page.navigate', { url }, sessionId );
		await loaded;
		const result = await send( 'Runtime.evaluate', {
			expression: `new Promise( resolve => {
				const timer = setInterval( () => {
					const result = document.getElementById( 'result' );
					if ( result && result.textContent !== 'pending' ) {
						clearInterval( timer );
						resolve( result.textContent );
					}
				}, 50 );
			} )`,
			awaitPromise: true, returnByValue: true
		}, sessionId );
		assert.equal( result.exceptionDetails, undefined, JSON.stringify( result.exceptionDetails ) );
		return JSON.parse( decodeURIComponent( result.result.value ) );

	} finally {

		clearTimeout( timeout );
		browser.kill();
		if ( browser.exitCode === null && browser.signalCode === null ) {

			await new Promise( resolve => browser.once( 'exit', resolve ) );

		}

	}

}

// Load the real pages in an iframe, then use their module's ready promise to
// exercise rendered scenes and their controls. No alternate app code path.
const harness = `<!doctype html><meta charset="utf-8"><pre id="result">pending</pre><script type="module">
const results = [];
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
async function resizeFrame( frame, width, height ) {
	frame.width = width;
	frame.height = height;
	// Let the iframe's resize event and layout finish before reading geometry.
	await new Promise( resolve => frame.contentWindow.requestAnimationFrame( () => frame.contentWindow.requestAnimationFrame( resolve ) ) );
}
try {
	const index = document.createElement( 'iframe' );
	index.width = 1024;
	index.height = 768;
	const indexLoaded = new Promise( resolve => index.onload = resolve );
	index.src = '/examples/';
	document.body.appendChild( index );
	await indexLoaded;
	const indexChecks = checkInfo( index.contentWindow, index.contentDocument );
	indexChecks.navigation = [ 'webgl_loader_mmd.html', 'webgl_loader_mmd_audio.html', 'webgl_loader_mmd_pose.html', 'README.md', 'assets/mmd/Readme.txt' ].every( href => index.contentDocument.querySelector( 'a[href="./' + href + '"]' ) );
	await resizeFrame( index, 360, 640 );
	for ( const [ name, passed ] of Object.entries( checkInfo( index.contentWindow, index.contentDocument ) ) ) indexChecks['mobile_' + name] = passed;
	results.push( { page: 'index', checks: indexChecks } );
	index.remove();
	for ( const suffix of [ '', '_audio', '_pose' ] ) {
		const frame = document.createElement( 'iframe' );
		frame.width = 1024;
		frame.height = 768;
		const loaded = new Promise( resolve => frame.onload = resolve );
		frame.src = '/examples/webgl_loader_mmd' + suffix + '.html';
		document.body.appendChild( frame );
		await loaded;
		const page = frame.contentWindow;
		const doc = frame.contentDocument;
		const module = await page.eval( "import('/examples/webgl_loader_mmd" + suffix + ".js')" );
		const context = await module.ready;
		context.renderer.setAnimationLoop( null );
		const { mesh, helper, camera, effect, renderer, scene } = context;
		const checks = checkInfo( page, doc );
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
		let guiRect = gui.getBoundingClientRect();
		checks.desktopGUI = guiRect.right === page.innerWidth - 15 && guiRect.top === 0;
		await resizeFrame( frame, 360, 640 );
		checks.mobileViewport = checkViewport();
		for ( const [ name, passed ] of Object.entries( checkInfo( page, doc ) ) ) checks['mobile_' + name] = passed;
		guiRect = gui.getBoundingClientRect();
		checks.mobileGUI = guiRect.left === 0 && guiRect.bottom === page.innerHeight && guiRect.width <= page.innerWidth * 0.8 && guiRect.height <= page.innerHeight * 0.5 && page.getComputedStyle( gui ).zIndex === '2';
		const outline = control( 'outline' );
		const outlineRect = outline.getBoundingClientRect();
		checks.mobileControlReachable = doc.elementFromPoint( outlineRect.x + outlineRect.width / 2, outlineRect.y + outlineRect.height / 2 ) === outline;
		await resizeFrame( frame, 1024, 768 );
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
			checks.animation = state.mixer._actions[ 0 ].getClip().tracks.length > 0;
			if ( suffix === '' ) {
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
			checks.bonesAnimated = JSON.stringify( before ) !== JSON.stringify( mesh.skeleton.bones.map( b => b.position.toArray().concat( b.quaternion.toArray() ) ) );
		}
		effect.render( scene, camera );
		checks.render = renderer.info.render.calls > 0 && doc.body.dataset.state === 'ready';
		checks.shaders = renderer.info.programs.length > 0 && renderer.info.programs.every( p => {
			const gl = renderer.getContext();
			return gl.getProgramParameter( p.program, gl.LINK_STATUS );
		} );
		// A runtime failure must also disable controls that already exist.
		renderer.debug.onShaderError();
		checks.failureDisablesGUI = doc.body.dataset.state === 'error' && gui.getAttribute( 'aria-disabled' ) === 'true' && [...gui.querySelectorAll( '.controller input, .controller select, .controller button' )].every( input => input.disabled );
		results.push( { page: suffix || 'animation', checks } );
		renderer.dispose();
		frame.remove();
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

test( 'example pages match Three.js layout, resize, render, and preserve interactive controls', { timeout: 90000 }, async () => {

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
	const server = createServer( async ( request, response ) => {

		if ( request.url === '/test' ) response.writeHead( 200, { 'Content-Type': 'text/html' } ).end( harness.replaceAll( '/examples/', prefix + '/examples/' ) );
		else if ( request.headers.referer?.includes( 'missing=1' ) && request.url.startsWith( prefix + '/examples/assets/mmd/' ) ) {

			response.writeHead( 404 ).end();

		}
		else if ( siteRoot ) {

			// Serve only the artifact, at the GitHub Pages project prefix. Requests
			// to origin-root dependencies cannot fall back to the source checkout.
			try {

				let path = decodeURIComponent( new URL( request.url, 'http://localhost' ).pathname );
				if ( ! path.startsWith( prefix + '/' ) ) throw new Error( 'Outside site' );
				if ( path.endsWith( '/' ) ) path += 'index.html';
				const file = resolve( siteRoot, path.slice( prefix.length + 1 ) );
				if ( ! file.startsWith( siteRoot + sep ) ) throw new Error( 'Outside site' );
				const content = await readFile( file );
				const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.bmp': 'image/bmp', '.mp3': 'audio/mpeg' };
				response.writeHead( 200, { 'Content-Type': types[ extname( file ) ] || 'application/octet-stream' } ).end( content );

			} catch {

				response.writeHead( 404 ).end();

			}

		} else handler( request, response );

	} );
	try {

		await new Promise( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		if ( siteRoot ) {

			const landing = await fetch( `http://127.0.0.1:${server.address().port}${prefix}/` );
			assert.equal( landing.status, 200 );
			assert.match( await landing.text(), /url=\.\/examples\// );
			const index = await fetch( `http://127.0.0.1:${server.address().port}${prefix}/examples/` );
			assert.equal( index.status, 200 );
			assert.match( await index.text(), /webgl_loader_mmd_audio.html/ );

		}
		const results = await runBrowser( `http://127.0.0.1:${server.address().port}/test`, join( temporary, 'profile' ) );
		assert.equal( results.length, 5, JSON.stringify( results ) );
		for ( const result of results ) {

			assert.equal( result.error, undefined, result.error );
			assert.ok( result.checks, JSON.stringify( results ) );
			for ( const [ check, value ] of Object.entries( result.checks ) ) {

				assert.equal( value, true, `${result.page}: ${check}` );

			}

		}

	} finally {

		server.closeAllConnections();
		await new Promise( resolve => server.close( resolve ) );
		await rm( temporary, { recursive: true, force: true } );

	}

} );
