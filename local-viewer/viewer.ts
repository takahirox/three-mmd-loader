import { AmbientLight, Box3, Clock, Color, DataTexture, NearestFilter, RepeatWrapping, DirectionalLight, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import type { AnimationClip, BufferAttribute, InterleavedBufferAttribute, Texture } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MMDAnimationHelper, MMDLoader, MMDOutlineEffect } from 'three-mmd-loader';
import type { MMDMesh } from 'three-mmd-loader';

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
let basePositions: Vector3[] = [];
const grants = element<HTMLInputElement>( 'grants' );
const translation = element<HTMLInputElement>( 'translation' );
const grantInfo = element<HTMLPreElement>( 'grant-info' );
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
const group = element<HTMLSelectElement>( 'group' );
const groupWeight = element<HTMLInputElement>( 'group-weight' );
const groupTarget = element<HTMLSelectElement>( 'group-target' );
const targetWeight = element<HTMLInputElement>( 'target-weight' );
const groupInfo = element<HTMLPreElement>( 'group-info' );
const materialMorph = element<HTMLSelectElement>( 'material-morph' );
const materialWeight = element<HTMLInputElement>( 'material-weight' );
const materialInfo = element<HTMLPreElement>( 'material-info' );
const uvMorph = element<HTMLSelectElement>( 'uv-morph' );
const uvWeight = element<HTMLInputElement>( 'uv-weight' );
const uvInfo = element<HTMLPreElement>( 'uv-info' );
const checker = element<HTMLInputElement>( 'checker' );
const pixels = new Uint8Array( 8 * 8 * 4 );
for ( let y = 0; y < 8; y ++ ) for ( let x = 0; x < 8; x ++ ) pixels.set( [ x % 2 ? 240 : 40, y % 2 ? 180 : 30, x < y ? 220 : 60, 255 ], ( y * 8 + x ) * 4 );
const checkerMap = new DataTexture( pixels, 8, 8 );
checkerMap.minFilter = checkerMap.magFilter = NearestFilter;
checkerMap.wrapS = checkerMap.wrapT = RepeatWrapping;
checkerMap.flipY = false; checkerMap.needsUpdate = true;
let originalMaps: ( Texture | null )[] = [];
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
	helper.enable( 'ik', false ).enable( 'grant', grants.checked );
	animation = false;

}
function reset() {

	stop();
	if ( mesh ) helper.pose( mesh, { metadata: { boneCount: 0, parentFile: '', coordinateSystem: 'right' }, bones: [] }, { ik: false, grant: false } );
	bend.value = translation.value = '0'; element( 'degrees' ).textContent = '0°';
	mesh?.morphTargetInfluences?.fill( 0 );
	helper.update( 0 ); reportMorphs();

}
function applyBend() {

	stop();
	if ( ! mesh ) return;
	// Restore before authored controls, including values equal to the last output.
	helper.pose( mesh, { metadata: { boneCount: 0, parentFile: '', coordinateSystem: 'right' }, bones: [] }, { ik: false, grant: false } );
	const index = Number( bone.value );
	mesh.skeleton.bones[ index ].position.copy( basePositions[ index ] ).add( new Vector3( Number( translation.value ), 0, 0 ) );
	const degrees = Number( bend.value );
	const direction = axis.value === 'x' ? new Vector3( 1, 0, 0 ) : axis.value === 'y' ? new Vector3( 0, 1, 0 ) : new Vector3( 0, 0, 1 );
	mesh.skeleton.bones[ index ].quaternion.copy( baseRotations[ index ] ).multiply( new Quaternion().setFromAxisAngle( direction, degrees * Math.PI / 180 ) );
	element( 'degrees' ).textContent = `${degrees}°`;
	helper.update( 0 ); reportGrants();
	report( `Bending ${mesh.skeleton.bones[ index ].name}. Drag to orbit; scroll to zoom.` );

}
function reportGroups() {

	const groups = mesh?.geometry.userData.MMD.groupMorphs ?? [];
	const lines: HTMLElement[] = [];
	let boneLinks = 0;
	for ( const g of groups ) {

		const heading = document.createElement( 'span' );
		heading.textContent = `${g.index}: ${g.name} (type 0), weight ${mesh!.morphTargetInfluences![ g.index ].toFixed( 2 )}\n`;
		lines.push( heading );
		for ( const e of g.elements ) {

			const line = document.createElement( 'span' );
			const supported = ( e.type !== null && e.type >= 1 && e.type <= 8 ) && Number.isFinite( e.ratio );
			line.textContent = `  → ${e.index}: ${e.name ?? 'missing'} (type ${e.type ?? 'invalid'}), ratio ${e.ratio}${supported ? '' : ' — ignored/unsupported'}\n`;
			if ( e.type === 2 && supported ) {

				boneLinks ++; line.className = 'bone-link';
				const target = mesh!.geometry.userData.MMD.boneMorphs?.find( m => m.index === e.index );
				line.textContent += target?.elements.map( b => `    Bone ${b.index}: ${mesh!.skeleton.bones[ b.index ]?.name ?? 'missing'}\n` ).join( '' ) ?? '';

			}
			lines.push( line );

		}

	}
	const diagnostic = document.createElement( 'span' );
	diagnostic.textContent = ( boneLinks ? `${boneLinks} group → bone links. Bone links highlighted.` : 'No group → bone relation is present in this PMX.' ) + '\nNested groups are ignored; vertex, bone, UV and material links are supported. Extra UV channels require a shader consumer.';
	groupInfo.replaceChildren( ...lines, diagnostic );
	groupWeight.value = String( mesh?.morphTargetInfluences?.[ Number( group.value ) ] ?? 0 );
	targetWeight.value = String( mesh?.morphTargetInfluences?.[ Number( groupTarget.value ) ] ?? 0 );
	element( 'group-weight-value' ).textContent = Number( groupWeight.value ).toFixed( 2 );
	element( 'target-weight-value' ).textContent = Number( targetWeight.value ).toFixed( 2 );

}
function selectGroup() {

	const selected = mesh?.geometry.userData.MMD.groupMorphs?.find( g => g.index === Number( group.value ) );
	const targets = new Map( selected?.elements.filter( e => ( e.type !== null && e.type >= 1 && e.type <= 8 ) && Number.isFinite( e.ratio ) ).map( e => [ e.index, e ] ) );
	groupTarget.replaceChildren( ...Array.from( targets.values(), e => new Option( `${e.index}: ${e.name} (type ${e.type})`, String( e.index ) ) ) );
	groupTarget.disabled = targetWeight.disabled = targets.size === 0;
	reportGroups();

}
function setWeight( select: HTMLSelectElement, slider: HTMLInputElement ) {

	if ( ! mesh || select.disabled ) return;
	stop(); mesh.morphTargetInfluences![ Number( select.value ) ] = Number( slider.value );
	helper.update( 0 ); reportMorphs();

}
group.onchange = selectGroup;
groupTarget.onchange = reportGroups;
groupWeight.oninput = () => setWeight( group, groupWeight );
targetWeight.oninput = () => setWeight( groupTarget, targetWeight );
function reportMaterials() {

	const morphs = mesh?.geometry.userData.MMD.materialMorphs ?? [];
	materialWeight.value = String( mesh?.morphTargetInfluences?.[ Number( materialMorph.value ) ] ?? 0 );
	element( 'material-weight-value' ).textContent = Number( materialWeight.value ).toFixed( 2 );
	if ( ! morphs.length ) {

		materialInfo.textContent = mesh ? 'Warning: this PMX has no type 8 material morph. Choose a verified candidate.' : 'Load a PMX to enumerate its actual type 8 material morphs.';
		return;

	}
	materialInfo.textContent = morphs.map( m => `${m.index}: ${m.name} (type 8), weight ${mesh!.morphTargetInfluences![ m.index ].toFixed( 2 )}\n` + m.elements.map( e => `  Material ${e.index}: ${e.index === - 1 ? 'all materials' : mesh!.material[ e.index ]?.name ?? 'invalid'}; mode ${e.type === 0 ? 'multiply' : e.type === 1 ? 'add' : 'invalid'}\n    ${JSON.stringify( e )}` ).join( '\n' ) ).join( '\n' ) + '\n\nEvaluated material / outline parameters:\n' + mesh!.material.map( ( m, i ) => `${i}: ${m.name}\n${JSON.stringify( { values: m.userData.MMD.materialMorph ?? m.userData.MMD.materialBase, color: m.color.toArray(), emissive: m.emissive.toArray(), opacity: m.opacity, transparent: m.transparent, side: m.side, depthWrite: m.depthWrite, outline: m.userData.outlineParameters } )}` ).join( '\n' );

}
materialMorph.onchange = reportMaterials;
materialWeight.oninput = () => setWeight( materialMorph, materialWeight );
function reportUVs() {

	const morphs = mesh?.geometry.userData.MMD.uvMorphs ?? [];
	uvWeight.value = String( mesh?.morphTargetInfluences?.[ Number( uvMorph.value ) ] ?? 0 );
	element( 'uv-weight-value' ).textContent = Number( uvWeight.value ).toFixed( 2 );
	uvInfo.textContent = morphs.length ? morphs.map( m => {

		const base = mesh!.geometry.userData.MMD.uvBases?.[ m.channel ];
		const a = mesh!.geometry.getAttribute( m.channel ? `mmdAdditionalUV${m.channel}` : 'uv' );
		const links = mesh!.geometry.userData.MMD.groupMorphs?.flatMap( g => g.elements.filter( e => e.index === m.index ).map( e => `${g.name} × ${e.ratio}` ) ) ?? [];
		return `${m.index}: ${m.name} (type ${m.channel + 3}), channel ${m.channel}; ${m.elements.filter( e => e.uv.some( v => Number.isFinite( v ) && v !== 0 ) ).length} nonzero elements\nGroups: ${links.join( ', ' ) || 'none'}\n` + m.elements.slice( 0, 200 ).map( e => {

			const valid = a && e.index >= 0 && e.index < a.count;
			const current = valid ? [ a.getX( e.index ), a.getY( e.index ), ...( m.channel ? [ a.getZ( e.index ), a.getW( e.index ) ] : [] ) ] : [];
			return `  Vertex ${e.index}, offset xyzw [${e.uv}]; base [${base?.slice( e.index * 4, e.index * 4 + 4 ) ?? 'absent'}]; morphed [${current}]`;

		} ).join( '\n' );

	} ).join( '\n\n' ) + '\nUV0 samples xy only (offset z/w retained above). Extra UV1–4 are vec4 data; default material has no consumer. First 200 elements per morph shown.' : 'No type 3–7 UV morph is present.';

}
uvMorph.onchange = reportUVs;
uvWeight.oninput = () => setWeight( uvMorph, uvWeight );
checker.onchange = () => {

	mesh?.material.forEach( ( m, i ) => { m.map = checker.checked ? checkerMap : originalMaps[ i ]; m.needsUpdate = true; } );

};
function reportMorphs() {

	reportGroups(); reportMaterials(); reportUVs();

	const boneMorphs = mesh?.geometry.userData.MMD.boneMorphs ?? [];
	if ( ! boneMorphs.length ) {

		morphInfo.textContent = mesh ? 'No type 2 bone morph is present in this PMX. Inspect type 3–7 in the UV panel.' : 'Load a PMX to enumerate its actual type 2 bone morphs.';
		weight.value = '0'; element( 'weight-value' ).textContent = '0.00'; return;

	}
	const selected = Number( morph.value );
	const selectedWeight = mesh!.morphTargetInfluences![ selected ];
	weight.value = String( selectedWeight ); element( 'weight-value' ).textContent = selectedWeight.toFixed( 2 );
	morphInfo.textContent = boneMorphs.map( m => {

		const lines = m.elements.map( e => `  Bone ${e.index}: ${mesh!.skeleton.bones[ e.index ]?.name ?? 'missing'}\n    translation: [${e.position.join( ', ' )}]\n    rotation (xyzw): [${e.rotation.join( ', ' )}]` );
		return `${m.index}: ${m.name} — weight ${mesh!.morphTargetInfluences![ m.index ].toFixed( 2 )}\n${lines.join( '\n' )}`;

	} ).join( '\n\n' ) + '\n\nDirect type 2 controls. Group links to vertex/bone/material targets are supported; UV morph dispatch is supported. Values are in right-handed local space.';

}
morph.onchange = reportMorphs;
weight.oninput = () => {

	const value = Number( weight.value ); stop();
	if ( ! mesh || morph.disabled ) return;
	mesh.morphTargetInfluences![ Number( morph.value ) ] = value;
	helper.update( 0 ); reportMorphs();
	report( `Bone morph ${morph.selectedOptions[ 0 ].text}: weight ${value.toFixed( 2 )}.` );

};
async function loadModel( generated: boolean | 'grant' = false ) {

	try {

		status.textContent = 'Loading local PMX and textures…';
		const directory = assetDirectory.value;
		const next = await loader.loadAsync( generated ? ( generated === 'grant' ? '/local-sdef/generated-grant.pmx' : '/local-sdef/generated-uv.pmx' ) : privateURL( element<HTMLInputElement>( 'model' ).value, directory ) );
		reset();
		if ( mesh ) { helper.remove( mesh ); scene.remove( mesh ); mesh.geometry.dispose(); mesh.skeleton.dispose(); mesh.material.forEach( m => m.dispose() ); }
		mesh = next; mesh.frustumCulled = false; scene.add( mesh ); loadedDirectory = directory;
		helper.add( mesh, { physics: false } );
		originalMaps = mesh.material.map( m => m.map ); checker.checked = generated === true; checker.onchange!( new Event( 'change' ) );
		const uvs = mesh.geometry.userData.MMD.uvMorphs ?? [];
		uvMorph.replaceChildren( ...uvs.map( m => new Option( `${m.index}: ${m.name} (UV${m.channel})`, String( m.index ) ) ) );
		uvMorph.disabled = uvWeight.disabled = uvs.length === 0;
		const materials = mesh.geometry.userData.MMD.materialMorphs ?? [];
		materialMorph.replaceChildren( ...materials.map( m => new Option( `${m.index}: ${m.name}`, String( m.index ) ) ) );
		materialMorph.disabled = materialWeight.disabled = materials.length === 0;
		const boneMorphs = mesh.geometry.userData.MMD.boneMorphs ?? [];
		morph.replaceChildren( ...boneMorphs.map( m => new Option( `${m.index}: ${m.name}`, String( m.index ) ) ) );
		morph.disabled = weight.disabled = boneMorphs.length === 0;
		const groups = mesh.geometry.userData.MMD.groupMorphs ?? [];
		group.replaceChildren( ...groups.map( g => new Option( `${g.index}: ${g.name}`, String( g.index ) ) ) );
		group.disabled = groupWeight.disabled = groups.length === 0;
		const folding = groups.find( g => g.name === 'たたむ全' );
		if ( folding ) group.value = String( folding.index );
		selectGroup(); reportMorphs();
		basePositions = mesh.skeleton.bones.map( b => b.position.clone() );
		baseRotations = mesh.skeleton.bones.map( b => b.quaternion.clone() );
		const types = mesh.geometry.getAttribute( 'mmdSkinningType' ) as BufferAttribute | InterleavedBufferAttribute;
		originalTypes = Float32Array.from( { length: types.count }, ( _, i ) => types.getX( i ) );
		count = Array.from( originalTypes ).filter( type => type === 3 ).length;
		bone.replaceChildren( ...mesh.skeleton.bones.map( ( b, i ) => new Option( `${i}: ${b.name}`, String( i ) ) ) );
		const elbow = mesh.skeleton.bones.findIndex( b => /左ひじ|左肘|elbow/i.test( b.name ) );
		bone.value = String( elbow >= 0 ? elbow : 0 ); comparison.checked = false;
		grants.checked = generated === 'grant'; helper.enable( 'grant', grants.checked );
		if ( generated === 'grant' ) bone.value = '6';
		helper.update( 0 ); reportGrants();
		mesh.updateMatrixWorld( true );
		const box = new Box3().setFromObject( mesh );
		const center = box.getCenter( new Vector3() );
		controls.target.copy( center );
		camera.position.copy( center ).add( new Vector3( 0, 0, Math.max( box.getSize( new Vector3() ).y * 1.7, 10 ) ) ); controls.update();
		report( 'Select an elbow or knee and move Bend to about 60–100°. Toggle BDEF2 to compare the same pose.' );

	} catch ( error ) { status.textContent = String( error ); }

}
element( 'load' ).onclick = () => loadModel();
element( 'generated-grant' ).onclick = () => loadModel( 'grant' );
translation.oninput = applyBend;
grants.onchange = () => { helper.enable( 'grant', grants.checked ).update( 0 ); reportGrants(); };
element( 'generated-uv' ).onclick = () => loadModel( true );
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
renderer.setAnimationLoop( () => { const delta = clock.getDelta(); if ( mesh ) helper.update( animation ? delta : 0 ); reportMorphs(); reportGrants(); controls.update(); effect.render( scene, camera ); } );

function reportGrants() {

	if ( ! mesh ) return;
	const data = mesh.geometry.userData.MMD;
	const counts = { globalRotation: 0, globalPosition: 0, localRotation: 0, localPosition: 0 };
	const lines: HTMLElement[] = [];
	for ( const g of data.grants ) {

		if ( g.affectRotation ) counts[ g.isLocal ? 'localRotation' : 'globalRotation' ] ++;
		if ( g.affectPosition ) counts[ g.isLocal ? 'localPosition' : 'globalPosition' ] ++;
		const source = mesh.skeleton.bones[ g.parentIndex ], target = mesh.skeleton.bones[ g.index ];
		const line = document.createElement( 'span' );
		line.className = 'bone-link';
		line.textContent = `${g.parentIndex}: ${source?.name ?? 'missing'} → ${g.index}: ${target?.name ?? 'missing'}; isLocal=${g.isLocal}; rotation=${g.affectRotation}; position=${g.affectPosition}; ratio=${g.ratio}; class=${g.transformationClass}; ${( data.bones[ g.index ].flag ?? 0 ) & 0x1000 ? 'post' : 'pre'}-physics\n` +
			`  Target position [${target?.position.toArray().map( v => v.toFixed( 4 ) )}], quaternion [${target?.quaternion.toArray().map( v => v.toFixed( 4 ) )}]\n`;
		lines.push( line );

	}
	const summary = document.createElement( 'span' );
	summary.textContent = `Grant counts: ${JSON.stringify( counts )}\n` +
		( counts.globalPosition + counts.localPosition ? '' : 'No position grants present.\n' ) +
		( counts.localRotation + counts.localPosition ? '' : 'No local grants present.\n' ) +
		'Flags are parsed from this PMX; counts and transforms are diagnostics, not a visual pass. Physics disabled in this viewer.\n';
	grantInfo.replaceChildren( summary, ...lines );

}
