import { referenceBonePose } from './bone-morph-reference.ts';

// Explicit equations from the authored fixture, independent of loader metadata
// and runtime dispatch. Duplicate links add; nested/invalid links contribute 0.
export function referenceGroupWeights( w: number[] ) {

	const at = ( i: number ) => w[ i ] ?? 0;
	return {
		bones: [ at( 1 ) + 0.75 * at( 4 ) + 0.375 * at( 6 ) + 0.5 * at( 7 ), at( 2 ) + 0.5 * at( 6 ), at( 3 ) + 0.75 * at( 7 ) ],
		vertex: at( 0 ) + 0.5 * at( 6 ) - 0.25 * at( 7 ) + 0.125 * at( 8 )
	};

}
export function referenceGroupPose( w: number[], base?: Parameters<typeof referenceBonePose>[ 1 ] ) {

	return referenceBonePose( referenceGroupWeights( w ).bones, base );

}
