import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { pmdBuffer, pmxBuffer } from '../fixtures.js';

const root = fileURLToPath( new URL( '../../', import.meta.url ) );
const chrome = process.env.CHROME_BIN || ( process.platform === 'darwin'
	? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
	: process.platform === 'win32'
		? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
		: 'google-chrome' );

test( 'PMD and PMX models without morphs compile toon, textured, and matcap shaders', { timeout: 60000 }, async () => {

	const fixtures = { pmd: Array.from( new Uint8Array( pmdBuffer() ) ), pmx: Array.from( new Uint8Array( pmxBuffer() ) ) };
	const html = `<!doctype html>
<script type="importmap">{"imports":{
	"three":"/node_modules/three/build/three.module.js",
	"three/addons/":"/node_modules/three/examples/jsm/"
}}</script>
<pre id="result">pending</pre>
<script type="module">
import {
	AddOperation, AmbientLight, DataTexture, DirectionalLight, MultiplyOperation,
	PerspectiveCamera, Scene, WebGLRenderer
} from 'three';
import { MMDLoader } from '/src/loaders/MMDLoader.js';
import { MMDParser } from '/src/libs/mmdparser.module.js';

const result = { cases: [], errors: [] };
try {

	const renderer = new WebGLRenderer();
	renderer.setSize( 32, 32 );
	const gl = renderer.getContext();
	renderer.debug.onShaderError = ( gl, program, vertex, fragment ) => {

		result.errors.push( [ gl.getProgramInfoLog( program ), gl.getShaderInfoLog( vertex ), gl.getShaderInfoLog( fragment ) ] );

	};
	const camera = new PerspectiveCamera( 45, 1, 0.1, 10 );
	camera.position.set( 0.5, 0.5, 3 );
	camera.lookAt( 0.5, 0.5, - 1 );
	const texture = new DataTexture( new Uint8Array( [ 255, 255, 255, 255 ] ), 1, 1 );
	texture.needsUpdate = true;
	const loader = new MMDLoader();
	// Generated textures avoid depending on image decoding or external assets.
	loader.meshBuilder.materialBuilder.textureLoader.load = () => texture;
	for ( const [ format, bytes ] of Object.entries( ${JSON.stringify( fixtures )} ) ) {

		for ( const variant of [ 'toon', 'textured', 'matcap-add', 'matcap-multiply' ] ) {

			const parser = new MMDParser.Parser();
			const buffer = new Uint8Array( bytes ).buffer;
			const data = format === 'pmd' ? parser.parsePmd( buffer, true ) : parser.parsePmx( buffer, true );
			const mesh = loader.meshBuilder.build( data, '' );
			mesh.frustumCulled = false;
			const material = mesh.material[ 0 ];
			if ( variant !== 'toon' ) material.map = texture;
			if ( variant.startsWith( 'matcap' ) ) {

				material.matcap = texture;
				material.matcapCombine = variant === 'matcap-add' ? AddOperation : MultiplyOperation;

			}
			const scene = new Scene();
			scene.add( mesh, new AmbientLight(), new DirectionalLight() );
			renderer.compile( scene, camera );
			renderer.render( scene, camera );
			result.cases.push( {
				format, variant,
				programs: renderer.info.programs.map( program => ( {
					vertex: gl.getShaderParameter( program.vertexShader, gl.COMPILE_STATUS ),
					fragment: gl.getShaderParameter( program.fragmentShader, gl.COMPILE_STATUS ),
					linked: gl.getProgramParameter( program.program, gl.LINK_STATUS )
				} ) )
			} );
			mesh.geometry.dispose();
			material.dispose();

		}

	}
	texture.dispose();
	renderer.dispose();

} catch ( error ) {

	result.errors.push( error.stack );

}
document.getElementById( 'result' ).textContent = encodeURIComponent( JSON.stringify( result ) );
</script>`;
	const server = createServer( async ( request, response ) => {

		const path = new URL( request.url, 'http://localhost' ).pathname;
		if ( path === '/' ) {

			response.setHeader( 'Content-Type', 'text/html' );
			response.end( html );
			return;

		}
		// Serve only the modules required by the regression page.
		if ( ! /^(\/src\/|\/node_modules\/three\/).+\.js$/.test( path ) ) {

			response.writeHead( 404 ).end();
			return;

		}
		try {

			const source = await readFile( join( root, path.slice( 1 ) ) );
			response.setHeader( 'Content-Type', 'text/javascript' );
			response.end( source );

		} catch {

			response.writeHead( 404 ).end();

		}

	} );
	const profile = await mkdtemp( join( tmpdir(), 'three-mmd-shader-test-' ) );
	try {

		await new Promise( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const { stdout } = await promisify( execFile )( chrome, [
			'--headless', '--no-first-run', '--no-default-browser-check',
			'--use-angle=swiftshader', '--enable-unsafe-swiftshader',
			'--dump-dom',
			`--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}/`
		], { timeout: 45000, maxBuffer: 1024 * 1024 } );
		const match = stdout.match( /<pre id="result">([^<]+)<\/pre>/ );
		assert.ok( match && match[ 1 ] !== 'pending', 'Browser did not complete shader validation' );
		const result = JSON.parse( decodeURIComponent( match[ 1 ] ) );
		assert.equal( result.errors.length, 0, JSON.stringify( result.errors[ 0 ] ) );
		assert.equal( result.cases.length, 8 );
		for ( const { format, variant, programs } of result.cases ) {

			assert.equal( programs.length, 1, `${format} ${variant}: expected one shader program` );
			assert.deepEqual( programs[ 0 ], { vertex: true, fragment: true, linked: true }, `${format} ${variant}` );

		}

	} finally {

		await new Promise( resolve => server.close( resolve ) );
		await rm( profile, { recursive: true, force: true } );

	}

} );
