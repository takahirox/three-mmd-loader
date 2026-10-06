import { mkdir, readdir, rm } from 'node:fs/promises';
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
