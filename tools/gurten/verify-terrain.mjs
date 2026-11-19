// Run from any directory:
//   node tools/gurten/verify-terrain.mjs [path/to/Scene] [--report results.json]
// Uses the real terrain/ground builders in memory; no browser or sensors needed.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const args=process.argv.slice(2),reportAt=args.indexOf('--report');
let report;
if(reportAt>=0){
 if(!args[reportAt+1])throw Error('--report requires a file path');
 report=path.resolve(args[reportAt+1]);args.splice(reportAt,2);
}
if(args.length>1||args.some(a=>a.startsWith('--')))throw Error('Usage: node verify-terrain.mjs [Scene folder] [--report results.json]');
const here=path.dirname(fileURLToPath(import.meta.url));
const scene=path.resolve(args[0]??path.join(here,'../../src/MTBIndoorBern/Scene'));
const loadModule=name=>import(pathToFileURL(path.join(scene,name)).href);
const [T,{addSurveyTrees,buildSurveyRoad,surfaceAt},{ForestRenderer}]=await Promise.all([
 loadModule('vendor/three.module.js'),loadModule('course-details.js'),loadModule('forest.js')
]);
const catalog=JSON.parse(fs.readFileSync(path.join(scene,'courses.json'),'utf8'));
const results=[];

for(const info of catalog){
 const folder=path.join(scene,info.folder);
 if(!['route.json','world.json','appearance.json'].every(name=>fs.existsSync(path.join(folder,name))))continue;
 const get=name=>JSON.parse(fs.readFileSync(path.join(folder,`${name}.json`),'utf8'));
 const r={course:get('route'),world:{...get('world'),trees:[]},survey:get('appearance'),scene:new T.Scene(),aerial:new T.Texture(),
  surveyMaterials:Object.fromEntries(['asphalt','gravel','leaves','earth','floor'].map(kind=>[kind,new T.MeshBasicMaterial()]))};
 r.at=ForestRenderer.prototype.at.bind(r);r.height=ForestRenderer.prototype.height.bind(r);r.uv=ForestRenderer.prototype.uv.bind(r);
 if(info.features){
  const {gurtenLiftAt,gurtenWidthAt}=await loadModule('gurten-features.js');
  r.gurtenFeatures=JSON.parse(fs.readFileSync(path.join(folder,info.features),'utf8'));
  r.featureHeight=d=>gurtenLiftAt(d,r.gurtenFeatures);r.featureWidth=(d,w)=>gurtenWidthAt(d,r.gurtenFeatures,w);
 }
 addSurveyTrees(r);
 ForestRenderer.prototype.buildTerrain.call(r);
 const g=r.world.terrain,chunkCount=Math.ceil((g.nx-1)/64)*Math.ceil((g.nz-1)/64),retained=new Set();
 // Each terrain cell has two indexed triangles. Read actual built geometry,
 // rather than reproducing the predicate whose regression this detects.
 for(const mesh of r.scene.children.slice(0,chunkCount)){
  const p=mesh.geometry.getAttribute('position'),index=mesh.geometry.index.array;
  for(let i=0;i<index.length;i+=6){const a=index[i];retained.add(`${Math.round((p.getX(a)-g.x0)/g.spacing)},${Math.round((p.getZ(a)-g.z0)/g.spacing)}`);}
 }
 buildSurveyRoad(r);
 const fine=new Set(),fineGeometry=r.localGroundMesh.geometry,finePositions=fineGeometry.getAttribute('position'),fineIndex=fineGeometry.index.array;
 for(let i=0;i<fineIndex.length;i+=6){const a=fineIndex[i];fine.add(`${Math.round(finePositions.getX(a)/2)},${Math.round(finePositions.getZ(a)/2)}`);}
 let removedCells=0,uncoveredFineCellIntersections=0;
 for(let iz=0;iz<g.nz-1;iz++)for(let ix=0;ix<g.nx-1;ix++){
  if(retained.has(`${ix},${iz}`))continue;
  removedCells++;
  const x=g.x0+ix*g.spacing,z=g.z0+iz*g.spacing;
  for(let fz=Math.floor(z/2);fz<Math.ceil((z+g.spacing)/2);fz++)for(let fx=Math.floor(x/2);fx<Math.ceil((x+g.spacing)/2);fx++)
   if(!fine.has(`${fx},${fz}`))uncoveredFineCellIntersections++;
 }
 let roadSurfaceSamples=0,coarseOverRoad=0;
 for(let d=0;d<r.course.length;d+=.5){
  const p=r.at(d),a=r.at(Math.max(0,d-.5)),b=r.at(Math.min(r.course.length,d+.5)),dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1;
  const width=r.featureWidth?.(d,surfaceAt(r,d).width)??surfaceAt(r,d).width;
  for(const off of [-width/2,0,width/2]){
   const x=p.x-dz/len*off,z=p.z+dx/len*off,ix=Math.floor((x-g.x0)/g.spacing),iz=Math.floor((z-g.z0)/g.spacing);
   if(retained.has(`${ix},${iz}`))coarseOverRoad++;
   roadSurfaceSamples++;
  }
 }
 const result={course:info.id,status:uncoveredFineCellIntersections===0&&coarseOverRoad===0?'PASS':'FAIL',coarseSpacingM:g.spacing,
  removedCells,uncoveredFineCellIntersections,roadSurfaceSamples,coarseOverRoad};
 results.push(result);console.log(JSON.stringify(result));
}
assert.ok(results.length,'No installed courses with route, terrain and appearance were found');
const summary={method:'Actual generated terrain and fine-ground geometry: every fine cell intersecting a removed coarse square exists; road centre and both edges sampled every 0.5m exclude retained coarse terrain',results};
if(report){fs.mkdirSync(path.dirname(report),{recursive:true});fs.writeFileSync(report,JSON.stringify(summary,null,2)+'\n');}
assert.ok(results.every(r=>r.status==='PASS'),'Terrain coverage regression; see per-course results');
