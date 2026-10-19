import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import type { AmmoAPI } from '../src/ammo.js';

const require = createRequire( import.meta.url );
interface Options { instantiateWasm: ( imports: WebAssembly.Imports, receive: ( instance: WebAssembly.Instance ) => void ) => WebAssembly.Exports }
type Factory = ( options: Options ) => Promise<AmmoAPI & { asm?: WebAssembly.Exports; getWasmExports?: () => WebAssembly.Exports; bulletCommit?: string }>;
const factories = new Map<string, { bytes: Uint8Array<ArrayBuffer>; factory: Factory }>();

// All real-Ammo Node baselines instantiate the pinned WASM binary. Passing
// bytes avoids old Emscripten's Node/fetch URL ambiguity on modern Node.
export async function initializeAmmo<T = AmmoAPI>( variant = process.env.MMD_AMMO_VARIANT ?? 'default' ): Promise<T> {

	assert.ok( [ 'default', 'bullet-master', 'legacy' ].includes( variant ), `Unknown Ammo test variant: ${variant}` );
	if ( ! factories.has( variant ) ) {

		const upstream = variant !== 'legacy';
		const bytes = readFileSync( upstream ? new URL( '../examples/vendor/bullet/ammo.wasm', import.meta.url ) : require.resolve( 'ammojs-typed/ammo.wasm.wasm' ) );
		const factory: Factory = upstream ? runInNewContext( `${readFileSync( new URL( '../examples/vendor/bullet/ammo.js', import.meta.url ), 'utf8' )}; Ammo;`, { WebAssembly, console, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance, process, require, __dirname: '.', __filename: 'ammo.js' } ) : require( 'ammojs-typed/wasm' );
		factories.set( variant, { bytes, factory } );

	}
	const { bytes, factory } = factories.get( variant )!;

	let instance: WebAssembly.Instance | undefined;
	const runtime = await factory( { instantiateWasm: ( imports, receive ) => {

		instance = new WebAssembly.Instance( new WebAssembly.Module( bytes ), imports );
		receive( instance );
		return instance.exports;

	} } );
	assert.ok( instance instanceof WebAssembly.Instance );
	assert.equal( runtime.asm ?? runtime.getWasmExports?.(), instance.exports, 'Ammo must execute the instantiated WASM exports' );
	if ( variant !== 'legacy' ) {

		assert.equal( runtime.bulletCommit, 'd3afe76132fc76b0f9b2359cbaef47a3766e7fbb' );
		assert.equal( typeof instance.exports.emscripten_bind_btDiscreteDynamicsWorld_stepSimulation_3, 'function' );

	}
	return runtime as unknown as T;

}
