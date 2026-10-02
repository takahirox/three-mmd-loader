import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeManifest } from './pages-manifest.js';

const root = fileURLToPath( new URL( '../', import.meta.url ) );
const manifest = JSON.parse( await readFile( join( root, 'examples/assets-manifest.json' ), 'utf8' ) );

// Preserve the development layout so the same pages run at any hosting prefix.
export async function buildExamples( {
	outputDirectory = join( root, 'dist/examples' ),
	assetDirectory = join( root, 'examples/assets/mmd' ),
	commit = process.env.GITHUB_SHA
} = {} ) {

	await rm( outputDirectory, { recursive: true, force: true } );
	await mkdir( outputDirectory, { recursive: true } );
	for ( const name of await readdir( join( root, 'examples' ) ) ) {

		if ( ! /\.(html|js|css|md|json)$/.test( name ) ) continue;
		await cp( join( root, 'examples', name ), join( outputDirectory, 'examples', name ) );

	}
	for ( const name of [ 'screenshots', 'fonts' ] ) {

		await cp( join( root, 'examples', name ), join( outputDirectory, 'examples', name ), { recursive: true } );

	}
	for ( const { path } of manifest.files ) {

		// Missing assets or notices fail the build instead of producing a partial site.
		await cp( join( assetDirectory, path ), join( outputDirectory, 'examples/assets/mmd', path ) );

	}
	for ( const path of [
		'src', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
		'node_modules/three/build/three.module.js',
		'node_modules/three/build/three.core.js',
		'node_modules/three/examples/jsm',
		'node_modules/three/LICENSE',
		'node_modules/ammojs-typed/ammo/ammo.js',
		'node_modules/ammojs-typed/LICENSE.md'
	] ) {

		await cp( join( root, path ), join( outputDirectory, path ), { recursive: true } );

	}
	await writeFile( join( outputDirectory, 'index.html' ), `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=./examples/">
<title>Standalone MMD examples</title></head>
<body><a href="./examples/">Open the browser examples</a></body></html>
` );
	commit ||= ( await promisify( execFile )( 'git', [ 'rev-parse', 'HEAD' ], { cwd: root } ) ).stdout.trim();
	await writeManifest( outputDirectory, commit );

}

if ( process.argv[ 1 ] && resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {

	await buildExamples();
	console.log( 'Static examples built in dist/examples/.' );

}
