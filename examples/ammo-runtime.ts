import type { AmmoAPI } from '../dist/ammo.js';

const requestedBullet = new URLSearchParams( globalThis.location?.search ).get( 'bullet' ) ?? 'default';
export const legacyBullet = requestedBullet === 'legacy';
export const ammoURL = new URL( legacyBullet ? '../node_modules/ammojs-typed/ammo/ammo.wasm.js' : './vendor/bullet/ammo.js', import.meta.url ).href;
type WasmAmmo = AmmoAPI & { asm?: WebAssembly.Exports; getWasmExports?: () => WebAssembly.Exports; bulletCommit?: string };
interface FactoryOptions {
	locateFile: ( path: string ) => string;
	instantiateWasm: ( imports: WebAssembly.Imports, receive: ( instance: WebAssembly.Instance ) => void ) => object;
}

// This is an Examples choice, not a requirement imposed on library consumers.
export async function initializeAmmoWasm(): Promise<AmmoAPI> {

	if ( ! [ 'default', 'master', 'legacy' ].includes( requestedBullet ) ) throw new Error( `Unknown Bullet selection: ${requestedBullet}. Remove the query for the default or use ?bullet=legacy to roll back.` );
	const host = globalThis as typeof globalThis & { Ammo: ( options: FactoryOptions ) => Promise<WasmAmmo> | WasmAmmo };
	if ( typeof WebAssembly === 'undefined' ) throw new Error( 'Ammo WASM requires browser WebAssembly support' );
	await new Promise<void>( ( resolve, reject ) => {

		const script = document.createElement( 'script' );
		const timer = setTimeout( () => { script.remove(); reject( new Error( `Bullet glue timed out: ${ammoURL}. Use ?bullet=legacy to roll back.` ) ); }, 10000 );
		script.src = ammoURL;
		script.onload = () => { clearTimeout( timer ); resolve(); };
		script.onerror = () => { clearTimeout( timer ); reject( new Error( `Bullet glue failed to load: ${ammoURL}. Use ?bullet=legacy to roll back.` ) ); };
		document.head.appendChild( script );

	} );
	if ( typeof host.Ammo !== 'function' ) throw new Error( `Ammo WASM factory missing: ${ammoURL}` );
	const factory = host.Ammo;
	const binaryURL = new URL( legacyBullet ? 'ammo.wasm.wasm' : 'ammo.wasm', ammoURL ).href;
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
		if ( ! ( instance instanceof WebAssembly.Instance ) || ( runtime.asm ?? runtime.getWasmExports?.() ) !== instance.exports || ! runtime.btDiscreteDynamicsWorld ) throw new Error( 'Ammo did not initialize the requested WebAssembly backend' );
		if ( ! legacyBullet ) {

			if ( runtime.bulletCommit !== 'd3afe76132fc76b0f9b2359cbaef47a3766e7fbb' ) throw new Error( 'Bullet source identity mismatch; rebuild with npm run build:bullet' );
			for ( const name of [ 'emscripten_bind_btDiscreteDynamicsWorld_stepSimulation_3', 'emscripten_bind_btGeneric6DofSpringConstraint_setParam_3' ] ) {

				if ( typeof instance.exports[ name ] !== 'function' ) throw new Error( `Bullet WASM export missing: ${name}` );

			}
			for ( const [ name, methods ] of Object.entries( {
				btVector3: [ 'setValue', 'x', 'y', 'z' ], btQuaternion: [ 'setX', 'setY', 'setZ', 'setW' ],
				btTransform: [ 'setIdentity', 'getBasis', 'getOrigin', 'getRotation', 'setRotation' ],
				btSphereShape: [ 'calculateLocalInertia' ], btBoxShape: [ 'calculateLocalInertia' ], btCapsuleShape: [ 'calculateLocalInertia' ],
				btDefaultMotionState: [ 'getWorldTransform', 'setWorldTransform' ],
				btRigidBodyConstructionInfo: [ 'set_m_additionalDamping', 'set_m_friction', 'set_m_restitution' ],
				btRigidBody: [ 'getMotionState', 'setCenterOfMassTransform', 'getCenterOfMassTransform', 'setDamping', 'setCollisionFlags', 'getCollisionFlags', 'setActivationState', 'setSleepingThresholds', 'clearForces', 'setLinearVelocity', 'setAngularVelocity', 'setInterpolationWorldTransform' ],
				btGeneric6DofSpringConstraint: [ 'setParam', 'enableSpring', 'setStiffness', 'setLinearLowerLimit', 'setLinearUpperLimit', 'setAngularLowerLimit', 'setAngularUpperLimit' ],
				btDiscreteDynamicsWorld: [ 'stepSimulation', 'setGravity', 'addRigidBody', 'removeRigidBody', 'addConstraint', 'removeConstraint' ],
				btCollisionDispatcher: [], btDbvtBroadphase: [], btSequentialImpulseConstraintSolver: [], btDefaultCollisionConfiguration: []
			} ) ) {

				const constructor = ( runtime as unknown as Record<string, ( ( ...args: unknown[] ) => unknown ) & { prototype?: Record<string, unknown> }> )[ name ];
				if ( typeof constructor !== 'function' || methods.some( method => typeof constructor.prototype?.[ method ] !== 'function' ) ) throw new Error( `Bullet API incompatible: ${name} (${methods.join( ', ' )}). Rebuild with npm run build:bullet or select ?bullet=legacy.` );

			}
			if ( typeof runtime.destroy !== 'function' ) throw new Error( 'Bullet is missing resource destruction' );

		}
		document.body.dataset.ammoBackend = 'wasm';
		document.body.dataset.bulletBackend = legacyBullet ? 'ammojs-typed-1.1.0' : 'master-d3afe76132fc';
		return runtime;

	} finally { clearTimeout( timer ); }

}
