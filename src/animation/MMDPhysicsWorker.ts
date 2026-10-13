import type { AmmoAPI } from '../ammo.js';
import type { PhysicsRequest } from './PhysicsWorkerProtocol.js';
import { PhysicsWorkerRuntime } from './PhysicsWorkerRuntime.js';

const scope = globalThis as unknown as {
	Ammo: AmmoAPI | ( () => Promise<AmmoAPI> );
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

			scope.importScripts( message.ammoURL );
			if ( typeof scope.Ammo === 'function' ) scope.Ammo = await scope.Ammo();
			if ( ! scope.Ammo?.btDiscreteDynamicsWorld ) throw new Error( 'Ammo script did not initialize a Bullet API' );

		} else runtime.handle( message );

	} ).catch( error => {

		failed = true;
		scope.postMessage( { type: 'error', reason: String( error ) } );

	} );

};
