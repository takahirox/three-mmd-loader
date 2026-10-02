import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { manifestName, requiredPages, validateManifest, writeManifest } from '../scripts/pages-manifest.js';
import { githubAPI, neverPublished, setupPages } from '../scripts/setup-pages.js';
import { backupSite, verifyDeployment, verifySite } from '../scripts/verify-pages.js';

const oldCommit = 'a'.repeat( 40 );
const newCommit = 'b'.repeat( 40 );

test( 'hosting setup creates Pages, removes approval gates, and restricts deployment to main idempotently', async () => {

	let site;
	let environment;
	let failEnvironment = true;
	let custom = [ { id: 10 } ];
	let policies = [ { id: 1, name: 'release/*', type: 'branch' }, { id: 2, name: 'main', type: 'tag' } ];
	const calls = [];
	const api = async ( method, path, body ) => {

		calls.push( { method, path, body } );
		if ( path === 'pages' ) {

			if ( method === 'GET' ) return site ? { status: 200, data: site } : { status: 404 };
			if ( method === 'POST' || method === 'PUT' ) site = { ...body, status: null, html_url: 'https://example.github.io/repo/' };

		} else if ( path === 'environments/github-pages' ) {

			if ( failEnvironment ) throw new Error( 'Environment setup interrupted' );
			if ( method === 'PUT' ) environment = { ...body, protection_rules: [ { type: 'branch_policy' } ] };
			return { data: environment };

		} else if ( path.endsWith( '/deployment_protection_rules' ) ) return { data: { custom_deployment_protection_rules: custom } };
		else if ( path.endsWith( '/deployment_protection_rules/10' ) && method === 'DELETE' ) custom = [];
		else if ( path.includes( '/deployment-branch-policies' ) ) {

			if ( method === 'GET' ) return { data: { total_count: policies.length, branch_policies: policies } };
			if ( method === 'DELETE' ) policies = policies.filter( policy => ! path.endsWith( '/' + policy.id ) );
			if ( method === 'POST' ) policies.push( { id: 3, ...body } );

		} else if ( path.startsWith( 'deployments?' ) ) return { data: [] };
		else throw new Error( `Unexpected ${method} ${path}` );
		return { status: 204 };

	};
	await assert.rejects( setupPages( api ), /Environment setup interrupted/ );
	assert.equal( site.build_type, 'workflow' );
	failEnvironment = false;
	const result = await setupPages( api );
	assert.equal( result.created, false );
	assert.equal( result.never_published, true );
	// Both public URLs are still missing after the interrupted bootstrap.
	assert.deepEqual( await backupSite( site.html_url, 'unused', {
		allowEmpty: result.never_published, fetcher: async () => new Response( '', { status: 404 } )
	} ), { success: true, exists: false } );
	assert.equal( result.success, true );
	assert.deepEqual( policies, [ { id: 3, name: 'main', type: 'branch' } ] );
	assert.deepEqual( environment.reviewers, [] );
	assert.equal( environment.wait_timer, 0 );
	assert.deepEqual( custom, [] );
	const afterFirst = calls.length;
	assert.equal( ( await setupPages( api ) ).created, false );
	assert.equal( ( await setupPages( api ) ).never_published, true );
	assert.equal( calls.slice( afterFirst ).some( call => call.method === 'POST' ), false );
	// Existing legacy Pages settings are also migrated to Actions.
	site.build_type = 'legacy';
	assert.equal( ( await setupPages( api ) ).never_published, false );
	assert.equal( site.build_type, 'workflow' );
	assert.throws( () => githubAPI( '', 'owner/repo' ), /PAGES_SETUP_TOKEN/ );
	const forbidden = githubAPI( 'do-not-log-this-token', 'owner/repo', async () => new Response( 'secret response', { status: 403 } ) );
	await assert.rejects( forbidden( 'PUT', 'pages', {} ), { message: 'GitHub PUT pages: HTTP 403' } );
	await assert.rejects( setupPages( async () => { throw new Error( 'Permission denied' ); } ), /Permission denied/ );

} );

test( 'empty-site recovery fails closed for prior publications, active attempts, legacy sites, and unknown history', async () => {

	const site = { build_type: 'workflow', status: null };
	for ( const states of [ [ 'success' ], [ 'inactive' ], [ 'pending' ], [ 'queued' ], [ 'in_progress' ], [], [ 'failure', 'success' ] ] ) {

		const api = async ( method, path ) => ( { data: path.startsWith( 'deployments?' )
			? [ { id: 1 } ] : states.map( state => ( { state } ) ) } );
		const allowEmpty = await neverPublished( api, site );
		assert.equal( allowEmpty, false, JSON.stringify( states ) );
		await assert.rejects( backupSite( 'https://example.github.io/repo/', 'unused', {
			allowEmpty, fetcher: async () => new Response( '', { status: 404 } )
		} ), /refusing to deploy without a backup/ );

	}
	const unused = async () => { throw new Error( 'History must not be queried' ); };
	assert.equal( await neverPublished( unused, { ...site, status: 'built' } ), false );
	assert.equal( await neverPublished( unused, { ...site, status: 'errored' } ), false );
	assert.equal( await neverPublished( unused, { ...site, status: undefined } ), false );
	assert.equal( await neverPublished( unused, { ...site, build_type: 'legacy' } ), false );
	await assert.rejects( neverPublished( async () => { throw new Error( 'History unavailable' ); }, site ), /History unavailable/ );
	for ( const state of [ 'failure', 'error' ] ) {

		const api = async ( method, path ) => ( { data: path.startsWith( 'deployments?' ) ? [ { id: 1 } ] : [ { state } ] } );
		assert.equal( await neverPublished( api, site ), true );

	}

} );

test( 'empty-site recovery checks older pages of deployments and their statuses', async () => {

	const site = { build_type: 'workflow', status: null };
	const deployments = Array.from( { length: 100 }, ( _, id ) => ( { id } ) );
	const api = async ( method, path ) => {

		if ( path.startsWith( 'deployments?' ) ) return { data: path.endsWith( 'page=1' ) ? deployments : [ { id: 100 } ] };
		return { data: [ { state: path.startsWith( 'deployments/100/' ) ? 'success' : 'failure' } ] };

	};
	assert.equal( await neverPublished( api, site ), false );
	const statusesAPI = async ( method, path ) => {

		if ( path.startsWith( 'deployments?' ) ) return { data: [ { id: 1 } ] };
		return { data: path.endsWith( 'page=1' ) ? Array.from( { length: 100 }, () => ( { state: 'failure' } ) ) : [ { state: 'inactive' } ] };

	};
	assert.equal( await neverPublished( statusesAPI, site ), false );

} );

async function siteFixture( run ) {

	const root = await mkdtemp( join( tmpdir(), 'mmd-pages-' ) );
	const site = join( root, 'live' );
	for ( const path of [ ...requiredPages, 'examples/assets/mmd/model.pmd' ] ) {

		await mkdir( dirname( join( site, path ) ), { recursive: true } );
		await writeFile( join( site, path ), `Expected example content: ${path}` );

	}
	await writeManifest( site, oldCommit );
	let requests = 0;
	const server = createServer( async ( request, response ) => {

		requests ++;
		const path = new URL( request.url, 'http://localhost' ).pathname;
		if ( ! path.startsWith( '/repo/' ) ) return response.writeHead( 404 ).end();
		let relative = path.slice( '/repo/'.length );
		if ( ! relative || relative.endsWith( '/' ) ) relative += 'index.html';
		try {

			const bytes = await readFile( join( site, relative ) );
			response.writeHead( 200 ).end( bytes );

		} catch {

			response.writeHead( 404 ).end();

		}

	} );
	await new Promise( resolve => server.listen( 0, '127.0.0.1', resolve ) );
	try {

		await run( { site, root, base: `http://127.0.0.1:${server.address().port}/repo/`, requestCount: () => requests } );

	} finally {

		server.closeAllConnections();
		await new Promise( resolve => server.close( resolve ) );
		await rm( root, { recursive: true, force: true } );

	}

}

test( 'public verification checks commit and every file and a saved backup restores the previous site', async () => {

	await siteFixture( async ( { site, root, base } ) => {

		const backup = join( root, 'backup' );
		const report = await backupSite( base, backup );
		assert.equal( report.commit, oldCommit );
		assert.equal( report.exists, true );
		assert.equal( report.success, true );
		const previous = await readFile( join( backup, manifestName ) );
		await writeManifest( site, newCommit );
		const candidate = await readFile( join( site, manifestName ) );
		assert.equal( ( await verifyDeployment( base, candidate, 'success' ) ).commit, newCommit );
		await assert.rejects( verifySite( base, previous ), /does not match commit/ );
		await writeFile( join( site, 'examples/assets/mmd/model.pmd' ), 'truncated download' );
		const failed = {};
		await assert.rejects( verifyDeployment( base, candidate, 'success', { attempts: 1, report: failed } ), /Public content mismatch/ );
		assert.equal( failed.success, false );
		assert.ok( failed.checks.some( check => ! check.success ) );
		await rm( site, { recursive: true } );
		await cp( backup, site, { recursive: true } );
		const restored = await verifyDeployment( base, previous, 'success' );
		assert.equal( restored.commit, oldCommit );
		assert.equal( restored.success, true );
		assert.ok( restored.checks.some( check => check.path === '/' && check.status === 200 ) );
		assert.ok( restored.checks.some( check => check.path === 'examples/' && check.status === 200 ) );

	} );

} );

test( 'backup fails closed for existing sites without manifests, missing files, and unsafe paths', async () => {

	await siteFixture( async ( { site, root, base } ) => {

		const manifest = JSON.parse( await readFile( join( site, manifestName ) ) );
		const unsafe = { ...manifest, files: [ ...manifest.files, { path: '../escape', sha256: 'a'.repeat( 64 ) } ] };
		assert.throws( () => validateManifest( unsafe ), /Invalid deployment file/ );
		await writeFile( join( site, manifestName ), JSON.stringify( unsafe ) );
		await assert.rejects( backupSite( base, join( root, 'backup' ) ), /Invalid deployment file/ );
		await writeFile( join( site, manifestName ), JSON.stringify( manifest ) );
		await rm( join( site, 'examples/webgl_loader_mmd_pose.html' ) );
		await assert.rejects( backupSite( base, join( root, 'backup' ) ), /Public content mismatch/ );
		await rm( join( site, manifestName ) );
		await assert.rejects( backupSite( base, join( root, 'backup' ) ), /refusing to replace/ );
		await rm( site, { recursive: true } );
		await assert.rejects( backupSite( base, join( root, 'backup' ) ), /refusing to deploy without a backup/ );
		assert.deepEqual( await backupSite( base, join( root, 'backup' ), { allowEmpty: true } ), { success: true, exists: false } );

	} );

} );

test( 'verification retries stale CDN content but never accepts a failed workflow deployment', async () => {

	await siteFixture( async ( { site, base, requestCount } ) => {

		const bytes = await readFile( join( site, manifestName ) );
		let stale = true;
		let waits = 0;
		const report = await verifyDeployment( base, bytes, 'success', {
			fetcher: async ( ...args ) => {

				if ( stale ) {

					stale = false;
					return new Response( '{"commit":"stale"}' );

				}
				return fetch( ...args );

			}, wait: async () => waits ++
		} );
		assert.equal( waits, 1 );
		assert.equal( report.attempts, 2 );
		assert.equal( report.success, true );
		const before = requestCount();
		await assert.rejects( verifyDeployment( base, bytes, 'failure' ), /deployment did not succeed/ );
		assert.equal( requestCount(), before );

	} );

} );

test( 'workflow scripts persist machine-readable evidence for successful and failed checks', async () => {

	await siteFixture( async ( { site, root, base, requestCount } ) => {

		const setup = fileURLToPath( new URL( '../scripts/setup-pages.js', import.meta.url ) );
		const verify = fileURLToPath( new URL( '../scripts/verify-pages.js', import.meta.url ) );
		const run = promisify( execFile );
		await assert.rejects( run( process.execPath, [ setup ], {
			cwd: root, env: { GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push', GITHUB_REPOSITORY: 'owner/repo' }
		} ), { code: 1 } );
		const setupReport = JSON.parse( await readFile( join( root, 'deployment-evidence/setup.json' ) ) );
		assert.equal( setupReport.success, false );
		assert.match( setupReport.error, /PAGES_SETUP_TOKEN/ );
		const evidence = join( root, 'deployment.json' );
		const env = { PAGE_URL: base, DEPLOYED_PAGE_URL: base, EXPECTED_COMMIT: oldCommit, GITHUB_RUN_ID: '123', DEPLOYMENT_OUTCOME: 'success' };
		await run( process.execPath, [ verify, 'verify', site, evidence ], { cwd: root, env } );
		const success = JSON.parse( await readFile( evidence ) );
		assert.equal( success.success, true );
		assert.equal( success.deployment_outcome, 'success' );
		assert.equal( success.expected_commit, oldCommit );
		assert.equal( success.run_id, '123' );
		assert.equal( success.page_url, base );
		assert.equal( success.checks.length, requiredPages.length + 4 );
		const before = requestCount();
		await assert.rejects( run( process.execPath, [ verify, 'verify', site, evidence ], {
			cwd: root, env: { ...env, DEPLOYMENT_OUTCOME: 'failure' }
		} ), { code: 1 } );
		const failed = JSON.parse( await readFile( evidence ) );
		assert.equal( failed.success, false );
		assert.equal( failed.deployment_outcome, 'failure' );
		assert.match( failed.error, /deployment did not succeed/ );
		assert.equal( requestCount(), before );

	} );

} );
