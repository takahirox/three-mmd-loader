import {
	AmbientLight, Audio, AudioListener, AudioLoader, Color, DirectionalLight,
	LoadingManager, PerspectiveCamera, PolarGridHelper, Scene, WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { MMDLoader } from 'three-mmd-loader/loaders/MMDLoader.js';
import { MMDAnimationHelper } from 'three-mmd-loader/animation/MMDAnimationHelper.js';

const assets = './assets/mmd/';

export async function initExample( mode ) {

	const status = document.getElementById( 'status' );
	const controls = document.getElementById( 'controls' );
	let renderer;
	function fail( error ) {

		document.body.dataset.state = 'error';
		status.textContent = `Could not load the example: ${error.message || error}. Run npm run examples:assets, then reload. See Asset terms and setup below.`;
		controls.disabled = true;
		renderer?.setAnimationLoop( null );

	}
	try {

		const scene = new Scene();
		scene.background = new Color( 0xf4f6fa );
		scene.add( new PolarGridHelper( 30, 8 ), new AmbientLight( 0xffffff, 2 ) );
		const light = new DirectionalLight( 0xffffff, 3 );
		light.position.set( - 1, 2, 1 );
		scene.add( light );
		const camera = new PerspectiveCamera( 45, innerWidth / innerHeight, 0.1, 2000 );
		camera.position.set( 0, 12, 35 );
		camera.lookAt( 0, 10, 0 );
		scene.add( camera );
		renderer = new WebGLRenderer( { antialias: true } );
		renderer.setPixelRatio( Math.min( devicePixelRatio, 2 ) );
		document.body.appendChild( renderer.domElement );
		renderer.debug.onShaderError = () => fail( new Error( 'Shader compilation failed' ) );
		const effect = new OutlineEffect( renderer );
		const orbit = mode === 'audio' ? null : new OrbitControls( camera, renderer.domElement );
		if ( orbit ) {

			orbit.target.set( 0, 10, 0 );
			orbit.update();

		}
		function resize() {

			camera.aspect = innerWidth / innerHeight;
			camera.updateProjectionMatrix();
			effect.setSize( innerWidth, innerHeight );

		}
		addEventListener( 'resize', resize );
		resize();

		// The package expects an initialized Ammo runtime on globalThis.
		if ( mode !== 'pose' ) globalThis.Ammo = await globalThis.Ammo();
		const manager = new LoadingManager();
		const resourcesReady = new Promise( ( resolve, reject ) => {

			manager.onLoad = resolve;
			manager.onError = url => {

				const error = new Error( `Failed to load ${url}` );
				fail( error );
				reject( error );

			};

		} );
		// Attach a handler immediately, including for a failed model request.
		resourcesReady.catch( () => {} );
		manager.onProgress = ( url, loaded, total ) => {

			if ( document.body.dataset.state !== 'error' ) status.textContent = `Loading assets: ${loaded}/${total}`;

		};
		const loader = new MMDLoader( manager );
		const helper = new MMDAnimationHelper( { afterglow: mode === 'audio' ? 0 : 2 } );
		const modelURL = assets + 'miku/miku_v2.pmd';
		let mesh;
		if ( mode === 'pose' ) {

			mesh = await loader.loadAsync( modelURL );

		} else {

			const mmd = await new Promise( ( resolve, reject ) => {

				loader.loadWithAnimation( modelURL, [ assets + 'vmds/wavefile_v2.vmd' ], resolve, undefined, reject );

			} );
			mesh = mmd.mesh;
			helper.add( mesh, { animation: mmd.animation, physics: true } );

		}
		await resourcesReady;
		scene.add( mesh );
		const context = { mesh, helper, camera, scene, renderer, effect };
		function checkbox( name, checked, change ) {

			const label = document.createElement( 'label' );
			const input = document.createElement( 'input' );
			input.type = 'checkbox';
			input.name = name;
			input.checked = checked;
			input.addEventListener( 'change', () => change( input.checked ) );
			label.append( input, ` ${name}` );
			controls.appendChild( label );

		}
		let running = mode === 'animation';
		if ( mode === 'animation' ) {

			for ( const name of [ 'animation', 'ik', 'physics' ] ) {

				checkbox( name, true, value => helper.enable( name, value ) );

			}
			const object = helper.objects.get( mesh );
			const ik = object.ikSolver.createHelper();
			const physics = object.physics.createHelper();
			ik.visible = physics.visible = false;
			scene.add( ik, physics );
			checkbox( 'show IK bones', false, value => { ik.visible = value; } );
			checkbox( 'show rigid bodies', false, value => { physics.visible = value; } );

		} else if ( mode === 'audio' ) {

			const cameraAnimation = await new Promise( ( resolve, reject ) => {

				loader.loadAnimation( [ assets + 'vmds/wavefile_camera.vmd' ], camera, resolve, undefined, reject );

			} );
			helper.add( camera, { animation: cameraAnimation } );
			const listener = new AudioListener();
			camera.add( listener );
			const buffer = await new AudioLoader().loadAsync( assets + 'audios/wavefile_short.mp3' );
			const audio = new Audio( listener ).setBuffer( buffer );
			// WAVEFILE's dance starts 160 frames before its music (30 fps).
			helper.add( audio, { delayTime: 160 / 30 } );
			context.audio = audio;
			const play = document.createElement( 'button' );
			play.id = 'play';
			play.textContent = 'Play';
			play.addEventListener( 'click', async () => {

				play.disabled = true;
				try {

					// Resume in the click handler to satisfy browser audio policies.
					await listener.context.resume();
					previousTime = null;
					running = true;
					play.textContent = 'Playing';

				} catch ( error ) {

					fail( error );

				}

			} );
			controls.appendChild( play );

		} else {

			// VPD files use Shift_JIS, so isUnicode is false.
			const poses = await Promise.all( Array.from( { length: 11 }, ( _, i ) => new Promise( ( resolve, reject ) => {

				const file = String( i + 1 ).padStart( 2, '0' ) + '.vpd';
				loader.loadVPD( assets + 'vpds/' + file, false, resolve, undefined, reject );

			} ) ) );
			const label = document.createElement( 'label' );
			label.textContent = 'Pose ';
			const select = document.createElement( 'select' );
			select.id = 'pose';
			select.add( new Option( 'Rest pose', '-1' ) );
			for ( let i = 0; i < poses.length; i ++ ) select.add( new Option( `Pose ${i + 1}`, String( i ) ) );
			let ik = true;
			function applyPose() {

				if ( select.value === '-1' ) mesh.pose();
				else helper.pose( mesh, poses[ Number( select.value ) ], { ik } );

			}
			select.addEventListener( 'change', applyPose );
			label.appendChild( select );
			controls.appendChild( label );
			checkbox( 'ik', true, value => { ik = value; applyPose(); } );
			context.poses = poses;

		}
		checkbox( 'outline', true, value => { effect.enabled = value; } );
		controls.disabled = false;
		status.textContent = mode === 'audio' ? 'Ready — press Play to start.' : 'Ready';
		let previousTime = null;
		renderer.setAnimationLoop( time => {

			try {

				const delta = previousTime === null ? 0 : Math.min( ( time - previousTime ) / 1000, 0.1 );
				previousTime = time;
				if ( running ) helper.update( delta );
				effect.render( scene, camera );

			} catch ( error ) {

				fail( error );

			}

		} );
		// Compile and render once before reporting success, even in background tabs.
		effect.render( scene, camera );
		if ( document.body.dataset.state === 'error' ) throw new Error( status.textContent );
		document.body.dataset.state = 'ready';
		return context;

	} catch ( error ) {

		fail( error );
		throw error;

	}

}
