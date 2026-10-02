import type { ModelData, VMD, VPD } from '../types.js';

/** Typed boundary for the unchanged, vendored mmd-parser implementation. */
export class Parser {
	parsePmd( buffer: ArrayBuffer, leftToRight?: boolean ): ModelData;
	parsePmx( buffer: ArrayBuffer, leftToRight?: boolean ): ModelData;
	parseVmd( buffer: ArrayBuffer, leftToRight?: boolean ): VMD;
	parseVpd( text: string, leftToRight?: boolean ): VPD;
	mergeVmds( motions: VMD[] ): VMD;
	leftToRightModel( model: ModelData ): void;
	leftToRightVmd( motion: VMD ): void;
	leftToRightVpd( pose: VPD ): void;
}

export class CharsetEncoder {
	s2uTable: Record<number, number>;
	s2u( bytes: ArrayLike<number> ): string;
}

export const MMDParser: { Parser: typeof Parser; CharsetEncoder: typeof CharsetEncoder };
