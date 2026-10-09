import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSdefServer } from '../scripts/serve-sdef.ts';
import { createExamplesServer } from '../scripts/serve-examples.ts';
import { sdefPmxBuffer } from './fixtures.ts';

test( 'private SDEF entry serves only local viewer, dependencies and permitted private asset files', async () => {

	const directory = await mkdtemp( join( tmpdir(), 'mmd-private-viewer-' ) );
	const server = createSdefServer( { privateDirectory: directory, boneMorphDirectory: directory, groupMorphDirectory: directory, materialMorphDirectory: directory, uvMorphDirectory: directory, grantDirectory: directory, physicsLayersDirectory: directory } );
	const publicServer = createExamplesServer();
	try {

		await writeFile( join( directory, '初音ミク.pmx' ), Buffer.from( sdefPmxBuffer() ) );
		await writeFile( join( directory, 'archive.zip' ), 'not served' );
		await writeFile( join( directory, 'README.txt' ), 'local license is not served' );
		await mkdir( join( directory, 'umbrella/tex' ), { recursive: true } );
		await writeFile( join( directory, 'umbrella/tex/色.png' ), 'texture' );
		assert.match( execFileSync( 'git', [ 'check-ignore', 'examples/assets/private/bone-morph/model.pmx' ], { encoding: 'utf8' } ), /bone-morph/ );
		assert.match( execFileSync( 'git', [ 'check-ignore', 'examples/assets/private/group-morph/model.pmx' ], { encoding: 'utf8' } ), /group-morph/ );
		assert.match( execFileSync( 'git', [ 'check-ignore', 'examples/assets/private/material-morph/model.pmx' ], { encoding: 'utf8' } ), /material-morph/ );
		assert.match( execFileSync( 'git', [ 'check-ignore', 'examples/assets/private/uv-morph/model.pmx' ], { encoding: 'utf8' } ), /uv-morph/ );
		assert.match( execFileSync( 'git', [ 'check-ignore', 'examples/assets/private/physics-layers/model.pmx' ], { encoding: 'utf8' } ), /physics-layers/ );
		assert.match( execFileSync( 'git', [ 'check-ignore', 'examples/assets/private/grant/model.pmx' ], { encoding: 'utf8' } ), /grant/ );
		await symlink( new URL( '../package.json', import.meta.url ), join( directory, 'outside.pmx' ) );
		await symlink( join( directory, '初音ミク.pmx' ), join( directory, 'inside.pmx' ) );
		await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
		await new Promise<void>( resolve => publicServer.listen( 0, '127.0.0.1', resolve ) );
		const base = `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}`;
		const publicBase = `http://127.0.0.1:${( publicServer.address() as import( 'node:net' ).AddressInfo ).port}`;
		for ( const path of [ '/local-sdef/generated-subtexture.pmx', '/local-sdef/generated-subtexture.png', '/local-sdef/generated-physics-layers.pmx', '/private-assets/physics-layers/' + encodeURIComponent( '初音ミク.pmx' ), '/local-sdef/generated-grant.pmx', '/private-assets/grant/' + encodeURIComponent( '初音ミク.pmx' ), '/local-sdef/generated-uv.pmx', '/private-assets/uv-morph/' + encodeURIComponent( '初音ミク.pmx' ), '/private-assets/material-morph/' + encodeURIComponent( '初音ミク.pmx' ), '/local-sdef/', '/local-sdef/viewer.js', '/src/skinning/MMDSdef.js', '/node_modules/three/build/three.webgpu.js', '/private-assets/yyb-miku-10th/' + encodeURIComponent( '初音ミク.pmx' ), '/private-assets/group-morph/' + encodeURIComponent( '初音ミク.pmx' ), '/private-assets/bone-morph/' + encodeURIComponent( '初音ミク.pmx' ), '/private-assets/bone-morph/umbrella/tex/' + encodeURIComponent( '色.png' ) ] ) {

			const response = await fetch( base + path );
			assert.equal( response.status, 200, path );
			assert.ok( ( await response.text() ).length > 0 );

		}
		for ( const path of [ '/private-assets/physics-layers/archive.zip', '/private-assets/physics-layers/README.txt', '/private-assets/physics-layers/inside.pmx', '/private-assets/physics-layers/outside.pmx', '/private-assets/physics-layers/%2e%2e%2fpackage.json', '/private-assets/grant/archive.zip', '/private-assets/grant/README.txt', '/private-assets/grant/outside.pmx', '/private-assets/grant/%2e%2e%2fpackage.json', '/private-assets/uv-morph/archive.zip', '/private-assets/uv-morph/README.txt', '/private-assets/uv-morph/outside.pmx', '/private-assets/uv-morph/%2e%2e%2fpackage.json', '/private-assets/material-morph/archive.zip', '/private-assets/material-morph/README.txt', '/private-assets/material-morph/outside.pmx', '/private-assets/material-morph/%2e%2e%2fpackage.json', '/private-assets/group-morph/archive.zip', '/private-assets/group-morph/README.txt', '/private-assets/group-morph/outside.pmx', '/private-assets/group-morph/%2e%2e%2fpackage.json', '/local-viewer/viewer.ts', '/package.json', '/private-assets/bone-morph/archive.zip', '/private-assets/bone-morph/README.txt', '/private-assets/bone-morph/outside.pmx', '/private-assets/bone-morph/%2e%2e%2fpackage.json', '/private-assets/unknown/model.pmx', '/examples/', '/examples/assets/private/yyb-miku-10th/model.pmx', '/private-assets/yyb-miku-10th/archive.zip', '/private-assets/yyb-miku-10th/outside.pmx', '/private-assets/yyb-miku-10th/%2e%2e%2fpackage.json' ] ) {

			const response = await fetch( base + path ); assert.equal( response.status, 404, path ); await response.text();

		}
		for ( const path of [ '/local-sdef/generated-subtexture.pmx', '/local-sdef/generated-subtexture.png', '/local-sdef/generated-physics-layers.pmx', '/private-assets/physics-layers/model.pmx', '/examples/assets/private/physics-layers/model.pmx', '/local-sdef/generated-grant.pmx', '/private-assets/grant/model.pmx', '/examples/assets/private/grant/model.pmx', '/private-assets/uv-morph/model.pmx', '/examples/assets/private/uv-morph/model.pmx', '/local-sdef/generated-uv.pmx', '/private-assets/material-morph/model.pmx', '/examples/assets/private/material-morph/model.pmx', '/local-sdef/', '/local-sdef/viewer.js', '/private-assets/yyb-miku-10th/model.pmx', '/examples/assets/private/yyb-miku-10th/model.pmx', '/private-assets/group-morph/model.pmx', '/examples/assets/private/group-morph/model.pmx', '/private-assets/bone-morph/model.pmx', '/examples/assets/private/bone-morph/model.pmx' ] ) {

			const response = await fetch( publicBase + path ); assert.equal( response.status, 404, path ); await response.text();

		}

	} finally {

		await Promise.all( [ new Promise( resolve => server.close( resolve ) ), new Promise( resolve => publicServer.close( resolve ) ) ] );
		await rm( directory, { recursive: true, force: true } );

	}

} );
