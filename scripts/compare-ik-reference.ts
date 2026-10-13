// Optional regeneration of public reference outputs. Normal tests use the saved
// JSON and require neither Babylon dependencies nor a network connection.
// See docs/ik-limits.md for the pinned source/dependency preparation commands.
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const directory = process.argv[ 2 ];
if ( ! directory ) throw new Error( 'Usage: node --import tsx scripts/compare-ik-reference.ts <reference-directory>' );
await readFile( resolve( directory, 'ikChainInfo.ts' ) );
const revision = 'ccb750db2998ed1067017eaf67f3fc987cfba6f8';
const harness = `
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { IkSolver } from './ikSolver';
class Bone {
 constructor(position, parentBone = null) { this.position=Vector3.FromArray(position); this.parentBone=parentBone; this.ikChainInfo=null; }
 world() {
  const info=this.ikChainInfo;
  const q=info ? info.ikRotation.multiply(info.localRotation) : Quaternion.Identity();
  const local=Matrix.Compose(Vector3.One(),q,this.position);
  return this.parentBone ? local.multiply(this.parentBone.world()) : local;
 }
 getWorldTranslationToRef(out) { const m=this.world().m;out.set(m[12],m[13],m[14]);return out; }
 getWorldMatrixToRef(out) { out.copyFrom(this.world());return out; }
 updateWorldMatrix() {} updateIkChainWorldMatrix() {}
}
const cases=[];
for(const axis of [0,1,2]) for(const authoredAngle of [0,0.25]) {
 const rest=[0,0,0];rest[(axis+1)%3]=1;
 const target=rest.slice(), a=(axis+1)%3,b=(axis+2)%3;
 target[a]=Math.cos(0.7)*rest[a]-Math.sin(0.7)*rest[b];target[b]=Math.sin(0.7)*rest[a]+Math.cos(0.7)*rest[b];
 const flip=v=>[v[0],v[1],-v[2]];
 const link=new Bone([0,0,0]), effector=new Bone(flip(rest),link), goal=new Bone(flip(target));
 const solver=new IkSolver(0,goal,effector);solver.iteration=80;solver.limitAngle=0.2;
 const minimumAngle=[0,0,0],maximumAngle=[0,0,0];minimumAngle[axis]=axis<2?-Math.PI:0;maximumAngle[axis]=axis<2?0:Math.PI;
 solver.addIkChain(link,false,{minimumAngle,maximumAngle});
 const basis=Vector3.Zero();if(axis===0)basis.x=1;else if(axis===1)basis.y=1;else basis.z=1;
 link.ikChainInfo.localRotation.copyFrom(Quaternion.RotationAxis(basis,axis<2?-authoredAngle:authoredAngle));
 solver.solve(false);
 const q=link.ikChainInfo.ikRotation.multiply(link.ikChainInfo.localRotation), p=effector.getWorldTranslationToRef(Vector3.Zero());
 cases.push({axis,rest,target,authoredAngle,iteration:80,maxAngle:0.2,quaternion:[-q.x,-q.y,q.z,q.w],effector:flip(p.asArray())});
}
process.stdout.write(JSON.stringify({runtime:'babylon-mmd',revision:'${revision}',mathDependency:'@babylonjs/core@9.30.0',coordinateSystem:'right-handed; reflect Z positions and negate quaternion X/Y from Babylon inputs/outputs',cases},null,2)+'\\n');
`;
const entry = resolve( directory, 'reference-entry.ts' ), output = resolve( directory, 'reference-bundle.mjs' );
await writeFile( entry, harness );
await build( { entryPoints: [ entry ], outfile: output, bundle: true, platform: 'node', format: 'esm' } );
const result = execFileSync( process.execPath, [ output ], { encoding: 'utf8' } );
// Fail if the harness/runtime produced nonfinite JSON values.
const parsed = JSON.parse( result ) as { cases: { effector: number[]; quaternion: number[] }[] };
if ( parsed.cases.some( c => [ ...c.effector, ...c.quaternion ].some( v => typeof v !== 'number' || ! Number.isFinite( v ) ) ) ) throw new Error( 'Nonfinite reference result' );
await writeFile( new URL( '../tests/ik-reference-fixtures.json', import.meta.url ), result );
process.stdout.write( `Saved ${parsed.cases.length} pinned reference cases.\n` );
