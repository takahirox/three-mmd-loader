import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath( new URL( '../', import.meta.url ) );
const lock = JSON.parse( readFileSync( resolve( root, 'experiments/bullet/source.json' ), 'utf8' ) );
const source = resolve( root, '.cache/bullet-experiment/source' );
const run = ( command: string, args: string[] ) => execFileSync( command, args, { cwd: root, stdio: 'inherit' } );
if ( ! existsSync( source ) ) {

	run( 'git', [ 'clone', '--filter=blob:none', '--no-checkout', lock.bulletRepository, source ] );
	run( 'git', [ '-C', source, 'sparse-checkout', 'set', 'src' ] );
	run( 'git', [ '-C', source, 'checkout', '--detach', lock.bulletCommit ] );

}
// The container and source are pinned. build.py rejects a different/dirty HEAD.
run( 'docker', [ 'run', '--rm', '--network=none', '--platform=linux/amd64', '-v', `${root}:/work`, '-w', '/work',
	lock.emscriptenImage, 'python3', 'experiments/bullet/build.py' ] );
