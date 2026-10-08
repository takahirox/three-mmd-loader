import type { Readable, Writable } from 'node:stream';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';

interface CDPResults {
	'Target.createTarget': { targetId: string };
	'Target.attachToTarget': { sessionId: string };
	'Page.enable': object;
	'Emulation.setEmulatedMedia': object;
	'Page.navigate': object;
	'Runtime.evaluate': { exceptionDetails?: unknown; result: { value: string } };
	'Browser.close': object;
}
interface Pending { resolve: ( value: unknown ) => void; reject: ( error: Error ) => void }
interface CDPMessage { id: number; sessionId?: string; method?: string; params?: unknown; result?: unknown; error?: { message: string } }

const chrome = process.env.CHROME_BIN || ( process.platform === 'darwin'
	? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
	: process.platform === 'win32'
		? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
		: 'google-chrome' );

// Chrome subprocesses can briefly keep writing profiles after the main process
// exits. Retry transient ENOTEMPTY/EBUSY failures, but still report permanent
// cleanup errors after ten retries with 100 ms linear backoff.
export async function removeBrowserDirectory( directory: string ) {

	await rm( directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } );

}

// Use Chrome's DevTools pipe so asynchronous audio work can finish on the
// normal browser clock. A virtual clock can stall AudioContext operations.
export async function runBrowser<T>( url: string, profile: string, colorScheme = 'light', timeoutMs = 45000 ): Promise<T> {

	const browser = spawn( chrome, [
		'--headless', '--no-first-run', '--no-default-browser-check',
		'--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu',
		'--autoplay-policy=no-user-gesture-required', '--remote-debugging-pipe',
		`--user-data-dir=${profile}`
	], { stdio: [ 'ignore', 'ignore', 'ignore', 'pipe', 'pipe' ] } );
	const closed = new Promise<void>( resolve => browser.once( 'close', () => resolve() ) );
	async function waitForClose() {

		let timer: ReturnType<typeof setTimeout> | undefined;
		try {

			return await Promise.race( [ closed.then( () => true ), new Promise<false>( resolve => {

				timer = setTimeout( () => resolve( false ), 2000 );

			} ) ] );

		} finally {

			clearTimeout( timer );

		}

	}
	const pending = new Map<number, Pending>();
	const events = new Map<string, Pending>();
	let nextID = 0;
	let buffer = '';
	function rejectPending( error: Error ) {

		for ( const { reject } of pending.values() ) reject( error );
		for ( const { reject } of events.values() ) reject( error );
		pending.clear();
		events.clear();

	}
	browser.on( 'error', rejectPending );
	browser.on( 'exit', () => rejectPending( new Error( 'Chrome exited before validation finished' ) ) );
	( browser.stdio[ 4 ] as Readable ).setEncoding( 'utf8' );
	( browser.stdio[ 4 ] as Readable ).on( 'data', chunk => {

		buffer += chunk;
		let index;
		while ( ( index = buffer.indexOf( '\0' ) ) !== -1 ) {

			const message: CDPMessage = JSON.parse( buffer.slice( 0, index ) );
			buffer = buffer.slice( index + 1 );
			const eventKey = `${message.sessionId}:${message.method}`;
			if ( events.has( eventKey ) ) {

				events.get( eventKey )!.resolve( message.params );
				events.delete( eventKey );

			}
			const entry = pending.get( message.id );
			if ( ! entry ) continue;
			pending.delete( message.id );
			if ( message.error ) entry.reject( new Error( message.error.message ) );
			else entry.resolve( message.result );

		}

	} );
	function send<K extends keyof CDPResults>( method: K, params: Record<string, unknown> = {}, sessionId?: string ): Promise<CDPResults[K]> {

		return new Promise<unknown>( ( resolve, reject ) => {

			const id = ++ nextID;
			pending.set( id, { resolve, reject } );
			( browser.stdio[ 3 ] as Writable ).write( JSON.stringify( { id, method, params, sessionId } ) + '\0' );

		} ) as Promise<CDPResults[K]>;

	}
	const timeout = setTimeout( () => {

		rejectPending( new Error( `Chrome did not finish validation of ${url} within ${timeoutMs / 1000} seconds` ) );
		browser.kill();

	}, timeoutMs );
	try {

		const { targetId } = await send( 'Target.createTarget', { url: 'about:blank' } );
		const { sessionId } = await send( 'Target.attachToTarget', { targetId, flatten: true } );
		await send( 'Page.enable', {}, sessionId );
		await send( 'Emulation.setEmulatedMedia', { features: [
			{ name: 'prefers-color-scheme', value: colorScheme },
			{ name: 'prefers-reduced-motion', value: 'reduce' }
		] }, sessionId );
		const loaded = new Promise( ( resolve, reject ) => {

			events.set( `${sessionId}:Page.loadEventFired`, { resolve, reject } );

		} );
		await send( 'Page.navigate', { url }, sessionId );
		await loaded;
		const result = await send( 'Runtime.evaluate', {
			expression: `new Promise( resolve => {
				const timer = setInterval( () => {
					const result = document.getElementById( 'result' );
					if ( result && result.textContent !== 'pending' ) {
						clearInterval( timer );
						resolve( result.textContent );
					}
				}, 50 );
			} )`,
			awaitPromise: true, returnByValue: true
		}, sessionId );
		assert.equal( result.exceptionDetails, undefined, JSON.stringify( result.exceptionDetails ) );
		return JSON.parse( decodeURIComponent( result.result.value ) );

	} finally {

		clearTimeout( timeout );
		if ( browser.exitCode === null && browser.signalCode === null && browser.pid !== undefined ) {

			// Let Chrome flush and stop its children normally before falling back
			// to signals. Wait for stdio closure as well as the parent exit.
			void send( 'Browser.close' ).catch( () => {} );
			if ( ! await waitForClose() ) browser.kill();
			if ( ! await waitForClose() ) browser.kill( 'SIGKILL' );

		}
		assert.ok( await waitForClose(), 'Chrome did not close after bounded shutdown attempts' );

	}

}
