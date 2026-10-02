import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const manifest = JSON.parse( readFileSync( join( root, 'package.json' ), 'utf8' ) );
const publicModules = {
	'animation/CCDIKSolver.js': [ 'CCDIKHelper', 'CCDIKSolver' ],
	'animation/MMDAnimationHelper.js': [ 'MMDAnimationHelper' ],
	'animation/MMDPhysics.js': [ 'MMDPhysics' ],
	'exporters/MMDExporter.js': [ 'MMDExporter' ],
	'libs/mmdparser.module.js': [ 'CharsetEncoder', 'MMDParser', 'Parser' ],
	'loaders/MMDLoader.js': [ 'MMDLoader' ],
	'shaders/MMDToonShader.js': [ 'MMDToonShader' ]
};

test( 'root and addon-style subpaths expose every public module', async () => {

	const entry = await import( 'three-mmd-loader' );
	assert.deepEqual( Object.keys( entry ).sort(), Object.values( publicModules ).flat().sort() );
	for ( const [ path, exports ] of Object.entries( publicModules ) ) {

		const module = await import( `three-mmd-loader/${path}` );
		assert.deepEqual( Object.keys( module ).sort(), exports );
		for ( const name of exports ) assert.equal( module[ name ], entry[ name ] );

	}

} );

test( 'packed npm package installs and imports in an isolated consumer', { timeout: 60000 }, () => {

	const consumer = mkdtempSync( join( tmpdir(), 'three-mmd-loader-test-' ) );
	const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
	const options = { cwd: consumer, encoding: 'utf8', timeout: 30000 };
	try {

		const [ packed ] = JSON.parse( execFileSync( npm, [
			'pack', root, '--json', '--pack-destination', consumer, '--ignore-scripts'
		], options ) );
		const files = packed.files.map( file => file.path );
		for ( const target of Object.values( manifest.exports ).flatMap( conditions => Object.values( conditions ) ) ) {

			assert.ok( files.includes( target.slice( 2 ) ), `Missing package file: ${target}` );

		}
		assert.ok( files.includes( 'LICENSE' ) );
		assert.ok( files.includes( 'THIRD_PARTY_NOTICES.md' ) );
		assert.ok( files.includes( 'README.md' ) );
		assert.ok( files.every( path => ! /^(node_modules|tests|src|dist\/examples)\//.test( path ) ) );
		// Pack the pinned peer installed by npm ci; resolving a registry version
		// offline would require metadata that npm ci does not cache.
		const [ peer ] = JSON.parse( execFileSync( npm, [
			'pack', join( root, 'node_modules/three' ), '--json', '--pack-destination', consumer, '--ignore-scripts'
		], options ) );
		assert.equal( peer.version, manifest.devDependencies.three );
		writeFileSync( join( consumer, 'package.json' ), JSON.stringify( {
			private: true,
			type: 'module',
			dependencies: {
				'three-mmd-loader': `file:./${packed.filename}`,
				three: `file:./${peer.filename}`
			}
		} ) );
		// An empty consumer cache keeps this check independent of prior npm runs.
		execFileSync( npm, [
			'install', '--offline', '--cache', join( consumer, 'npm-cache' ), '--ignore-scripts', '--no-audit', '--no-fund'
		], options );
		writeFileSync( join( consumer, 'check.mjs' ), `
import assert from 'node:assert/strict';
import { Loader, REVISION } from 'three';
import * as entry from 'three-mmd-loader';
assert.equal( REVISION, '186' );
assert.ok( new entry.MMDLoader() instanceof Loader );
new entry.MMDAnimationHelper();
new entry.MMDExporter();
new entry.MMDParser.Parser();
assert.throws( () => new entry.MMDPhysics( null, [] ), /Import ammo.js/ );
for ( const [ path, names ] of Object.entries( ${JSON.stringify( publicModules )} ) ) {
  const module = await import( 'three-mmd-loader/' + path );
  for ( const name of names ) assert.equal( module[ name ], entry[ name ] );
}
` );
		execFileSync( process.execPath, [ 'check.mjs' ], options );
		// Type-check the tarball's declarations in the isolated consumer. Only
		// external Three.js type dependencies and the compiler come from the checkout.
		for ( const path of [ '@types', 'fflate', 'meshoptimizer' ] ) {

			cpSync( join( root, 'node_modules', path ), join( consumer, 'node_modules', path ), { recursive: true } );

		}
		cpSync( join( root, 'tests/types/consumer.ts' ), join( consumer, 'consumer.ts' ) );
		execFileSync( process.execPath, [
			join( root, 'node_modules/typescript/bin/tsc' ), '--noEmit', '--strict',
			'--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'consumer.ts'
		], options );
		const installed = JSON.parse( readFileSync( join( consumer, 'node_modules/three-mmd-loader/package.json' ), 'utf8' ) );
		assert.equal( installed.peerDependencies.three, '~0.186.0' );
		assert.equal( installed.dependencies, undefined );

	} finally {

		rmSync( consumer, { recursive: true, force: true } );

	}

} );
