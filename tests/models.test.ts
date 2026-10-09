import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { importModels } from '../scripts/import-models.ts';
import { categories, decodeNotice, gitHash, inspectDirectory, inspectPmx, limits, safePath, selectSource, setupSource, sources, validateSource } from '../scripts/private-models.ts';
import type { ModelSource } from '../scripts/private-models.ts';
import { readModelZip } from '../scripts/safe-model-zip.ts';
import { createSdefServer } from '../scripts/serve-sdef.ts';
import { createExamplesServer } from '../scripts/serve-examples.ts';
import { grantPmxBuffer, physicsLayersPmxBuffer, sdefPmxBuffer, materialPmxBuffer, vmdBuffer } from './fixtures.ts';
import { modelZip } from './model-zip-fixture.ts';

const fixtureFiles = () => new Map( [
	[ '包/モデル.pmx', Buffer.from( sdefPmxBuffer( { texturePath: 'tex/色.png', groupMorphs: true } ) ) ],
	[ '包/tex/色.png', Buffer.from( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64' ) ],
	[ '包/motion.vmd', Buffer.from( vmdBuffer() ) ],
	[ '包/README.txt', Buffer.from( 'Generated fixture terms; no third-party license implied.' ) ]
] );
const fixtureSource = ( files: Map<string, Buffer> ): ModelSource => ( { id: 'fixture', name: 'Generated fixture', repository: 'fixtures/models', origin: 'https://github.com/fixtures/models', commit: 'a'.repeat( 40 ), reviewed: '2026-10-09', license: 'Generated fixture', attribution: 'test fixture', notices: [ '包/README.txt' ], files: [ ...files ].map( ( [ path, bytes ] ) => ( { path, size: bytes.length, sha: gitHash( bytes ) } ) ) } );

test( 'reviewed Gene manifest pins only correct original files and rejects unreviewed/protected sources', () => {

	assert.equal( sources.length, 1 ); const gene = selectSource( 'gene' ); validateSource( gene );
	assert.equal( gene.commit, 'c7eace43dffaccff6ad0597433ef85fa57c91e03' );
	assert.equal( gene.files.find( f => f.path === 'README.md' )?.sha, '9dc2555a5361d005dd9caef6707c4dff815199ce' );
	assert.equal( gene.files.filter( f => f.path.startsWith( 'tex/' ) ).length, 12 );
	assert.ok( gene.files.some( f => f.path === 'Gene.pmx' ) );
	assert.match( gene.license, /trademark.*contact/i ); assert.match( gene.attribution, /Nagoya/ );
	for ( const id of [ 'https://bowlroll.net/file/123', 'https://raw.githubusercontent.com/other/main/model.pmx', 'yyb', 'gene --url', '../gene' ] ) assert.throws( () => selectSource( id ), /Unsupported automatic source/ );
	for ( const change of [ { commit: 'main' }, { notices: [] }, { origin: 'https://bowlroll.net/' }, { files: [ { path: '../Gene.pmx', sha: 'a'.repeat( 40 ), size: 1 } ] } ] ) assert.throws( () => validateSource( { ...gene, ...change } ) );
	for ( const path of [ '../x', '/x', 'C:/x', 'a\\..\\x', 'a/../b', 'a//b', 'a\0x', 'a/CON.txt', 'a/b.','a/b?' ] ) assert.throws( () => safePath( path ) );

} );

test( 'controlled HTTP download verifies retries, truncation, hash cache, idempotence and offline recovery', async () => {

	const temporary = await mkdtemp( join( tmpdir(), 'mmd-setup-' ) ), root = join( temporary, 'private' );
	const files = fixtureFiles(), source = fixtureSource( files ); let requests: number = 0, phase = 'retry';
	const server = createServer( ( request, response ) => {

		requests ++; const bytes = files.get( decodeURIComponent( request.url!.slice( 1 ) ) )!;
		if ( phase === 'retry' && requests === 1 ) { response.writeHead( 503 ).end(); return; }
		if ( phase === 'partial' ) { response.writeHead( 200, { 'Content-Length': bytes.length } ); response.write( bytes.subarray( 0, 5 ) ); response.destroy(); return; }
		if ( phase === 'checksum' ) { response.end( Buffer.alloc( bytes.length ) ); return; }
		if ( phase === 'short' ) { response.end( bytes.subarray( 0, 5 ) ); return; }
		if ( phase === 'oversize' ) { response.end( Buffer.alloc( bytes.length + 1 ) ); return; }
		if ( phase === 'redirect' ) { response.writeHead( 302, { Location: 'https://bowlroll.net/' } ).end(); return; }
		response.end( bytes );

	} );
	await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
	const localURL = `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}`;
	const fetchFile: typeof fetch = ( url, options ) => {

		const prefix = `https://raw.githubusercontent.com/${source.repository}/${source.commit}/`;
		assert.ok( String( url ).startsWith( prefix ) ); assert.equal( options?.credentials, 'omit' ); assert.equal( options?.redirect, 'error' );
		return fetch( localURL + '/' + String( url ).slice( prefix.length ), options );

	};
	try {

		const first = await setupSource( source, { root, fetchFile } ); assert.equal( requests, 5 );
		assert.deepEqual( first.models[ 0 ].report, inspectPmx( files.get( '包/モデル.pmx' )! ) );
		const file = join( first.directory, '包/モデル.pmx' ), modified = ( await stat( file ) ).mtimeMs;
		const second = await setupSource( source, { root, fetchFile } ); assert.equal( second.directory, first.directory ); assert.equal( requests, 5 ); assert.equal( ( await stat( file ) ).mtimeMs, modified );
		// A corrupt cache must never poison the intact installed copy, even offline.
		const cache = join( root, '.cache', source.files[ 0 ].sha ); await writeFile( cache, 'corrupt' );
		await setupSource( source, { root, offline: true, fetchFile } ); assert.equal( gitHash( await readFile( cache ) ), source.files[ 0 ].sha );
		// Recover a missing installation entirely from independently verified cache.
		await rm( first.directory, { recursive: true } ); await setupSource( source, { root, offline: true, fetchFile } ); assert.equal( requests, 5 );
		for ( const failure of [ 'partial', 'checksum', 'short', 'oversize', 'redirect' ] ) {

			phase = failure; const alternate = { ...source, id: failure };
			const separateRoot = join( temporary, failure ); const before: number = requests;
			await assert.rejects( setupSource( alternate, { root: separateRoot, fetchFile, retries: 1 } ), /Source unavailable or unverified/ ); assert.equal( requests - before, 2 );
			await assert.rejects( lstat( join( separateRoot, 'models', failure ) ), { code: 'ENOENT' } );
			await assert.rejects( lstat( join( separateRoot, '.models-lock' ) ), { code: 'ENOENT' } );

		}
		await new Promise<void>( resolve => server.close( () => resolve() ) );
		await setupSource( source, { root, offline: true, fetchFile } );
		await assert.rejects( setupSource( source, { root: join( temporary, 'empty' ), offline: true, fetchFile } ), /no verified local copy/ );
		// Broken downloads must leave a previous usable installation untouched.
		const changed = { ...source, files: source.files.map( ( f, i ) => i ? f : { ...f, sha: 'b'.repeat( 40 ) } ) };
		await assert.rejects( setupSource( changed, { root, fetchFile, retries: 0 } ), /existing assets preserved/ );
		assert.equal( gitHash( await readFile( file ) ), source.files[ 0 ].sha );

	} finally { if ( server.listening ) await new Promise<void>( resolve => server.close( () => resolve() ) ); await rm( temporary, { recursive: true, force: true } ); }

} );

test( 'PMX reports present data without claiming absent categories or visual validation', () => {

	const empty = inspectPmx( Buffer.from( sdefPmxBuffer() ) ); assert.equal( empty.sdef, 9 );
	assert.deepEqual( empty.morphTypes, [ 0, 1, 0, 0, 0, 0, 0, 0, 0 ] );
	for ( const category of categories.filter( c => c !== 'sdef' ) ) assert.equal( empty.features[ category ], 'not demonstrated' );
	assert.equal( inspectPmx( Buffer.from( sdefPmxBuffer( { envFlag: 3 } ) ) ).envFlag3, 1 );
	const groups = inspectPmx( Buffer.from( sdefPmxBuffer( { groupMorphs: true } ) ) ); assert.ok( groups.groupLinks.some( l => l.type === 2 ) );
	const uv = inspectPmx( Buffer.from( sdefPmxBuffer( { uvMorphs: true } ) ) ); assert.equal( uv.additionalUVChannels, 4 ); assert.ok( uv.morphTypes.slice( 3, 8 ).every( n => n > 0 ) ); assert.ok( uv.groupLinks.some( l => l.type === 3 ) );
	const material = inspectPmx( Buffer.from( materialPmxBuffer() ) ); assert.ok( material.morphTypes[ 8 ] > 0 ); assert.ok( material.groupLinks.some( l => l.type === 8 ) );
	const grant = inspectPmx( Buffer.from( grantPmxBuffer() ) ); assert.ok( grant.grants.some( g => g.affectPosition ) ); assert.ok( grant.grants.some( g => g.affectRotation ) ); assert.ok( grant.grants.some( g => g.isLocal ) );
	const physics = inspectPmx( Buffer.from( physicsLayersPmxBuffer() ) ); assert.ok( physics.postPhysicsBones > 0 ); assert.ok( physics.prePhysicsBones > 0 ); assert.ok( physics.rigidBodyModes.every( n => n > 0 ) );
	assert.ok( Object.values( physics.features ).every( s => s === 'not demonstrated' || s === 'present (visual test not performed)' ) );

} );

test( 'local Unicode directory/ZIP imports discover models, preserve textures/terms and never alter existing bundles on failure', async () => {

	const temporary = await mkdtemp( join( tmpdir(), 'mmd-import-' ) ), root = join( temporary, 'private' ), source = join( temporary, 'source' );
	try {

		await mkdir( source ); const files = fixtureFiles();
		for ( const [ path, bytes ] of files ) { await mkdir( dirname( join( source, path ) ), { recursive: true } ); await writeFile( join( source, path ), bytes ); }
		const first = await importModels( source, { root, category: 'group-morph' } );
		const zip = join( temporary, 'モデル.zip' ); await writeFile( zip, modelZip( [ ...files ].map( ( [ path, bytes ] ) => ( { path, bytes, flags: 0x808 } ) ) ) );
		const second = await importModels( zip, { root, category: 'group-morph' } ); assert.equal( second.directory, first.directory );
		assert.deepEqual( await inspectDirectory( first.directory ), first.models ); assert.equal( first.models[ 0 ].motions[ 0 ], '包/motion.vmd' ); assert.equal( first.models[ 0 ].notices[ 0 ], '包/README.txt' );
		assert.deepEqual( await readFile( join( first.directory, '包/tex/色.png' ) ), files.get( '包/tex/色.png' ) );
		const before = await readdir( join( root, 'models' ) );
		for ( const invalid of [ [ { path: 'none.txt', bytes: Buffer.from( 'no PMX' ) } ], [ { path: 'invalid.pmx', bytes: Buffer.from( 'bad' ) } ], [ { path: 'missing.pmx', bytes: files.get( '包/モデル.pmx' )! } ] ] ) {

			await writeFile( zip, modelZip( invalid ) ); await assert.rejects( importModels( zip, { root } ), /No PMX|invalid\/unsupported PMX|missing texture/ );

		}
		await assert.rejects( importModels( 'https://bowlroll.net/file/123', { root } ), /Local paths only/ );
		await assert.rejects( importModels( source, { root, category: 'unknown' } ), /Unknown category/ );
		await symlink( join( source, '包/モデル.pmx' ), join( source, 'outside.pmx' ) ); await assert.rejects( importModels( source, { root } ), /Symlink/ );
		assert.deepEqual( await readdir( join( root, 'models' ) ), before );
		const linkedRoot = join( temporary, 'linked' ); await symlink( root, linkedRoot ); await assert.rejects( importModels( zip, { root: linkedRoot } ), /Symlink/ );

	} finally { await rm( temporary, { recursive: true, force: true } ); }

} );

test( 'notice decoding and legacy Japanese ZIP names preserve inspectable text', () => {

	assert.equal( decodeNotice( Buffer.from( [ 0x82, 0xa0 ] ) ), 'あ' );
	assert.equal( decodeNotice( Buffer.concat( [ Buffer.from( [ 0xff, 0xfe ] ), Buffer.from( '利用条件', 'utf16le' ) ] ) ), '利用条件' );
	assert.equal( decodeNotice( Buffer.from( 'Terms\x1b[31m' ) ), 'Terms[31m' );
	const zip = modelZip( [ { path: 'あ.txt', encodedName: Buffer.from( [ 0x82, 0xa0, 0x2e, 0x74, 0x78, 0x74 ] ), flags: 0, bytes: Buffer.from( 'notice' ) } ] );
	assert.equal( readModelZip( zip ).get( 'あ.txt' )?.toString(), 'notice' );
	const folders = modelZip( [ { path: 'folder/', mode: 0o40755, bytes: Buffer.alloc( 0 ) }, { path: 'folder/model.txt', bytes: Buffer.from( 'text' ) } ] );
	assert.equal( readModelZip( folders ).size, 1 );

} );

test( 'ZIP rejects traversal, executable content, links, bombs, collisions and boundary/CRC violations before extraction', () => {

	const bytes = Buffer.from( 'generated notice' );
	for ( const path of [ '../model.pmx', '/model.pmx', 'C:\\model.pmx', 'a\\..\\model.pmx', 'file.exe', 'file.sh', 'file.html', 'archive.zip' ] ) assert.throws( () => readModelZip( modelZip( [ { path, bytes } ] ) ) );
	for ( const mode of [ 0o120777, 0o010644, 0o100755 ] ) assert.throws( () => readModelZip( modelZip( [ { path: 'file.txt', bytes, mode } ] ) ), /mode rejected/ );
	for ( const magic of [ 'MZ', '#!', '\x7fELF' ] ) assert.throws( () => readModelZip( modelZip( [ { path: 'file.png', bytes: Buffer.from( magic ) } ] ) ), /Executable content/ );
	for ( const flags of [ 0x801, 0x840 ] ) assert.throws( () => readModelZip( modelZip( [ { path: 'file.txt', bytes, flags } ] ) ), /Encrypted\/unsupported/ );
	assert.throws( () => readModelZip( modelZip( [ { path: 'bomb.txt', bytes: Buffer.alloc( 1024 * 1024 ) } ] ) ), /ratio limit/ );
	for ( const paths of [ [ 'A.txt', 'a.txt' ], [ 'a.txt', 'a.txt/x.txt' ], [ 'é.txt', 'e\u0301.txt' ], [ 'Tex/a.txt', 'tex/b.txt' ] ] ) assert.throws( () => readModelZip( modelZip( paths.map( path => ( { path, bytes } ) ) ) ), /Duplicate|collision/ );
	const corrupt = modelZip( [ { path: 'file.txt', bytes, method: 0 } ] ); corrupt[ 30 + Buffer.byteLength( 'file.txt' ) ] ^= 1; assert.throws( () => readModelZip( corrupt ), /CRC failure/ );
	const boundary = modelZip( [ { path: 'file.txt', bytes } ] ); boundary.writeUInt32LE( 0xffffffff, boundary.length - 6 ); assert.throws( () => readModelZip( boundary ), /boundaries/ );
	const original = modelZip( [ { path: 'file.txt', bytes } ] ); const originalCentral = original.readUInt32LE( original.length - 6 );
	const selfExtracting = Buffer.concat( [ Buffer.from( 'MZ' ), original ] ); selfExtracting.writeUInt32LE( originalCentral + 2, selfExtracting.length - 6 ); selfExtracting.writeUInt32LE( 2, originalCentral + 2 + 42 );
	assert.throws( () => readModelZip( selfExtracting ), /prepended/ );
	const names = modelZip( [ { path: 'file.txt', bytes } ] ); names[ 30 ] = 0x78; assert.throws( () => readModelZip( names ), /mismatch/ );
	const size = modelZip( [ { path: 'file.txt', bytes } ] ); const central = size.indexOf( Buffer.from( [ 0x50, 0x4b, 1, 2 ] ) ); size.writeUInt32LE( limits.file + 1, central + 24 ); assert.throws( () => readModelZip( size ), /resource/ );
	assert.throws( () => readModelZip( modelZip( Array.from( { length: limits.files + 1 }, ( _, i ) => ( { path: i + '.txt', bytes: Buffer.alloc( 0 ) } ) ) ) ), /entry limit/ );
	assert.throws( () => readModelZip( Buffer.alloc( limits.archive + 1 ) ), /size limit/ );

} );

test( 'private catalog budgets each installed bundle independently and isolates oversized or invalid bundles', async () => {

	const temporary = await mkdtemp( join( tmpdir(), 'mmd-bundle-catalog-' ) ), root = join( temporary, 'models' );
	const server = createSdefServer( { modelsDirectory: root, installedExamplesDirectory: join( temporary, 'missing' ) } );
	async function makeBundle( name: string, textures = 1 ) {

		const bundle = join( root, name );
		for ( const [ path, bytes ] of fixtureFiles() ) { await mkdir( dirname( join( bundle, path ) ), { recursive: true } ); await writeFile( join( bundle, path ), bytes ); }
		for ( let i = 0; i < textures; i ++ ) {

			// Sparse textures exercise real byte limits without allocating hundreds of MiB.
			const file = await open( join( bundle, '包/tex', i === 0 ? '色.png' : `${i}.png` ), 'a' );
			try { await file.truncate( 60 * 1024 * 1024 ); } finally { await file.close(); }

		}

	}
	try {

		await makeBundle( 'first' );
		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		const url = `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}/local-sdef/models.json`;
		const initial = await ( await fetch( url ) ).json();
		assert.equal( initial.models.length, 1 );
		for ( let i = 1; i < 5; i ++ ) await makeBundle( `valid-${i}` );
		const combined = await ( await fetch( url ) ).json();
		assert.equal( combined.models.length, 5 ); assert.deepEqual( combined.errors, [] );
		assert.deepEqual( combined.models.find( ( m: { path: string } ) => m.path === initial.models[ 0 ].path ), initial.models[ 0 ] );
		await makeBundle( 'oversized', 5 ); await makeBundle( 'broken' );
		await writeFile( join( root, 'broken/包/モデル.pmx' ), 'invalid PMX' );
		await symlink( join( root, 'first' ), join( root, 'linked' ) );
		await makeBundle( '.staging-hidden' );
		const isolated = await ( await fetch( url ) ).json();
		assert.deepEqual( isolated.models, combined.models );
		assert.equal( isolated.errors.length, 3 );
		for ( const message of [ /oversized:.*Model resource limit exceeded/, /broken:.*invalid\/unsupported PMX/, /linked:.*Symlink/ ] ) assert.ok( isolated.errors.some( ( e: { message: string } ) => message.test( e.message ) ) );
		assert.ok( isolated.models.every( ( m: { path: string; motions: string[]; notices: { path: string; text: string }[] } ) => m.motions[ 0 ] === m.path.replace( 'モデル.pmx', 'motion.vmd' ) && m.notices[ 0 ].path === m.path.replace( 'モデル.pmx', 'README.txt' ) && m.notices[ 0 ].text.includes( 'Generated fixture' ) ) );

	} finally { await new Promise( resolve => server.close( resolve ) ); await rm( temporary, { recursive: true, force: true } ); }

} );

test( 'private catalog serves generated installed models/terms only on loopback; assets stay ignored and lifecycle-free', async () => {

	const temporary = await mkdtemp( join( tmpdir(), 'mmd-catalog-' ) ), root = join( temporary, 'private' ), source = join( temporary, 'model.zip' );
	await writeFile( source, modelZip( [ ...fixtureFiles() ].map( ( [ path, bytes ] ) => ( { path, bytes } ) ) ) );
	const imported = await importModels( source, { root } );
	const server = createSdefServer( { modelsDirectory: join( root, 'models' ), installedExamplesDirectory: join( temporary, 'missing' ) } ), publicServer = createExamplesServer();
	try {

		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) ); await new Promise<void>( resolve => publicServer.listen( 0, '127.0.0.1', resolve ) );
		const base = `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}`, publicBase = `http://127.0.0.1:${( publicServer.address() as import( 'node:net' ).AddressInfo ).port}`;
		const catalog = await ( await fetch( base + '/local-sdef/models.json' ) ).json();
		const model = catalog.models.find( ( m: { path: string } ) => m.path.endsWith( '包/モデル.pmx' ) ); assert.ok( model ); assert.equal( model.report.sdef, 9 ); assert.match( model.notices[ 0 ].text, /Generated fixture/ );
		const asset = '/private-assets/models/' + model.path.split( '/' ).map( encodeURIComponent ).join( '/' ); assert.equal( ( await fetch( base + asset ) ).status, 200 );
		const bundle = imported.directory.split( '/' ).at( -1 );
		for ( const path of [ '/local-sdef/models.json', asset, '/examples/assets/private/models/' + bundle + '/包/モデル.pmx' ] ) assert.equal( ( await fetch( publicBase + path ) ).status, 404 );
		for ( const path of [ '/private-assets/models/.staging-x/model.pmx', '/private-assets/models/.cache/hash', '/private-assets/models/' + bundle + '/包/README.txt' ] ) assert.equal( ( await fetch( base + path ) ).status, 404 );
		for ( const path of [ 'examples/assets/private/models/gene/Gene.pmx', 'examples/assets/private/.cache/hash', 'examples/assets/private/models/import-sdef/model.zip' ] ) assert.match( execFileSync( 'git', [ 'check-ignore', path ], { encoding: 'utf8' } ), /private/ );
		const manifest = JSON.parse( await readFile( new URL( '../package.json', import.meta.url ), 'utf8' ) );
		for ( const [ name, command ] of Object.entries( manifest.scripts ) ) if ( name !== 'models:setup' && name !== 'models:import' ) assert.doesNotMatch( String( command ), /models:setup|models:import|setup-models|import-models/ );
		await writeFile( join( imported.directory, 'broken.pmx' ), 'invalid generated fixture' );
		const refreshed = await ( await fetch( base + '/local-sdef/models.json' ) ).json();
		assert.ok( refreshed.models.some( ( m: { path: string } ) => m.path === model.path ) );
		assert.ok( refreshed.errors.some( ( e: { message: string } ) => e.message.includes( 'broken.pmx' ) ) );
		for ( const file of [ '../.github/workflows/tests.yml', '../.github/workflows/examples-pages.yml', '../examples/assets-manifest.json' ] ) assert.doesNotMatch( await readFile( new URL( file, import.meta.url ), 'utf8' ), /setup-models|import-models|models:setup|models:import|mmdagent-ex\/gene/ );

	} finally { await Promise.all( [ new Promise( resolve => server.close( resolve ) ), new Promise( resolve => publicServer.close( resolve ) ) ] ); await rm( temporary, { recursive: true, force: true } ); }

} );
