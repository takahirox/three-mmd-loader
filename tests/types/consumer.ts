import { AnimationClip, PerspectiveCamera, Vector3 } from 'three';
import {
	MMDLoader, MMDAnimationHelper, CCDIKSolver, MMDPhysics, MMDExporter,
	MMDToonMaterial, MMDOutlineEffect
} from 'three-mmd-loader';
import type { AmmoAPI, IK, MMDMesh, MMDBoneMorph, MMDGroupMorph } from 'three-mmd-loader';
import { MMDLoader as SubpathLoader } from 'three-mmd-loader/loaders/MMDLoader.js';
import { MMDAnimationHelper as SubpathHelper } from 'three-mmd-loader/animation/MMDAnimationHelper.js';
import { CCDIKHelper } from 'three-mmd-loader/animation/CCDIKSolver.js';
import { MMDPhysics as SubpathPhysics } from 'three-mmd-loader/animation/MMDPhysics.js';
import { MMDExporter as SubpathExporter } from 'three-mmd-loader/exporters/MMDExporter.js';
import { Parser, CharsetEncoder } from 'mmd-parser';
import type { Pmd, Pmx, Vmd, Vpd } from 'mmd-parser';
import { MMDToonMaterial as SubpathMaterial } from 'three-mmd-loader/materials/MMDToonMaterial.js';
import { MMDOutlineEffect as SubpathOutline } from 'three-mmd-loader/effects/MMDOutlineEffect.js';
import { WebGPURenderer } from 'three/webgpu';

const loader: MMDLoader = new SubpathLoader();
const mesh: MMDMesh = await loader.loadAsync( 'model.pmx' );
mesh.material[ 0 ].gradientMap = null;
mesh.material[ 0 ].shininess = 30;
const helper: MMDAnimationHelper = new SubpathHelper( { sync: false, pmxAnimation: true } );
helper.add( mesh, { physics: false, animation: new AnimationClip() } ).update( 1 / 60 );
helper.add( new PerspectiveCamera(), { animation: new AnimationClip() } );
helper.onBeforePhysics = model => { model.skeleton.bones[ 0 ].position.x = 1; };
helper.enable( 'ik', false ).enable( 'boneMorph', true );
const boneMorphs: MMDBoneMorph[] = mesh.geometry.userData.MMD.boneMorphs ?? [];
for ( const morph of boneMorphs ) mesh.morphTargetInfluences![ morph.index ] = 0.5;
const groupMorphs: MMDGroupMorph[] = mesh.geometry.userData.MMD.groupMorphs ?? [];
for ( const group of groupMorphs ) {

	mesh.morphTargetInfluences![ group.index ] = 0.5;
	const targetType: number | null = group.elements[ 0 ]?.type ?? null;
	const targetName: string | null = group.elements[ 0 ]?.name ?? null;
	void targetType; void targetName;

}
loader.loadAnimation( [ 'a.vmd', 'b.vmd' ], mesh, clip => { helper.add( mesh, { animation: clip } ); } );
loader.loadWithAnimation( 'model.pmd', 'motion.vmd', result => { helper.add( result.mesh, { animation: result.animation } ); } );
loader.loadPMD( 'model.pmd', ( data: Pmd ) => { loader.meshBuilder.build( data, '' ); } );
loader.loadPMX( 'model.pmx', ( data: Pmx ) => { loader.meshBuilder.build( data, '' ); } );
loader.loadVMD( 'motion.vmd', ( motion: Vmd ) => { loader.animationBuilder.build( motion, mesh ); } );
loader.loadVPD( 'pose.vpd', true, ( pose: Vpd ) => { helper.pose( mesh, pose, { ik: false } ); } );

const iks: IK[] = [ { target: 2, effector: 1, links: [ { index: 0, limitation: new Vector3( 1, 0, 0 ) } ] } ];
new CCDIKSolver( mesh, iks ).update().createHelper().dispose();
new CCDIKHelper( mesh, iks ).dispose();
const physics: MMDPhysics = new SubpathPhysics( mesh, [], [], { gravity: new Vector3( 0, - 10, 0 ) } );
physics.update( 1 / 60 ).createHelper().dispose();
const exporter: MMDExporter = new SubpathExporter();
const text: string | null = exporter.parseVpd( mesh );
const bytes: Uint8Array | null = exporter.parseVpd( mesh, true );
if ( text ) helper.pose( mesh, new Parser().parseVpd( text, true ) );
if ( bytes ) new CharsetEncoder().s2u( bytes );
new Parser().parsePmx( new ArrayBuffer( 0 ), true );
const material: MMDToonMaterial = new SubpathMaterial( { shininess: 0, matcapCombine: 0 } );
material.diffuse.setRGB( 1, 1, 1 );
material.displacementScale = 0.5;
const outline: MMDOutlineEffect = new SubpathOutline( new WebGPURenderer( { forceWebGL: true } ) );
outline.enabled = false;
outline.dispose();

// The optional Ammo runtime satisfies the structural API without a package
// runtime import, and declaration consumers need no ammojs-typed dependency.
declare const ammo: AmmoAPI;
ammo.btVector3;

// @ts-expect-error unknown helper option
new MMDAnimationHelper( { syncc: false } );
// @ts-expect-error unknown animation feature
helper.enable( 'unknown', true );
// @ts-expect-error animation is a Three.js clip
helper.add( mesh, { animation: 'motion.vmd' } );
// @ts-expect-error model loading resolves a mesh, not an animation
const clip: AnimationClip = await loader.loadAsync( 'model.pmx' );
// @ts-expect-error a PMX parser requires binary input
new Parser().parsePmx( 'model.pmx' );
// @ts-expect-error IK bone indices are numeric
new CCDIKSolver( mesh, [ { target: 'target', effector: 1, links: [] } ] );

// @ts-expect-error parser constructors belong to mmd-parser
import { MMDParser, Parser as RemovedParser, CharsetEncoder as RemovedEncoder } from 'three-mmd-loader';
// @ts-expect-error the old parser subpath is no longer exported
import 'three-mmd-loader/libs/mmdparser.module.js';

// @ts-expect-error the GLSL shader subpath was removed by the TSL migration
import 'three-mmd-loader/shaders/MMDToonShader.js';
