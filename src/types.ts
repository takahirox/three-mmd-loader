import type { MMDToonMaterial } from './loaders/MMDLoader.js';
import type { BufferGeometry, SkinnedMesh, Vector3 } from 'three';

export type Vector3Tuple = [ number, number, number ];
export type Vector4Tuple = [ number, number, number, number ];

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

interface RigidBodyBase {
	name?: string;
	englishName?: string;
	boneIndex: number;
	type: number;
	position: Vector3Tuple;
	rotation: Vector3Tuple;
	weight: number;
	friction: number;
	restitution: number;
	positionDamping: number;
	rotationDamping: number;
	groupIndex: number;
	groupTarget: number;
}

export type RigidBodyParameters = RigidBodyBase & (
	{ shapeType: 0; width: number; height?: number; depth?: number } |
	{ shapeType: 1; width: number; height: number; depth: number } |
	{ shapeType: 2; width: number; height: number; depth?: number }
);

export interface ConstraintParameters {
	name?: string;
	englishName?: string;
	type?: number;
	rigidBodyIndex1: number;
	rigidBodyIndex2: number;
	position: Vector3Tuple;
	rotation: Vector3Tuple;
	translationLimitation1: Vector3Tuple;
	translationLimitation2: Vector3Tuple;
	rotationLimitation1: Vector3Tuple;
	rotationLimitation2: Vector3Tuple;
	springPosition: Vector3Tuple;
	springRotation: Vector3Tuple;
}

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
}

export interface MMDGeometry extends BufferGeometry {
	bones: MMDBone[];
	morphTargets: { name: string }[];
	userData: { MMD: MMDGeometryData; [ key: string ]: unknown };
}

export type MMDMesh = SkinnedMesh<MMDGeometry, MMDToonMaterial[]>;

export interface ModelMetadata {
	format: 'pmd' | 'pmx';
	coordinateSystem: 'left' | 'right';
	vertexCount: number;
	faceCount: number;
	materialCount: number;
	boneCount: number;
	morphCount: number;
	rigidBodyCount: number;
	constraintCount: number;
	ikCount?: number;
	[ key: string ]: unknown;
}

export interface ModelBone {
	name: string;
	position: Vector3Tuple;
	parentIndex: number;
	transformationClass?: number;
	ik?: { effector: number; iteration: number; maxAngle: number; links: {
		index: number; angleLimitation: number; lowerLimitationAngle?: Vector3Tuple; upperLimitationAngle?: Vector3Tuple;
	}[] };
	grant?: Omit<Grant, 'index'>;
}

export interface ModelMaterial {
	name?: string;
	diffuse: Vector4Tuple;
	specular: Vector3Tuple;
	ambient: Vector3Tuple;
	shininess: number;
	faceCount: number;
	toonIndex: number;
	// PMD material fields.
	fileName?: string;
	edgeFlag?: number;
	// PMX material fields.
	flag?: number;
	edgeColor?: Vector4Tuple;
	edgeSize?: number;
	textureIndex?: number;
	envTextureIndex?: number;
	envFlag?: number;
	toonFlag?: number;
}

// The vendor supports different element shapes according to format and morph
// type. Optional fields describe those shapes without hiding them behind any.
export interface MorphElement {
	index: number;
	position?: Vector3Tuple;
	ratio?: number;
	rotation?: Vector4Tuple;
	uv?: Vector4Tuple;
	diffuse?: Vector4Tuple;
	specular?: Vector3Tuple;
	ambient?: Vector3Tuple;
	type?: number;
	shininess?: number;
	edgeColor?: Vector4Tuple;
	edgeSize?: number;
	textureColor?: Vector4Tuple;
	sphereTextureColor?: Vector4Tuple;
	toonColor?: Vector4Tuple;
}

export interface ModelMorph {
	name: string;
	type: number;
	elementCount: number;
	elements: MorphElement[];
}

export interface ModelData {
	metadata: ModelMetadata;
	vertices: { position: Vector3Tuple; normal: Vector3Tuple; uv: [ number, number ]; skinIndices: number[]; skinWeights: number[] }[];
	faces: { indices: number[] }[];
	materials: ModelMaterial[];
	bones: ModelBone[];
	morphs: ModelMorph[];
	rigidBodies: RigidBodyParameters[];
	constraints: ConstraintParameters[];
	iks?: ( Required<Pick<IK, 'target' | 'effector' | 'iteration' | 'maxAngle'>> & { links: { index: number }[] } )[];
	toonTextures?: { fileName: string }[];
	textures?: string[];
}

export interface VMDMotion {
	boneName: string;
	frameNum: number;
	position: Vector3Tuple;
	rotation: Vector4Tuple;
	interpolation: number[];
}

export interface VMDMorph { morphName: string; frameNum: number; weight: number }
export interface VMDCamera {
	frameNum: number;
	distance: number;
	position: Vector3Tuple;
	rotation: Vector3Tuple;
	interpolation: number[];
	fov: number;
	perspective: number;
}

export interface VMD {
	metadata: { name: string; coordinateSystem: 'left' | 'right'; motionCount: number; morphCount: number; cameraCount: number; magic?: string };
	motions: VMDMotion[];
	morphs: VMDMorph[];
	cameras: VMDCamera[];
}

export interface VPD {
	metadata: { coordinateSystem: 'left' | 'right'; parentFile: string; boneCount: number };
	bones: { name: string; translation: Vector3Tuple; quaternion: Vector4Tuple }[];
}
