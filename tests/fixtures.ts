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

/** Type 8 fixture with three surfaces, shared samplers, all channels and ordered links. */
export function materialPmxBuffer( { allAdd = false }: { allAdd?: boolean } = {} ) {

	const w = new Writer();
	w.text( 'PMX ', 4 ).f32( 2 ).u8( 8 );
	for ( const value of [ 0, 0, 1, 1, 1, 1, 1, 1 ] ) w.u8( value );
	w.text( 'Material probes' ).text( '' ).text( '' ).text( '' );
	w.u32( 9 );
	for ( let m = 0; m < 3; m ++ ) for ( const p of [ [ - 0.5, - 0.5, 0 ], [ 0.5, - 0.5, 0 ], [ 0, 0.5, 0 ] ] ) w.f32( ...p, 0, 0, 1, 0, 0 ).u8( 0 ).u8( 0 ).f32( 1 );
	w.u32( 9 ); for ( let i = 0; i < 9; i ++ ) w.u8( i );
	w.u32( 1 ).text( 'shared.png' ).u32( 3 );
	for ( let m = 0; m < 3; m ++ ) {

		w.text( `material-${m}` ).text( '' ).f32( ...( m === 2 ? [ 0.4, 0.2, 0.8, 1 ] : [ 0.8, 0.6, 0.4, 1 ] ), 0.2, 0.4, 0.6, 20, 0.4, 0.6, 0.8 );
		w.u8( 0x10 ).f32( 0.2, 0.4, 0.6, 1, 3 ).u8( m === 2 ? 255 : 0 ).u8( m === 2 ? 255 : 0 ).u8( m === 2 ? 0 : m + 1 );
		w.u8( m === 2 ? 1 : 0 ).u8( 0 ).text( '' ).u32( 3 );

	}
	w.u32( 1 ).text( 'root' ).text( '' ).f32( 0, 0, 0 ).u8( 255 ).u32( 0 ).u16( 0 ).f32( 0, 1, 0 );
	w.u32( 8 );
	w.text( 'uv-placeholder' ).text( '' ).u8( 4 ).u8( 3 ).u32( 1 ).u8( 0 ).f32( 0.1, 0.2, 0.3, 0.4 );
	const material = ( name: string, elements: { index: number; type: number; values: number[] }[] ) => {

		w.text( name ).text( '' ).u8( 4 ).u8( 8 ).u32( elements.length );
		for ( const e of elements ) w.u8( e.index ).u8( e.type ).f32( ...e.values );

	};
	// diffuse, specular, shininess, ambient, edge RGBA/size, texture/sphere/toon RGBA
	material( 'multiply-all', [ { index: - 1, type: 0, values: [ 0.5, 1.5, 0.25, 0, 2, 0.5, 1.5, 0.5, 0.5, 1.5, 0.25, 2, 0.5, 1.5, 0, 0, 0.5, 1.5, 0.25, 0.5, 1.5, 0.25, 0.5, 0.75, 0.25, 0.5, 1.5, 0.5 ] } ] );
	material( 'add-first', [ { index: allAdd ? - 1 : 0, type: 1, values: [ 0.2, - 0.2, 0.4, - 0.5, 0.1, 0.2, - 0.1, 10, 0.1, - 0.2, 0.2, 0.4, 0.1, - 0.2, - 0.5, - 3, - 0.5, - 0.25, 0, - 0.5, 0, - 0.5, - 0.25, - 0.25, - 0.25, 0, - 0.5, - 0.5 ] } ] );
	const late = [ 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 2, 0.5, 1, 0.5, 0.5, 1, 0.5, 1, 2, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1 ];
	material( 'late-multiply', [ { index: 0, type: 0, values: late }, { index: 0, type: 0, values: late } ] );
	const group = ( name: string, links: number[][] ) => {

		w.text( name ).text( '' ).u8( 4 ).u8( 0 ).u32( links.length );
		for ( const [ index, ratio ] of links ) w.u8( index ).f32( ratio );

	};
	group( 'material-group', [ [ 1, 0.25 ], [ 2, 0.5 ], [ 1, 0.125 ] ] );
	group( 'shared-group', [ [ 1, - 0.25 ], [ 2, 0.25 ], [ 3, 0.5 ] ] );
	group( 'nested-group', [ [ 4, 100 ], [ 6, 100 ], [ 1, 0.5 ], [ - 1, 1 ], [ 120, 1 ], [ 1, NaN ], [ 1, Infinity ] ] );
	material( 'invalid-material', [ { index: - 2, type: 1, values: late }, { index: 120, type: 0, values: late }, { index: - 1, type: 3, values: late } ] );
	w.u32( 0 ).u32( 0 ).u32( 0 );
	return w.buffer();

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

export function sdefPmxBuffer( { boneMorphs = false, groupMorphs = false, texturePath, uvMorphs = false, additionalUVCount = 4, grants = false, physicsLayers = false, envFlag = 0 }: { envFlag?: number; physicsLayers?: boolean; grants?: boolean; boneMorphs?: boolean; groupMorphs?: boolean; texturePath?: string; uvMorphs?: boolean; additionalUVCount?: number } = {} ) {

	boneMorphs ||= groupMorphs || physicsLayers;
	grants ||= physicsLayers;

	const w = new Writer();
	w.text( 'PMX ', 4 ).f32( 2 ).u8( 8 );
	for ( const value of [ 0, uvMorphs ? additionalUVCount : 0, 1, 1, 1, 1, 1, 1 ] ) w.u8( value );
	w.text( 'SDEF probes' ).text( '' ).text( '' ).text( '' );
	w.u32( sdefProbeVertices.length * 3 );
	for ( const v of sdefProbeVertices ) {

		for ( let i = 0; i < 3; i ++ ) {

			const position = uvMorphs ? [ ( sdefProbeVertices.indexOf( v ) % 3 - 1 ) * 1.2 + [ - 0.45, 0.45, 0 ][ i ], Math.floor( sdefProbeVertices.indexOf( v ) / 3 ) * 1.2 + [ - 0.45, - 0.45, 0.45 ][ i ], 0 ] : v.position;
			w.f32( ...position, ...sdefNormal, ...( uvMorphs ? [ 0.125, 0.2 ] : [ 0, 0 ] ) );
			if ( uvMorphs ) for ( let c = 1; c <= additionalUVCount; c ++ ) w.f32( ...uvProbeBase( c ) );
			w.u8( v.type );
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
	w.u8( 0x11 ).f32( 1, 0, 0, 1, 1 ).u8( texturePath ? 0 : 255 ).u8( 255 ).u8( envFlag ).u8( 1 ).u8( 0 );
	w.text( '' ).u32( sdefProbeVertices.length * 3 );
	const fixtureBones = physicsLayers ? physicsLayerBones : grantFixtureBones;
	w.u32( grants ? fixtureBones.length : 4 );
	for ( let i = 0; i < ( grants ? fixtureBones.length : 4 ); i ++ ) {

		if ( grants ) {

			const b = fixtureBones[ i ];
			w.text( `bone${i}` ).text( '' ).f32( ...b.position ).u8( b.parent ).u32( b.transformationClass ).u16( b.flag ).f32( 0, 1, 0 );
			if ( b.grant ) w.u8( b.grant.parentIndex ).f32( b.grant.ratio );
			if ( b.flag & 0x0800 ) w.f32( 0, 1, 0, 1, 0, 0 );
			if ( physicsLayers && ( i === 6 || i === 9 ) ) w.u8( i === 6 ? 5 : 10 ).u32( 32 ).f32( 0.5 ).u32( 1 ).u8( i === 6 ? 4 : 1 ).u8( 0 );
			continue;

		}
		w.text( `bone${i}` ).text( '' ).f32( i * 0.2, i * 0.1, i * - 0.15 ).u8( 255 ).u32( 0 ).u16( 0 ).f32( 0, 1, 0 );

	}
	w.u32( ( groupMorphs ? 16 : boneMorphs ? 6 : 1 ) + ( uvMorphs ? 8 : 0 ) ).text( 'vertex-morph' ).text( '' ).u8( 1 ).u8( 1 ).u32( sdefProbeVertices.length * 3 );
	for ( let i = 0; i < sdefProbeVertices.length * 3; i ++ ) w.u8( i ).f32( ...sdefMorph );
	if ( boneMorphs ) {

		for ( const morph of authoredBoneMorphs ) {

			w.text( morph.name ).text( '' ).u8( 4 ).u8( 2 ).u32( morph.elements.length );
			for ( const e of morph.elements ) w.u8( e.index ).f32( ...e.position, ...e.rotation );

		}
		// A direct group-to-bone link followed by a UV target.
		w.text( 'bone-group' ).text( '' ).u8( 4 ).u8( 0 ).u32( 1 ).u8( 1 ).f32( 0.75 );
		w.text( 'uv-morph' ).text( '' ).u8( 4 ).u8( 3 ).u32( 1 ).u8( 0 ).f32( 0.1, 0.2, 0.3, 0.4 );

	}
	if ( groupMorphs ) {

		const group = ( name: string, elements: number[][] ) => {

			w.text( name ).text( '' ).u8( 4 ).u8( 0 ).u32( elements.length );
			for ( const [ index, ratio ] of elements ) w.u8( index ).f32( ratio );

		};
		group( 'mixed-group', [ [ 0, 0.5 ], [ 1, 0.25 ], [ 2, 0.5 ], [ 1, 0.125 ] ] ); // 6
		group( 'shared-group', [ [ 0, - 0.25 ], [ 1, 0.5 ], [ 3, 0.75 ] ] ); // 7
		group( 'nested-group', [ [ 6, 1 ], [ 9, 1 ], [ 0, 0.125 ] ] ); // 8
		group( 'cyclic-group', [ [ 9, 1 ], [ 8, 1 ] ] ); // 9
		w.text( 'material-morph' ).text( '' ).u8( 4 ).u8( 8 ).u32( 1 ).u8( 255 ).u8( 1 ); // 10
		w.f32( 0.2, 0.3, 0.4, 0.5, 0.1, 0.2, 0.3, 10, 0.2, 0.3, 0.4, 0.1, 0.2, 0.3, 1, 2 );
		w.f32( 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 );
		for ( const type of [ 4, 5, 6, 7 ] ) { // 11..14

			w.text( `additional-uv-${type}` ).text( '' ).u8( 4 ).u8( type ).u32( 1 ).u8( 0 ).f32( 0.1, 0.2, 0.3, 0.4 );

		}
		group( 'invalid-group', [ [ - 1, 1 ], [ 120, 1 ], [ 5, 1 ], [ 10, 1 ], [ 11, 1 ], [ 12, 1 ], [ 13, 1 ], [ 14, 1 ], [ 9, 1 ], [ 1, NaN ], [ 0, Infinity ] ] ); // 15

	}
	if ( uvMorphs ) {

		const first = groupMorphs ? 16 : boneMorphs ? 6 : 1;
		for ( let c = 0; c <= 4; c ++ ) {

			w.text( `uv${c}` ).text( '' ).u8( 4 ).u8( c + 3 ).u32( sdefProbeVertices.length * 3 + 3 );
			for ( let i = 0; i < sdefProbeVertices.length * 3; i ++ ) w.u8( i ).f32( ...uvProbeDelta( c ) );
			w.u8( 0 ).f32( 0.01, - 0.02, 0.03, - 0.04 ); // duplicate
			w.u8( 120 ).f32( 20, 30, 40, 50 ); // invalid vertex
			w.u8( 1 ).f32( NaN, Infinity, - Infinity, NaN );

		}
		const group = ( name: string, links: number[][] ) => {

			w.text( name ).text( '' ).u8( 4 ).u8( 0 ).u32( links.length );
			for ( const [ index, ratio ] of links ) w.u8( index ).f32( ratio );

		};
		group( 'uv-group', [ ...Array.from( { length: 5 }, ( _, c ) => [ first + c, 0.5 ] ), [ first, 0.25 ], [ 0, 0.2 ] ] );
		group( 'uv-shared', [ [ first, - 0.25 ], [ first + 4, 0.75 ] ] );
		group( 'uv-nested', [ [ first + 5, 100 ], [ first + 7, 100 ], [ first + 2, - 0.5 ], [ 120, 1 ], [ first, NaN ], [ first, Infinity ] ] );

	}
	w.u32( 0 ); // display frames
	if ( physicsLayers ) {

		w.u32( physicsLayerBodies.length );
		for ( const [ i, b ] of physicsLayerBodies.entries() ) {

			w.text( `body${i}` ).text( '' ).u8( b.bone ).u8( 0 ).u16( 0xffff ).u8( 0 );
			w.f32( b.radius, b.radius, b.radius, ...physicsLayerBones[ b.bone ].position, 0, 0, 0, b.mode === 0 ? 0 : 1, 0, 0, 0, 0.5 ).u8( b.mode );

		}
		w.u32( 1 ).text( 'constrained pair' ).text( '' ).u8( 0 ).u8( 0 ).u8( 3 );
		w.f32( 0.3, 0, 0, 0, 0, 0 );
		// Locked translation, free rotation. Distinct from the contact probe.
		w.f32( 0, 0, 0, 0, 0, 0, -3.14, -3.14, -3.14, 3.14, 3.14, 3.14, 0, 0, 0, 0, 0, 0 );

	} else w.u32( 0 ).u32( 0 );
	return w.buffer();

}

export const uvProbeBase = ( c: number ) => c === 0 ? [ 0.125, 0.2, 0, 0 ] : [ c * 0.1, 0.2 + c * 0.01, 0.3 + c * 0.02, 0.4 + c * 0.03 ];
export const uvProbeDelta = ( c: number ) => c === 0 ? [ 0.6, 0.35, 0.2, - 0.4 ] : [ c * 0.03, - c * 0.02, c * 0.04, - c * 0.05 ];

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

// Asymmetric bind positions, two distinct parent branches and all four PMX
// append flag combinations. Vertices retain BDEF/SDEF indices 0..3.
export const grantFixtureBones = [
	{ position: [ 0.6, - 0.4, 0.3 ], parent: - 1, transformationClass: 2, flag: 0x0300, grant: { parentIndex: 6, ratio: 0.5 } },
	{ position: [ - 0.7, 0.5, - 0.2 ], parent: 5, transformationClass: 2, flag: 0x0180, grant: { parentIndex: 6, ratio: - 0.5 } },
	{ position: [ 0.4, 1, 0.7 ], parent: 4, transformationClass: 3, flag: 0x0200, grant: { parentIndex: 0, ratio: 1.5 } },
	{ position: [ - 0.2, - 0.6, 0.4 ], parent: 5, transformationClass: 3, flag: 0x1280, grant: { parentIndex: 6, ratio: 0.25 } },
	{ position: [ 0.3, 0.2, - 0.4 ], parent: 7, transformationClass: 0, flag: 0 },
	{ position: [ - 0.5, 0.3, 0.1 ], parent: - 1, transformationClass: 0, flag: 0 },
	{ position: [ 0.8, 0.7, - 0.5 ], parent: 4, transformationClass: 1, flag: 0x0380, grant: { parentIndex: 5, ratio: 0.75 } },
	{ position: [ 0.1, - 0.3, 0.2 ], parent: - 1, transformationClass: 0, flag: 0 },
	// Local AXES are an editor control definition, not the local GRANT flag.
	{ position: [ 0.2, 0.4, - 0.6 ], parent: 5, transformationClass: 4, flag: 0x0900, grant: { parentIndex: 0, ratio: 0.75 } }
];

export function grantPmxBuffer() { return sdefPmxBuffer( { grants: true, boneMorphs: true } ); }

// Internally authored binary fixture: parsed by the released parser in CI
// and loaded without credentials or third-party files in the private viewer.
export const physicsLayerBones = [
	{ position: [ 0, 0, 0 ], parent: -1, transformationClass: 3, flag: 0x1380, grant: { parentIndex: 6, ratio: 0.5 } },
	{ position: [ 2, 0, 0 ], parent: -1, transformationClass: 4, flag: 0x1380, grant: { parentIndex: 6, ratio: 0.25 } },
	{ position: [ -2, 0, 0 ], parent: 7, transformationClass: 4, flag: 0x1380, grant: { parentIndex: 6, ratio: 0.25 } },
	{ position: [ 0.65, 0, 0 ], parent: -1, transformationClass: 0, flag: 0 },
	{ position: [ -2, 2, 0 ], parent: -1, transformationClass: 0, flag: 0 },
	{ position: [ -2, 3, 0 ], parent: 4, transformationClass: 1, flag: 0 },
	{ position: [ 0, 2, 0 ], parent: -1, transformationClass: 2, flag: 0x0020 },
	{ position: [ 0.5, 0.5, 0 ], parent: -1, transformationClass: 0, flag: 0 },
	{ position: [ -0.65, 0, 0 ], parent: -1, transformationClass: 1, flag: 0 },
	{ position: [ 3, 1, 0 ], parent: -1, transformationClass: 6, flag: 0x1020 },
	{ position: [ 2, 1, 0 ], parent: 1, transformationClass: 5, flag: 0x1000 }
];
export const physicsLayerBodies = [ { bone: 0, mode: 0, radius: 0.4 }, { bone: 1, mode: 1, radius: 0.1 }, { bone: 2, mode: 2, radius: 0.1 }, { bone: 3, mode: 1, radius: 0.1 }, { bone: 8, mode: 1, radius: 0.4 } ];
export function physicsLayersPmxBuffer() { return sdefPmxBuffer( { physicsLayers: true } ); }
