import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Bone, Euler, Quaternion, Texture, Vector3 } from 'three';
import { Parser } from 'mmd-parser';
import { CCDIKSolver, MMDAnimationHelper, MMDLoader } from '@takahirox/three-mmd';
import { fixture, hingeLimits, rotateAxis, rotateEuler } from './ik-fixtures.ts';
import type { Vec } from './ik-fixtures.ts';
import { grantPmxBuffer, vmdBuffer } from './fixtures.ts';

const near = ( actual: number, expected: number, tolerance = 1e-6 ) => assert.ok( Math.abs( actual - expected ) < tolerance, `${actual} != ${expected}` );
function solve( f: ReturnType<typeof fixture> ) { new CCDIKSolver( f.mesh, [ f.ik ] ).update(); }
function bounds( f: ReturnType<typeof fixture>, order: Euler['order'] ) {

	const angles = new Euler().setFromQuaternion( f.link.quaternion, order );
	for ( const [ i, v ] of [ angles.x, angles.y, angles.z ].entries() ) {

		const min = f.ik.links[ 0 ].rotationMin!.getComponent( i ), max = f.ik.links[ 0 ].rotationMax!.getComponent( i );
		const wrapped = v + 2 * Math.PI * Math.round( ( ( min + max ) / 2 - v ) / ( 2 * Math.PI ) );
		assert.ok( wrapped >= min - 1e-6 && wrapped <= max + 1e-6, `${wrapped} outside [${min},${max}]` );

	}
	assert.ok( f.link.quaternion.toArray().every( Number.isFinite ) ); near( f.link.quaternion.length(), 1 );

}

test( 'ordinary unconstrained CCD reaches a target and resolves antiparallel directions', () => {

	for ( const target of [ [ 1, 0, 0 ], [ 0, -1, 0 ], [ 0, 1, 0 ] ] as Vec[] ) {

		const f = fixture( [ 0, 1, 0 ], target ); solve( f ); near( f.error(), 0, 2e-5 );
		const q = f.link.quaternion.clone(); for ( let i = 0; i < 20; i ++ ) solve( f ); near( q.angleTo( f.link.quaternion ), 0 );

	}

} );
for ( const axis of [ 0, 1, 2 ] ) {

	const rest: Vec = [ 0, 0, 0 ]; rest[ axis ] = 2; rest[ ( axis + 1 ) % 3 ] = 1;
	test( `${'XYZ'[ axis ]} hinge solves projected angle with an axial offset and respects the step budget`, () => {

		const f = fixture( rest, rotateAxis( rest, axis, 1.1 ), hingeLimits( axis, 0, Math.PI ), 1 );
		solve( f );
		// atan2 in the hinge plane gives 1.1; the permitted first step is 0.2,
		// regardless of the unchanged length-2 component along the hinge axis.
		near( f.link.quaternion.angleTo( new Quaternion() ), 0.2 );
		near( f.error(), 2 * Math.sin( ( 1.1 - 0.2 ) / 2 ) );
		f.ik.iteration = 80; solve( f ); near( f.error(), 0, 2e-5 ); bounds( f, axis === 1 ? 'YXZ' : 'XYZ' );
		const q = f.link.quaternion.clone(); for ( let i = 0; i < 40; i ++ ) { solve( f ); bounds( f, axis === 1 ? 'YXZ' : 'XYZ' ); } near( q.angleTo( f.link.quaternion ), 0 );

	} );
	test( `${'XYZ'[ axis ]} hinge reaches antiparallel target using its permitted sign`, () => {

		const p: Vec = [ 0, 0, 0 ]; p[ ( axis + 1 ) % 3 ] = 1;
		for ( const sign of [ -1, 1 ] ) {

			const f = fixture( p, p.map( v => -v ) as Vec, hingeLimits( axis, sign < 0 ? -Math.PI : 0, sign < 0 ? 0 : Math.PI ) );
			solve( f ); near( f.error(), 0, 2e-5 );
			const expected = new Quaternion().setFromAxisAngle( new Vector3().setComponent( axis, 1 ), sign * Math.PI ); near( expected.angleTo( f.link.quaternion ), 0 );

		}

	} );
}
test( 'knee-like one-sided hinge retains authored rotation and crosses the pi representation boundary continuously', () => {

	for ( const axis of [ 0, 1, 2 ] ) for ( const sign of [ -1, 1 ] ) {

		const p: Vec = [ 0, 0, 0 ]; p[ ( axis + 1 ) % 3 ] = 1;
		const f = fixture( p, rotateAxis( p, axis, sign * 3.16 ), hingeLimits( axis, sign < 0 ? -3.5 : 0.01, sign < 0 ? -0.01 : 3.5 ) );
		f.link.quaternion.setFromAxisAngle( new Vector3().setComponent( axis, 1 ), sign * 3.12 ); f.mesh.updateMatrixWorld( true );
		const before = f.link.quaternion.clone(); solve( f ); near( f.error(), 0, 2e-5 ); near( before.angleTo( f.link.quaternion ), 0.04 );
		const q = f.link.quaternion.clone(); for ( let i = 0; i < 30; i ++ ) solve( f ); near( q.angleTo( f.link.quaternion ), 0 );

	}

} );
test( 'multi-axis limits use a nonsingular order, preserve authored pose, and remain continuous near pi', () => {

	const limits: [ Vec, Vec ] = [ [ -0.4, 2.8, -0.4 ], [ 0.4, 3.5, 0.4 ] ];
	const p: Vec = [ 0.3, 0.7, 1 ];
	const f = fixture( p, rotateEuler( p, [ 0.2, 3.16, 0.3 ], 'YXZ' ), limits );
	f.link.quaternion.setFromEuler( new Euler( 0.2, 3.12, 0.3, 'YXZ' ) ); f.mesh.updateMatrixWorld( true );
	const before = f.link.quaternion.clone(); solve( f ); bounds( f, 'YXZ' ); near( f.error(), 0, 2e-5 ); assert.ok( before.angleTo( f.link.quaternion ) < 0.1 );
	const q = f.link.quaternion.clone(); for ( let i = 0; i < 30; i ++ ) { solve( f ); bounds( f, 'YXZ' ); } near( q.angleTo( f.link.quaternion ), 0, 1e-5 );

} );
test( 'zero-length, locked and unreachable hinge targets stay finite and satisfy limits', () => {

	for ( const [ p, target, limits ] of [
		[ [ 0, 0, 0 ], [ 1, 0, 0 ], hingeLimits( 0 ) ],
		[ [ 0, 1, 0 ], [ 0, 0, 0 ], hingeLimits( 0 ) ],
		[ [ 0, 1, 0 ], [ 0, -1, 0 ], hingeLimits( 0, 0, 0 ) ],
		[ [ 1, 0, 0 ], [ -1, 0, 0 ], hingeLimits( 0 ) ],
		[ [ 0, 1, 0 ], [ 0, -1, 0 ], hingeLimits( 0, 0, 0.4 ) ]
	] as [ Vec, Vec, [ Vec, Vec ] ][] ) {

		const f = fixture( p, target, limits ); const initial = f.error(); solve( f ); bounds( f, 'XYZ' ); assert.ok( f.error() <= initial + 1e-6 );
		const q = f.link.quaternion.clone(); for ( let i = 0; i < 20; i ++ ) solve( f ); near( q.angleTo( f.link.quaternion ), 0 );

	}

} );
test( 'PMX mesh builds convert limits without changing reusable parsed metadata', () => {

	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	const data = new Parser().parsePmx( grantPmxBuffer(), true );
	data.bones[ 1 ].parentIndex = 0;
	data.bones[ 2 ].ik = { target: null, effector: 1, iteration: 20, maxAngle: 0.5, linkCount: 1, links: [ { index: 0, angleLimitation: 1, lowerLimitationAngle: [ -2.8, -0.5, -0.2 ], upperLimitationAngle: [ -0.1, 0.6, 0.3 ] } ] };
	const original = structuredClone( data );
	const first = loader.meshBuilder.build( data, '' ), second = loader.meshBuilder.build( data, '' );
	assert.deepEqual( data, original );
	const a = first.geometry.userData.MMD.iks[ 0 ].links[ 0 ], b = second.geometry.userData.MMD.iks[ 0 ].links[ 0 ];
	assert.deepEqual( a.rotationMin!.toArray(), [ 0.1, -0.6, -0.2 ] ); assert.deepEqual( a.rotationMax!.toArray(), [ 2.8, 0.5, 0.3 ] );
	assert.deepEqual( a, b );
	for ( const mesh of [ first, second ] ) { mesh.updateMatrixWorld( true ); new CCDIKSolver( mesh, mesh.geometry.userData.MMD.iks ).update(); }
	assert.deepEqual( first.skeleton.bones.map( b => b.quaternion.toArray() ), second.skeleton.bones.map( b => b.quaternion.toArray() ) );

} );

for ( const [ order, limits, desired ] of [
	[ 'YXZ', [ [ -0.4, -1, -0.6 ], [ 0.4, 1, 0.6 ] ], [ 0.25, 0.7, -0.3 ] ],
	[ 'ZYX', [ [ -2, -0.3, -0.8 ], [ 2, 0.3, 0.8 ] ], [ 1.7, -0.2, 0.5 ] ],
	[ 'XZY', [ [ -2, -2, -0.4 ], [ 2, 2, 0.4 ] ], [ -1.3, 1.8, 0.2 ] ]
] as [ Euler['order'], [ Vec, Vec ], Vec ][] ) test( `multi-axis ${order} analytical target satisfies range and per-iteration budget`, () => {

	const p: Vec = [ 0.3, 0.7, 1 ];
	const f = fixture( p, rotateEuler( p, desired, order ), limits, 1 );
	for ( let i = 0; i < 240; i ++ ) {

		const q = f.link.quaternion.clone(), error = f.error(); solve( f ); bounds( f, order );
		assert.ok( q.angleTo( f.link.quaternion ) <= f.ik.maxAngle! + 1e-6 ); assert.ok( f.error() <= error + 1e-6 );

	}
	near( f.error(), 0, 2e-5 );

} );

test( 'two-link knee chain reaches an analytical right-angle pose in a rotated scene', () => {

	const f = fixture( [ 0, -1, 0 ], [ 0, -1, -1 ], hingeLimits( 0, 0.01, Math.PI ), 160 );
	const hip = new Bone(); f.mesh.remove( f.link ); hip.add( f.link ); f.mesh.add( hip ); f.link.position.set( 0, -1, 0 );
	f.mesh.skeleton.bones.push( hip ); f.ik.links.push( { index: 3 } );
	f.mesh.position.set( 2, 3, 4 ); f.mesh.rotation.set( 0.3, -0.4, 0.2 ); f.mesh.scale.setScalar( 1.2 ); f.mesh.updateMatrixWorld( true );
	solve( f ); near( f.error(), 0, 2e-5 ); bounds( f, 'XYZ' );
	near( f.link.rotation.x, Math.PI / 2, 3e-5 ); near( hip.quaternion.angleTo( new Quaternion() ), 0, 3e-5 );

} );

test( 'invalid IK metadata or poses cannot partially update a chain or prevent unrelated IK', () => {

	for ( const variant of [ 'index', 'fractional-index', 'target', 'effector', 'nan-limit', 'range', 'max', 'negative-max', 'min-max', 'iterations', 'fractional-iterations', 'pose', 'quaternion', 'extreme-limit', 'scale' ] ) {

		const f = fixture( [ 0, 1, 0 ], [ 1, 0, 0 ] ), other = fixture( [ 0, 1, 0 ], [ 1, 0, 0 ] );
		const offset = f.mesh.skeleton.bones.length; f.mesh.add( other.link, other.target ); f.mesh.skeleton.bones.push( ...other.mesh.skeleton.bones );
		const good = { ...other.ik, target: offset + 2, effector: offset + 1, links: [ { index: offset } ] };
		// Invalid second link must be checked before the first link rotates.
		if ( variant === 'index' ) f.ik.links.push( { index: 999 } );
		if ( variant === 'fractional-index' ) f.ik.links[ 0 ].index = 0.5;
		if ( variant === 'target' ) f.ik.target = 999;
		if ( variant === 'effector' ) f.ik.effector = -1;
		if ( variant === 'nan-limit' ) f.ik.links[ 0 ].rotationMin = new Vector3( NaN, 0, 0 );
		if ( variant === 'range' ) { f.ik.links[ 0 ].rotationMin = new Vector3( 1, 0, 0 ); f.ik.links[ 0 ].rotationMax = new Vector3(); }
		if ( variant === 'max' ) f.ik.maxAngle = Infinity;
		if ( variant === 'negative-max' ) f.ik.maxAngle = -1;
		if ( variant === 'min-max' ) f.ik.minAngle = 1;
		if ( variant === 'iterations' ) f.ik.iteration = Infinity;
		if ( variant === 'fractional-iterations' ) f.ik.iteration = 0.5;
		if ( variant === 'extreme-limit' ) { f.ik.links[ 0 ].rotationMin = new Vector3( -Infinity, 0, 0 ); }
		if ( variant === 'quaternion' ) f.target.quaternion.set( 1e100, 0, 0, 1e100 );
		if ( variant === 'pose' ) f.target.position.x = NaN;
		if ( variant === 'scale' ) f.link.scale.x = 0;
		f.mesh.updateMatrixWorld( true ); const before = f.link.quaternion.toArray();
		new CCDIKSolver( f.mesh, [ f.ik, good ] ).update(); assert.deepEqual( f.link.quaternion.toArray(), before, variant ); near( other.error(), 0, 2e-5 );

	}
	const f = fixture( [ 0, 1, 0 ], [ 1, 0, 0 ], hingeLimits( 2 ), Number.MAX_SAFE_INTEGER );
	let calls = 0; const original = f.link.updateMatrixWorld.bind( f.link ); f.link.updateMatrixWorld = force => { calls ++; original( force ); };
	solve( f ); assert.ok( calls <= 1024 ); near( f.error(), 0, 2e-5 );

} );

test( 'disabled links stop the chain and legacy PMD knee limitation keeps its positive X heuristic', () => {

	const f = fixture( [ 0, -1, 0 ], [ 0, 0, -1 ] ); f.ik.links[ 0 ].limitation = new Vector3( 1, 0, 0 );
	f.ik.links[ 0 ].enabled = false; solve( f ); near( f.link.quaternion.angleTo( new Quaternion() ), 0 );
	f.ik.links[ 0 ].enabled = true; solve( f ); near( f.error(), 0, 2e-5 ); near( f.link.rotation.x, Math.PI / 2 );

} );

test( 'pinned Babylon IK outputs agree with the analytical planar hinge oracle, including authored rotation', () => {

	const saved = JSON.parse( readFileSync( new URL( './ik-reference-fixtures.json', import.meta.url ), 'utf8' ) ) as {
		cases: { axis: number; rest: Vec; target: Vec; authoredAngle: number; iteration: number; maxAngle: number; quaternion: [ number, number, number, number ]; effector: Vec }[];
	};
	for ( const c of saved.cases ) {

		const f = fixture( c.rest, c.target, hingeLimits( c.axis, 0, Math.PI ), c.iteration, c.maxAngle );
		const axis = new Vector3().setComponent( c.axis, 1 );
		f.link.quaternion.setFromAxisAngle( axis, c.authoredAngle ); f.mesh.updateMatrixWorld( true ); solve( f );
		// Check the downloaded runtime output itself against sin/cos geometry;
		// do not treat that output as the sole source of the expected result.
		const analytical = new Quaternion().setFromAxisAngle( axis, 0.7 );
		near( analytical.angleTo( new Quaternion().fromArray( c.quaternion ) ), 0 );
		near( f.link.quaternion.angleTo( analytical ), 0 ); near( f.error(), 0, 2e-5 );
		const position = f.effector.getWorldPosition( new Vector3() ).toArray();
		position.forEach( ( v, i ) => near( v, c.effector[ i ], 1e-6 ) ); bounds( f, c.axis === 1 ? 'YXZ' : 'XYZ' );

	}

} );

test( 'Euler singular and nearby poses stay finite without discontinuous orientation changes', () => {

	for ( const z of [ Math.PI / 2 - 1e-7, Math.PI / 2, Math.PI / 2 + 1e-7 ] ) {

		const p: Vec = [ 0.2, 0.5, 1 ], desired: Vec = [ 0.2, 0.31, z ];
		const f = fixture( p, rotateEuler( p, desired, 'XZY' ), [ [ -2, -2, -2 ], [ 2, 2, 2 ] ], 240 );
		f.link.quaternion.setFromEuler( new Euler( 0.2, 0.3, z, 'XZY' ) ); f.mesh.updateMatrixWorld( true );
		const before = f.link.quaternion.clone(); solve( f ); near( f.error(), 0, 2e-5 ); assert.ok( before.angleTo( f.link.quaternion ) < 0.05 );
		const q = f.link.quaternion.clone(); for ( let i = 0; i < 20; i ++ ) solve( f ); near( q.angleTo( f.link.quaternion ), 0, 1e-5 );

	}

} );

for ( const post of [ false, true ] ) test( `constrained helper pose lifecycle restores authored IK input on seek, loop and toggles, post=${post}`, () => {

	const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
	const data = new Parser().parsePmx( grantPmxBuffer(), true );
	for ( const bone of data.bones ) { delete bone.grant; bone.flag = 0; bone.parentIndex = -1; }
	data.bones[ 0 ].position = [ 0, 0, 0 ]; data.bones[ 1 ].position = [ 0, 1, 0 ]; data.bones[ 1 ].parentIndex = 0;
	data.bones[ 2 ].position = [ 1, 0, 0 ]; data.bones[ 2 ].flag = post ? 0x1020 : 0x20;
	data.bones[ 2 ].ik = { target: null, effector: 1, iteration: 80, maxAngle: 0.2, linkCount: 1, links: [ { index: 0, angleLimitation: 1, lowerLimitationAngle: [ 0, 0, -Math.PI ], upperLimitationAngle: [ 0, 0, Math.PI ] } ] };
	const mesh = loader.meshBuilder.build( data, '' );
	const clip = loader.animationBuilder.build( new Parser().parseVmd( vmdBuffer( { boneName: 'bone0', rotation: [ 0, 0, Math.sin( 0.125 ), Math.cos( 0.125 ) ] } ), true ), mesh );
	// Keep the authored quarter-radian twist constant while translation seeks.
	const rotationTrack = clip.tracks.find( track => track.name.endsWith( '.quaternion' ) )!;
	rotationTrack.values.set( rotationTrack.values.slice( 4, 8 ), 0 );
	const helper = new MMDAnimationHelper( { sync: false } ); helper.add( mesh, { animation: clip, physics: false } );
	const mixer = helper.objects.get( mesh )!.mixer!;
	const expected = new Quaternion().setFromAxisAngle( new Vector3( 0, 0, 1 ), -Math.PI / 2 );
	for ( const time of [ 0, 0.1, 0.2, 0, 0.1 ] ) {

		mixer.setTime( time );
		for ( let repeat = 0; repeat < 20; repeat ++ ) {

			helper.update( 0 ); near( expected.angleTo( mesh.skeleton.bones[ 0 ].quaternion ), 0 );
			const effector = mesh.skeleton.bones[ 1 ].getWorldPosition( new Vector3() ), target = mesh.skeleton.bones[ 2 ].getWorldPosition( new Vector3() );
			near( effector.distanceTo( target ), 2 * time, 2e-5 );

		}

	}
	helper.enable( 'ik', false ).update( 0 ); near( mesh.skeleton.bones[ 0 ].rotation.z, 0.25 );
	helper.enable( 'ik', true ).update( 0 ); near( expected.angleTo( mesh.skeleton.bones[ 0 ].quaternion ), 0 );
	helper.update( clip.duration ); helper.update( 0 ); near( expected.angleTo( mesh.skeleton.bones[ 0 ].quaternion ), 0 );
	helper.remove( mesh ); near( mesh.skeleton.bones[ 0 ].rotation.z, 0.25 );

} );

test( 'malformed PMX limit arrays remain invalid and are safely skipped after import', () => {

	for ( const lower of [ undefined, [ 0, 0 ], [ NaN, 0, 0 ], [ 2, 0, 0 ] ] ) {

		const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.textureLoader.load = () => new Texture();
		const data = new Parser().parsePmx( grantPmxBuffer(), true ); data.bones[ 1 ].parentIndex = 0;
		data.bones[ 2 ].ik = { target: null, effector: 1, iteration: 20, maxAngle: 0.5, linkCount: 1, links: [ { index: 0, angleLimitation: 1, lowerLimitationAngle: lower as Vec | undefined, upperLimitationAngle: [ 1, 0, 0 ] } ] };
		const before = structuredClone( data ); const mesh = loader.meshBuilder.build( data, '' ); mesh.updateMatrixWorld( true );
		const rotations = mesh.skeleton.bones.map( b => b.quaternion.toArray() );
		new CCDIKSolver( mesh, mesh.geometry.userData.MMD.iks ).update();
		assert.deepEqual( data, before ); assert.deepEqual( mesh.skeleton.bones.map( b => b.quaternion.toArray() ), rotations );

	}

} );
