import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { linkedCollisionBuffer } from '../fixtures.ts';
import { removeBrowserDirectory, runBrowser } from './browser.ts';

const root = fileURLToPath( new URL( '../../', import.meta.url ) );
const packagePath = '/node_modules/@takahirox/three-mmd/';
const harness = `<!doctype html><pre id="result">pending</pre>
<script>
globalThis.wasmInstances=[];
for(const key of ['instantiate','instantiateStreaming']) {
 const native=WebAssembly[key];
 WebAssembly[key]=async function(...args) {
  const result=await native.apply(WebAssembly,args);
  wasmInstances.push(result.instance||result);return result;
 };
}
</script>
<script type="importmap">{"imports":{
 "three":"/node_modules/three/build/three.module.js",
 "three/addons/":"/node_modules/three/examples/jsm/",
 "three/tsl":"/node_modules/three/build/three.tsl.js",
 "three/webgpu":"/node_modules/three/build/three.webgpu.js",
 "mmd-parser":"/node_modules/mmd-parser/build/mmdparser.module.mjs",
 "@takahirox/three-mmd":"${packagePath}dist/index.js",
 "@takahirox/three-mmd/":"${packagePath}dist/"
}}</script>
<script src="${packagePath}dist/vendor/bullet/ammo.js"></script>
<script type="module">
const checks={};
function check(name,value){if(!value)throw new Error(name);checks[name]=true;}
try {
 const entry=await import('@takahirox/three-mmd');
 const manifest=await (await fetch('${packagePath}package.json')).json();
 for(const path of Object.keys(manifest.exports).filter(path=>path!=='.')) {
  const subpath=await import('@takahirox/three-mmd/'+path.slice(2));
  check(path,Object.entries(subpath).every(([key,value])=>entry[key]===value));
 }
 const ammoURL=new URL('${packagePath}dist/vendor/bullet/ammo.js',location.href);
 globalThis.Ammo=await Ammo({locateFile:path=>new URL(path,ammoURL).href});
 check('main uses real packaged WASM',wasmInstances.some(instance=>instance.exports===Ammo.getWasmExports()));
 check('pinned Bullet identity',Ammo.bulletCommit==='d3afe76132fc76b0f9b2359cbaef47a3766e7fbb');
 const {Texture}=await import('three');
 const loader=new entry.MMDLoader();loader.meshBuilder.materialBuilder.textureLoader.load=()=>new Texture();
 for(const physicsMode of ['sync','worker']) {
  const mesh=await loader.loadAsync('/model.pmd'),meta=mesh.geometry.userData.MMD;
  const physics=new entry.MMDPhysics(mesh,meta.rigidBodies,meta.constraints,{
   physicsMode,workerPhysics:{ammoURL:ammoURL.href}
  });
  try {
   await physics.ready;
   check(physicsMode+' initialized without fallback',physics.physicsMode===physicsMode && !physics.initializationError);
   physics.update(1/60);
   if(physicsMode==='worker') {
    const deadline=performance.now()+10000;
    while(!physics.workerStatus.completedSequence) {
     if(performance.now()>deadline)throw new Error('packaged Worker step timeout');
     await new Promise(resolve=>setTimeout(resolve,5));
    }
    physics.workerAdapter.project();
    check('non-isolated Worker uses transferables',physics.transport==='transferable');
   }
   check(physicsMode+' finite native body results',physics.bodyResults.length>0 && physics.bodyResults.every(body=>body.position.concat(body.quaternion).every(Number.isFinite)));
  } finally {physics.dispose();mesh.geometry.dispose();mesh.skeleton.dispose();mesh.material.forEach(material=>material.dispose());}
 }
 document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({checks}));
} catch(error) {document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({error:String(error),checks}));}
</script>`;

test( 'tarball consumer initializes shipped Bullet WASM and the default classic Worker without source aliases', { timeout: 90000 }, async () => {

	const consumer = await mkdtemp( join( tmpdir(), 'three-mmd-browser-package-' ) );
	const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
	const options = { cwd: consumer, encoding: 'utf8' as const, timeout: 30000, env: { ...process.env, npm_config_dry_run: 'false' } };
	let binaryRequests = 0, workerRequests = 0;
	const server = createServer( async ( request, response ) => {

		const path = new URL( request.url!, 'http://localhost' ).pathname;
		if ( path === '/' ) response.writeHead( 200, { 'Content-Type': 'text/html' } ).end( harness );
		else if ( path === '/model.pmd' ) response.writeHead( 200 ).end( Buffer.from( linkedCollisionBuffer( 'pmd', { masks: [ 0, 0 ] } ) ) );
		else {

			try {

				// Only installed files are served; no checkout fallback or source aliases.
				const file = resolve( consumer, '.' + decodeURIComponent( path ) );
				assert.ok( file.startsWith( join( consumer, 'node_modules' ) + sep ) );
				const content = await readFile( file );
				if ( path.endsWith( '/ammo.wasm' ) ) binaryRequests ++;
				if ( path.endsWith( '/MMDPhysicsWorker.js' ) ) workerRequests ++;
				const types: Record<string, string> = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
				// Avoid cache reuse so both main and Worker binary loads are observed.
				response.writeHead( 200, { 'Content-Type': types[ extname( file ) ] || 'application/octet-stream', 'Cache-Control': 'no-store' } ).end( content );

			} catch { response.writeHead( 404 ).end(); }

		}

	} );
	try {

		const packed = [];
		for ( const directory of [ root, join( root, 'node_modules/three' ), join( root, 'node_modules/mmd-parser' ) ] ) {

			const [ result ] = JSON.parse( execFileSync( npm, [ 'pack', directory, '--json', '--pack-destination', consumer, '--ignore-scripts' ], options ) );
			packed.push( result.filename as string );

		}
		await writeFile( join( consumer, 'package.json' ), JSON.stringify( {
			private: true, type: 'module', overrides: { 'mmd-parser': `file:./${packed[ 2 ]}` },
			dependencies: { '@takahirox/three-mmd': `file:./${packed[ 0 ]}`, three: `file:./${packed[ 1 ]}` }
		} ) );
		execFileSync( npm, [ 'install', '--offline', '--cache', join( consumer, 'empty-cache' ), '--ignore-scripts', '--no-audit', '--no-fund' ], options );
		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const address = server.address(); assert.ok( address && typeof address !== 'string' );
		const result = await runBrowser<{ error?: string; checks: Record<string, boolean> }>( `http://127.0.0.1:${address.port}/`, join( consumer, 'profile' ) );
		assert.equal( result.error, undefined, JSON.stringify( result ) );
		assert.ok( Object.values( result.checks ).every( Boolean ) );
		assert.equal( workerRequests, 1, 'must load the shipped default classic Worker' );
		assert.equal( binaryRequests, 2, 'main thread and real Worker must each load installed WASM' );

	} finally {

		server.closeAllConnections();
		if ( server.listening ) await new Promise( resolve => server.close( resolve ) );
		await removeBrowserDirectory( consumer );

	}

} );
