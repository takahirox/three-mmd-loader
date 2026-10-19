// Controlled trajectories and native-step accounting, not a stability stress test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Parser } from 'mmd-parser';
import { Texture, Vector3 } from 'three';
import type { AmmoWorld } from '../src/ammo.js';
import { MMDAnimationHelper } from '../src/animation/MMDAnimationHelper.js';
import { MMDPhysics } from '../src/animation/MMDPhysics.js';
import { MMDLoader } from '../src/loaders/MMDLoader.js';
import { rotationPhysicsBuffer } from '../tests/fixtures.ts';
import { ManualWorker } from '../tests/manual-physics-worker.ts';

const seconds = 6;
const tapes = Object.fromEntries( [ 60, 120, 144 ].map( fps => [ fps, Array.from( { length: fps * seconds }, ( _, i ) => ( i + 1 ) / fps ) ] ) );
interface Sample { time: number; bodies: number[]; bones: number[] }
interface Case {
	key: string; fps: number; format: string; type: number; path: string;
	executedSteps: number; simulatedSeconds: number; callsByStepCount: Record<number, number>;
	nativeStepMs: number; totalUpdateMs: number; perExecutedStepMs: number; finite: boolean; samples: Sample[];
}
interface Run { backend: string; initializationMs: number; cases: Case[] }
const backend = process.argv[ 2 ];
if ( backend === 'default' || backend === 'master' ) {

	process.env.MMD_AMMO_VARIANT = backend === 'master' ? 'bullet-master' : 'default';
	const start = performance.now();
	const { initializeAmmo } = await import( '../tests/ammo-runtime.ts' );
	const ammo = await initializeAmmo();
	const initializationMs = performance.now() - start;
	Object.assign( globalThis, { Ammo: ammo } );
	const cases: Case[] = [];
	const prototype = ammo.btDiscreteDynamicsWorld.prototype as AmmoWorld;
	const nativeStep = prototype.stepSimulation;
	let steps = 0, nativeStepMs = 0, calls: Record<number, number> = {};
	prototype.stepSimulation = function ( delta, maxSteps, unitStep ) {

		const start = performance.now(), requested = nativeStep.call( this, delta, maxSteps, unitStep );
		nativeStepMs += performance.now() - start;
		const executed = Math.min( maxSteps, requested ); steps += executed;
		calls[ executed ] = ( calls[ executed ] ?? 0 ) + 1; return requested;

	};
	for ( const format of [ 'pmd', 'pmx' ] as const ) for ( const type of [ 1, 2 ] ) for ( const path of [ 'standalone sync', 'shared sync', 'worker runtime' ] ) for ( const fps of [ 60, 120, 144 ] ) {

		const parser = new Parser(), buffer = rotationPhysicsBuffer( format, [ 0.2, -0.3, 0.4 ], type );
		const data = format === 'pmd' ? parser.parsePmd( buffer, true ) : parser.parsePmx( buffer, true );
		// Give the same authored joint nonzero spring stiffness in both engines.
		data.constraints[ 0 ].springPosition = [ 10, 15, 20 ]; data.constraints[ 0 ].springRotation = [ 5, 7, 9 ];
		data.constraints[ 0 ].translationLimitation1 = [ -0.25, -0.25, -0.25 ];
		data.constraints[ 0 ].translationLimitation2 = [ 0.25, 0.25, 0.25 ];
		data.constraints[ 0 ].rotationLimitation1 = [ -0.4, -0.4, -0.4 ];
		data.constraints[ 0 ].rotationLimitation2 = [ 0.4, 0.4, 0.4 ];
		const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
		const meshes = Array.from( { length: path === 'shared sync' ? 2 : 1 }, ( _, i ) => {

			const mesh = loader.meshBuilder.build( data, '' ); mesh.position.z = i * 20; mesh.updateMatrixWorld( true ); return mesh;

		} );
		const rest = meshes[ 0 ].skeleton.bones.map( bone => ( { position: bone.position.clone(), quaternion: bone.quaternion.clone() } ) );
		const helper = new MMDAnimationHelper( { sync: false } ); helper.sharedPhysics = true;
		const worker = new ManualWorker(), meta = meshes[ 0 ].geometry.userData.MMD;
		let physics: MMDPhysics;
		if ( path === 'standalone sync' ) physics = new MMDPhysics( meshes[ 0 ], meta.rigidBodies, meta.constraints );
		else {

			for ( const mesh of meshes ) helper.add( mesh, { warmup: 0, animationWarmup: false,
				...( path === 'worker runtime' ? { physicsMode: 'worker', workerPhysics: worker.options() } : {} ) } );
			physics = helper.objects.get( meshes[ 0 ] )!.physics!;
			if ( path === 'worker runtime' ) { worker.start(); await physics.ready; }
			if ( path === 'shared sync' ) assert.equal( physics.world, helper.objects.get( meshes[ 1 ] )!.physics!.world );

		}
		assert.equal( physics.unitStep, 1 / 60 ); assert.equal( physics.maxStepNum, 10 );
		steps = 0; nativeStepMs = 0; calls = {};
		const samples: Sample[] = []; let elapsed = 0, totalUpdateMs = 0;
		const axis = new Vector3( 1, 2, -1 ).normalize();
		for ( const [ index, time ] of tapes[ fps ].entries() ) {

			for ( const mesh of meshes ) {

				mesh.skeleton.bones.forEach( ( bone, i ) => { bone.position.copy( rest[ i ].position ); bone.quaternion.copy( rest[ i ].quaternion ); } );
				const anchor = mesh.skeleton.bones[ 0 ];
				anchor.position.x += Math.sin( time * 1.7 ) * 0.3;
				anchor.quaternion.setFromAxisAngle( axis, Math.sin( time * 1.3 ) * 0.2 );
				mesh.updateMatrixWorld( true );

			}
			const start = performance.now();
			if ( path === 'standalone sync' ) physics.update( time - elapsed );
			else {

				helper.update( time - elapsed );
				if ( path === 'worker runtime' ) { worker.finish(); physics.workerAdapter!.project(); }

			}
			totalUpdateMs += performance.now() - start; elapsed = time;
			assert.ok( physics.bodyResults.length > 0 );
			for ( const body of physics.bodyResults ) assert.ok( body.position.concat( body.quaternion ).every( Number.isFinite ), `${format}/${type}/${path}/${fps} body at ${time}` );
			for ( const mesh of meshes ) for ( const bone of mesh.skeleton.bones ) assert.ok( bone.position.toArray().concat( bone.quaternion.toArray() ).every( Number.isFinite ), `${format}/${type}/${path}/${fps} bone at ${time}` );
			if ( ( index + 1 ) % ( fps / 2 ) === 0 ) samples.push( { time,
				bodies: physics.bodyResults.flatMap( body => [ ...body.position, ...body.quaternion ] ),
				bones: meshes[ 0 ].skeleton.bones.flatMap( bone => [ ...bone.position.toArray(), ...bone.quaternion.toArray() ] ) } );

		}
		const finite = samples.every( sample => [ ...sample.bodies, ...sample.bones ].every( Number.isFinite ) );
		assert.ok( finite ); assert.ok( steps >= seconds * 60 - 1 && steps <= seconds * 60 );
		assert.ok( Math.abs( samples[ 0 ].bodies[ 0 ] - samples.at( -1 )!.bodies[ 0 ] ) > 0.01, 'animated anchor must move' );
		cases.push( { key: `${format}/type${type}/${path}/${fps}`, fps, format, type, path, executedSteps: steps,
			simulatedSeconds: steps / 60, callsByStepCount: calls, nativeStepMs, totalUpdateMs, perExecutedStepMs: nativeStepMs / steps, finite, samples } );
		if ( path === 'standalone sync' ) physics.dispose(); else for ( const mesh of meshes ) helper.remove( mesh );
		for ( const mesh of meshes ) { mesh.geometry.dispose(); mesh.skeleton.dispose(); }

	}
	prototype.stepSimulation = nativeStep;
	console.log( JSON.stringify( { backend, initializationMs, cases } satisfies Run ) );

} else {

	const runs: Run[] = [];
	for ( let repeat = 0; repeat < 3; repeat ++ ) for ( const backend of repeat % 2 ? [ 'master', 'default' ] : [ 'default', 'master' ] ) {

		runs.push( JSON.parse( execFileSync( process.execPath, [ '--import', 'tsx', fileURLToPath( import.meta.url ), backend ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 } ) ) );

	}
	const baseline = runs.find( run => run.backend === 'default' )!, latest = runs.find( run => run.backend === 'master' )!;
	function difference( a: Case, b: Case, field: 'bodies' | 'bones' ) {

		const deltas = a.samples.flatMap( ( sample, i ) => sample[ field ].map( ( value, j ) => Math.abs( value - b.samples[ i ][ field ][ j ] ) ) );
		let maxPositionDistance = 0, maxRotationAngleRadians = 0;
		for ( const [ i, sample ] of a.samples.entries() ) for ( let offset = 0; offset < sample[ field ].length; offset += 7 ) {

			const x = sample[ field ], y = b.samples[ i ][ field ];
			maxPositionDistance = Math.max( maxPositionDistance, Math.hypot( x[ offset ] - y[ offset ], x[ offset + 1 ] - y[ offset + 1 ], x[ offset + 2 ] - y[ offset + 2 ] ) );
			const q = x.slice( offset + 3, offset + 7 ), r = y.slice( offset + 3, offset + 7 );
			const dot = Math.abs( q.reduce( ( sum, value, j ) => sum + value * r[ j ], 0 ) ) / ( Math.hypot( ...q ) * Math.hypot( ...r ) );
			maxRotationAngleRadians = Math.max( maxRotationAngleRadians, 2 * Math.acos( Math.min( 1, dot ) ) );

		}
		return { maxAbsoluteDifference: Math.max( ...deltas ), rmsDifference: Math.sqrt( deltas.reduce( ( sum, delta ) => sum + delta * delta, 0 ) / deltas.length ), maxPositionDistance, maxRotationAngleRadians };

	}
	const crossEngine = baseline.cases.map( ( a, i ) => ( { key: a.key, bodies: difference( a, latest.cases[ i ], 'bodies' ), bones: difference( a, latest.cases[ i ], 'bones' ) } ) );
	const acrossFPS = [ baseline, latest ].flatMap( run => run.cases.filter( c => c.fps !== 60 ).map( c => {

		const reference = run.cases.find( a => a.fps === 60 && a.format === c.format && a.type === c.type && a.path === c.path )!;
		return { backend: run.backend, key: c.key, bodies: difference( c, reference, 'bodies' ), bones: difference( c, reference, 'bones' ) };

	} ) );
	const repeatability = runs.slice( 2 ).map( run => {

		const first = run.backend === 'default' ? baseline : latest;
		return { backend: run.backend, maxTrajectoryDifference: Math.max( ...run.cases.map( ( c, i ) => Math.max( difference( c, first.cases[ i ], 'bodies' ).maxAbsoluteDifference, difference( c, first.cases[ i ], 'bones' ).maxAbsoluteDifference ) ) ) };

	} );
	assert.ok( repeatability.every( result => result.maxTrajectoryDifference === 0 ) );
	const output = { recordedAt: new Date().toISOString(), machine: { platform: platform(), arch: arch(), cpu: cpus()[ 0 ].model, node: process.version },
		bullet: JSON.parse( readFileSync( new URL( '../examples/vendor/bullet/manifest.json', import.meta.url ), 'utf8' ) ),
		baseline: 'ammojs-typed@1.1.0 WASM, Bullet 2.82 plus 2.83 raycast patch',
		method: 'Three fresh processes per backend, alternating order. Six seconds per fixture; no warmup. Identical analytic animated kinematic anchor, mixed-axis spring joint (linear limits +/-0.25, angular +/-0.4 rad, stiffness [10,15,20] linear/[5,7,9] angular) and type 1/2 dynamic box; PMD/PMX; standalone sync, two separated shared-sync models, sequenced Worker runtime. Default gravity, fixed 1/60, maxStepNum 10, ERP, damping, masks and timestamps. Native step time excludes projection; total update includes it and deterministic Worker cloning. No browser scheduling or transfer-latency speed claim.',
		tapes, tapeSha256: createHash( 'sha256' ).update( JSON.stringify( tapes ) ).digest( 'hex' ),
		runs: runs.map( ( run, i ) => i < 2 ? run : { ...run, cases: run.cases.map( ( { samples: _samples, ...metrics } ) => metrics ) } ),
		crossEngine, acrossFPS, repeatability,
		limitations: 'Synthetic six-second fixtures do not reproduce the intermittent violent oscillation. Across-FPS differences include unchanged kinematic sampling/interpolation. No confirmed stability fix or general speedup.' };
	const target = new URL( '../docs/bullet-comparison.json', import.meta.url );
	writeFileSync( target, JSON.stringify( output, null, 2 ) + '\n' );
	console.log( `Saved ${runs.length} runs, ${baseline.cases.length} cases per run to docs/bullet-comparison.json` );

}
