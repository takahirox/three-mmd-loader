import type { AmmoAPI } from '../ammo.js';
import type { PhysicsRequest } from './PhysicsWorkerProtocol.js';
import { PhysicsWorkerRuntime } from './PhysicsWorkerRuntime.js';

const scope = globalThis as unknown as {
	Ammo: AmmoAPI | ( ( options: { locateFile: ( path: string ) => string; onAbort: ( reason: unknown ) => void } ) => Promise<AmmoAPI> );
	importScripts: ( url: string ) => void;
	postMessage: ( value: unknown, transfer?: Transferable[] ) => void;
	onmessage: ( event: MessageEvent<PhysicsRequest> ) => void;
};
const runtime = new PhysicsWorkerRuntime( ( message, transfer ) => scope.postMessage( message, transfer ) );
let queue = Promise.resolve();
let failed = false;
scope.onmessage = event => {

	queue = queue.then( async () => {

		if ( failed ) return;
		const message = event.data;
		if ( message.type === 'init' ) {

			// Classic Workers have no document.currentScript. Emscripten's default
			// binary lookup can otherwise use the Worker URL instead of the glue URL.
			const ammoURL = new URL( message.ammoURL, globalThis.location.href ).href;
			scope.importScripts( ammoURL );
			if ( typeof scope.Ammo === 'function' ) {

				const factory = scope.Ammo;
				scope.Ammo = await new Promise<AmmoAPI>( ( resolve, reject ) => {

					Promise.resolve( factory.call( {}, {
						locateFile: path => new URL( path, ammoURL ).href,
						onAbort: reason => reject( new Error( `Ammo initialization aborted (${ammoURL}): ${String( reason )}` ) )
					} ) ).then( resolve, reject );

				} );

			}
			if ( ! scope.Ammo?.btDiscreteDynamicsWorld ) throw new Error( 'Ammo script did not initialize a Bullet API' );

		} else runtime.handle( message );

	} ).catch( error => {

		failed = true;
		scope.postMessage( { type: 'error', reason: String( error ) } );

	} );

};
