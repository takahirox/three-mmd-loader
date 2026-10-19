import { build } from 'esbuild';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath( new URL( '../', import.meta.url ) );
// Keep dist/examples intact when rebuilding the package during development.
await mkdir( new URL( '../dist/', import.meta.url ), { recursive: true } );
for ( const name of await readdir( new URL( '../dist/', import.meta.url ) ) ) {

	if ( name === 'examples' ) continue;
	await rm( new URL( `../dist/${name}`, import.meta.url ), { recursive: true, force: true } );

}
execFileSync( process.execPath, [ 'node_modules/typescript/bin/tsc' ], { cwd: root, stdio: 'inherit' } );
execFileSync( process.execPath, [ 'node_modules/typescript/bin/tsc', '-p', 'tsconfig.examples.json' ], { cwd: root, stdio: 'inherit' } );

// Classic worker bundles Three/core adapters, so it needs no import map and can
// initialize classic Ammo distributions with importScripts.
await build( { entryPoints: [ fileURLToPath( new URL( '../src/animation/MMDPhysicsWorker.ts', import.meta.url ) ) ], outfile: fileURLToPath( new URL( '../dist/animation/MMDPhysicsWorker.js', import.meta.url ) ), bundle: true, format: 'iife', platform: 'browser', target: 'es2022' } );

// Optional self-hosted runtime assets; consumers still supply globalThis.Ammo.
await cp( new URL( '../examples/vendor/bullet/', import.meta.url ), new URL( '../dist/vendor/bullet/', import.meta.url ), { recursive: true } );
