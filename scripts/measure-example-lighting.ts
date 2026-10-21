import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Parser } from 'mmd-parser';
import { assetManifest } from './assets-manifest.ts';
import { inspectGeneLight } from './inspect-gene-light.ts';
import { createExamplesServer } from './serve-examples.ts';
import { removeBrowserDirectory, runBrowser } from '../tests/browser/browser.ts';

// Read only the same public pinned assets as the Examples/capture workflow.
const gene = await inspectGeneLight();
const mikuBytes = await readFile( new URL( '../examples/assets/mmd/miku/miku_v2.pmd', import.meta.url ) );
const mikuBlob = createHash( 'sha1' ).update( `blob ${mikuBytes.length}\0` ).update( mikuBytes ).digest( 'hex' );
assert.equal( mikuBlob, assetManifest.files.find( file => file.path === 'miku/miku_v2.pmd' )!.sha );
const miku = new Parser().parsePmd( mikuBytes.buffer.slice( mikuBytes.byteOffset, mikuBytes.byteOffset + mikuBytes.byteLength ), true );
const implementation = {
	three: JSON.parse( await readFile( new URL( '../node_modules/three/package.json', import.meta.url ), 'utf8' ) ).version as string,
	files: Object.fromEntries( await Promise.all( [ 'examples/scene.ts', 'src/materials/MMDToonMaterial.ts', 'src/loaders/MMDLoader.ts', 'scripts/measure-example-lighting.ts' ].map( async path =>
		[ path, createHash( 'sha256' ).update( await readFile( new URL( '../' + path, import.meta.url ) ) ).digest( 'hex' ) ] ) ) )
};
interface Result { error?: string; models: unknown[]; userAgent: string }
const harness = `<!doctype html><pre id="result">pending</pre><script type="module">
const models=[], errors=[];
const progress=stage=>fetch('/progress?stage='+encodeURIComponent(stage));
try {
 for(const id of ['webgl_loader_mmd_pmx_gene','webgl_loader_mmd_pose']) {
  await progress(id+' loading');
  const frame=document.createElement('iframe');frame.width=256;frame.height=256;frame.style.cssText='position:fixed;left:0;top:0';
  const loaded=new Promise(r=>frame.onload=r);frame.src='/examples/'+id+'.html?backend=webgl';document.body.appendChild(frame);await loaded;
  const page=frame.contentWindow;
  page.addEventListener('error',e=>errors.push(e.message));page.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
  const {mesh,helper,renderer,scene,camera}=await (await page.eval("import('/examples/"+id+".js')")).ready;
  const {RenderTarget}=await page.eval("import('three/webgpu')");
  const {FloatType,LinearSRGBColorSpace,DataTexture,SRGBColorSpace}=await page.eval("import('three')");
  await progress(id+' ready');renderer.setAnimationLoop(null);helper.enable('physics',false);helper.enable('animation',false);
  mesh.pose();mesh.morphTargetInfluences.fill(0);mesh.updateMatrixWorld(true);mesh.skeleton.update();
  renderer.setPixelRatio(1);renderer.setSize(256,256);camera.aspect=1;camera.updateProjectionMatrix();
  for(const c of scene.children)if(c!==mesh && !c.isLight && !c.isCamera)c.visible=false;
  scene.background=null;renderer.setClearColor(0,0);
  const ambient=scene.children.find(c=>c.isAmbientLight),direct=scene.children.find(c=>c.isDirectionalLight);
  renderer.debug.onShaderError=()=>errors.push('shader compilation');
  const source=${JSON.stringify( { gene: gene.materialRecords, miku: miku.materials } )}[id.endsWith('gene')?'gene':'miku'];
  const decode=v=>v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);
  mesh.material.forEach((m,i)=>{for(const [loaded,raw] of [[m.color.toArray(),source[i].diffuse],[m.ambient.toArray(),source[i].ambient],[m.specular.toArray(),source[i].specular]])for(let j=0;j<3;j++)if(Math.abs(loaded[j]-decode(raw[j]))>1e-6)throw new Error('Source/loaded color mismatch '+i);if(m.shininess!==source[i].shininess || m.opacity!==source[i].diffuse[3])throw new Error('Source/loaded power/alpha mismatch '+i);});
  const saved=mesh.material.map(m=>({color:m.color.clone(),ambient:m.ambient.clone(),specular:m.specular.clone(),shininess:m.shininess,map:m.map,matcap:m.matcap,gradientMap:m.gradientMap}));
  function textureStats(tex) {
   if(!tex)return null;
   const image=tex.image, c=page.document.createElement('canvas');c.width=image.width;c.height=image.height;
   const ctx=c.getContext('2d');let data=image.data;if(!data){ctx.drawImage(image,0,0);data=ctx.getImageData(0,0,c.width,c.height).data;}
   const min=[255,255,255],max=[0,0,0],mean=[0,0,0];let n=0;
   for(let i=0;i<data.length;i+=4)if(data[i+3]>0){n++;for(let j=0;j<3;j++){min[j]=Math.min(min[j],data[i+j]);max[j]=Math.max(max[j],data[i+j]);mean[j]+=data[i+j];}}
   return {width:c.width,height:c.height,colorSpace:tex.colorSpace,min,max,mean:mean.map(v=>v/n),visibleTexels:n};
  }
  const materialState=mesh.material.map((m,i)=>({index:i,name:m.name,color:m.color.toArray(),ambient:m.ambient.toArray(),specular:m.specular.toArray(),shininess:m.shininess,opacity:m.opacity,baseTexture:textureStats(m.map),toon:textureStats(m.gradientMap),sphere:!!m.matcap}));
  const white=new DataTexture(new Uint8Array([255,255,255,255]),1,1);white.colorSpace=SRGBColorSpace;white.needsUpdate=true;
  const target=new RenderTarget(256,256,{type:FloatType});target.texture.colorSpace=LinearSRGBColorSpace;
  const canvas=page.document.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d');
  function configure(c) {
   ambient.color.setHex(c.colors?.[0]??0xAAAAAA);direct.color.setHex(c.colors?.[1]??0xffffff);
   ambient.intensity=c.sceneAmbient===false?0:1;direct.intensity=c.directional===false?0:1;
   mesh.material.forEach((m,i)=>{const s=saved[i];m.color.copy(s.color);m.ambient.copy(s.ambient);m.specular.copy(s.specular);m.shininess=s.shininess;
    if(c.diffuse===false)m.color.setRGB(0,0,0);if(c.materialAmbient===false)m.ambient.setRGB(0,0,0);if(c.specular===false)m.specular.setRGB(0,0,0);
    if(c.powerZero)m.shininess=0;
    m.map=s.map;m.mmdTextureColor.set(c.neutralBaseRGB?0:1,c.neutralBaseRGB?0:1,c.neutralBaseRGB?0:1,1);m.mmdTextureColorAdd.set(c.neutralBaseRGB?1:0,c.neutralBaseRGB?1:0,c.neutralBaseRGB?1:0,0);m.matcap=c.noSphere?null:s.matcap;m.gradientMap=c.neutralToon?white:s.gradientMap;
   });
  }
  async function pixels(){await new Promise(r=>page.requestAnimationFrame(r));renderer.setRenderTarget(target);renderer.render(scene,camera);const p=await renderer.readRenderTargetPixelsAsync(target,0,0,256,256);renderer.setRenderTarget(null);return p;}
  configure({});const first=await pixels();const mask=[];for(let i=0;i<first.length;i+=4)if(first[i+3]>0.99)mask.push(i);
  const round=v=>Math.round(v*1e6)/1e6;
  function stats(p,display=false){
   let peak=0,over=0;const mean=[0,0,0],bins=[0,0,0,0,0,0];
   for(const i of mask){let clipped=false;for(let j=0;j<3;j++){const v=p[i+j];mean[j]+=v;peak=Math.max(peak,v);if(v>(display?254:1))clipped=true;
    const thresholds=display?[32,64,128,192,255]:[0.1,0.25,0.5,1,2];let b=thresholds.findIndex(t=>v<t);bins[b<0?5:b]++;
   }if(clipped)over++;}
   return {pixels:mask.length,meanRGB:mean.map(v=>round(v/mask.length)),peak:round(peak),overRangePixels:over,overRangePercent:round(100*over/mask.length),channelHistogram:bins};
  }
  const cases=[
   {name:'white',colors:[0xffffff,0xffffff]}, {name:'current',colors:[0xAAAAAA,0xffffff]}, {name:'gray',colors:[0x888888,0x888888]},
   {name:'bothLightsZero',sceneAmbient:false,directional:false},
   {name:'sceneAmbientOnly',directional:false,materialAmbient:false,specular:false},
   {name:'materialAmbientOnly',sceneAmbient:false,directional:false,diffuse:false,specular:false},
   {name:'directionalDiffuseOnly',sceneAmbient:false,materialAmbient:false,specular:false},
   {name:'directSpecularOnly',sceneAmbient:false,materialAmbient:false,diffuse:false},
   {name:'directSpecularPowerZero',sceneAmbient:false,materialAmbient:false,diffuse:false,powerZero:true},
   {name:'noMaterialAmbient',materialAmbient:false}, {name:'noSceneAmbient',sceneAmbient:false}, {name:'noDirectional',directional:false},
   {name:'noSpecular',specular:false}, {name:'noSphere',noSphere:true}, {name:'neutralToon',neutralToon:true}, {name:'neutralBaseTextureRGB',neutralBaseRGB:true}
  ];
  const measurements=[],linear={};
  for(const c of cases){await progress(id+' '+c.name);configure(c);const p=await pixels();linear[c.name]=p;renderer.render(scene,camera);ctx.clearRect(0,0,256,256);ctx.drawImage(renderer.domElement,0,0);const display=ctx.getImageData(0,0,256,256).data;
   // WebGL target rows are bottom-up; canvas rows are top-down.
   const flipped=new Uint8Array(display.length);for(let y=0;y<256;y++)flipped.set(display.subarray(y*1024,(y+1)*1024),(255-y)*1024);
   measurements.push({case:c.name,settings:c,linear:stats(p),displaySRGB8:stats(flipped,true)});
  }
  const former=new Float32Array(first.length);let sumError=0,repeatError=0;const ablationMaxDelta={noSpecular:0,noSphere:0,neutralToon:0};
  configure({});const repeat=await pixels();
  for(const i of mask)for(let j=0;j<3;j++){
   for(const name of Object.keys(ablationMaxDelta))ablationMaxDelta[name]=Math.max(ablationMaxDelta[name],Math.abs(linear[name][i+j]-linear.current[i+j]));
   former[i+j]=linear.current[i+j]-linear.directionalDiffuseOnly[i+j]*(1-1/Math.PI);
   const sum=linear.sceneAmbientOnly[i+j]+linear.materialAmbientOnly[i+j]+linear.directionalDiffuseOnly[i+j]+linear.directSpecularOnly[i+j];
   sumError=Math.max(sumError,Math.abs(sum-linear.current[i+j]));repeatError=Math.max(repeatError,Math.abs(repeat[i+j]-linear.current[i+j]));
  }
  if(repeatError>1e-5 || sumError>1e-4)throw new Error('Isolation/repeat mismatch '+sumError+' / '+repeatError);
  if(!renderer.backend.isWebGLBackend || errors.length)throw new Error('Backend/runtime error '+errors);
  models.push({page:id,backend:'WebGL2 / SwiftShader',camera:camera.position.toArray(),target:[0,10,0],size:[256,256],pose:'rest; physics and animation disabled; all morph weights zero',toneMapping:renderer.toneMapping,outputColorSpace:renderer.outputColorSpace,materialState,measurements,ablationMaxDelta,sourceToLoadedParametersMatch:true,formerDiffuseDividedByPiCounterfactual:stats(former),maxIsolationSumError:sumError,maxRepeatError:repeatError});
  target.dispose();frame.remove();
 }
 document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({models,userAgent:navigator.userAgent}));
} catch(e){document.getElementById('result').textContent=encodeURIComponent(JSON.stringify({models,error:e.stack||String(e)}));}
</script>`;
const app = createExamplesServer();
const handler = app.listeners( 'request' )[ 0 ];
const server = createServer( ( request, response ) => {

	if ( request.url?.startsWith( '/progress?' ) ) { console.log( new URL( request.url, 'http://localhost' ).searchParams.get( 'stage' ) ); response.end( 'ok' ); }
	else if ( request.url === '/measure' ) response.writeHead( 200, { 'Content-Type': 'text/html' } ).end( harness );
	else handler( request, response );

} );
const temporary = await mkdtemp( join( tmpdir(), 'mmd-lighting-' ) );
try {

	await new Promise<void>( resolve => server.listen( 0, '127.0.0.1', resolve ) );
	const base = `http://127.0.0.1:${( server.address() as import( 'node:net' ).AddressInfo ).port}`;
	const result = await runBrowser<Result>( base + '/measure', join( temporary, 'profile' ), 'light', 300000 );
	assert.equal( result.error, undefined, result.error );
	assert.equal( result.models.length, 2 );
	await writeFile( new URL( '../docs/gene-light-lighting-measurements.json', import.meta.url ), JSON.stringify( {
		method: 'npm run build && npm run examples:assets && node --import tsx scripts/measure-example-lighting.ts', implementation,
		gene: { commit: gene.commit, sha256: gene.modelSha256, materials: gene.materialRecords, materialMorphs: gene.materialMorphs },
		miku: { commit: assetManifest.commit, gitBlob: mikuBlob, materials: miku.materials, toonTextures: miku.toonTextures },
		...result
	}, null, 2 ) + '\n' );
	console.log( 'Wrote docs/gene-light-lighting-measurements.json (real model materials, HDR and display measurements)' );

} finally {

	server.closeAllConnections();
	await new Promise<void>( resolve => server.close( () => resolve() ) );
	await removeBrowserDirectory( temporary );

}
