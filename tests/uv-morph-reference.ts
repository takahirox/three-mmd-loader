import { uvProbeBase, uvProbeDelta } from './fixtures.ts';

// Independent authored arithmetic: fixture indices 1..5 UV, 6..8 groups.
export function referenceUV( channel: number, vertex: number, weights: readonly number[] ) {

	const finite = ( i: number ) => Number.isFinite( weights[ i ] ) ? weights[ i ] : 0;
	const effective = finite( channel + 1 ) + finite( 6 ) * ( channel === 0 ? 0.75 : 0.5 )
		+ finite( 7 ) * ( channel === 0 ? - 0.25 : channel === 4 ? 0.75 : 0 )
		+ finite( 8 ) * ( channel === 2 ? - 0.5 : 0 );
	return uvProbeBase( channel ).map( ( base, k ) => base + effective * ( uvProbeDelta( channel )[ k ] + ( vertex === 0 ? [ 0.01, - 0.02, 0.03, - 0.04 ][ k ] : 0 ) ) );

}
