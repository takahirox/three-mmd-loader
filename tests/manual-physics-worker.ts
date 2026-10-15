import assert from 'node:assert/strict';
import { PhysicsWorkerRuntime } from '../src/animation/PhysicsWorkerRuntime.js';
import type { PhysicsRequest, PhysicsResponse } from '../src/animation/PhysicsWorkerProtocol.js';

// Real shared simulation, deterministic scheduler, and actual structured-clone
// transfers. Tests decide exactly when requests/results become visible.
export class ManualWorker {
	onmessage: Worker['onmessage'] = null;
	onerror: Worker['onerror'] = null;
	onmessageerror: Worker['onmessageerror'] = null;
	requests: PhysicsRequest[] = [];
	responses: PhysicsResponse[] = [];
	terminated = false;
	frames = 0;
	private runtime = new PhysicsWorkerRuntime( ( response, transfer = [] ) => {

		this.responses.push( structuredClone( response, { transfer } ) );

	} );
	postMessage( message: PhysicsRequest, transfer: Transferable[] = [] ) { this.requests.push( structuredClone( message, { transfer } ) ); }
	terminate() { this.terminated = true; }
	process() {

		const message = this.requests.shift(); assert.ok( message );
		if ( message.type !== 'init' ) { if ( message.type === 'frame' ) this.frames ++; this.runtime.handle( message ); }

	}
	deliver( response = this.responses.shift() ) {

		assert.ok( response ); this.onmessage?.call( this as unknown as Worker, { data: response } as MessageEvent );

	}
	start() { while ( this.requests.length ) this.process(); while ( this.responses.length ) this.deliver(); }
	finish() { this.process(); this.deliver(); }
	options() { return { ammoURL: 'https://example.test/ammo.js', createWorker: () => this as unknown as Worker }; }
}
