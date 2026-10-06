import { checkTypeScriptSources, unexpectedJavaScript } from '../scripts/check-typescript.ts';
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
	assert.ok( ! existsSync( join( root, 'src/libs' ) ), 'No vendored parser source or declarations' );
	assert.ok( ! existsSync( join( root, 'dist/libs' ) ), 'No copied parser artifacts' );
	for ( const entry of readdirSync( join( root, 'src' ), { recursive: true, encoding: 'utf8' } ) ) {

		assert.ok( ! /\.(?:c|m)?js$/.test( entry ), entry );
		if ( ! entry.endsWith( '.ts' ) ) continue;
		const source = readFileSync( join( root, 'src', entry ), 'utf8' );
		assert.doesNotMatch( source, /@ts-(?:nocheck|ignore)/, entry );

	}

} );

test( 'repository JavaScript is limited to generated output', () => {

	checkTypeScriptSources();
	assert.deepEqual( unexpectedJavaScript( [
		'src/libs/mmdparser.module.js', 'dist/index.js', 'dist/examples/examples/browser.js',
		'examples/browser.ts', 'scripts/tool.ts', 'tests/unit.test.ts',
		'examples/regression.js', 'scripts/regression.js', 'tests/regression.js', 'other.js', 'other.mjs', 'other.cjs'
	] ), [ 'src/libs/mmdparser.module.js', 'examples/regression.js', 'scripts/regression.js', 'tests/regression.js', 'other.js', 'other.mjs', 'other.cjs' ] );

} );
