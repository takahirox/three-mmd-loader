import { AmbientLight, Box3, Clock, Color, DirectionalLight, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import type { AnimationClip, BufferAttribute, InterleavedBufferAttribute } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MMDAnimationHelper, MMDLoader, MMDOutlineEffect } from 'three-mmd-loader';
import type { MMDMesh } from '../src/types.js';

const element = <T extends HTMLElement>( id: string ) => document.getElementById( id ) as T;
const status = element<HTMLParagraphElement>( 'status' );
const renderer = new WebGPURenderer( { antialias: true, forceWebGL: new URLSearchParams( location.search ).has( 'webgl' ) } );
await renderer.init();
renderer.setPixelRatio( Math.min( devicePixelRatio, 2 ) );
document.body.appendChild( renderer.domElement );
const scene = new Scene(); scene.background = new Color( 0x20242b );
scene.add( new AmbientLight( 0xffffff, 1 ) );
const light = new DirectionalLight( 0xffffff, 2 ); light.position.set( 10, 20, 15 ); scene.add( light );
const camera = new PerspectiveCamera( 45, 1, 0.1, 1000 ); camera.position.set( 0, 10, 35 );
const controls = new OrbitControls( camera, renderer.domElement ); controls.target.set( 0, 10, 0 ); controls.update();
const effect = new MMDOutlineEffect( renderer );
const loader = new MMDLoader();
const helper = new MMDAnimationHelper();
const clock = new Clock();
let mesh: MMDMesh | undefined;
let baseRotations: Quaternion[] = [];
let originalTypes: Float32Array | undefined;
let animation = false;
let count = 0;
const bend = element<HTMLInputElement>( 'bend' );
const bone = element<HTMLSelectElement>( 'bone' );
const axis = element<HTMLSelectElement>( 'axis' );
const comparison = element<HTMLInputElement>( 'bdef' );
const assetDirectory = element<HTMLSelectElement>( 'asset-directory' );
const morph = element<HTMLSelectElement>( 'morph' );
const weight = element<HTMLInputElement>( 'weight' );
const morphInfo = element<HTMLPreElement>( 'morph-info' );
let loadedDirectory = '';

function privateURL( path: string, directory = assetDirectory.value ) {

	const parts = path.replaceAll( '\\', '/' ).split( '/' );
	if ( ! path || parts.some( p => ! p || p === '..' || p === '.' ) ) throw new Error( 'Use a relative path inside the selected private directory.' );
	return '/private-assets/' + encodeURIComponent( directory ) + '/' + parts.map( encodeURIComponent ).join( '/' );

}
function report( message = '' ) {

	status.textContent = `${count} SDEF vertices. ${comparison.checked ? 'BDEF2 comparison' : 'SDEF enabled'}.\n${message}`;

}
function stop() {

	if ( mesh && animation ) { helper.remove( mesh ); helper.add( mesh, { physics: false } ); }
	helper.enable( 'ik', false ).enable( 'grant', false );
	animation = false;

}
function reset() {

	stop();
	if ( mesh ) helper.pose( mesh, { metadata: { boneCount: 0, parentFile: '', coordinateSystem: 'right' }, bones: [] }, { ik: false, grant: false } );
	bend.value = '0'; element( 'degrees' ).textContent = '0°';
	mesh?.morphTargetInfluences?.fill( 0 );
	helper.update( 0 ); reportMorphs();

}
function applyBend() {

	stop();
	if ( ! mesh ) return;
	const index = Number( bone.value );
	const degrees = Number( bend.value );
	const direction = axis.value === 'x' ? new Vector3( 1, 0, 0 ) : axis.value === 'y' ? new Vector3( 0, 1, 0 ) : new Vector3( 0, 0, 1 );
	mesh.skeleton.bones[ index ].quaternion.copy( baseRotations[ index ] ).multiply( new Quaternion().setFromAxisAngle( direction, degrees * Math.PI / 180 ) );
	element( 'degrees' ).textContent = `${degrees}°`;
	report( `Bending ${mesh.skeleton.bones[ index ].name}. Drag to orbit; scroll to zoom.` );

}
function reportMorphs() {

	const boneMorphs = mesh?.geometry.userData.MMD.boneMorphs ?? [];
	if ( ! boneMorphs.length ) {

		morphInfo.textContent = mesh ? 'No type 2 bone morph is present in this PMX. Group, UV and material morphs are not implemented by this viewer.' : 'Load a PMX to enumerate its actual type 2 bone morphs.';
		weight.value = '0'; element( 'weight-value' ).textContent = '0.00'; return;

	}
	const selected = Number( morph.value );
	const selectedWeight = mesh!.morphTargetInfluences![ selected ];
	weight.value = String( selectedWeight ); element( 'weight-value' ).textContent = selectedWeight.toFixed( 2 );
	morphInfo.textContent = boneMorphs.map( m => {

		const lines = m.elements.map( e => `  Bone ${e.index}: ${mesh!.skeleton.bones[ e.index ]?.name ?? 'missing'}\n    translation: [${e.position.join( ', ' )}]\n    rotation (xyzw): [${e.rotation.join( ', ' )}]` );
		return `${m.index}: ${m.name} — weight ${mesh!.morphTargetInfluences![ m.index ].toFixed( 2 )}\n${lines.join( '\n' )}`;

	} ).join( '\n\n' ) + '\n\nDirect type 2 only. Group composition, UV and material morph dispatch are unsupported. Values are in right-handed local space.';

}
morph.onchange = reportMorphs;
weight.oninput = () => {

	const value = Number( weight.value ); stop();
	if ( ! mesh || morph.disabled ) return;
	mesh.morphTargetInfluences![ Number( morph.value ) ] = value;
	helper.update( 0 ); reportMorphs();
	report( `Bone morph ${morph.selectedOptions[ 0 ].text}: weight ${value.toFixed( 2 )}.` );

};
element( 'load' ).onclick = async () => {

	try {

		status.textContent = 'Loading local PMX and textures…';
		const directory = assetDirectory.value;
		const next = await loader.loadAsync( privateURL( element<HTMLInputElement>( 'model' ).value, directory ) );
		reset();
		if ( mesh ) { helper.remove( mesh ); scene.remove( mesh ); mesh.geometry.dispose(); mesh.skeleton.dispose(); mesh.material.forEach( m => m.dispose() ); }
		mesh = next; mesh.frustumCulled = false; scene.add( mesh ); loadedDirectory = directory;
		helper.add( mesh, { physics: false } );
		const boneMorphs = mesh.geometry.userData.MMD.boneMorphs ?? [];
		morph.replaceChildren( ...boneMorphs.map( m => new Option( `${m.index}: ${m.name}`, String( m.index ) ) ) );
		morph.disabled = weight.disabled = boneMorphs.length === 0;
		reportMorphs();
		baseRotations = mesh.skeleton.bones.map( b => b.quaternion.clone() );
		const types = mesh.geometry.getAttribute( 'mmdSkinningType' ) as BufferAttribute | InterleavedBufferAttribute;
		originalTypes = Float32Array.from( { length: types.count }, ( _, i ) => types.getX( i ) );
		count = Array.from( originalTypes ).filter( type => type === 3 ).length;
		bone.replaceChildren( ...mesh.skeleton.bones.map( ( b, i ) => new Option( `${i}: ${b.name}`, String( i ) ) ) );
		const elbow = mesh.skeleton.bones.findIndex( b => /左ひじ|左肘|elbow/i.test( b.name ) );
		bone.value = String( elbow >= 0 ? elbow : 0 ); comparison.checked = false;
		mesh.updateMatrixWorld( true );
		const box = new Box3().setFromObject( mesh );
		const center = box.getCenter( new Vector3() );
		controls.target.copy( center );
		camera.position.copy( center ).add( new Vector3( 0, 0, Math.max( box.getSize( new Vector3() ).y * 1.7, 10 ) ) ); controls.update();
		report( 'Select an elbow or knee and move Bend to about 60–100°. Toggle BDEF2 to compare the same pose.' );

	} catch ( error ) { status.textContent = String( error ); }

};
bend.oninput = applyBend; axis.onchange = applyBend;
bone.onchange = () => { bend.value = '0'; applyBend(); };
element( 'reset' ).onclick = reset;
comparison.onchange = () => {

	if ( ! mesh || ! originalTypes ) return;
	const types = mesh.geometry.getAttribute( 'mmdSkinningType' ) as BufferAttribute | InterleavedBufferAttribute;
	for ( let i = 0; i < originalTypes.length; i ++ ) types.setX( i, comparison.checked && originalTypes[ i ] === 3 ? 1 : originalTypes[ i ] );
	types.needsUpdate = true; report();

};
element( 'play' ).onclick = async () => {

	try {

		if ( ! mesh ) throw new Error( 'Load a model first.' );
		const motion = await new Promise<AnimationClip>( ( resolve, reject ) => loader.loadAnimation( privateURL( element<HTMLInputElement>( 'motion' ).value, loadedDirectory ), mesh!, resolve, undefined, reject ) );
		reset();
		helper.remove( mesh ); helper.enable( 'ik', true ).enable( 'grant', true );
		helper.add( mesh, { animation: motion, physics: false } ); animation = true;
		report( 'Playing private motion with IK and grants; physics disabled. Stop before adjusting bones.' );

	} catch ( error ) { report( String( error ) ); }

};
element( 'stop' ).onclick = reset;
function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize( innerWidth, innerHeight ); }
addEventListener( 'resize', resize ); resize();
renderer.setAnimationLoop( () => { const delta = clock.getDelta(); if ( mesh ) helper.update( animation ? delta : 0 ); reportMorphs(); controls.update(); effect.render( scene, camera ); } );
