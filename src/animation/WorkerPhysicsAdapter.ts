import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { MMDMesh, RigidBodyParameters, ConstraintParameters } from '../types.js';
import type { MMDPhysics } from './MMDPhysics.js';
import { inputLength, outputLength, selectPhysicsTransport } from './PhysicsWorkerProtocol.js';
import type { PhysicsModel, PhysicsRequest, PhysicsResponse, WorkerPhysicsOptions } from './PhysicsWorkerProtocol.js';

/** One mailbox and one clock for a complete Bullet world. @internal */
export class WorkerPhysicsWorld {
	readonly transport = selectPhysicsTransport();
	readonly members = new Map<number, WorkerPhysicsAdapter>();
	private worker?: Worker;
	private timer?: ReturnType<typeof setTimeout>;
	private options?: WorkerPhysicsOptions;
	private buffer?: ArrayBuffer | SharedArrayBuffer;
	private control?: Int32Array;
	private flight?: { generation: number; sequence: number; models: WorkerPhysicsAdapter[]; warmup: boolean; delta: number };
	private generation = 0;
	private sequence = 0;
	lastCompletedSequence = 0;
	get inFlight() { return Boolean( this.flight ); }
	private nextId = 0;
	private delta = 0;
	private warming = false;
	private paused = false;
	private failedReason?: string;
	private stopped = false;

	constructor( options?: WorkerPhysicsOptions ) {

		this.options = options;
		try {

			if ( ! options?.ammoURL ) throw new Error( 'workerPhysics.ammoURL is required' );
			const url = new URL( options.ammoURL, typeof document === 'undefined' ? import.meta.url : document.baseURI ).href;
			this.worker = options.createWorker ? options.createWorker() : new Worker( new URL( './MMDPhysicsWorker.js', import.meta.url ) );
			this.worker.onmessage = event => this.receive( event.data as PhysicsResponse );
			this.worker.onerror = event => { event.preventDefault?.(); this.fail( event.message || 'Worker error' ); };
			this.worker.onmessageerror = () => this.fail( 'Worker message could not be decoded' );
			this.post( { type: 'init', ammoURL: url } );

		} catch ( error ) { this.failedReason = String( error ); this.close(); }

	}

	add( adapter: WorkerPhysicsAdapter ) {

		adapter.model.id = ++ this.nextId;
		this.members.set( adapter.model.id, adapter ); this.invalidate();
		if ( this.failedReason ) { this.fallback(); return; }
		this.post( { type: 'add', model: adapter.model } ); this.watch();

	}

	remove( adapter: WorkerPhysicsAdapter ) {

		this.members.delete( adapter.model.id ); this.invalidate();
		this.post( { type: 'remove', id: adapter.model.id } );
		if ( this.members.size === 0 ) { this.stopped = true; this.close(); }

	}

	invalidate() { this.generation = ( this.generation + 1 ) & 0x7fffffff; this.delta = 0; }
	pause( paused: boolean ) { this.paused = paused; this.invalidate(); if ( ! paused ) this.pumpWarmup(); }
	setGravity( value: Vector3 ) {

		for ( const member of this.members.values() ) member.owner.gravity.copy( value );
		this.post( { type: 'gravity', value: value.toArray() } );

	}

	update( delta: number ) {

		if ( this.failedReason || this.stopped || this.paused ) return;
		if ( ! this.warming && ( this.flight?.warmup || Array.from( this.members.values() ).some( member => member.warmupCycles > 0 ) ) ) {

			this.pumpWarmup(); return;

		}
		if ( Number.isFinite( delta ) && delta > 0 ) this.delta = Math.min( this.delta + delta, 0.25 );
		if ( this.flight || Array.from( this.members.values() ).some( member => ! member.initialized ) ) return;
		const members = Array.from( this.members.values() );
		if ( members.length === 0 ) return;
		const hasPMX = members.some( m => m.model.format === 'pmx' );
		const time = ! Number.isFinite( delta ) ? delta : delta <= 0 && hasPMX ? 0 : this.delta || delta;
		// PMX zero-time evaluation only projects the latest complete pose.
		if ( ( ! Number.isFinite( time ) || time <= 0 ) && hasPMX && ! members.some( m => m.needsReset ) ) return;
		const length = members.reduce( ( n, m ) => n + inputLength( m.model ) + outputLength( m.model ), 0 );
		if ( ! this.buffer || this.buffer.byteLength !== length * 8 ) {

			this.buffer = this.transport === 'shared' ? new SharedArrayBuffer( length * 8 ) : new ArrayBuffer( length * 8 );
			this.control = this.transport === 'shared' ? new Int32Array( new SharedArrayBuffer( 12 ) ) : undefined;

		}
		const data = new Float64Array( this.buffer ); let offset = 0;
		const frames = members.map( member => {

			member.capture( data, offset ); offset += inputLength( member.model );
			const frame = { id: member.model.id, reset: member.needsReset, resetPose: member.needsReset ? member.resetSnapshot : undefined, staged: Boolean( member.owner.poseLayers ) };
			member.needsReset = false; return frame;

		} );
		if ( this.control ) Atomics.store( this.control, 0, 0 );
		const sequence = this.sequence = ( this.sequence + 1 ) & 0x7fffffff;
		this.flight = { generation: this.generation, sequence, models: members, warmup: this.warming, delta: time }; this.delta = 0;
		const buffer = this.buffer;
		this.post( { type: 'frame', generation: this.generation, sequence, delta: time, models: frames, buffer, control: this.control?.buffer as SharedArrayBuffer | undefined }, this.transport === 'transferable' ? [ buffer as ArrayBuffer ] : [] );
		this.watch();

	}

	private receive( message: PhysicsResponse ) {

		if ( this.stopped || this.failedReason ) return;
		if ( message.type === 'error' ) { this.fail( message.reason ); return; }
		if ( message.type === 'added' ) {

			const member = this.members.get( message.id );
			if ( member ) { member.initialized = true; member.resolveReady(); }
			if ( Array.from( this.members.values() ).every( m => m.initialized ) && ! this.flight ) clearTimeout( this.timer );
			this.pumpWarmup(); return;

		}
		const flight = this.flight;
		if ( ! flight || flight.sequence !== message.sequence || flight.generation !== message.generation ) return;
		clearTimeout( this.timer ); this.flight = undefined;
		if ( this.transport === 'transferable' ) this.buffer = message.buffer;
		if ( flight.generation === this.generation ) {

			if ( ! this.buffer || ( this.control && ( Atomics.load( this.control, 0 ) !== 1 || Atomics.load( this.control, 1 ) !== message.generation || Atomics.load( this.control, 2 ) !== message.sequence ) ) ) {

				this.fail( 'Incomplete physics result' ); return;

			}
			this.lastCompletedSequence = message.sequence;
			const data = new Float64Array( this.buffer );
			let offset = flight.models.reduce( ( n, m ) => n + inputLength( m.model ), 0 );
			const expectedLength = offset + flight.models.reduce( ( n, m ) => n + outputLength( m.model ), 0 );
			if ( data.length !== expectedLength || data.subarray( offset ).some( value => ! Number.isFinite( value ) ) ) {

				this.fail( 'Invalid physics result buffer' ); return;

			}
			for ( const member of flight.models ) {

				member.accept( data, offset, flight.delta > 0 ? 'step' : member.owner.bodyResultPhase ); offset += outputLength( member.model );

			}

		}
		this.pumpWarmup();

	}

	private pumpWarmup() {

		if ( this.flight || this.stopped || this.failedReason || this.paused || Array.from( this.members.values() ).some( m => ! m.initialized ) ) return;
		const member = Array.from( this.members.values() ).find( m => m.warmupCycles > 0 );
		if ( ! member ) return;
		member.warmupCycles --; this.delta = 0; this.warming = true;
		try {

			if ( member.owner.warmupStep ) member.owner.warmupStep( 1 / 60 );
			else member.owner.update( 1 / 60 );

		} finally { this.warming = false; }

	}

	private post( message: PhysicsRequest, transfer: Transferable[] = [] ) {

		try { this.worker?.postMessage( message, transfer ); } catch ( error ) { this.fail( String( error ) ); }

	}
	private watch() {

		clearTimeout( this.timer );
		if ( this.failedReason || this.stopped ) return;
		this.timer = setTimeout( () => this.fail( 'Worker initialization or simulation timed out' ), this.options?.timeout ?? 10000 );

	}
	private close() {

		clearTimeout( this.timer ); this.worker?.terminate(); this.worker = undefined;
		this.flight = undefined; this.buffer = undefined; this.control = undefined;

	}
	private fail( reason: string ) {

		if ( this.failedReason || this.stopped ) return;
		this.failedReason = reason; this.close(); this.fallback();

	}
	private fallback() {

		const reason = this.failedReason!;
		console.warn( `THREE.MMDPhysics: Worker physics fell back to sync: ${reason}` );
		try { this.options?.onFallback?.( reason ); } catch ( error ) { console.warn( error ); }
		let world: MMDPhysics['world'] = null;
		for ( const member of this.members.values() ) {

			// Rebuild the complete shared world together, with current pre-physics
			// poses and cleared velocities. Never transplant Ammo pointers.
			world = member.owner._fallbackWorker( world ); member.resolveReady();

		}
		for ( const member of this.members.values() ) {

			const cycles = member.warmupCycles; member.warmupCycles = 0;
			if ( cycles > 0 ) member.owner.warmup( cycles );

		}

	}
}

/** Main-thread pose projection; no Ammo allocation or Bullet world. @internal */
export class WorkerPhysicsAdapter {
	readonly model: PhysicsModel;
	readonly ready: Promise<void>;
	resolveReady!: () => void;
	initialized = false;
	needsReset = true;
	resetSnapshot: number[] = [];
	warmupCycles = 0;
	private pending: ( number[] | undefined )[] = [];
	private offsets: Matrix4[];
	private deferred: boolean[];
	private disposed = false;

	constructor( readonly owner: MMDPhysics, readonly group: WorkerPhysicsWorld, bodies: RigidBodyParameters[], constraints: ConstraintParameters[] ) {

		const mesh = owner.mesh, metadata = ( mesh as MMDMesh ).geometry.userData.MMD;
		const bones = mesh.skeleton.bones;
		this.model = {
			id: 0, format: metadata?.format ?? 'pmd', bones: bones.map( ( b, i ) => ( { parent: bones.indexOf( b.parent as typeof b ), flag: metadata?.bones[ i ]?.flag } ) ),
			rest: bones.flatMap( b => [ ...b.position.toArray(), ...b.quaternion.toArray() ] ),
			bodies, constraints, gravity: owner.gravity.toArray(), unitStep: owner.unitStep, maxStepNum: owner.maxStepNum
		};
		// Match native rigid-body offsets (#78) for reset, deferred input and
		// body-to-bone projection. Joint frames retain their separate XYZ order.
		this.offsets = bodies.map( body => new Matrix4().compose( new Vector3().fromArray( body.position ), new Quaternion().setFromEuler( new Euler( ...body.rotation, 'YXZ' ) ), new Vector3( 1, 1, 1 ) ) );
		this.deferred = bodies.map( body => {

			const visited = new Set<number>(); let index = body.boneIndex;
			while ( this.model.format === 'pmx' && this.model.bones[ index ] && ! visited.has( index ) ) {

				visited.add( index ); if ( ( this.model.bones[ index ].flag ?? 0 ) & 0x1000 ) return true;
				index = this.model.bones[ index ].parent;

			}
			return false;

		} );
		this.ready = new Promise( resolve => { this.resolveReady = resolve; } );
		this.resetPose();
		// Registration is performed by the owner after assigning this adapter,
		// so immediate fallback can safely clear the owner field.

	}

	capture( data: Float64Array, offset: number ) {

		this.withUnitScale( () => {

			this.owner.mesh.matrixWorld.toArray( data, offset ); offset += 16;
			for ( const bone of this.owner.mesh.skeleton.bones ) {

				bone.position.toArray( data, offset ); bone.quaternion.toArray( data, offset + 3 ); offset += 7;

			}
		} );
		for ( const pose of this.pending ) { if ( pose ) data.set( pose, offset ); else data.fill( NaN, offset, offset + 7 ); offset += 7; }

	}

	accept( data: Float64Array, offset: number, phase: 'step' | 'reset' ) {

		if ( this.disposed ) return;
		this.owner.bodyResultPhase = phase;
		for ( const result of this.owner.bodyResults ) {

			for ( let i = 0; i < 3; i ++ ) result.position[ i ] = data[ offset ++ ];
			for ( let i = 0; i < 4; i ++ ) result.quaternion[ i ] = data[ offset ++ ];

		}

	}
	update( delta: number ) { this.group.update( delta ); this.project(); }
	project( index?: number ) {

		this.withUnitScale( () => {

			for ( const [ i, params ] of this.model.bodies.entries() ) {

				if ( params.type === 0 || params.boneIndex === - 1 || ( index !== undefined && params.boneIndex !== index ) ) continue;
				const bone = this.owner.mesh.skeleton.bones[ params.boneIndex ], result = this.owner.bodyResults[ i ];
				const world = new Matrix4().compose( new Vector3().fromArray( result.position ), new Quaternion().fromArray( result.quaternion ), new Vector3( 1, 1, 1 ) ).multiply( this.offsets[ i ].clone().invert() );
				const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3(); world.decompose( position, rotation, scale );
				if ( bone.parent ) rotation.premultiply( bone.parent.getWorldQuaternion( new Quaternion() ).invert() );
				bone.quaternion.copy( rotation.normalize() );
				if ( params.type === 1 ) { if ( bone.parent ) bone.parent.worldToLocal( position ); bone.position.copy( position ); }
				bone.updateMatrixWorld( true );

			}

		} );

	}
	deferAfterPhysics() {

		this.withUnitScale( () => {

			for ( const [ i, body ] of this.model.bodies.entries() ) if ( this.deferred[ i ] && ( body.type === 0 || ( body.type === 2 && this.model.format !== 'pmx' ) ) ) this.pending[ i ] = this.bodyPose( i );

		} );

	}
	reset() {

		if ( this.disposed ) return;
		this.group.invalidate(); this.needsReset = true; this.resetPose();

	}
	private resetPose() {

		const layers = this.owner.poseLayers, mesh = this.owner.mesh;
		const rendered = mesh.skeleton.bones.flatMap( b => [ ...b.position.toArray(), ...b.quaternion.toArray() ] );
		if ( layers ) for ( const [ i, bone ] of mesh.skeleton.bones.entries() ) {

			bone.position.fromArray( layers.beforePhysics, i * 7 ); bone.quaternion.fromArray( layers.beforePhysics, i * 7 + 3 );

		}
		this.pending = this.model.bodies.map( () => undefined );
		this.withUnitScale( () => {

			this.owner.bodyResults = this.model.bodies.map( ( _, i ) => { const pose = this.bodyPose( i ); return { position: pose.slice( 0, 3 ), quaternion: pose.slice( 3 ) }; } );

		} );
		const snapshot = new Float64Array( inputLength( this.model ) );
		this.capture( snapshot, 0 ); this.resetSnapshot = Array.from( snapshot );
		this.owner.bodyResultPhase = 'reset';
		if ( layers ) {

			for ( const [ i, bone ] of mesh.skeleton.bones.entries() ) { bone.position.fromArray( rendered, i * 7 ); bone.quaternion.fromArray( rendered, i * 7 + 3 ); }
			this.deferAfterPhysics();

		}

	}
	private bodyPose( i: number ) {

		const bone = this.owner.mesh.skeleton.bones[ this.model.bodies[ i ].boneIndex ];
		const matrix = bone ? bone.matrixWorld.clone() : new Matrix4();
		// Bullet ignores bone scale when composing a rigid body offset.
		const p = new Vector3(), q = new Quaternion(), s = new Vector3(); matrix.decompose( p, q, s );
		matrix.compose( p, q, s.set( 1, 1, 1 ) ).multiply( this.offsets[ i ] ).decompose( p, q, s );
		return [ ...p.toArray(), ...q.toArray() ];

	}
	private withUnitScale( action: () => void ) {

		const mesh = this.owner.mesh;
		mesh.updateMatrixWorld( true );
		const p = new Vector3(), q = new Quaternion(), worldScale = new Vector3(); mesh.matrixWorld.decompose( p, q, worldScale );
		const parent = mesh.parent, scale = mesh.scale.clone();
		const normalized = worldScale.x !== 1 || worldScale.y !== 1 || worldScale.z !== 1;
		if ( normalized ) { mesh.parent = null; mesh.scale.set( 1, 1, 1 ); mesh.updateMatrixWorld( true ); }
		try { action(); } finally {

			if ( normalized ) { mesh.parent = parent; mesh.scale.copy( scale ); }
			mesh.updateMatrixWorld( true );

		}

	}
	dispose() {

		if ( this.disposed ) return;
		this.disposed = true; this.resolveReady(); this.pending.length = 0; this.group.remove( this );

	}
}
