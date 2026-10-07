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

export function vmdBuffer( { morphs = [] }: { morphs?: { morphName: string; frameNum: number; weight: number }[] } = {} ) {

	const w = new Writer();
	w.text( 'Vocaloid Motion Data 0002', 30 ).text( 'triangle', 20 ).u32( 2 );
	for ( const frame of [ 0, 30 ] ) {

		w.text( 'root', 15 ).u32( frame ).f32( frame / 30 * 2, 0, 0, 0, 0, 0, 1 );
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
