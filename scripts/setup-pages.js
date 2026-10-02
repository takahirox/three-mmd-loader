import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function githubAPI( token, repository, fetcher = fetch ) {

	if ( ! token ) throw new Error( 'PAGES_SETUP_TOKEN is required: repository-scoped Pages and Administration write, Actions read permissions' );
	if ( ! /^[\w.-]+\/[\w.-]+$/.test( repository ) ) throw new Error( 'Invalid repository' );
	return async ( method, path, body, allowed = [] ) => {

		const response = await fetcher( `${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${repository}/${path}`, {
			method, headers: {
				Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'
			}, body: body === undefined ? undefined : JSON.stringify( body ), signal: AbortSignal.timeout( 30000 )
		} );
		// Do not include response bodies or credentials in logs/evidence.
		if ( ! response.ok && ! allowed.includes( response.status ) ) throw new Error( `GitHub ${method} ${path}: HTTP ${response.status}` );
		return { status: response.status, data: response.status === 204 || allowed.includes( response.status ) ? null : await response.json() };

	};

}

export async function setupPages( api ) {

	let site = await api( 'GET', 'pages', undefined, [ 404 ] );
	const created = site.status === 404;
	if ( created ) await api( 'POST', 'pages', { build_type: 'workflow' } );
	else if ( site.data.build_type !== 'workflow' ) await api( 'PUT', 'pages', { build_type: 'workflow' } );
	const environment = 'environments/github-pages';
	await api( 'PUT', environment, {
		wait_timer: 0, reviewers: [],
		deployment_branch_policy: { protected_branches: false, custom_branch_policies: true }
	} );
	// This environment is owned by this workflow and must deploy without approval.
	const custom = ( await api( 'GET', `${environment}/deployment_protection_rules` ) ).data;
	for ( const rule of custom.custom_deployment_protection_rules || [] ) {

		await api( 'DELETE', `${environment}/deployment_protection_rules/${rule.id}` );

	}
	const policiesPath = `${environment}/deployment-branch-policies`;
	const policies = [];
	for ( let page = 1; ; page ++ ) {

		const data = ( await api( 'GET', `${policiesPath}?per_page=100&page=${page}` ) ).data;
		policies.push( ...data.branch_policies );
		if ( policies.length >= data.total_count ) break;

	}
	for ( const policy of policies ) {

		if ( policy.name !== 'main' || policy.type === 'tag' ) await api( 'DELETE', `${policiesPath}/${policy.id}` );

	}
	if ( ! policies.some( policy => policy.name === 'main' && policy.type !== 'tag' ) ) await api( 'POST', policiesPath, { name: 'main', type: 'branch' } );
	site = await api( 'GET', 'pages' );
	const env = ( await api( 'GET', environment ) ).data;
	const rules = ( await api( 'GET', policiesPath ) ).data.branch_policies;
	const remainingCustom = ( await api( 'GET', `${environment}/deployment_protection_rules` ) ).data.custom_deployment_protection_rules || [];
	if ( site.data.build_type !== 'workflow' || ! site.data.html_url ||
		! env.deployment_branch_policy?.custom_branch_policies || env.deployment_branch_policy.protected_branches ||
		env.protection_rules.some( rule => rule.type !== 'branch_policy' ) || remainingCustom.length !== 0 ||
		rules.length !== 1 || rules[ 0 ].name !== 'main' || rules[ 0 ].type === 'tag' ) {

		throw new Error( 'Pages or environment configuration did not match unattended main deployment settings' );

	}
	return { success: true, created, build_type: 'workflow', environment: 'github-pages', branch: 'main', page_url: site.data.html_url };

}

if ( process.argv[ 1 ] && resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {

	const report = { success: false, run_id: process.env.GITHUB_RUN_ID, commit: process.env.GITHUB_SHA, checked_at: new Date().toISOString() };
	try {

		if ( process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_EVENT_NAME === 'pull_request' ) throw new Error( 'Hosting configuration is restricted to main' );
		Object.assign( report, await setupPages( githubAPI( process.env.PAGES_SETUP_TOKEN, process.env.GITHUB_REPOSITORY ) ) );
		if ( process.env.GITHUB_OUTPUT ) await appendFile( process.env.GITHUB_OUTPUT, `page_url=${report.page_url}\ncreated=${report.created}\n` );

	} catch ( error ) {

		report.error = error.message;
		console.error( error.message );
		process.exitCode = 1;

	} finally {

		const path = 'deployment-evidence/setup.json';
		await mkdir( dirname( path ), { recursive: true } );
		await writeFile( path, JSON.stringify( report, null, 2 ) + '\n' );

	}

}
