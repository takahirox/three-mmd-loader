import { Parser } from 'mmd-parser';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geneLightDirectory, geneLightManifest, verifyGeneLightFile } from './gene-light-assets.ts';

/** Inspect the actual pinned bytes with the released parser, independently of
 * the private full-Gene catalog. Also check exact, case-sensitive texture paths. */
export async function inspectGeneLight( directory = geneLightDirectory ) {

	for ( const file of geneLightManifest.files ) verifyGeneLightFile( file, await readFile( join( directory, file.path ) ) );
	const bytes = await readFile( join( directory, 'Gene_light.pmx' ) );
	const model = new Parser().parsePmx( bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength ), true );
	const depths = model.bones.map( ( bone, index ) => {

		const visited = new Set( [ index ] );
		let parent = bone.parentIndex, depth = 0;
		while ( parent !== - 1 ) {

			if ( parent < 0 || parent >= model.bones.length || visited.has( parent ) ) throw new Error( 'Invalid Gene bone hierarchy' );
			visited.add( parent ); depth ++; parent = model.bones[ parent ].parentIndex;

		}
		return depth;

	} );
	const textures = model.textures.map( path => path.replaceAll( '\\', '/' ) );
	const shippedTextures = geneLightManifest.files.filter( file => file.path.startsWith( 'light/' ) ).map( file => file.path );
	if ( JSON.stringify( [ ...new Set( textures ) ].sort() ) !== JSON.stringify( shippedTextures.sort() ) ) throw new Error( 'Gene texture references differ from public allowlist' );
	for ( const material of model.materials ) {

		for ( const index of [ material.textureIndex, material.envTextureIndex, ...( material.toonFlag === 0 ? [ material.toonIndex ] : [] ) ] ) {

			if ( index < - 1 || index >= textures.length ) throw new Error( 'Invalid Gene material texture reference' );

		}

	}
	const count = <T>( array: T[], key: ( value: T ) => number, kinds: number[] ) => Object.fromEntries( kinds.map( kind => [ kind, array.filter( value => key( value ) === kind ).length ] ) );
	return {
		parser: 'mmd-parser 1.1.4', commit: geneLightManifest.commit, model: 'Gene_light.pmx',
		modelSha256: geneLightManifest.files.find( file => file.path === 'Gene_light.pmx' )!.sha256,
		vertices: model.vertices.length, faces: model.faces.length, materials: model.materials.length,
		textures, additionalUV: model.metadata.additionalUvNum,
		skinning: count( model.vertices, v => v.type, [ 0, 1, 2, 3 ] ),
		bones: {
			count: model.bones.length, roots: model.bones.filter( b => b.parentIndex === - 1 ).length,
			maxDepth: Math.max( ...depths ), invalidParentsOrCycles: 0,
			ikChains: model.bones.filter( b => b.ik ).length,
			ikLinks: model.bones.reduce( ( n, b ) => n + ( b.ik?.links.length ?? 0 ), 0 ),
			grants: model.bones.filter( b => b.grant ).length,
			localGrants: model.bones.filter( b => b.grant?.isLocal ).length,
			positionGrants: model.bones.filter( b => b.grant?.affectPosition ).length,
			prePhysics: model.bones.filter( b => ! ( b.flag & 0x1000 ) ).length,
			postPhysics: model.bones.filter( b => b.flag & 0x1000 ).length,
			postPhysicsIK: model.bones.filter( b => b.flag & 0x1000 && b.ik ).length,
			postPhysicsGrants: model.bones.filter( b => b.flag & 0x1000 && b.grant ).length,
			transformationClasses: count( model.bones, b => b.transformationClass, [ ...new Set( model.bones.map( b => b.transformationClass ) ) ].sort() )
		},
		bodyTypes: count( model.rigidBodies, b => b.type, [ 0, 1, 2 ] ), joints: model.constraints.length,
		morphTypes: count( model.morphs, m => m.type, [ 0, 1, 2, 3, 4, 5, 6, 7, 8 ] ),
		groupLinks: model.morphs.flatMap( m => m.type !== 0 ? [] : [ {
			name: m.name, targets: m.elements.map( element => ( { name: model.morphs[ element.index ].name, type: model.morphs[ element.index ].type, ratio: element.ratio } ) )
		} ] ),
		totalBytes: geneLightManifest.files.reduce( ( n, file ) => n + file.size, 0 ),
		motionFiles: 0
	};

}

if ( process.argv[ 1 ] && resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {

	console.log( JSON.stringify( await inspectGeneLight(), null, 2 ) );

}
