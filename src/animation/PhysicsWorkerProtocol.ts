import type { ConstraintParameters, MMDBone, RigidBodyParameters } from '../types.js';

export type PhysicsMode = 'sync' | 'worker';
export type PhysicsTransport = 'shared' | 'transferable';
export interface WorkerPhysicsOptions {
	/** Classic Ammo factory/API script URL. Factory locateFile paths resolve beside this script (including WASM binaries). */
	ammoURL: string;
	/** Override the bundled classic Worker (for CSP, hosting, or testing). */
	createWorker?: () => Worker;
	/** Initialization/step watchdog, in milliseconds. Default 10000. */
	timeout?: number;
	/** Receives fallback diagnostics in addition to console.warn. */
	onFallback?: ( reason: string ) => void;
}
export interface PhysicsModel {
	id: number;
	format: 'pmx' | 'pmd';
	bones: Pick<MMDBone, 'parent' | 'flag'>[];
	rest: number[];
	bodies: RigidBodyParameters[];
	constraints: ConstraintParameters[];
	unitStep: number;
	maxStepNum: number;
	gravity: number[];
}
// Frame layout per model: mesh world matrix (16), local bones (7 each),
// preceding displayed post-phase body transforms (7 each; NaN means absent).
export const inputLength = ( model: PhysicsModel ) => 16 + model.bones.length * 7 + model.bodies.length * 7;
export const outputLength = ( model: PhysicsModel ) => model.bodies.length * 7;
export interface FrameModel { id: number; reset: boolean; resetPose?: number[]; staged: boolean }
export type PhysicsRequest =
	| { type: 'init'; ammoURL: string }
	| { type: 'add'; model: PhysicsModel }
	| { type: 'remove'; id: number }
	| { type: 'gravity'; value: number[] }
	| { type: 'frame'; generation: number; sequence: number; delta: number; models: FrameModel[]; buffer: ArrayBuffer | SharedArrayBuffer; control?: SharedArrayBuffer };
export type PhysicsResponse =
	| { type: 'added'; id: number }
	| { type: 'error'; reason: string }
	| { type: 'result'; generation: number; sequence: number; buffer?: ArrayBuffer };

export function selectPhysicsTransport(): PhysicsTransport {

	if ( globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined' ) {

		try { Atomics.load( new Int32Array( new SharedArrayBuffer( 4 ) ), 0 ); return 'shared'; } catch { /* use transfers */ }

	}
	return 'transferable';

}
