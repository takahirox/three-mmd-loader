import { Parser } from 'mmd-parser';
import { Texture } from 'three';
import { MMDLoader } from '../src/loaders/MMDLoader.js';
import { physicsLayersPmxBuffer, pmdBuffer } from './fixtures.ts';

/** Equivalent normalized PMD/PMX physics; PMX alone can express post phases. */
export function type2Fixture( phase = 'pre', contact: boolean | 'joint-contact' = false, format: 'pmd' | 'pmx' = 'pmx' ) {

	const data = new Parser().parsePmx( physicsLayersPmxBuffer(), true );
	for ( const bone of data.bones ) { bone.flag = 0; delete bone.grant; delete bone.ik; }
	data.bones[ 3 ].parentIndex = 7;
	if ( phase === 'post' ) data.bones[ 3 ].flag = 0x1000;
	if ( phase === 'post-parent' ) data.bones[ 7 ].flag = 0x1000;
	data.rigidBodies = [ data.rigidBodies[ 0 ], data.rigidBodies[ 3 ], data.rigidBodies[ 4 ] ];
	data.rigidBodies[ 1 ].type = 2;
	data.rigidBodies[ 1 ].position = contact ? [ -0.65, 0, 0 ] : [ 0.85, 0.1, 0 ];
	data.rigidBodies[ 1 ].rotation = [ 0.1, -0.2, 0.3 ];
	data.rigidBodies[ 1 ].width = contact ? 0.4 : 0.1;
	data.rigidBodies[ 2 ].position = [ -0.65, 0, 2 ]; // isolated from contact type 2
	if ( ! contact ) data.rigidBodies[ 2 ].position[ 2 ] = 0;
	data.constraints[ 0 ].rigidBodyIndex2 = 1;
	if ( contact ) {

		if ( contact === true ) data.constraints = [];
		data.rigidBodies[ 0 ].groupTarget = 0xffff; // contact variant permits the probe's group

	}
	data.metadata.rigidBodyCount = 3; data.metadata.constraintCount = data.constraints.length;
	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	if ( format === 'pmd' ) {

		// Start with parsed PMD metadata/materials, then author the equivalent
		// skeleton and PMD bone-relative offsets (PMX input is model-space).
		const pmd = new Parser().parsePmd( pmdBuffer(), true );
		pmd.bones = data.bones.map( b => ( { name: b.name, parentIndex: b.parentIndex, tailIndex: 0, type: 0, ikIndex: 0, position: [ ...b.position ] } ) );
		pmd.rigidBodies = data.rigidBodies.map( b => ( { ...b, position: b.position.map( ( v, i ) => v - ( data.bones[ b.boneIndex ]?.position[ i ] ?? 0 ) ) as [ number, number, number ] } ) );
		pmd.constraints = data.constraints;
		pmd.metadata.boneCount = pmd.bones.length; pmd.metadata.rigidBodyCount = pmd.rigidBodies.length; pmd.metadata.constraintCount = pmd.constraints.length;
		return loader.meshBuilder.build( pmd, '' );

	}
	return loader.meshBuilder.build( data, '' );

}
