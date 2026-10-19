import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { initializeAmmo } from './ammo-runtime.ts';

test( 'default Bullet artifacts match pinned source, recipe and license hashes', async () => {

	const directory = new URL( '../examples/vendor/bullet/', import.meta.url );
	const manifest = JSON.parse( await readFile( new URL( 'manifest.json', directory ), 'utf8' ) );
	const lock = JSON.parse( await readFile( new URL( '../experiments/bullet/source.json', import.meta.url ), 'utf8' ) );
	for ( const [ key, value ] of Object.entries( lock ) ) assert.equal( manifest[ key ], value, key );
	assert.equal( manifest.bulletCommit, 'd3afe76132fc76b0f9b2359cbaef47a3766e7fbb' );
	assert.deepEqual( manifest.patches, [] );
	for ( const [ name, hash ] of Object.entries( manifest.sha256 ) ) assert.equal( createHash( 'sha256' ).update( await readFile( new URL( name, directory ) ) ).digest( 'hex' ), hash, name );
	for ( const [ name, hash ] of Object.entries( manifest.recipeSha256 ) ) assert.equal( createHash( 'sha256' ).update( await readFile( new URL( '../experiments/bullet/' + name, import.meta.url ) ) ).digest( 'hex' ), hash, `Rebuild Bullet after editing ${name}` );
	for ( const name of [ 'Bullet', 'Bullet-source-notices', 'Emscripten', 'musl', 'libcxx', 'libcxxabi', 'compiler-rt', 'dlmalloc' ] ) assert.ok( manifest.sha256[ `LICENSE.${name}.txt` ], name );

} );

for ( const variant of [ 'default', 'bullet-master', 'legacy' ] ) test( `${variant} initializes a real WASM runtime with native Ammo exports`, async () => {

	const ammo = await initializeAmmo<import( '../src/ammo.js' ).AmmoAPI & { asm?: WebAssembly.Exports; getWasmExports?: () => WebAssembly.Exports; bulletCommit?: string }>( variant );
	const exports = ammo.asm ?? ammo.getWasmExports?.();
	assert.ok( exports );
	assert.ok( Object.values( exports ).some( value => typeof value === 'function' ) );
	if ( variant !== 'legacy' ) {

		assert.equal( ammo.bulletCommit, 'd3afe76132fc76b0f9b2359cbaef47a3766e7fbb' );
		assert.equal( typeof exports.emscripten_bind_btDiscreteDynamicsWorld_stepSimulation_3, 'function' );
		assert.equal( typeof exports.emscripten_bind_btGeneric6DofSpringConstraint_setParam_3, 'function' );

	}
	const vector = new ammo.btVector3( 1, 2, 3 );
	assert.deepEqual( [ vector.x(), vector.y(), vector.z() ], [ 1, 2, 3 ] ); ammo.destroy!( vector );

} );
