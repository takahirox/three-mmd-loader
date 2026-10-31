import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pmdBuffer, pmxBuffer, subtexturePngBuffer } from '../fixtures.ts';
import { removeBrowserDirectory, runBrowser } from './browser.ts';

const names: [ string, string, string ] = [ 'tex\\base.png', 'tex//part/../sphere.png', 'tex\\custom/toon.png' ];
const portableNames = [ 'tex\\hair.png', './tex//hair.png', 'tex/./hair.png', 'tex\\日本 語😀.png', 'tex/a%20b%23c.png', 'tex/a b#c.png', 'tex/%25FF.png', 'tex/100%25ab.png' ];
const unsafeNames = [ '..\\escape.png', 'tex/../../escape.png', '%252e%252e/escape.png', 'tex/%2fescape.png', 'tex/%255cescape.png', 'tex/%2500.png', 'tex/bad%zz.png' ];
const pmdSphereNames = [ 't\\s.sph', 't/s%2esph', 't/s.sph/.', 't\\s.spa', 't/s%2espa', 't/s.spa/.' ];

test( 'canonical texture requests, real image decoding, cached failures and retry in Chrome', { timeout: 60000 }, async () => {

	const html = `<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{
"mmd-parser":"/node_modules/mmd-parser/build/mmdparser.module.mjs","three":"/node_modules/three/build/three.module.js",
"three/webgpu":"/node_modules/three/build/three.webgpu.js","three/tsl":"/node_modules/three/build/three.tsl.js",
"three/addons/":"/node_modules/three/examples/jsm/"}}</script><pre id="result">pending</pre><script type="module">
import { AddOperation, LoadingManager, MultiplyOperation, TextureLoader } from 'three';
import { MMDLoader } from '/dist/index.js';
const result={errors:[],handlers:[],modifiers:[],failures:[],families:0,decoded:0};
const check=(value,message)=>{if(!value)throw new Error(message);};
const manager=new LoadingManager();
manager.setURLModifier(url=>{result.modifiers.push(url);return url;});
const originalHandler=manager.getHandler.bind(manager);
manager.getHandler=url=>{result.handlers.push(url);return originalHandler(url);};
const loader=new MMDLoader(manager),builder=loader.meshBuilder.materialBuilder.setResourcePath('/models/direct/');
async function texture(path,cache={},params={}) {
 return new Promise((resolve,reject)=>{
  const map=builder._loadTexture(path,cache,params,undefined,reject);
  if(map.readyCallbacks)map.readyCallbacks.push(resolve);else if(!map.failed)resolve(map);
 });
}
function decoded(map) {
 check((map.image.naturalWidth||map.image.width)>0&&(map.image.naturalHeight||map.image.height)>0,'empty decoded image');result.decoded++;
}
try {
 const cache={};
 for(const path of ${JSON.stringify( portableNames )})decoded(await texture(path,cache));
 check(builder._loadTexture(${JSON.stringify( portableNames[ 0 ] )},cache)===builder._loadTexture(${JSON.stringify( portableNames[ 1 ] )},cache),'canonical texture identity');
 const selected=new TextureLoader(manager);let selectedCalls=0;
 const selectedLoad=selected.load.bind(selected);selected.load=(...args)=>{selectedCalls++;return selectedLoad(...args);};
 manager.addHandler(/^\\/models\\/direct\\/tex\\/handler.png$/,selected);
 decoded(await texture(${JSON.stringify( portableNames[ 0 ].replace( 'hair', 'handler' ) )}));check(selectedCalls===1,'canonical custom handler selection');
 decoded(await texture('tex/image%2eTGA'));
 decoded(await texture(location.origin+'/absolute/image.TGA?version=1#texture'));
 decoded(await texture(location.origin+'/absolute/image.png?name=.tga'));
 decoded(await texture('//'+location.host+'/absolute/protocol.png'));
 decoded(await texture('/absolute/root.png'));
 decoded(await texture('data:image/png;base64,${subtexturePngBuffer().toString( 'base64' )}'));
 const blob=URL.createObjectURL(await (await fetch('/blob-source.png')).blob());
 try {decoded(await texture(blob));}finally{URL.revokeObjectURL(blob);}
 decoded(await texture('toon01.bmp',{}, {isDefaultToonTexture:true,isToonTexture:true}));
 const before=result.handlers.length;
 for(const path of ${JSON.stringify( unsafeNames )}) {
  let error;try{builder._loadTexture(path,{});}catch(e){error=e;}
  check(error?.message.includes('Unsafe relative texture path'),'missing path error '+path);
 }
 check(result.handlers.length===before,'unsafe paths reached handler selection');
 for(const name of ['missing','decode','network','retry']) {
  const failedCache={};let first,second;
  // Two aliases of the same in-flight failed request must both receive the original event.
  await Promise.all([texture('tex/'+name+'.png',failedCache).catch(e=>first=e),texture('tex/./'+name+'.png',failedCache).catch(e=>second=e)]);
  check(first&&first===second,'in-flight error callback identity '+name);
  let cached;await texture('tex/'+name+'.png',failedCache).catch(e=>cached=e);
  check(cached instanceof Error&&cached.message.includes('/models/direct/tex/'+name+'.png')&&!cached.message.includes('Unsafe'),'cached canonical failure '+name);
  result.failures.push(name);
 }
 // A fresh build/cache retries the same canonical URL after the server recovers.
 decoded(await texture('tex/retry.png'));
 for(const index of [0,1,2]) {
  let invalid;try{await new MMDLoader().loadAsync('/invalid'+index+'.pmx');}catch(error){invalid=error;}
  check(invalid?.message.includes('Unsafe relative texture path'),'loader did not report invalid texture family '+index);
 }
 for(const flag of [1,2,3]) {
  const m=new LoadingManager(),ready=new Promise(resolve=>m.onLoad=resolve),l=new MMDLoader(m);
  const mesh=await l.loadAsync('/models/pmx'+flag+'/model.pmx');await ready;
  const material=mesh.material[0];decoded(material.map);decoded(material.matcap);decoded(material.gradientMap);
  check(material.userData.MMD.mapFileName===${JSON.stringify( names[ 0 ] )},'original base name');
  check(material.userData.MMD.matcapFileName===${JSON.stringify( names[ 1 ] )},'original sphere name');
  check(material.userData.MMD.envFlag===flag,'sphere mode');result.families++;
  mesh.geometry.dispose();mesh.material.forEach(m=>m.dispose());
 }
 for(let i=0;i<${pmdSphereNames.length};i++) {
  const m=new LoadingManager(),ready=new Promise(resolve=>m.onLoad=resolve),l=new MMDLoader(m);
  const mesh=await l.loadAsync('/models/pmd'+i+'/model.pmd');await ready;
  const material=mesh.material[0],extension=i<3?'sph':'spa';
  decoded(material.map);decoded(material.matcap);decoded(material.gradientMap);result.families++;
  check(material.map.image.src.endsWith('/models/pmd'+i+'/t/b.png'),'PMD base map retained');
  check(material.matcap.image.src.endsWith('/models/pmd'+i+'/t/s.'+extension),'PMD canonical sphere map');
  check(material.matcapCombine===(i<3?MultiplyOperation:AddOperation),'PMD sphere combine mode');
  mesh.geometry.dispose();mesh.material.forEach(m=>m.dispose());
 }
}catch(error){result.errors.push(error.stack||String(error));}
document.getElementById('result').textContent=encodeURIComponent(JSON.stringify(result));
</script>`;
	const requests: { url: string; status: number }[] = [];
	let retries = 0;
	const tga = Buffer.alloc( 21 );
	tga[ 2 ] = 2; tga[ 12 ] = 1; tga[ 14 ] = 1; tga[ 16 ] = 24; tga[ 17 ] = 0x20; tga[ 20 ] = 255;
	const server = createServer( async ( request, response ) => {

		const url = request.url!;
		const path = new URL( url, 'http://localhost' ).pathname;
		response.setHeader( 'Cache-Control', 'no-store' );
		if ( path === '/' ) { response.writeHead( 200, { 'Content-Type': 'text/html' } ).end( html ); return; }
		if ( /^\/(?:dist\/|node_modules\/(?:three|mmd-parser)\/).+\.(?:mjs|js)$/.test( path ) ) {

			try { response.writeHead( 200, { 'Content-Type': 'text/javascript' } ).end( await readFile( new URL( '../../' + path.slice( 1 ), import.meta.url ) ) ); }
			catch { response.writeHead( 404 ).end(); }
			return;

		}
		if ( path.endsWith( '/model.pmx' ) ) {

			const envFlag = Number( path.match( /pmx(\d)/ )![ 1 ] );
			response.writeHead( 200 ).end( Buffer.from( pmxBuffer( { textureNames: names, envFlag, additionalUvMorphs: true } ) ) ); return;

		}
		if ( /^\/invalid[0-2]\.pmx$/.test( path ) ) {

			const textureNames: [ string, string, string ] = [ ...names ];
			textureNames[ Number( path[ 8 ] ) ] = unsafeNames[ 0 ];
			response.writeHead( 200 ).end( Buffer.from( pmxBuffer( { textureNames } ) ) ); return;

		}
		if ( path.endsWith( '/model.pmd' ) ) {

			const sphereName = pmdSphereNames[ Number( path.match( /pmd(\d)/ )![ 1 ] ) ];
			response.writeHead( 200 ).end( Buffer.from( pmdBuffer( { textureFileName: 't/b.png*' + sphereName, toonFileName: 't\\toon.png' } ) ) ); return;

		}
		if ( path.endsWith( '/network.png' ) ) { requests.push( { url, status: 0 } ); response.destroy(); return; }
		const status = path.endsWith( '/missing.png' ) || ( path.endsWith( '/retry.png' ) && retries ++ === 0 ) ? 404 : 200;
		requests.push( { url, status } );
		const body = path.endsWith( '/decode.png' ) ? Buffer.from( 'invalid image bytes' ) : path.endsWith( '.TGA' ) ? tga : subtexturePngBuffer();
		response.writeHead( status, { 'Content-Type': path.endsWith( '.TGA' ) ? 'image/x-tga' : 'image/png' } ).end( status === 200 ? body : 'missing' );

	} );
	const profile = await mkdtemp( join( tmpdir(), 'mmd-resource-browser-' ) );
	try {

		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const result = await runBrowser<{ errors: string[]; handlers: string[]; modifiers: string[]; failures: string[]; families: number; decoded: number }>( `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/`, profile );
		assert.deepEqual( result.errors, [] );
		assert.equal( result.families, 3 + pmdSphereNames.length );
		assert.ok( result.decoded >= 25 );
		assert.deepEqual( result.failures, [ 'missing', 'decode', 'network', 'retry' ] );
		for ( const url of [ '/models/direct/tex/hair.png', '/models/direct/tex/%E6%97%A5%E6%9C%AC%20%E8%AA%9E%F0%9F%98%80.png', '/models/direct/tex/a%20b%23c.png', '/models/direct/tex/%25FF.png', '/models/direct/tex/100%25ab.png', '/models/direct/tex/handler.png', '/models/direct/tex/image.TGA' ] ) {

			assert.deepEqual( requests.filter( request => request.url === url ), [ { url, status: 200 } ], JSON.stringify( { url, requests: requests.filter( request => request.url.startsWith( '/models/direct/' ) ) } ) );
			assert.equal( result.handlers.filter( path => path === url ).length, 1, url );
			assert.equal( result.modifiers.filter( path => path === url ).length, 1, url );

		}
		for ( const flag of [ 1, 2, 3 ] ) for ( const name of [ 'tex/base.png', 'tex/sphere.png', 'tex/custom/toon.png' ] ) {

			const url = `/models/pmx${flag}/${name}`;
			assert.deepEqual( requests.filter( request => request.url === url ), [ { url, status: 200 } ] );

		}
		for ( let i = 0; i < pmdSphereNames.length; i ++ ) for ( const name of [ 't/b.png', i < 3 ? 't/s.sph' : 't/s.spa', 't/toon.png' ] ) {

			const url = `/models/pmd${i}/${name}`;
			assert.deepEqual( requests.filter( request => request.url === url ), [ { url, status: 200 } ] );

		}
		assert.deepEqual( requests.filter( request => request.url.endsWith( '/retry.png' ) ).map( request => request.status ), [ 404, 200 ] );
		assert.deepEqual( requests.filter( request => request.url.endsWith( '/missing.png' ) ).map( request => request.status ), [ 404 ] );
		assert.deepEqual( requests.filter( request => request.url.endsWith( '/decode.png' ) ).map( request => request.status ), [ 200 ] );
		assert.ok( requests.some( request => request.url.endsWith( '/network.png' ) && request.status === 0 ) );
		assert.ok( requests.every( request => ! /escape|%5c|%2f|%25(?:00|5c)|\\/i.test( request.url ) ), JSON.stringify( requests ) );

	} finally {

		await new Promise<void>( resolve => server.close( () => resolve() ) );
		await removeBrowserDirectory( profile );

	}

} );
