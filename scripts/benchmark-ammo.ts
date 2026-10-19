// Same-process workload, fresh child per backend; no dependency or solver changes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { Parser } from 'mmd-parser';
import { Texture, Vector3 } from 'three';
import type { AmmoAPI } from '../src/ammo.js';
import { MMDLoader } from '../src/loaders/MMDLoader.js';
import { MMDPhysics } from '../src/animation/MMDPhysics.js';
import { rotationPhysicsBuffer } from '../tests/fixtures.ts';

const require = createRequire( import.meta.url );
const backend = process.argv[ 2 ];
interface Sample { initializationMs: number; steppingMs: number; trajectory: number[] }
if ( backend === 'asm' || backend === 'wasm' ) {

	const started = performance.now();
	type Options = { instantiateWasm: ( imports: WebAssembly.Imports, receive: ( instance: WebAssembly.Instance ) => void ) => WebAssembly.Exports };
	const factory = require( backend === 'wasm' ? 'ammojs-typed/wasm' : 'ammojs-typed' ) as ( options?: Options ) => Promise<AmmoAPI & { asm: WebAssembly.Exports }>;
	let instance: WebAssembly.Instance | undefined;
	const ammo = await factory( backend === 'wasm' ? { instantiateWasm: ( imports, receive ) => {

		instance = new WebAssembly.Instance( new WebAssembly.Module( readFileSync( require.resolve( 'ammojs-typed/ammo.wasm.wasm' ) ) ), imports );
		receive( instance ); return instance.exports;

	} } : undefined );
	if ( backend === 'wasm' ) { assert.ok( instance ); assert.equal( ammo.asm, instance.exports ); }
	const initializationMs = performance.now() - started;
	Object.assign( globalThis, { Ammo: ammo } );
	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	const worlds = Array.from( { length: 16 }, ( _, i ) => {

		const format = i % 2 ? 'pmd' : 'pmx', parser = new Parser();
		const buffer = rotationPhysicsBuffer( format, [ 0.2, -0.3, 0.4 ], i % 3 ? 1 : 2, true, [ -0.1, 0.25, 0.3 ] );
		const data = format === 'pmd' ? parser.parsePmd( buffer, true ) : parser.parsePmx( buffer, true );
		const mesh = loader.meshBuilder.build( data, '' ), meta = mesh.geometry.userData.MMD;
		return new MMDPhysics( mesh, meta.rigidBodies, meta.constraints, { gravity: new Vector3( 2, -5, 3 ) } );

	} );
	const axis = new Vector3( 1, 2, -1 ).normalize();
	function advance( frame: number ) {

		for ( const physics of worlds ) {

			const anchor = physics.mesh.skeleton.bones[ 0 ];
			anchor.position.x = Math.sin( frame / 60 ) * 0.3;
			anchor.quaternion.setFromAxisAngle( axis, Math.sin( frame / 80 ) * 0.2 );
			physics.mesh.updateMatrixWorld( true );
			physics.update( 1 / 60 );

		}

	}
	// Identical animated input and 120-frame JIT/solver warmup.
	for ( let frame = 0; frame < 120; frame ++ ) advance( frame );
	const trajectory: number[] = [], stepStarted = performance.now();
	for ( let frame = 0; frame < 600; frame ++ ) {

		advance( frame + 120 );
		if ( frame % 60 === 0 ) for ( const physics of worlds ) for ( const body of physics.bodyResults ) trajectory.push( ...body.position, ...body.quaternion );

	}
	const steppingMs = performance.now() - stepStarted;
	for ( const physics of worlds ) physics.dispose();
	console.log( JSON.stringify( { initializationMs, steppingMs, trajectory } ) );

} else {

	const results: Record<string, Sample[]> = { asm: [], wasm: [] };
	for ( let repeat = 0; repeat < 5; repeat ++ ) for ( const name of repeat % 2 ? [ 'wasm', 'asm' ] : [ 'asm', 'wasm' ] ) {

		results[ name ].push( JSON.parse( execFileSync( process.execPath, [ '--import', 'tsx', fileURLToPath( import.meta.url ), name ], { encoding: 'utf8' } ) ) );

	}
	const sizes = [ require.resolve( 'ammojs-typed' ), require.resolve( 'ammojs-typed/wasm' ), require.resolve( 'ammojs-typed/ammo.wasm.wasm' ) ].map( path => {

		const bytes = readFileSync( path ); return { file: path.split( '/' ).at( -1 ), bytes: bytes.length, gzipBytes: gzipSync( bytes, { level: 9 } ).length };

	} );
	const median = ( values: number[] ) => [ ...values ].sort( ( a, b ) => a - b )[ Math.floor( values.length / 2 ) ];
	const difference = results.asm[ 0 ].trajectory.map( ( value, i ) => Math.abs( value - results.wasm[ 0 ].trajectory[ i ] ) );
	assert.ok( difference.every( Number.isFinite ) );
	const sampleWidth = 16 * 2 * 7;
	const motion = Math.max( ...results.wasm[ 0 ].trajectory.map( ( value, i, values ) => Math.abs( value - values[ i % sampleWidth ] ) ) );
	assert.ok( motion > 0.01, 'trajectory comparison must include moving bodies' );
	console.log( JSON.stringify( {
		command: 'node --import tsx scripts/benchmark-ammo.ts', recordedAt: new Date().toISOString(),
		machine: { platform: platform(), arch: arch(), cpu: cpus()[ 0 ].model, node: process.version },
		package: 'ammojs-typed@1.1.0',
		workload: '16 independent PMD/PMX worlds, 32 bodies, 16 mixed-axis constraints; types 1/2; sinusoidal anchor translation/rotation, default solver, 120 warmup then 600 x 1/60 s updates per world; five fresh processes per backend in alternating order',
		initialization: 'require glue + local binary read/compile/instantiate (WASM); no network, warm filesystem cache; excludes process startup and model setup',
		sizes, results: Object.fromEntries( Object.entries( results ).map( ( [ name, samples ] ) => [ name, {
			initializationMs: samples.map( sample => sample.initializationMs ), steppingMs: samples.map( sample => sample.steppingMs ),
			medianInitializationMs: median( samples.map( sample => sample.initializationMs ) ), medianSteppingMs: median( samples.map( sample => sample.steppingMs ) )
		} ] ) ),
		trajectoryComparison: { sampledScalars: difference.length, maxMotionFromFirstSample: motion, tolerance: 5e-4, withinTolerance: difference.every( value => value < 5e-4 ), maxAbsoluteDifference: Math.max( ...difference ), rmsDifference: Math.sqrt( difference.reduce( ( sum, value ) => sum + value ** 2, 0 ) / difference.length ) },
		limitations: 'Synthetic constrained workload; stepping includes skeletal projection and sampled trajectory capture. Gzip sizes are illustrative, not measured network transfer. No claim about browser startup, real-model parity, sustained stability or universal speedup.'
	}, null, 2 ) );

}
