import { Parser } from 'mmd-parser';
import { Texture } from 'three';
import { MMDLoader } from '../src/loaders/MMDLoader.js';
import { physicsLayersPmxBuffer } from './fixtures.ts';

/** Public, synthetic PMX data; no grant/IK dependency in the physics oracle. */
export function type2Fixture( phase = 'pre', contact = false ) {

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

		data.constraints = [];
		data.rigidBodies[ 0 ].groupTarget = 0xffff; // contact variant permits the probe's group

	}
	data.metadata.rigidBodyCount = 3; data.metadata.constraintCount = data.constraints.length;
	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	return loader.meshBuilder.build( data, '' );

}
