import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Bone } from 'three';
import type { Grant, MMDMesh } from '../types.js';

const finite = ( values: number[] ) => values.every( Number.isFinite );

/** Internal PMX append deformation; see docs/grants.md for spaces and order. */
export class GrantSolver {

	private invalid = new Set<number>();
	private localRestPositions: Vector3[];
	private restPositions: Vector3[];
	private inverseRestRotations: Quaternion[];
	private modelMatrix = new Matrix4();
	private inverseMesh = new Matrix4();
	private position = new Vector3();
	private rotation = new Quaternion();
	private scale = new Vector3();
	private weighted = new Quaternion();
	private resultPosition = new Vector3();
	private resultRotation = new Quaternion();
	private beforePhysicsPositions: Vector3[];
	private beforePhysicsRotations: Quaternion[];

	constructor( public mesh: MMDMesh, public grants: Grant[] = [] ) {

		const data = mesh.geometry.userData.MMD.bones;
		this.beforePhysicsPositions = mesh.skeleton.bones.map( b => b.position.clone() );
		this.beforePhysicsRotations = mesh.skeleton.bones.map( b => b.quaternion.clone() );
		this.localRestPositions = data.map( b => new Vector3().fromArray( b.pos ) );
		this.restPositions = data.map( b => new Vector3().fromArray( b.pos ) );
		this.inverseRestRotations = data.map( b => new Quaternion().fromArray( b.rotq ) );
		// Use bind data, never the potentially already animated skeleton.
		for ( const b of data ) {

			const ancestors: number[] = [];
			const seen = new Set( [ b.index ] );
			let parent = b.parent;
			while ( data[ parent ] && ! seen.has( parent ) ) {

				seen.add( parent ); ancestors.push( parent ); parent = data[ parent ].parent;

			}
			const matrix = new Matrix4().compose( new Vector3().fromArray( b.pos ), new Quaternion().fromArray( b.rotq ), new Vector3( 1, 1, 1 ) );
			for ( const i of ancestors ) matrix.premultiply( new Matrix4().compose( new Vector3().fromArray( data[ i ].pos ), new Quaternion().fromArray( data[ i ].rotq ), new Vector3( 1, 1, 1 ) ) );
			matrix.decompose( this.restPositions[ b.index ], this.inverseRestRotations[ b.index ], this.scale );
			this.inverseRestRotations[ b.index ].invert();

		}
		// Reject all edges in a cycle. Iterative walks avoid recursion overflow
		// for hostile files and retain unrelated valid branches.
		const parents = new Map( grants.map( g => [ g.index, g.parentIndex ] ) );
		for ( const g of grants ) {

			const path: number[] = [];
			const seen = new Map<number, number>();
			let index = g.index;
			while ( parents.has( index ) && ! seen.has( index ) ) {

				seen.set( index, path.length ); path.push( index ); index = parents.get( index )!;

			}
			if ( seen.has( index ) ) for ( const i of path.slice( seen.get( index ) ) ) this.invalid.add( i );
			// A local grant cannot read its own descendant's accumulated pose.
			if ( g.isLocal ) {

				const visited = new Set<number>();
				index = g.parentIndex;
				while ( data[ index ] && ! visited.has( index ) ) {

					if ( index === g.index ) this.invalid.add( g.index );
					visited.add( index ); index = data[ index ].parent;

				}

			}

		}

	}

	update() {

		const data = this.mesh.geometry.userData.MMD.bones;
		const sorted = this.grants.slice().sort( ( a, b ) =>
			( ( data[ a.index ]?.flag ?? 0 ) & 0x1000 ) - ( ( data[ b.index ]?.flag ?? 0 ) & 0x1000 ) ||
			( a.transformationClass ?? 0 ) - ( b.transformationClass ?? 0 ) || a.index - b.index );
		for ( const g of sorted ) this.updateOne( g );
		this.mesh.updateMatrixWorld( true );
		return this;

	}

	captureBeforePhysics() {

		this.mesh.skeleton.bones.forEach( ( b, i ) => {

			this.beforePhysicsPositions[ i ].copy( b.position );
			this.beforePhysicsRotations[ i ].copy( b.quaternion );

		} );

	}

	updateOne( grant: Grant, afterPhysics = false ) {

		const bones = this.mesh.skeleton.bones;
		const target = bones[ grant.index ], source = bones[ grant.parentIndex ];
		if ( ! Number.isInteger( grant.index ) || ! Number.isInteger( grant.parentIndex ) || ! target || ! source ||
			grant.index === grant.parentIndex || this.invalid.has( grant.index ) || ! Number.isFinite( grant.ratio ) || grant.ratio === 0 ) return this;
		const data = this.mesh.geometry.userData.MMD.bones;
		if ( ! data[ grant.index ] || ! data[ grant.parentIndex ] ) return this;
		const dynamicSource = afterPhysics && data[ grant.parentIndex ].rigidBodyType > 0;
		this.position.copy( dynamicSource ? this.beforePhysicsPositions[ grant.parentIndex ] : source.position ).sub( this.localRestPositions[ grant.parentIndex ] );
		this.rotation.copy( dynamicSource ? this.beforePhysicsRotations[ grant.parentIndex ] : source.quaternion );
		if ( grant.isLocal ) {

			const visited = new Set<number>();
			let index = grant.parentIndex;
			while ( data[ index ] && ! visited.has( index ) ) {

				const bone = bones[ index ];
				if ( ! bone || ! finite( bone.position.toArray() ) || ! finite( bone.quaternion.toArray() ) || bone.quaternion.lengthSq() === 0 ) return this;
				visited.add( index ); index = data[ index ].parent;

			}
			this.mesh.updateMatrixWorld( true );
			// PMX's "local matrix" is accumulated in MODEL space, not Three's
			// bone-local matrix or scene world space. Exclude the mesh transform.
			if ( ! finite( this.mesh.matrixWorld.elements ) || this.mesh.matrixWorld.determinant() === 0 ) return this;
			this.inverseMesh.copy( this.mesh.matrixWorld ).invert();
			this.modelMatrix.multiplyMatrices( this.inverseMesh, source.matrixWorld );
			this.modelMatrix.decompose( this.position, this.rotation, this.scale );
			this.position.sub( this.restPositions[ grant.parentIndex ] );
			this.rotation.multiply( this.inverseRestRotations[ grant.parentIndex ] );

		}
		this.resultPosition.copy( target.position );
		this.resultRotation.copy( target.quaternion );
		if ( grant.affectPosition ) {

			if ( ! finite( this.position.toArray() ) ) return this;
			this.resultPosition.addScaledVector( this.position, grant.ratio );

		}
		if ( grant.affectRotation ) {

			if ( ! this.weightRotation( this.rotation, grant.ratio ) ) return this;
			// Column-vector equivalent of PMX's grant * animation * morph.
			this.resultRotation.multiply( this.weighted );

		}
		if ( ! finite( this.resultPosition.toArray() ) || ! finite( this.resultRotation.toArray() ) ) return this;
		target.position.copy( this.resultPosition ); target.quaternion.copy( this.resultRotation );
		target.updateMatrixWorld( true );
		return this;

	}

	private weightRotation( rotation: Quaternion, ratio: number ) {

		if ( ! finite( rotation.toArray() ) || ! Number.isFinite( ratio ) || ( rotation.lengthSq() === 0 || ! Number.isFinite( rotation.lengthSq() ) ) ) return false;
		this.weighted.copy( rotation ).normalize();
		if ( this.weighted.w < 0 ) this.weighted.set( - this.weighted.x, - this.weighted.y, - this.weighted.z, - this.weighted.w );
		const sine = Math.hypot( this.weighted.x, this.weighted.y, this.weighted.z );
		if ( sine === 0 ) { this.weighted.identity(); return true; }
		const angle = Math.atan2( sine, this.weighted.w ) * ratio;
		if ( ! Number.isFinite( angle ) ) return false;
		const factor = Math.sin( angle ) / sine;
		this.weighted.set( this.weighted.x * factor, this.weighted.y * factor, this.weighted.z * factor, Math.cos( angle ) );
		return true;

	}

	addGrantRotation( bone: Bone, q: Quaternion, ratio: number ) {

		if ( this.weightRotation( q, ratio ) ) bone.quaternion.multiply( this.weighted );
		return this;

	}

}
