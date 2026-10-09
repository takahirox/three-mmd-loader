import type { SkinnedMesh } from 'three';

/** Keep invalid public weights out of Three's vertex uniforms and base sum. */
export function protectMMDMorphWeights( mesh: SkinnedMesh ) {

	const before = mesh.onBeforeRender;
	const after = mesh.onAfterRender;
	const originals: ( number[] | undefined )[] = [];
	const buffers: number[][] = [];

	// The TSL renderer uses these callbacks for surfaces, outlines and shadows.
	// Scope the copy to each draw so mixers/controllers always see public weights.
	mesh.onBeforeRender = function ( ...args ) {

		before.apply( this, args );
		const weights = this.morphTargetInfluences;
		const depth = originals.length;
		originals.push( weights );
		if ( ! weights || weights.every( Number.isFinite ) ) return;
		const safe = buffers[ depth ] ??= [];
		safe.length = weights.length;
		for ( let i = 0; i < weights.length; i ++ ) safe[ i ] = Number.isFinite( weights[ i ] ) ? weights[ i ] : 0;
		this.morphTargetInfluences = safe;

	};
	mesh.onAfterRender = function ( ...args ) {

		this.morphTargetInfluences = originals.pop();
		after.apply( this, args );

	};

}
