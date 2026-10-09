import { attribute, Fn, vec4 } from 'three/tsl';
import type { Node, NodeBuilder } from 'three/webgpu';

/** Morphed PMX additional UV1–4, as vec4; undeclared channels return vec4(0). */
export function mmdAdditionalUV( channel: 1 | 2 | 3 | 4 ): Node<'vec4'> {

	const name = `mmdAdditionalUV${channel}`;
	return Fn( ( _inputs: unknown, builder: NodeBuilder ) => builder.geometry.hasAttribute( name )
		? attribute( name, 'vec4' ) : vec4( 0 ) )() as Node<'vec4'>;

}
