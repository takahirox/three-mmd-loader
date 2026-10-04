import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath( new URL( '../', import.meta.url ) );

export function unexpectedJavaScript( paths: string[] ): string[] {

	return paths.filter( path => /\.(?:c|m)?js$/.test( path ) &&
		path !== 'src/libs/mmdparser.module.js' && ! path.startsWith( 'dist/' ) );

}

export function checkTypeScriptSources(): void {

	const paths = execFileSync( 'git', [ 'ls-files', '-z', '--cached', '--others', '--exclude-standard' ], {
		cwd: root, encoding: 'utf8'
	} ).split( '\0' ).filter( path => path && existsSync( join( root, path ) ) );
	const unexpected = unexpectedJavaScript( paths );
	if ( unexpected.length ) throw new Error( `Repository sources must use TypeScript:\n${unexpected.join( '\n' )}` );

}

if ( process.argv[ 1 ] && resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {

	checkTypeScriptSources();
	console.log( 'Repository JavaScript exceptions verified.' );

}
