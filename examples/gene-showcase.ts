import type { KeyframeTrack } from 'three';
import { AnimationClip, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';
import type { MMDMesh } from '../dist/types.js';
import type { MMDAnimationHelper } from '@takahirox/three-mmd/animation/MMDAnimationHelper.js';
import type { GUI } from 'three/addons/libs/lil-gui.module.min.js';

/** A small original clip: foot lift for IK, eye/arm twist sources for grants,
 * and torso sway for hair/clothing physics. No redistributed VMD is needed. */
export function createGeneAnimation( mesh: MMDMesh ) {

	const times = [ 0, 1, 2, 3, 4 ];
	const tracks: KeyframeTrack[] = [];
	const bone = ( name: string ) => mesh.skeleton.bones.find( b => b.name === name );
	function translate( name: string, offsets: number[][] ) {

		const target = bone( name );
		if ( ! target ) return;
		tracks.push( new VectorKeyframeTrack( `.bones[${name}].position`, times,
			offsets.flatMap( offset => target.position.clone().add( new Vector3( ...offset ) ).toArray() ) ) );

	}
	function rotate( name: string, axis: Vector3, angles: number[] ) {

		const target = bone( name );
		if ( ! target ) return;
		tracks.push( new QuaternionKeyframeTrack( `.bones[${name}].quaternion`, times,
			angles.flatMap( angle => target.quaternion.clone().multiply( new Quaternion().setFromAxisAngle( axis.normalize(), angle ) ).toArray() ) ) );

	}
	translate( 'センター', [ [ 0, 0, 0 ], [ 0.4, - 0.3, 0 ], [ 0, 0, 0 ], [ - 0.4, - 0.3, 0 ], [ 0, 0, 0 ] ] );
	translate( '左足ＩＫ', [ [ 0, 0, 0 ], [ 0, 0.8, 0.6 ], [ 0, 0, 0 ], [ 0, 0, 0 ], [ 0, 0, 0 ] ] );
	rotate( '上半身', new Vector3( 0, 0, 1 ), [ 0, 0.06, 0, - 0.06, 0 ] );
	rotate( '両目', new Vector3( 0, 1, 0 ), [ 0, 0.6, 0, - 0.6, 0 ] );
	rotate( '左腕捩', new Vector3( 0.8289166, - 0.5588465, 0.0242479 ), [ 0, 0.7, 0, - 0.7, 0 ] );
	// Isolated generated build fixtures have no Gene bone names.
	if ( tracks.length === 0 ) rotate( mesh.skeleton.bones[ 0 ].name, new Vector3( 0, 1, 0 ), [ 0, 0.2, 0, - 0.2, 0 ] );
	return new AnimationClip( 'Gene feature demonstration (generated)', 4, tracks );

}

export function addGeneControls( mesh: MMDMesh, helper: MMDAnimationHelper, gui: GUI ) {

	const features = { grant: true };
	gui.add( features, 'grant' ).onChange( ( value: boolean ) => helper.enable( 'grant', value ) );
	const folder = gui.addFolder( 'Morph weights' );
	const weights: Record<string, number> = {};
	const selection = [
		[ 'まばたき', 'Blink (vertex)' ], [ '笑い', 'Smile (vertex)' ],
		[ 'あ', 'Mouth A (vertex)' ], [ '叫び', 'Shout (group)' ],
		[ 'メッシュなし', 'Hide hair highlights (UV)' ], [ '青ざめ', 'Pale (material)' ]
	];
	for ( const [ name, label ] of selection ) {

		const index = mesh.morphTargetDictionary?.[ name ];
		if ( index === undefined ) continue;
		weights[ name ] = 0;
		folder.add( weights, name, 0, 1, 0.01 ).name( label ).onChange( ( value: number ) => {

			mesh.morphTargetInfluences![ index ] = value;
			helper.update( 0 );

		} );

	}
	// Keep controls compact on mobile; the folder can be opened and scrolled.
	folder.close();

}
