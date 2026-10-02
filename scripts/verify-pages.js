import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { manifestName, sha256, validateManifest } from './pages-manifest.js';

async function get( base, path, fetcher ) {

	const url = new URL( path, base.endsWith( '/' ) ? base : base + '/' );
	url.searchParams.set( 'deployment-check', `${Date.now()}-${Math.random()}` );
	const response = await fetcher( url, { cache: 'no-store', signal: AbortSignal.timeout( 30000 ) } );
	return { status: response.status, bytes: Buffer.from( await response.arrayBuffer() ) };

}

async function checkSite( base, manifest, { fetcher = fetch, directory, checks = [] } = {} ) {

	validateManifest( manifest );
	const entries = [
		...manifest.files,
		{ ...manifest.files.find( entry => entry.path === 'index.html' ), path: '' },
		{ ...manifest.files.find( entry => entry.path === 'examples/index.html' ), path: 'examples/' }
	];
	let next = 0;
	const workers = Array.from( { length: 8 }, async () => {

		while ( next < entries.length ) {

			const { path, sha256: expected } = entries[ next ++ ];
			const { status, bytes } = await get( base, path, fetcher );
			const hash = sha256( bytes );
			checks.push( { path: path || '/', status, sha256: hash, success: status === 200 && hash === expected } );
			if ( status !== 200 || hash !== expected ) throw new Error( `Public content mismatch: ${path || '/'} (HTTP ${status})` );
			if ( directory && path && ! path.endsWith( '/' ) ) {

				await mkdir( dirname( join( directory, path ) ), { recursive: true } );
				await writeFile( join( directory, path ), bytes );

			}

		}

	} );
	// Wait for all workers before retrying or packaging a backup.
	const results = await Promise.allSettled( workers );
	const failure = results.find( result => result.status === 'rejected' );
	if ( failure ) throw failure.reason;
	return checks;

}

export async function backupSite( base, directory, { fetcher = fetch, report = {}, allowEmpty = false } = {} ) {

	const live = await get( base, manifestName, fetcher );
	if ( live.status === 404 ) {

		const root = await get( base, '', fetcher );
		// A legacy/unrecognised site must not be overwritten without a usable backup.
		if ( root.status !== 404 ) throw new Error( 'Existing public site has no deployment manifest; refusing to replace it' );
		if ( ! allowEmpty ) throw new Error( 'Existing Pages site is unavailable; refusing to deploy without a backup' );
		Object.assign( report, { success: true, exists: false } );
		return report;

	}
	if ( live.status !== 200 ) throw new Error( `Cannot back up public site: HTTP ${live.status}` );
	const manifest = validateManifest( JSON.parse( live.bytes ) );
	Object.assign( report, { exists: true, commit: manifest.commit, checks: [] } );
	await checkSite( base, manifest, { fetcher, directory, checks: report.checks } );
	await writeFile( join( directory, manifestName ), live.bytes );
	report.success = true;
	return report;

}

export async function verifySite( base, expectedBytes, { fetcher = fetch, checks = [] } = {} ) {

	const expected = validateManifest( JSON.parse( expectedBytes ) );
	const live = await get( base, manifestName, fetcher );
	checks.push( { path: manifestName, status: live.status, success: live.status === 200 && sha256( live.bytes ) === sha256( expectedBytes ) } );
	if ( ! checks[ 0 ].success ) throw new Error( `Public deployment manifest does not match commit ${expected.commit}` );
	await checkSite( base, expected, { fetcher, checks } );
	return checks;

}

export async function verifyDeployment( base, bytes, outcome, { attempts = 6, wait = delay, fetcher = fetch, report = {} } = {} ) {

	Object.assign( report, { success: false, deployment_outcome: outcome, commit: validateManifest( JSON.parse( bytes ) ).commit } );
	if ( outcome !== 'success' ) throw new Error( `GitHub Pages deployment did not succeed: ${outcome}` );
	for ( let attempt = 1; attempt <= attempts; attempt ++ ) {

		report.attempts = attempt;
		report.checks = [];
		try {

			await verifySite( base, bytes, { fetcher, checks: report.checks } );
			report.success = true;
			return report;

		} catch ( error ) {

			if ( attempt === attempts ) throw error;
			await wait( 10000 );

		}

	}

}

if ( process.argv[ 1 ] && resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {

	const [ mode, directory, evidencePath ] = process.argv.slice( 2 );
	const report = {
		success: false, mode, page_url: process.env.PAGE_URL, deployment_url: process.env.DEPLOYED_PAGE_URL,
		expected_commit: process.env.EXPECTED_COMMIT, run_id: process.env.GITHUB_RUN_ID, checked_at: new Date().toISOString()
	};
	try {

		if ( mode === 'backup' ) {

			await backupSite( process.env.PAGE_URL, directory, { report, allowEmpty: process.env.ALLOW_EMPTY_SITE === 'true' } );
			if ( process.env.GITHUB_OUTPUT ) await appendFile( process.env.GITHUB_OUTPUT, `exists=${report.exists}\n` );

		} else if ( mode === 'verify' ) {

			const bytes = await readFile( join( directory, manifestName ) );
			if ( process.env.EXPECTED_COMMIT && JSON.parse( bytes ).commit !== process.env.EXPECTED_COMMIT ) throw new Error( 'Artifact commit differs from workflow commit' );
			if ( process.env.DEPLOYED_PAGE_URL && new URL( process.env.DEPLOYED_PAGE_URL ).href.replace( /\/$/, '' ) !==
				new URL( process.env.PAGE_URL ).href.replace( /\/$/, '' ) ) throw new Error( 'Deployment result URL differs from configured Pages URL' );
			await verifyDeployment( process.env.PAGE_URL, bytes, process.env.DEPLOYMENT_OUTCOME, { report } );

		} else throw new Error( 'Expected backup or verify mode' );

	} catch ( error ) {

		report.error = error.message;
		console.error( error.message );
		process.exitCode = 1;

	} finally {

		await mkdir( dirname( evidencePath ), { recursive: true } );
		await writeFile( evidencePath, JSON.stringify( report, null, 2 ) + '\n' );

	}

}
