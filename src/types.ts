import type { MMDToonMaterial } from './loaders/MMDLoader.js';
import type { BufferGeometry, SkinnedMesh, Vector3 } from 'three';
import type { RigidBody, Constraint } from 'mmd-parser';

export interface IKLink {
	index: number;
	enabled?: boolean;
	limitation?: Vector3;
	rotationMin?: Vector3;
	rotationMax?: Vector3;
}

export interface IK {
	target: number;
	effector: number;
	links: IKLink[];
	iteration?: number;
	minAngle?: number;
	maxAngle?: number;
}

export interface Grant {
	index: number;
	parentIndex: number;
	ratio: number;
	isLocal: boolean;
	affectRotation: boolean;
	affectPosition: boolean;
	transformationClass?: number;
}

// GeometryBuilder converts PMX body positions to bone offsets for Three.js physics.
type RigidBodyBase = Omit<RigidBody, 'name' | 'shapeType' | 'height' | 'depth'> & {
	name?: string;
	englishName?: string;
};

export type RigidBodyParameters = RigidBodyBase & (
	{ shapeType: 0; width: number; height?: number; depth?: number } |
	{ shapeType: 1; width: number; height: number; depth: number } |
	{ shapeType: 2; width: number; height: number; depth?: number }
);

export type ConstraintParameters = Omit<Constraint, 'name'> & {
	name?: string;
	englishName?: string;
	type?: number;
};

export interface MMDBone {
	index: number;
	name: string;
	parent: number;
	pos: number[];
	rotq: number[];
	scl: number[];
	transformationClass?: number;
	rigidBodyType: number;
	ik?: IK;
	grant?: Grant;
}

export interface MMDGeometryData {
	format: 'pmd' | 'pmx';
	bones: MMDBone[];
	iks: IK[];
	grants: Grant[];
	rigidBodies: RigidBodyParameters[];
	constraints: ConstraintParameters[];
	/** Direct PMX type 2 morphs in file order; offsets are already right-handed. */
	boneMorphs?: MMDBoneMorph[];
	/** PMX type 0 references in file order, including ignored/unsupported links. */
	groupMorphs?: MMDGroupMorph[];
	/** PMX type 8 payloads in file order, without coordinate conversion. */
	materialMorphs?: MMDMaterialMorph[];
}

export interface MMDMaterialValues {
	diffuse: number[];
	specular: number[];
	shininess: number;
	ambient: number[];
	edgeColor: number[];
	edgeSize: number;
	textureColor: number[];
	sphereTextureColor: number[];
	toonColor: number[];
}

export interface MMDMaterialMorph {
	index: number;
	name: string;
	elements: ( MMDMaterialValues & { index: number; type: number } )[];
}

export interface MMDGroupMorph {
	index: number;
	name: string;
	elements: { index: number; ratio: number; type: number | null; name: string | null }[];
}

export interface MMDBoneMorph {
	index: number;
	name: string;
	elements: { index: number; position: number[]; rotation: number[] }[];
}

export interface MMDGeometry extends BufferGeometry {
	bones: MMDBone[];
	morphTargets: { name: string }[];
	userData: { MMD: MMDGeometryData; [ key: string ]: unknown };
}

export type MMDMesh = SkinnedMesh<MMDGeometry, MMDToonMaterial[]>;
