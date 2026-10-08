// Small, generated MMD assets keep tests independent of third-party models.
class Writer {

	bytes: number[];

	constructor() {

		this.bytes = [];

	}

	number( method: 'setUint8' | 'setUint16' | 'setUint32' | 'setFloat32', size: number, value: number ) {

		const buffer = new ArrayBuffer( size );
		new DataView( buffer )[ method ]( 0, value, true );
		this.bytes.push( ...new Uint8Array( buffer ) );
		return this;

	}

	u8( value: number ) { return this.number( 'setUint8', 1, value ); }
	u16( value: number ) { return this.number( 'setUint16', 2, value ); }
	u32( value: number ) { return this.number( 'setUint32', 4, value ); }
	f32( ...values: number[] ) {

		for ( const value of values ) this.number( 'setFloat32', 4, value );
		return this;

	}

	text( value: string, size?: number ) {

		const bytes = size === undefined
			? Buffer.from( value, 'utf16le' )
			: new TextEncoder().encode( value );
		if ( size === undefined ) {

			this.u32( bytes.length );
			size = bytes.length;

		}
		for ( let i = 0; i < size; i ++ ) this.u8( bytes[ i ] ?? 0 );
		return this;

	}

	buffer() { return Uint8Array.from( this.bytes ).buffer; }

}

const vertices = [ [ 0, 0, 1 ], [ 1, 0, 1 ], [ 0, 1, 1 ] ];

export function pmdBuffer() {

	const w = new Writer();
	w.text( 'Pmd', 3 ).f32( 1 ).text( 'triangle', 20 ).text( '', 256 );
	w.u32( 3 );
	for ( const position of vertices ) {

		w.f32( ...position, 0, 0, 1, 0, 0 ).u16( 0 ).u16( 0 ).u8( 100 ).u8( 0 );

	}
	w.u32( 3 ).u16( 0 ).u16( 1 ).u16( 2 );
	w.u32( 1 ); // material
	w.f32( 0.8, 0.6, 0.4, 1, 30, 0.1, 0.1, 0.1, 0.2, 0.2, 0.2 );
	w.u8( 255 ).u8( 1 ).u32( 3 ).text( '', 20 );
	w.u16( 1 ); // bone
	w.text( 'root', 20 ).u16( 65535 ).u16( 0 ).u8( 0 ).u16( 0 ).f32( 0, 0, 0 );
	w.u16( 0 ).u16( 0 ); // IK, morphs
	w.u8( 0 ).u8( 0 ).u32( 0 ).u8( 0 ); // display frames, English header
	for ( let i = 0; i < 10; i ++ ) w.text( '', 100 ); // toon texture names
	w.u32( 0 ).u32( 0 ); // rigid bodies, constraints
	return w.buffer();

}

export function pmxBuffer( { additionalUvMorphs = false }: { additionalUvMorphs?: boolean } = {} ) {

	const w = new Writer();
	w.text( 'PMX ', 4 ).f32( 2 ).u8( 8 );
	// UTF-16LE, optional additional UV channels, one-byte indices.
	for ( const value of [ 0, additionalUvMorphs ? 4 : 0, 1, 1, 1, 1, 1, 1 ] ) w.u8( value );
	w.text( 'triangle' ).text( '' ).text( '' ).text( '' );
	w.u32( 3 );
	for ( const position of vertices ) {

		w.f32( ...position, 0, 0, 1, 0, 0 );
		if ( additionalUvMorphs ) {

			for ( let channel = 0; channel < 4; channel ++ ) w.f32( 0, 0, 0, 0 );

		}
		w.u8( 0 ).u8( 0 ).f32( 1 ); // BDEF1

	}
	w.u32( 3 ).u8( 0 ).u8( 1 ).u8( 2 );
	w.u32( 0 ); // textures
	w.u32( 1 ); // material
	w.text( 'material' ).text( '' );
	w.f32( 0.8, 0.6, 0.4, 1, 0.1, 0.1, 0.1, 30, 0.2, 0.2, 0.2 );
	w.u8( 0x11 ).f32( 0, 0, 0, 1, 1 ); // double sided, outline
	w.u8( 255 ).u8( 255 ).u8( 0 ).u8( 1 ).u8( 0 ); // no map/matcap, shared toon
	w.text( '' ).u32( 3 );
	w.u32( 1 ); // bone
	w.text( 'root' ).text( '' ).f32( 0, 0, 0 ).u8( 255 ).u32( 0 ).u16( 0 );
	w.f32( 0, 1, 0 ); // tail offset
	if ( additionalUvMorphs ) {

		w.u32( 5 ); // four additional UV morphs followed by a vertex morph
		for ( const type of [ 4, 5, 6, 7 ] ) {

			w.text( `additional-uv-${type}` ).text( '' ).u8( 4 ).u8( type ).u32( 2 );
			w.u8( 0 ).f32( type / 4, - 0.5, 0.25, 1 );
			w.u8( 2 ).f32( - 1, type / 2, 0.5, - 0.25 );

		}
		w.text( 'following-vertex' ).text( '' ).u8( 1 ).u8( 1 ).u32( 1 );
		w.u8( 1 ).f32( 0.25, 0.5, 0.75 );
		w.u32( 1 ); // a display frame after the morph payloads
		w.text( 'following-frame' ).text( '' ).u8( 0 ).u32( 2 );
		w.u8( 0 ).u8( 0 ).u8( 1 ).u8( 4 ); // root bone, vertex morph

	} else {

		w.u32( 0 ).u32( 0 ); // morphs, display frames

	}
	w.u32( 0 ).u32( 0 ); // rigid bodies, constraints
	return w.buffer();

}

export function vmdBuffer( { morphs = [], boneName = 'root', rotation = [ 0, 0, 0, 1 ] }: { rotation?: number[]; boneName?: string; morphs?: { morphName: string; frameNum: number; weight: number }[] } = {} ) {

	const w = new Writer();
	w.text( 'Vocaloid Motion Data 0002', 30 ).text( 'triangle', 20 ).u32( 2 );
	for ( const frame of [ 0, 30 ] ) {

		w.text( boneName, 15 ).u32( frame ).f32( frame / 30 * 2, 0, 0, ...frame === 0 ? [ 0, 0, 0, 1 ] : rotation );
		// Linear Bezier interpolation for position and rotation.
		for ( let i = 0; i < 64; i ++ ) w.u8( i % 16 < 8 ? 0 : 127 );

	}
	w.u32( morphs.length );
	for ( const morph of morphs ) {

		w.text( morph.morphName, 15 ).u32( morph.frameNum ).f32( morph.weight );

	}
	w.u32( 0 ); // cameras
	return w.buffer();

}

export function cameraVmdBuffer() {

	const w = new Writer();
	w.text( 'Vocaloid Motion Data 0002', 30 ).text( 'camera', 20 );
	w.u32( 0 ).u32( 0 ).u32( 2 ); // bone motions, morphs, camera frames
	for ( const frame of [ 0, 30 ] ) {

		w.u32( frame ).f32( - 35, frame / 30, 10, 0, 0, 0, 0 );
		for ( let i = 0; i < 6; i ++ ) w.u8( 0 ).u8( 127 ).u8( 0 ).u8( 127 );
		w.u32( 45 ).u8( 0 );

	}
	return w.buffer();

}

// Authored PMX probes: each triangle has identical skinning inputs so its GPU
// output is constant. Different clip positions are supplied by the browser test.
export const sdefProbeVertices = [
	{ type: 3, weight: 0.35, position: [ 0.6, 0.3, 0.2 ] },
	{ type: 3, weight: 0, position: [ - 0.4, 0.7, 0.3 ] },
	{ type: 3, weight: 1, position: [ 0.2, - 0.5, - 0.1 ] },
	{ type: 0, weight: 1, position: [ 0.4, 0.5, 0.6 ] },
	{ type: 1, weight: 0.35, position: [ - 0.3, 0.6, - 0.4 ] },
	{ type: 2, weight: 0.2, position: [ 0.5, - 0.2, 0.4 ] }
];
export const sdefCenter = [ 0.1, 0.2, 0.3 ];
export const sdefR0 = [ 0.4, - 0.2, 0.6 ];
export const sdefR1 = [ - 0.3, 0.5, - 0.1 ];
export const sdefNormal = [ 0.36, 0.48, 0.8 ];
export const sdefMorph = [ 0.15, - 0.2, 0.25 ];

export function sdefPmxBuffer( { boneMorphs = false, texturePath }: { boneMorphs?: boolean; texturePath?: string } = {} ) {

	const w = new Writer();
	w.text( 'PMX ', 4 ).f32( 2 ).u8( 8 );
	for ( const value of [ 0, 0, 1, 1, 1, 1, 1, 1 ] ) w.u8( value );
	w.text( 'SDEF probes' ).text( '' ).text( '' ).text( '' );
	w.u32( sdefProbeVertices.length * 3 );
	for ( const v of sdefProbeVertices ) {

		for ( let i = 0; i < 3; i ++ ) {

			w.f32( ...v.position, ...sdefNormal, 0, 0 ).u8( v.type );
			if ( v.type === 0 ) w.u8( 0 );
			else if ( v.type === 2 ) w.u8( 0 ).u8( 1 ).u8( 2 ).u8( 3 ).f32( 0.2, 0.3, 0.1, 0.4 );
			else w.u8( 0 ).u8( 1 ).f32( v.weight );
			if ( v.type === 3 ) w.f32( ...sdefCenter, ...sdefR0, ...sdefR1 );
			w.f32( 1 );

		}

	}
	w.u32( sdefProbeVertices.length * 3 );
	for ( let i = 0; i < sdefProbeVertices.length * 3; i ++ ) w.u8( i );
	w.u32( texturePath ? 1 : 0 );
	if ( texturePath ) w.text( texturePath );
	w.u32( 1 );
	w.text( 'probes' ).text( '' ).f32( 0.8, 0.6, 0.4, 1, 0, 0, 0, 30, 0, 0, 0 );
	w.u8( 0x11 ).f32( 1, 0, 0, 1, 1 ).u8( texturePath ? 0 : 255 ).u8( 255 ).u8( 0 ).u8( 1 ).u8( 0 );
	w.text( '' ).u32( sdefProbeVertices.length * 3 );
	w.u32( 4 );
	for ( let i = 0; i < 4; i ++ ) {

		w.text( `bone${i}` ).text( '' ).f32( i * 0.2, i * 0.1, i * - 0.15 ).u8( 255 ).u32( 0 ).u16( 0 ).f32( 0, 1, 0 );

	}
	w.u32( boneMorphs ? 6 : 1 ).text( 'vertex-morph' ).text( '' ).u8( 1 ).u8( 1 ).u32( sdefProbeVertices.length * 3 );
	for ( let i = 0; i < sdefProbeVertices.length * 3; i ++ ) w.u8( i ).f32( ...sdefMorph );
	if ( boneMorphs ) {

		for ( const morph of authoredBoneMorphs ) {

			w.text( morph.name ).text( '' ).u8( 4 ).u8( 2 ).u32( morph.elements.length );
			for ( const e of morph.elements ) w.u8( e.index ).f32( ...e.position, ...e.rotation );

		}
		// Full group-to-bone and UV dispatch is deliberately unsupported.
		w.text( 'bone-group' ).text( '' ).u8( 4 ).u8( 0 ).u32( 1 ).u8( 1 ).f32( 0.75 );
		w.text( 'uv-morph' ).text( '' ).u8( 4 ).u8( 3 ).u32( 1 ).u8( 0 ).f32( 0.1, 0.2, 0.3, 0.4 );

	}
	w.u32( 0 ).u32( 0 ).u32( 0 );
	return w.buffer();

}

// Left-handed source payloads: asymmetric rotations and translations, a
// negative quaternion sign and a near-identity rotation. Never external assets.
export const authoredBoneMorphs = [
	{ name: 'bone-a', elements: [
		{ index: 0, position: [ 0.3, - 0.2, 0.4 ], rotation: [ 0.2, - 0.3, 0.4, Math.sqrt( 0.71 ) ] },
		{ index: 1, position: [ - 0.1, 0.25, - 0.35 ], rotation: [ - 0.3, 0.1, 0.2, Math.sqrt( 0.86 ) ] }
	] },
	{ name: 'bone-b', elements: [
		{ index: 0, position: [ - 0.15, 0.3, 0.2 ], rotation: [ - 0.1, - 0.4, 0.2, - Math.sqrt( 0.79 ) ] }
	] },
	{ name: 'bone-near', elements: [
		{ index: 1, position: [ 0.1, 0.2, 0.3 ], rotation: [ 0.0001, - 0.0002, 0.0003, Math.sqrt( 1 - 0.00000014 ) ] }
	] }
];
