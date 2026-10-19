import type { AmmoAPI } from '../dist/ammo.js';

export const ammoURL = new URL( '../node_modules/ammojs-typed/ammo/ammo.wasm.js', import.meta.url ).href;
type WasmAmmo = AmmoAPI & { asm: WebAssembly.Exports };
interface FactoryOptions {
	locateFile: ( path: string ) => string;
	instantiateWasm: ( imports: WebAssembly.Imports, receive: ( instance: WebAssembly.Instance ) => void ) => object;
}

// This is an Examples choice, not a requirement imposed on library consumers.
export async function initializeAmmoWasm(): Promise<AmmoAPI> {

	const host = globalThis as typeof globalThis & { Ammo: ( options: FactoryOptions ) => Promise<WasmAmmo> | WasmAmmo };
	if ( typeof WebAssembly === 'undefined' ) throw new Error( 'Ammo WASM requires browser WebAssembly support' );
	if ( typeof host.Ammo !== 'function' ) throw new Error( `Ammo WASM factory missing: ${ammoURL}` );
	const factory = host.Ammo;
	const binaryURL = new URL( 'ammo.wasm.wasm', ammoURL ).href;
	let instance: WebAssembly.Instance | undefined;
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {

		const runtime = await new Promise<WasmAmmo>( ( resolve, reject ) => {

			timer = setTimeout( () => { controller.abort(); reject( new Error( `Ammo WASM initialization timed out: ${binaryURL}` ) ); }, 10000 );
			// The pinned glue writes this.Ammo before it is ready. Isolate that
			// side effect so a failed setup cannot expose an uninitialized API.
			Promise.resolve( factory.call( {}, {
				locateFile: path => new URL( path, ammoURL ).href,
				instantiateWasm: ( imports, receive ) => {

					// Own the fetch so HTTP, compile and instantiate failures reject the
					// setup promise even with this older Emscripten factory's abort path.
					void ( async () => {

						const response = await fetch( binaryURL, { signal: controller.signal } );
						if ( ! response.ok ) throw new Error( `HTTP ${response.status}` );
						const result = await WebAssembly.instantiate( await response.arrayBuffer(), imports );
						instance = result.instance;
						receive( instance );

					} )().catch( error => reject( new Error( `Ammo WASM initialization failed (${binaryURL}): ${String( error )}` ) ) );
					return {};

				}
			} ) ).then( resolve, reject );

		} );
		if ( ! instance || runtime.asm !== instance.exports || ! runtime.btDiscreteDynamicsWorld ) throw new Error( 'Ammo did not initialize the requested WebAssembly backend' );
		document.body.dataset.ammoBackend = 'wasm';
		return runtime;

	} finally { clearTimeout( timer ); }

}
