import {
	BufferAttribute,
	BufferGeometry,
	Color,
	Euler,
	Line,
	LineBasicMaterial,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	Quaternion,
	SphereGeometry,
	Vector3
} from 'three';

import type { Bone, SkinnedMesh, TypedArray } from 'three';
import type { IK, IKLink } from '../types.js';

const _q = new Quaternion();
const _targetPos = new Vector3();
const _targetVec = new Vector3();
const _effectorPos = new Vector3();
const _effectorVec = new Vector3();
const _linkPos = new Vector3();
const _invLinkQ = new Quaternion();
const _linkScale = new Vector3();
const _axis = new Vector3();
const _vector = new Vector3();
const _matrix = new Matrix4();


/**
 * CCD Algorithm
 *  - https://sites.google.com/site/auraliusproject/ccd-algorithm
 *
 * // ik parameter example
 * //
 * // target, effector, index in links are bone index in skeleton.bones.
 * // the bones relation should be
 * // <-- parent                                  child -->
 * // links[ n ], links[ n - 1 ], ..., links[ 0 ], effector
 * iks = [ {
 *	target: 1,
 *	effector: 2,
 *	links: [ { index: 5, limitation: new Vector3( 1, 0, 0 ) }, { index: 4, enabled: false }, { index : 3 } ],
 *	iteration: 10,
 *	minAngle: 0.0,
 *	maxAngle: 1.0,
 * } ];
 */

class CCDIKSolver {

	mesh: SkinnedMesh;
	iks: IK[];

	/**
	 * @param {THREE.SkinnedMesh} mesh
	 * @param {Array<Object>} iks
	 */
	constructor( mesh: SkinnedMesh, iks: IK[] = [] ) {

		this.mesh = mesh;
		this.iks = iks;

		this._valid();

	}

	/**
	 * Update all IK bones.
	 *
	 * @return {CCDIKSolver}
	 */
	update() {

		const iks = this.iks;

		for ( let i = 0, il = iks.length; i < il; i ++ ) {

			this.updateOne( iks[ i ] );

		}

		return this;

	}

	/**
	 * Update one IK bone
	 *
	 * @param {Object} ik parameter
	 * @return {CCDIKSolver}
	 */
	updateOne( ik: IK ) {

		const bones = this.mesh.skeleton.bones;

		// for reference overhead reduction in loop
		const math = Math;

		const effector = bones[ ik.effector ];
		const target = bones[ ik.target ];
		// Validate the entire chain before changing any bone. Bounds are ranges,
		// not wrapped intervals; an invalid chain must not partially update.
		if ( ! effector || ! target || ! Number.isInteger( ik.target ) || ! Number.isInteger( ik.effector ) || ! Number.isInteger( ik.iteration ?? 1 ) || ( ik.iteration ?? 1 ) < 0 ||
			! Number.isFinite( ik.maxAngle ?? Math.PI ) || ! Number.isFinite( ik.minAngle ?? 0 ) ||
			( ik.minAngle ?? 0 ) < 0 || ( ik.maxAngle ?? Math.PI ) < ( ik.minAngle ?? 0 ) ||
			! validPose( target ) || ! validPose( effector ) ||
			ik.links.some( data => ! Number.isInteger( data.index ) || ! bones[ data.index ] ||
				! validPose( bones[ data.index ] ) || ! validLimits( data ) ) ) return this;

		// don't use getWorldPosition() here for the performance
		// because it calls updateMatrixWorld( true ) inside.
		_targetPos.setFromMatrixPosition( target.matrixWorld );

		const links = ik.links;
		const iteration = Math.min( ik.iteration !== undefined ? ik.iteration : 1, 1024 );
		const constrained = links.map( data => data.rotationMin || data.rotationMax ? constrainedAngles( bones[ data.index ], data ) : null );
		if ( ik.maxAngle === 0 || constrained.some( state => state && ! state.angles.every( Number.isFinite ) ) ) return this;

		for ( let i = 0; i < iteration; i ++ ) {

			let rotated = false;

			for ( let j = 0, jl = links.length; j < jl; j ++ ) {

				const link = bones[ links[ j ].index ];

				// skip this link and following links.
				// this skip is used for MMD performance optimization.
				if ( links[ j ].enabled === false ) break;

				const limitation = links[ j ].limitation;

				// don't use getWorldPosition/Quaternion() here for the performance
				// because they call updateMatrixWorld( true ) inside.
				if ( ! link.matrixWorld.elements.every( Number.isFinite ) || ! target.matrixWorld.elements.every( Number.isFinite ) || ! effector.matrixWorld.elements.every( Number.isFinite ) ) return this;
				link.matrixWorld.decompose( _linkPos, _invLinkQ, _linkScale );
				if ( ! _invLinkQ.toArray().every( Number.isFinite ) || ! _linkScale.toArray().every( v => Number.isFinite( v ) && Math.abs( v ) > 1e-10 ) ) return this;
				_invLinkQ.invert();
				_effectorPos.setFromMatrixPosition( effector.matrixWorld );

				// work in link world
				_effectorVec.subVectors( _effectorPos, _linkPos );
				_effectorVec.applyQuaternion( _invLinkQ );

				_targetVec.subVectors( _targetPos, _linkPos );
				_targetVec.applyQuaternion( _invLinkQ );
				if ( ! Number.isFinite( _effectorVec.lengthSq() ) || ! Number.isFinite( _targetVec.lengthSq() ) ) return this;
				if ( _effectorVec.lengthSq() < 1e-20 || _targetVec.lengthSq() < 1e-20 ) continue;

				_effectorVec.normalize();
				_targetVec.normalize();
				const state = constrained[ j ];
				if ( state ) {

					rotated = solveConstrained( link, links[ j ], state, ik.maxAngle ?? Math.PI ) || rotated;
					continue;

				}

				let angle = _targetVec.dot( _effectorVec );

				if ( angle > 1.0 ) {

					angle = 1.0;

				} else if ( angle < - 1.0 ) {

					angle = - 1.0;

				}

				angle = math.acos( angle );

				// skip if changing angle is too small to prevent vibration of bone
				if ( angle < 1e-5 ) continue;

				if ( ik.minAngle !== undefined && angle < ik.minAngle ) {

					angle = ik.minAngle;

				}

				if ( ik.maxAngle !== undefined && angle > ik.maxAngle ) {

					angle = ik.maxAngle;

				}

				_axis.crossVectors( _effectorVec, _targetVec );
				if ( _axis.lengthSq() < 1e-20 ) {

					// Antiparallel has infinitely many axes. Use a deterministic
					// perpendicular axis (or the PMD knee's permitted axis).
					if ( limitation ) _axis.copy( limitation ).normalize();
					else {

						const v = _effectorVec;
						_axis.set( Math.abs( v.x ) <= Math.abs( v.y ) && Math.abs( v.x ) <= Math.abs( v.z ) ? 1 : 0,
							Math.abs( v.y ) < Math.abs( v.x ) && Math.abs( v.y ) <= Math.abs( v.z ) ? 1 : 0,
							Math.abs( v.z ) < Math.abs( v.x ) && Math.abs( v.z ) < Math.abs( v.y ) ? 1 : 0 );
						_axis.cross( v );

					}
					if ( Math.abs( _axis.dot( _effectorVec ) ) > 1e-8 ) continue;

				}
				_axis.normalize();

				_q.setFromAxisAngle( _axis, angle );
				link.quaternion.multiply( _q ).normalize();

				// Preserve the historical PMD knee heuristic.
				if ( limitation !== undefined ) {

					let c = link.quaternion.w;

					c = math.max( - 1, math.min( 1, c ) );

					const c2 = math.sqrt( 1 - c * c );
					link.quaternion.set( limitation.x * c2,
					                     limitation.y * c2,
					                     limitation.z * c2,
					                     c );

				}

				link.updateMatrixWorld( true );

				rotated = true;

			}

			if ( ! rotated ) break;

		}

		return this;

	}

	/**
	 * Creates Helper
	 *
	 * @param {number} sphereSize
	 * @return {CCDIKHelper}
	 */
	createHelper( sphereSize?: number ) {

		return new CCDIKHelper( this.mesh, this.iks, sphereSize );

	}

	// private methods

	_valid() {

		const iks = this.iks;
		const bones = this.mesh.skeleton.bones;

		for ( let i = 0, il = iks.length; i < il; i ++ ) {

			const ik = iks[ i ];
			const effector = bones[ ik.effector ];
			const links = ik.links;
			let link0, link1;

			link0 = effector;

			for ( let j = 0, jl = links.length; j < jl; j ++ ) {

				link1 = bones[ links[ j ].index ];

				if ( ! link0 || ! link1 ) break;
				if ( link0.parent !== link1 ) {

					console.warn( 'THREE.CCDIKSolver: bone ' + link0.name + ' is not the child of bone ' + link1.name );

				}

				link0 = link1;

			}

		}

	}

}

const _constraintQ = new Quaternion();
const _prefixQ = new Quaternion();
const _beforeQ = new Quaternion();
const _constraintEuler = new Euler();
const _effectorParent = new Vector3();
const _targetParent = new Vector3();
const _cross = new Vector3();
const _basis = [ new Vector3( 1, 0, 0 ), new Vector3( 0, 1, 0 ), new Vector3( 0, 0, 1 ) ];
const _tau = 2 * Math.PI;

type ConstrainedAngles = { angles: number[]; order: Euler['order'] };

function validPose( bone: Bone ) {

	const determinant = bone.matrixWorld.determinant();
	return bone.matrixWorld.elements.every( Number.isFinite ) && Number.isFinite( determinant ) && Math.abs( determinant ) > 1e-30 &&
		bone.position.toArray().every( Number.isFinite ) && Math.abs( bone.quaternion.lengthSq() - 1 ) < 1e-5 &&
		bone.scale.toArray().every( v => Number.isFinite( v ) && Math.abs( v ) > 1e-10 );

}

function validLimits( link: IKLink ) {

	if ( [ link.limitation, link.rotationMin, link.rotationMax ].some( v => v && ! v.toArray().every( Number.isFinite ) ) ) return false;
	if ( link.limitation && Math.abs( link.limitation.lengthSq() - 1 ) > 1e-6 ) return false;
	for ( let c = 0; c < 3; c ++ ) if ( ( link.rotationMin?.getComponent( c ) ?? -Math.PI ) > ( link.rotationMax?.getComponent( c ) ?? Math.PI ) ) return false;
	return true;

}

function constrainedAngles( bone: Bone, link: IKLink ): ConstrainedAngles {

	// As in babylon-mmd, put an axis whose allowed interval is within
	// (-pi/2,pi/2) in the middle. PMX specifies bounds, not an Euler order.
	const min = link.rotationMin, max = link.rotationMax;
	const order = ( min?.x ?? -Math.PI ) > -Math.PI / 2 && ( max?.x ?? Math.PI ) < Math.PI / 2 ? 'YXZ' :
		( min?.y ?? -Math.PI ) > -Math.PI / 2 && ( max?.y ?? Math.PI ) < Math.PI / 2 ? 'ZYX' : 'XZY';
	_matrix.makeRotationFromQuaternion( _constraintQ.copy( bone.quaternion ).normalize() );
	const m = _matrix.elements;
	// atan2 retains the small cosine near a singularity. Three's general Euler
	// conversion instead zeroes an outer angle within its singularity threshold,
	// which can turn a legal authored pose into an out-of-range representation.
	const principal = order === 'YXZ' ? [ Math.atan2( -m[ 9 ], Math.hypot( m[ 8 ], m[ 10 ] ) ), Math.atan2( m[ 8 ], m[ 10 ] ), Math.atan2( m[ 1 ], m[ 5 ] ) ] :
		order === 'ZYX' ? [ Math.atan2( m[ 6 ], m[ 10 ] ), Math.atan2( -m[ 2 ], Math.hypot( m[ 0 ], m[ 1 ] ) ), Math.atan2( m[ 1 ], m[ 0 ] ) ] :
		[ Math.atan2( m[ 6 ], m[ 5 ] ), Math.atan2( m[ 8 ], m[ 0 ] ), Math.atan2( -m[ 4 ], Math.hypot( m[ 0 ], m[ 8 ] ) ) ];
	const alternative = principal.slice(), middle = 'XYZ'.indexOf( order[ 1 ] );
	for ( let c = 0; c < 3; c ++ ) alternative[ c ] = c === middle ? Math.PI - alternative[ c ] : alternative[ c ] + Math.PI;
	const candidates = [ principal, alternative ];
	if ( Math.abs( Math.cos( principal[ middle ] ) ) < 1e-12 ) {

		// At a singularity the outer factors are coupled: for these three
		// orders, first - sign(middle)*last = combined (modulo a full turn).
		// Intersect that line with the bounds rather than clamping a single
		// arbitrary decomposition. Choose its midpoint for a continuous feasible
		// representation as the combined angle changes across repeated updates.
		const first = 'XYZ'.indexOf( order[ 0 ] ), last = 'XYZ'.indexOf( order[ 2 ] );
		const sign = Math.sign( principal[ middle ] ), k = -sign;
		_constraintQ.copy( bone.quaternion ).multiply( _prefixQ.setFromAxisAngle( _basis[ middle ], -sign * Math.PI / 2 ) );
		const combined = 2 * Math.atan2( _constraintQ.toArray()[ first ], _constraintQ.w );
		const firstMin = min?.getComponent( first ) ?? -Math.PI, firstMax = max?.getComponent( first ) ?? Math.PI;
		const lastMin = min?.getComponent( last ) ?? -Math.PI, lastMax = max?.getComponent( last ) ?? Math.PI;
		const lower = firstMin + ( k > 0 ? lastMin : -lastMax ), upper = firstMax + ( k > 0 ? lastMax : -lastMin );
		// Roundoff at a box corner must not reject the only feasible full-turn
		// lift. The candidate is still clipped to the exact component bounds below.
		const turnMin = Math.ceil( ( lower - combined ) / _tau - 1e-12 ), turnMax = Math.floor( ( upper - combined ) / _tau + 1e-12 );
		if ( turnMin <= turnMax ) {

			const turn = Math.max( turnMin, Math.min( turnMax, Math.round( ( lower / 2 + upper / 2 - combined ) / _tau ) ) );
			const total = combined + turn * _tau;
			const a = Math.max( firstMin, total - ( k > 0 ? lastMax : -lastMin ) );
			const b = Math.min( firstMax, total - ( k > 0 ? lastMin : -lastMax ) );
			const coupled = principal.slice();
			coupled[ first ] = a / 2 + b / 2;
			coupled[ last ] = ( total - coupled[ first ] ) / k;
			coupled[ middle ] = sign * Math.PI / 2;
			candidates.push( coupled );

		}

	}
	let best = principal, distance = Infinity;
	for ( const candidate of candidates ) {

		for ( let c = 0; c < 3; c ++ ) {

			const lower = min?.getComponent( c ) ?? -Math.PI, upper = max?.getComponent( c ) ?? Math.PI;
			// Lift to the equivalent angle nearest the interval before clamping.
			candidate[ c ] += _tau * Math.round( ( lower / 2 + upper / 2 - candidate[ c ] ) / _tau );
			candidate[ c ] = Math.max( lower, Math.min( upper, candidate[ c ] ) );

		}
		_constraintEuler.set( candidate[ 0 ], candidate[ 1 ], candidate[ 2 ], order );
		const d = _constraintQ.setFromEuler( _constraintEuler ).angleTo( bone.quaternion );
		if ( d < distance ) { best = candidate; distance = d; }

	}
	return { angles: best, order };

}

function solveConstrained( bone: Bone, link: IKLink, state: ConstrainedAngles, maxAngle: number ) {

	const { angles, order } = state;
	_beforeQ.copy( bone.quaternion );
	// The target is fixed in the parent rotation frame. The effector vector
	// is fixed in the link frame until this joint rotates.
	_targetParent.copy( _targetVec ).applyQuaternion( _beforeQ );
	_constraintEuler.set( angles[ 0 ], angles[ 1 ], angles[ 2 ], order );
	bone.quaternion.setFromEuler( _constraintEuler );
	_effectorParent.copy( _effectorVec ).applyQuaternion( bone.quaternion );
	_prefixQ.identity();
	let budget = Math.min( maxAngle, Math.PI );
	for ( const name of order ) {

		const c = 'XYZ'.indexOf( name );
		_axis.copy( _basis[ c ] ).applyQuaternion( _prefixQ );
		const a = _effectorParent.dot( _targetParent ) - _effectorParent.dot( _axis ) * _targetParent.dot( _axis );
		const b = _axis.dot( _cross.crossVectors( _effectorParent, _targetParent ) );
		const min = link.rotationMin?.getComponent( c ) ?? -Math.PI, max = link.rotationMax?.getComponent( c ) ?? Math.PI;
		// A full-turn interval admits every orientation of this Euler factor.
		// Its endpoints are equivalent representations, not rotation barriers.
		const fullTurn = max - min >= _tau;
		const lower = fullTurn ? -budget : Math.max( min - angles[ c ], -budget );
		const upper = fullTurn ? budget : Math.min( max - angles[ c ], budget );
		let delta = 0, gain = a;
		if ( Math.abs( a ) + Math.abs( b ) > 1e-15 && lower < upper ) {

			// Dot after rotation is A*cos(d)+B*sin(d)+C. Test stationary
			// maxima and interval ends, including BOTH antiparallel signs.
			const optimum = Math.atan2( b, a );
			for ( const candidate of [ lower, upper, optimum, optimum - _tau, optimum + _tau ] ) {

				const d = Math.max( lower, Math.min( upper, candidate ) ), value = a * Math.cos( d ) + b * Math.sin( d );
				if ( value > gain + 1e-15 ) { delta = d; gain = value; }

			}

		}
		angles[ c ] += delta;
		if ( fullTurn ) {

			if ( angles[ c ] > max ) angles[ c ] -= _tau * Math.ceil( ( angles[ c ] - max ) / _tau );
			if ( angles[ c ] < min ) angles[ c ] += _tau * Math.ceil( ( min - angles[ c ] ) / _tau );

		}
		budget = Math.max( 0, budget - Math.abs( delta ) );
		_effectorParent.applyQuaternion( _constraintQ.setFromAxisAngle( _axis, delta ) );
		_prefixQ.multiply( _constraintQ.setFromAxisAngle( _basis[ c ], angles[ c ] ) );

	}
	_constraintEuler.set( angles[ 0 ], angles[ 1 ], angles[ 2 ], order );
	bone.quaternion.setFromEuler( _constraintEuler );
	const changed = 1 - Math.abs( _beforeQ.dot( bone.quaternion ) ) > 1e-14;
	if ( changed ) bone.updateMatrixWorld( true );
	else bone.quaternion.copy( _beforeQ );
	return changed;

}

function getPosition( bone: Object3D, matrixWorldInv: Matrix4 ) {

	return _vector
		.setFromMatrixPosition( bone.matrixWorld )
		.applyMatrix4( matrixWorldInv );

}

function setPositionOfBoneToAttributeArray( array: TypedArray, index: number, bone: Object3D, matrixWorldInv: Matrix4 ) {

	const v = getPosition( bone, matrixWorldInv );

	array[ index * 3 + 0 ] = v.x;
	array[ index * 3 + 1 ] = v.y;
	array[ index * 3 + 2 ] = v.z;

}

/**
 * Visualize IK bones
 *
 * @param {SkinnedMesh} mesh
 * @param {Array<Object>} iks
 * @param {number} sphereSize
 */
class CCDIKHelper extends Object3D {

	root: SkinnedMesh;
	iks: IK[];
	sphereGeometry: SphereGeometry;
	targetSphereMaterial: MeshBasicMaterial;
	effectorSphereMaterial: MeshBasicMaterial;
	linkSphereMaterial: MeshBasicMaterial;
	lineMaterial: LineBasicMaterial;

	constructor( mesh: SkinnedMesh, iks: IK[] = [], sphereSize = 0.25 ) {

		super();

		this.root = mesh;
		this.iks = iks;

		this.matrix.copy( mesh.matrixWorld );
		this.matrixAutoUpdate = false;

		this.sphereGeometry = new SphereGeometry( sphereSize, 16, 8 );

		this.targetSphereMaterial = new MeshBasicMaterial( {
			color: new Color( 0xff8888 ),
			depthTest: false,
			depthWrite: false,
			transparent: true
		} );

		this.effectorSphereMaterial = new MeshBasicMaterial( {
			color: new Color( 0x88ff88 ),
			depthTest: false,
			depthWrite: false,
			transparent: true
		} );

		this.linkSphereMaterial = new MeshBasicMaterial( {
			color: new Color( 0x8888ff ),
			depthTest: false,
			depthWrite: false,
			transparent: true
		} );

		this.lineMaterial = new LineBasicMaterial( {
			color: new Color( 0xff0000 ),
			depthTest: false,
			depthWrite: false,
			transparent: true
		} );

		this._init();

	}

	/**
	 * Updates IK bones visualization.
	 */
	updateMatrixWorld( force?: boolean ) {

		const mesh = this.root;

		if ( this.visible ) {

			let offset = 0;

			const iks = this.iks;
			const bones = mesh.skeleton.bones;

			_matrix.copy( mesh.matrixWorld ).invert();

			for ( let i = 0, il = iks.length; i < il; i ++ ) {

				const ik = iks[ i ];

				const targetBone = bones[ ik.target ];
				const effectorBone = bones[ ik.effector ];

				const targetMesh = this.children[ offset ++ ];
				const effectorMesh = this.children[ offset ++ ];

				targetMesh.position.copy( getPosition( targetBone, _matrix ) );
				effectorMesh.position.copy( getPosition( effectorBone, _matrix ) );

				for ( let j = 0, jl = ik.links.length; j < jl; j ++ ) {

					const link = ik.links[ j ];
					const linkBone = bones[ link.index ];

					const linkMesh = this.children[ offset ++ ];

					linkMesh.position.copy( getPosition( linkBone, _matrix ) );

				}

				const line = this.children[ offset ++ ] as Line;
				const array = line.geometry.attributes.position.array;

				setPositionOfBoneToAttributeArray( array, 0, targetBone, _matrix );
				setPositionOfBoneToAttributeArray( array, 1, effectorBone, _matrix );

				for ( let j = 0, jl = ik.links.length; j < jl; j ++ ) {

					const link = ik.links[ j ];
					const linkBone = bones[ link.index ];
					setPositionOfBoneToAttributeArray( array, j + 2, linkBone, _matrix );

				}

				line.geometry.attributes.position.needsUpdate = true;

			}

		}

		this.matrix.copy( mesh.matrixWorld );

		super.updateMatrixWorld( force );

	}

	/**
	 * Frees the GPU-related resources allocated by this instance. Call this method whenever this instance is no longer used in your app.
	 */
	dispose() {

		this.sphereGeometry.dispose();

		this.targetSphereMaterial.dispose();
		this.effectorSphereMaterial.dispose();
		this.linkSphereMaterial.dispose();
		this.lineMaterial.dispose();

		const children = this.children;

		for ( let i = 0; i < children.length; i ++ ) {

			const child = children[ i ];

			if ( child instanceof Line ) child.geometry.dispose();

		}

	}

	// private method

	_init() {

		const scope = this;
		const iks = this.iks;

		function createLineGeometry( ik: IK ) {

			const geometry = new BufferGeometry();
			const vertices = new Float32Array( ( 2 + ik.links.length ) * 3 );
			geometry.setAttribute( 'position', new BufferAttribute( vertices, 3 ) );

			return geometry;

		}

		function createTargetMesh() {

			return new Mesh( scope.sphereGeometry, scope.targetSphereMaterial );

		}

		function createEffectorMesh() {

			return new Mesh( scope.sphereGeometry, scope.effectorSphereMaterial );

		}

		function createLinkMesh() {

			return new Mesh( scope.sphereGeometry, scope.linkSphereMaterial );

		}

		function createLine( ik: IK ) {

			return new Line( createLineGeometry( ik ), scope.lineMaterial );

		}

		for ( let i = 0, il = iks.length; i < il; i ++ ) {

			const ik = iks[ i ];

			this.add( createTargetMesh() );
			this.add( createEffectorMesh() );

			for ( let j = 0, jl = ik.links.length; j < jl; j ++ ) {

				this.add( createLinkMesh() );

			}

			this.add( createLine( ik ) );

		}

	}

}

export { CCDIKSolver, CCDIKHelper };
