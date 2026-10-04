import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export interface PagesSite { build_type: string; status?: string | null; html_url?: string }
export interface BranchPolicy { id: number; name: string; type?: string }
export interface PagesEnvironment {
	wait_timer?: number; reviewers?: unknown[];
	deployment_branch_policy?: { protected_branches: boolean; custom_branch_policies: boolean };
	protection_rules: { type: string }[];
}
export type GitHubAPI = ( method: string, path: string, body?: Record<string, unknown>, allowed?: number[] ) => Promise<{ status?: number; data?: unknown }>;
// GitHub responses are typed at the endpoint boundary; failures are handled by githubAPI.
export async function apiData<T>( api: GitHubAPI, path: string ): Promise<T> {
	const response = await api( 'GET', path );
	return response.data as T;
}
interface PagesReport {
	success: boolean; run_id?: string; commit?: string; checked_at: string;
	repository?: string; mode?: string; page_url?: string; created?: boolean; never_published?: boolean; error?: string;
}

export async function setupCredential( env = process.env, run: ( command: string, args: string[] ) => Promise<{ stdout: string }> = promisify( execFile ) ) {

	const token = env.GH_TOKEN || env.GITHUB_TOKEN;
	if ( token ) return token;
	// Reuse the agent's authorization in memory; never copy it into Actions secrets.
	if ( env.GITHUB_ACTIONS === 'true' ) throw new Error( 'GITHUB_TOKEN is required in Actions' );
	try {

		const { stdout } = await run( 'gh', [ 'auth', 'token', '--hostname', 'github.com' ] );
		if ( stdout.trim() ) return stdout.trim();

	} catch {

		// execFile errors can contain stdout/stderr. Do not expose credentials.

	}
	throw new Error( 'No available GitHub authorization; use the existing authenticated GitHub CLI' );

}

export function githubAPI( token: string, repository: string, fetcher: typeof fetch = fetch ): GitHubAPI {

	if ( ! token ) throw new Error( 'GitHub authorization is required' );
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

export async function neverPublished( api: GitHubAPI, site: PagesSite ) {

	// Legacy sites lack Actions deployment history. A built/errored Pages status
	// may also reflect a publication that is not represented in that history.
	if ( site.build_type !== 'workflow' || site.status !== null ) return false;
	for ( let page = 1; ; page ++ ) {

		const deployments = await apiData<{ id: number }[]>( api, `deployments?environment=github-pages&per_page=100&page=${page}` );
		for ( const deployment of deployments ) {

			let latest;
			for ( let statusPage = 1; ; statusPage ++ ) {

				const statuses = await apiData<{ state: string }[]>( api, `deployments/${deployment.id}/statuses?per_page=100&page=${statusPage}` );
				latest ??= statuses[ 0 ]?.state;
				// Inactive deployments may be previously successful publications.
				if ( statuses.some( status => status.state === 'success' || status.state === 'inactive' ) ) return false;
				if ( statuses.length < 100 ) break;

			}
			// Unknown or in-progress attempts must finish before an empty-site retry.
			if ( latest !== 'failure' && latest !== 'error' ) return false;

		}
		if ( deployments.length < 100 ) return true;

	}

}

export async function setupPages( api: GitHubAPI ) {

	const response = await api( 'GET', 'pages', undefined, [ 404 ] );
	const site = response.data as PagesSite;
	const created = response.status === 404;
	const legacy = ! created && site.build_type !== 'workflow';
	if ( created ) await api( 'POST', 'pages', { build_type: 'workflow' } );
	else if ( site.build_type !== 'workflow' ) await api( 'PUT', 'pages', { build_type: 'workflow' } );
	const environment = 'environments/github-pages';
	await api( 'PUT', environment, {
		wait_timer: 0, reviewers: [],
		deployment_branch_policy: { protected_branches: false, custom_branch_policies: true }
	} );
	// This environment is owned by this workflow and must deploy without approval.
	const custom = ( await apiData<{ custom_deployment_protection_rules?: { id: number }[] }>( api, `${environment}/deployment_protection_rules` ) );
	for ( const rule of custom.custom_deployment_protection_rules || [] ) {

		await api( 'DELETE', `${environment}/deployment_protection_rules/${rule.id}` );

	}
	const policiesPath = `${environment}/deployment-branch-policies`;
	const policies: BranchPolicy[] = [];
	for ( let page = 1; ; page ++ ) {

		const data = await apiData<{ total_count: number; branch_policies: BranchPolicy[] }>( api, `${policiesPath}?per_page=100&page=${page}` );
		policies.push( ...data.branch_policies );
		if ( policies.length >= data.total_count ) break;

	}
	for ( const policy of policies ) {

		if ( policy.name !== 'main' || policy.type === 'tag' ) await api( 'DELETE', `${policiesPath}/${policy.id}` );

	}
	if ( ! policies.some( policy => policy.name === 'main' && policy.type !== 'tag' ) ) await api( 'POST', policiesPath, { name: 'main', type: 'branch' } );
	return checkPages( api, { created, legacy } );

}

export async function checkPages( api: GitHubAPI, { created = false, legacy = false } = {} ) {

	const site = await apiData<PagesSite>( api, 'pages' );
	const environment = 'environments/github-pages';
	const env = await apiData<PagesEnvironment>( api, environment );
	const rules: BranchPolicy[] = [];
	for ( let page = 1; ; page ++ ) {

		const data = await apiData<{ total_count: number; branch_policies: BranchPolicy[] }>( api, `${environment}/deployment-branch-policies?per_page=100&page=${page}` );
		rules.push( ...data.branch_policies );
		if ( rules.length >= data.total_count ) break;

	}
	const remainingCustom = ( await apiData<{ custom_deployment_protection_rules?: { id: number }[] }>( api, `${environment}/deployment_protection_rules` ) ).custom_deployment_protection_rules || [];
	if ( site.build_type !== 'workflow' || ! site.html_url ||
		! env.deployment_branch_policy?.custom_branch_policies || env.deployment_branch_policy.protected_branches ||
		env.protection_rules.some( rule => rule.type !== 'branch_policy' ) || remainingCustom.length !== 0 ||
		rules.length !== 1 || rules[ 0 ].name !== 'main' || rules[ 0 ].type === 'tag' ) {

		throw new Error( 'Pages or environment configuration did not match unattended main deployment settings' );

	}
	const never_published = ! legacy && await neverPublished( api, site );
	return { success: true, created, never_published, build_type: 'workflow', environment: 'github-pages', branch: 'main', page_url: site.html_url };

}

if ( process.argv[ 1 ] && resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {

	const report: PagesReport = { success: false, run_id: process.env.GITHUB_RUN_ID, commit: process.env.GITHUB_SHA, checked_at: new Date().toISOString() };
	try {

		if ( process.env.GITHUB_ACTIONS === 'true' && ( process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_EVENT_NAME === 'pull_request' ) ) throw new Error( 'Hosting configuration is restricted to main' );
		const mode = process.argv[ 2 ];
		if ( mode !== '--configure' && mode !== '--check' ) throw new Error( 'Expected --configure (bootstrap) or --check (read-only)' );
		const repository = process.env.GITHUB_REPOSITORY || ( await promisify( execFile )( 'gh', [ 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner' ] ) ).stdout.trim();
		report.repository = repository;
		report.mode = mode;
		const api = githubAPI( await setupCredential(), repository );
		Object.assign( report, await ( mode === '--configure' ? setupPages( api ) : checkPages( api ) ) );
		if ( process.env.GITHUB_OUTPUT ) await appendFile( process.env.GITHUB_OUTPUT, `page_url=${report.page_url}\ncreated=${report.created}\nnever_published=${report.never_published}\n` );

	} catch ( error ) {

		report.success = false;
		report.error = error instanceof Error ? error.message : String( error );
		console.error( report.error );
		process.exitCode = 1;

	} finally {

		const path = 'deployment-evidence/setup.json';
		await mkdir( dirname( path ), { recursive: true } );
		await writeFile( path, JSON.stringify( report, null, 2 ) + '\n' );

	}

}
