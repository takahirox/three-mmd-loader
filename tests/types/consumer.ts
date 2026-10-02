import { AnimationClip, PerspectiveCamera, Vector3 } from 'three';
import {
	MMDLoader, MMDAnimationHelper, CCDIKSolver, MMDPhysics, MMDExporter,
	MMDParser, MMDToonShader
} from 'three-mmd-loader';
import type { AmmoAPI, IK, MMDMesh, VMD, VPD } from 'three-mmd-loader';
import { MMDLoader as SubpathLoader } from 'three-mmd-loader/loaders/MMDLoader.js';
import { MMDAnimationHelper as SubpathHelper } from 'three-mmd-loader/animation/MMDAnimationHelper.js';
import { CCDIKHelper } from 'three-mmd-loader/animation/CCDIKSolver.js';
import { MMDPhysics as SubpathPhysics } from 'three-mmd-loader/animation/MMDPhysics.js';
import { MMDExporter as SubpathExporter } from 'three-mmd-loader/exporters/MMDExporter.js';
import { Parser, CharsetEncoder } from 'three-mmd-loader/libs/mmdparser.module.js';
import { MMDToonShader as SubpathShader } from 'three-mmd-loader/shaders/MMDToonShader.js';

const loader: MMDLoader = new SubpathLoader();
const mesh: MMDMesh = await loader.loadAsync( 'model.pmx' );
mesh.material[ 0 ].gradientMap = MMDToonShader.uniforms.gradientMap.value;
mesh.material[ 0 ].shininess = 30;
const helper: MMDAnimationHelper = new SubpathHelper( { sync: false, pmxAnimation: true } );
helper.add( mesh, { physics: false, animation: new AnimationClip() } ).update( 1 / 60 );
helper.add( new PerspectiveCamera(), { animation: new AnimationClip() } );
helper.onBeforePhysics = model => { model.skeleton.bones[ 0 ].position.x = 1; };
helper.enable( 'ik', false );
loader.loadAnimation( [ 'a.vmd', 'b.vmd' ], mesh, clip => { helper.add( mesh, { animation: clip } ); } );
loader.loadWithAnimation( 'model.pmd', 'motion.vmd', result => { helper.add( result.mesh, { animation: result.animation } ); } );
loader.loadPMD( 'model.pmd', data => { loader.meshBuilder.build( data, '' ); } );
loader.loadPMX( 'model.pmx', data => { loader.meshBuilder.build( data, '' ); } );
loader.loadVMD( 'motion.vmd', ( motion: VMD ) => { loader.animationBuilder.build( motion, mesh ); } );
loader.loadVPD( 'pose.vpd', true, ( pose: VPD ) => { helper.pose( mesh, pose, { ik: false } ); } );

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
new MMDParser.Parser().parsePmx( new ArrayBuffer( 0 ), true );
SubpathShader.uniforms.diffuse.value.setRGB( 1, 1, 1 );

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
