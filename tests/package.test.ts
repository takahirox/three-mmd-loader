import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { pmdBuffer, pmxBuffer, sdefPmxBuffer, vmdBuffer } from './fixtures.ts';

const root = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
interface PackageManifest { exports: Record<string, Record<string, string>>; devDependencies: { three: string }; dependencies: { 'mmd-parser': string } }
interface PackedPackage { filename: string; version: string; files: { path: string }[] }
const manifest: PackageManifest = JSON.parse( readFileSync( join( root, 'package.json' ), 'utf8' ) );
const publicModules = {
	'animation/CCDIKSolver.js': [ 'CCDIKHelper', 'CCDIKSolver' ],
	'animation/MMDAnimationHelper.js': [ 'MMDAnimationHelper' ],
	'animation/MMDPhysics.js': [ 'MMDPhysics' ],
	'exporters/MMDExporter.js': [ 'MMDExporter' ],
	'loaders/MMDLoader.js': [ 'MMDLoader' ],
	'materials/MMDToonMaterial.js': [ 'MMDToonMaterial' ],
	'effects/MMDOutlineEffect.js': [ 'MMDOutlineEffect' ]
};

test( 'root and addon-style subpaths expose every public module', async () => {

	const entry = await import( 'three-mmd-loader' );
	assert.deepEqual( Object.keys( entry ).sort(), Object.values( publicModules ).flat().sort() );
	await assert.rejects( import( 'three-mmd-loader/' + 'shaders/MMDToonShader.js' ), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' } );
	await assert.rejects( import( 'three-mmd-loader/' + 'libs/mmdparser.module.js' ), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' } );
	for ( const [ path, exports ] of Object.entries( publicModules ) ) {

		const module = await import( `three-mmd-loader/${path}` );
		assert.deepEqual( Object.keys( module ).sort(), exports );
		for ( const name of exports ) assert.equal( module[ name ], ( entry as unknown as Record<string, unknown> )[ name ] );

	}

} );

test( 'packed npm package installs and imports in an isolated consumer', { timeout: 60000 }, () => {

	const consumer = mkdtempSync( join( tmpdir(), 'three-mmd-loader-test-' ) );
	const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
	const options = { cwd: consumer, encoding: 'utf8' as const, timeout: 30000 };
	try {

		const [ packed ]: PackedPackage[] = JSON.parse( execFileSync( npm, [
			'pack', root, '--json', '--pack-destination', consumer, '--ignore-scripts'
		], options ) );
		const files = packed.files.map( file => file.path );
		for ( const target of Object.values( manifest.exports ).flatMap( conditions => Object.values( conditions ) ) ) {

			assert.ok( files.includes( target.slice( 2 ) ), `Missing package file: ${target}` );

		}
		assert.ok( files.every( path => ! /(?:mmdparser|dist\/libs\/|private|local-viewer|serve-sdef)/.test( path ) ) );
		assert.ok( files.includes( 'LICENSE' ) );
		assert.ok( files.includes( 'THIRD_PARTY_NOTICES.md' ) );
		assert.ok( files.includes( 'README.md' ) );
		assert.ok( files.every( path => ! /^(node_modules|tests|src|dist\/examples)\//.test( path ) ) );
		// Pack the pinned peer installed by npm ci; resolving a registry version
		// offline would require metadata that npm ci does not cache.
		const [ peer ]: PackedPackage[] = JSON.parse( execFileSync( npm, [
			'pack', join( root, 'node_modules/three' ), '--json', '--pack-destination', consumer, '--ignore-scripts'
		], options ) );
		assert.equal( peer.version, manifest.devDependencies.three );
		// Supply the installed parser tarball through an override. The consumer
		// declares only the loader and its Three.js peer, so npm must install the
		// parser through the loader's runtime dependency, with no registry/cache.
		const [ parser ]: PackedPackage[] = JSON.parse( execFileSync( npm, [
			'pack', join( root, 'node_modules/mmd-parser' ), '--json', '--pack-destination', consumer, '--ignore-scripts'
		], options ) );
		assert.equal( parser.version, '1.1.4' );
		writeFileSync( join( consumer, 'package.json' ), JSON.stringify( {
			private: true,
			type: 'module',
			overrides: { 'mmd-parser': `file:./${parser.filename}` },
			dependencies: {
				'three-mmd-loader': `file:./${packed.filename}`,
				three: `file:./${peer.filename}`
			}
		} ) );
		// An empty consumer cache keeps this check independent of prior npm runs.
		execFileSync( npm, [
			'install', '--offline', '--cache', join( consumer, 'npm-cache' ), '--ignore-scripts', '--no-audit', '--no-fund'
		], options );
		for ( const [ name, buffer ] of [ [ 'model.pmd', pmdBuffer() ], [ 'model.pmx', pmxBuffer( { additionalUvMorphs: true } ) ], [ 'motion.vmd', vmdBuffer() ], [ 'sdef.pmx', sdefPmxBuffer( { groupMorphs: true } ) ] ] as const ) {

			writeFileSync( join( consumer, name ), Buffer.from( buffer ) );

		}
		writeFileSync( join( consumer, 'check.mjs' ), `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Loader, REVISION, Texture } from 'three';
import { Parser, CharsetEncoder } from 'mmd-parser';
import * as entry from 'three-mmd-loader';
// Three.js FileLoader uses this browser event when streaming responses.
globalThis.ProgressEvent ??= class extends Event {
  constructor( type, properties = {} ) { super( type ); Object.assign( this, properties ); }
};
assert.equal( REVISION, '186' );
assert.ok( new entry.MMDLoader() instanceof Loader );
new entry.MMDAnimationHelper();
new entry.MMDExporter();
assert.deepEqual( Object.keys( entry ).sort(), ${JSON.stringify( Object.values( publicModules ).flat().sort() )} );
for ( const name of [ 'MMDParser', 'Parser', 'CharsetEncoder' ] ) assert.ok( ! ( name in entry ) );
await assert.rejects( import( 'three-mmd-loader/libs/mmdparser.module.js' ), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' } );
const loader = new entry.MMDLoader();
assert.ok( loader._getParser() instanceof Parser );
loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
const pmxBytes = readFileSync( 'model.pmx' );
const pmx = new Parser().parsePmx( pmxBytes.buffer.slice( pmxBytes.byteOffset, pmxBytes.byteOffset + pmxBytes.byteLength ) );
assert.deepEqual( pmx.morphs.slice( 0, 4 ).map( morph => morph.type ), [ 4, 5, 6, 7 ] );
for ( const morph of pmx.morphs.slice( 0, 4 ) ) {
  assert.deepEqual( morph.elements, [
    { index: 0, uv: [ morph.type / 4, - 0.5, 0.25, 1 ] },
    { index: 2, uv: [ - 1, morph.type / 2, 0.5, - 0.25 ] }
  ] );
}
assert.equal( pmx.morphs[ 4 ].name, 'following-vertex' );
assert.deepEqual( pmx.morphs[ 4 ].elements, [ { index: 1, position: [ 0.25, 0.5, 0.75 ] } ] );
assert.equal( pmx.frames[ 0 ].name, 'following-frame' );
assert.deepEqual( pmx.frames[ 0 ].elements, [ { target: 0, index: 0 }, { target: 1, index: 4 } ] );
for ( const format of [ 'pmd', 'pmx' ] ) {
  const bytes = readFileSync( 'model.' + format );
  const mesh = await loader.loadAsync( 'data:application/octet-stream;base64,' + bytes.toString( 'base64' ) );
  assert.equal( mesh.geometry.userData.MMD.format, format );
  assert.equal( mesh.geometry.attributes.position.count, 3 );
  const animation = await new Promise( ( resolve, reject ) => loader.loadAnimation(
    'data:application/octet-stream;base64,' + readFileSync( 'motion.vmd' ).toString( 'base64' ), mesh, resolve, undefined, reject
  ) );
  const helper = new entry.MMDAnimationHelper();
  helper.add( mesh, { physics: false, animation } ).update( 0.5 );
  assert.ok( mesh.skeleton.bones[ 0 ].position.x > 0 );
  mesh.skeleton.bones[ 0 ].name = 'センター';
  const exporter = new entry.MMDExporter();
  const text = exporter.parseVpd( mesh );
  const pose = new Parser().parseVpd( text, true );
  assert.equal( pose.bones[ 0 ].name, 'センター' );
  assert.equal( new CharsetEncoder().s2u( exporter.parseVpd( mesh, true ) ), text );
  helper.pose( mesh, pose, { ik: false } );
  mesh.geometry.dispose();
  mesh.material.forEach( material => material.dispose() );
}
const sdefBytes = readFileSync( 'sdef.pmx' );
const sdefMesh = await loader.loadAsync( 'data:application/octet-stream;base64,' + sdefBytes.toString( 'base64' ) );
assert.equal( Array.from( { length: sdefMesh.geometry.attributes.mmdSkinningType.count }, ( _, i ) => sdefMesh.geometry.attributes.mmdSkinningType.getX( i ) ).filter( type => type === 3 ).length, 9 );
assert.equal( sdefMesh.geometry.attributes.mmdSdefC.getZ( 0 ), Math.fround( -0.3 ) );
assert.ok( sdefMesh.material[0].isMMDToonMaterial );
assert.equal(sdefMesh.geometry.userData.MMD.boneMorphs.length, 3);
const morphHelper = new entry.MMDAnimationHelper();
morphHelper.add(sdefMesh, {physics:false});
sdefMesh.morphTargetInfluences[sdefMesh.morphTargetDictionary['bone-a']]=1;
morphHelper.update(0);
assert.ok(Math.abs(sdefMesh.skeleton.bones[0].position.z + 0.4)<1e-6);
const transformed=sdefMesh.skeleton.bones[0].quaternion.toArray();
morphHelper.update(0);
assert.deepEqual(sdefMesh.skeleton.bones[0].quaternion.toArray(), transformed);
morphHelper.enable('boneMorph',false).update(0);
assert.deepEqual(sdefMesh.skeleton.bones[0].position.toArray(),[0,0,0]);
sdefMesh.morphTargetInfluences.fill(0);
sdefMesh.morphTargetInfluences[sdefMesh.morphTargetDictionary['mixed-group']]=1;
morphHelper.enable('boneMorph',true).update(0);
assert.ok(Math.abs(sdefMesh.skeleton.bones[0].position.x - (0.3*0.375 - 0.15*0.5))<1e-6);
assert.equal(sdefMesh.morphTargetInfluences[1],0);
assert.equal(sdefMesh.geometry.userData.MMD.groupMorphs.find(g=>g.index===6).elements[1].type,2);
const groupResult=sdefMesh.skeleton.bones[0].quaternion.toArray();
morphHelper.update(0);assert.deepEqual(sdefMesh.skeleton.bones[0].quaternion.toArray(),groupResult);
sdefMesh.morphTargetInfluences.fill(0);morphHelper.update(0);
assert.deepEqual(sdefMesh.skeleton.bones[0].position.toArray(),[0,0,0]);
sdefMesh.geometry.dispose(); sdefMesh.material.forEach( material => material.dispose() );
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
		const installed: { peerDependencies: { three: string }; dependencies?: Record<string, string> } = JSON.parse( readFileSync( join( consumer, 'node_modules/three-mmd-loader/package.json' ), 'utf8' ) );
		assert.equal( installed.peerDependencies.three, '~0.186.0' );
		assert.deepEqual( installed.dependencies, { 'mmd-parser': '^1.1.4' } );
		assert.equal( installed.dependencies[ 'mmd-parser' ], manifest.dependencies[ 'mmd-parser' ] );
		const installedParser = JSON.parse( readFileSync( join( consumer, 'node_modules/mmd-parser/package.json' ), 'utf8' ) );
		assert.equal( installedParser.version, '1.1.4' );

	} finally {

		rmSync( consumer, { recursive: true, force: true } );

	}

} );
