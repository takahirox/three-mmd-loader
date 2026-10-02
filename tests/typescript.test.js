import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath( new URL( '../', import.meta.url ) );
const required = [
	'index', 'animation/CCDIKSolver', 'animation/MMDAnimationHelper',
	'animation/MMDPhysics', 'exporters/MMDExporter', 'loaders/MMDLoader',
	'shaders/MMDToonShader'
];

test( 'maintained runtime sources remain checked TypeScript with built JS and declarations', () => {

	for ( const path of required ) {

		assert.ok( existsSync( join( root, `src/${path}.ts` ) ), path );
		assert.ok( ! existsSync( join( root, `src/${path}.js` ) ), path );
		assert.ok( existsSync( join( root, `dist/${path}.js` ) ), path );
		assert.ok( existsSync( join( root, `dist/${path}.d.ts` ) ), path );

	}
	for ( const entry of readdirSync( join( root, 'src' ), { recursive: true } ) ) {

		if ( entry.endsWith( '.js' ) ) assert.equal( entry.replaceAll( '\\', '/' ), 'libs/mmdparser.module.js' );
		if ( ! entry.endsWith( '.ts' ) ) continue;
		const source = readFileSync( join( root, 'src', entry ), 'utf8' );
		assert.doesNotMatch( source, /@ts-(?:nocheck|ignore)/, entry );

	}

} );
