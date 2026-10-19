import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { AmmoAPI } from '../src/ammo.js';

const require = createRequire( import.meta.url );
const bytes = readFileSync( require.resolve( 'ammojs-typed/ammo.wasm.wasm' ) );
interface Options { instantiateWasm: ( imports: WebAssembly.Imports, receive: ( instance: WebAssembly.Instance ) => void ) => WebAssembly.Exports }
const factory = require( 'ammojs-typed/wasm' ) as ( options: Options ) => Promise<AmmoAPI & { asm: WebAssembly.Exports }>;

// All real-Ammo Node baselines instantiate the pinned WASM binary. Passing
// bytes avoids old Emscripten's Node/fetch URL ambiguity on modern Node.
export async function initializeAmmo<T = AmmoAPI>(): Promise<T> {

	let instance: WebAssembly.Instance | undefined;
	const runtime = await factory( { instantiateWasm: ( imports, receive ) => {

		instance = new WebAssembly.Instance( new WebAssembly.Module( bytes ), imports );
		receive( instance );
		return instance.exports;

	} } );
	assert.ok( instance instanceof WebAssembly.Instance );
	assert.equal( runtime.asm, instance.exports, 'Ammo must execute the instantiated WASM exports' );
	return runtime as unknown as T;

}
