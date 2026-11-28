// CPU-only invariants for the Dentenberg visual layer. No renderer, sensors,
// recording frames or private route data are required by the default suite.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import * as T from '../../src/MTBIndoorBern/Scene/vendor/three.module.js';
import {ForestRenderer} from '../../src/MTBIndoorBern/Scene/forest.js';
import {addSurveyTrees,buildSurveyRoad,loadSurvey,surfaceAt} from '../../src/MTBIndoorBern/Scene/course-details.js';
import {prepareDentenbergWoodland,selectDentenbergTrees,buildDentenbergWoodland,updateDentenbergWoodland,prewarmDentenbergWoodland} from '../../src/MTBIndoorBern/Scene/dentenberg-woodland.js';
import {WOODLAND_LIMITS,forestWeight,woodlandTreeStyle,indexWoodland,collectNearby} from '../../src/MTBIndoorBern/Scene/dentenberg-profile.js';
import {syntheticCourse,rendererFixture,installCanvasStub} from './fixtures.mjs';

const args=process.argv.slice(2),privateIndex=args[0]==='--course'?0:-1;
if(args.length!==0&&(args.length!==2||privateIndex!==0||!args[1]))throw Error('Usage: node tools/dentenberg/verify-woodland.mjs [--course <local course directory>]');
const restoreCanvas=installCanvasStub(),originalLoad=T.TextureLoader.prototype.loadAsync;
T.TextureLoader.prototype.loadAsync=async()=>new T.Texture({width:16,height:16});
const report={ok:true,synthetic:null,privateCourse:'not requested',optionalAssets:null,otherCourses:null};
const isForest=(engine,d)=>engine.survey.segments.some(segment=>segment.forest&&d>=segment.from&&d<segment.to);
const items=chunks=>[...chunks.values()].flat();
const visibleInScene=object=>{for(let node=object;node;node=node.parent)if(!node.visible)return false;return true;};

function assertSameRoad(before,after){
 const a=before.roadMesh.geometry.attributes.position,b=after.roadMesh.geometry.attributes.position;
 assert.equal(a.count,b.count,'visual styling does not change route sampling');
 const ps=after.roadPoints??after.course.points;
 assert.equal(b.count,ps.length*5);
 for(let row=0;row<ps.length;row++)for(let col=0;col<5;col++){
  const index=row*5+col;
  assert.ok(a.getY(index)===b.getY(index),'every road vertex retains its original elevation');
  if(col===2||!surfaceAt(after,ps[row].d).forest){
   assert.ok(a.getX(index)===b.getX(index)&&a.getZ(index)===b.getZ(index),'centreline and open-road geometry remain unchanged');
  }
 }
 for(let row=0;row<ps.length;row++){
  const q=ps[row],index=row*5+2;
  assert.ok(b.getX(index)===Math.fround(q.x)&&b.getZ(index)===Math.fround(q.z),'the road centre follows the source route exactly');
  assert.ok(b.getY(index)===Math.fround(q.y+.062),'the existing visual lift is retained, without adding slope changes');
 }
}

async function buildFixture(data,{enabled=true,videoFloor=false}={}){
 const r=rendererFixture(data,{videoFloor});
 if(!enabled)ForestRenderer.prototype.setDentenbergWoodlandEnabled.call(r,false);
 await prepareDentenbergWoodland(r);addSurveyTrees(r);selectDentenbergTrees(r);buildSurveyRoad(r);buildDentenbergWoodland(r);
 return r;
}

async function verifyCourse(data,label){
 const courseBefore=JSON.stringify(data.course),worldBefore=JSON.stringify(data.world),surveyBefore=JSON.stringify(data.survey);
 const before=await buildFixture(data,{enabled:false}),after=await buildFixture(data);
 assert.equal(before.dentenbergWoodland,undefined,'the comparison switch retains the previous renderer path');
 assert.ok(after.dentenbergWoodland,'the Dentenberg visual layer is enabled');
 assertSameRoad(before,after);
 assert.equal(JSON.stringify(data.course),courseBefore,'route positions, distances, elevations and gradients are immutable');
 assert.equal(JSON.stringify(data.world),worldBefore,'source world data is not rewritten');
 assert.equal(JSON.stringify(data.survey),surveyBefore,'observed and inferred survey boundaries are not rewritten');
 const state=after.dentenbergWoodland,retained=new Set(after.world.trees.map(tree=>JSON.stringify(tree)));
 assert.ok(state.totalTrees>0&&state.totalShrubs>0&&state.totalFerns>0,'the fixture exercises actual new vegetation');
 assert.equal(state.trees.length+after.world.trees.length,before.world.trees.length,'replaced trees are neither duplicated nor dropped');
 for(const tree of before.world.trees){
  const nearest=after.nearestRoad(tree[0],tree[2]);
  const replaced=isForest(after,nearest.d)&&nearest.distance<=WOODLAND_LIMITS.lateralLimit;
  assert.equal(retained.has(JSON.stringify(tree)),!replaced,'only trees in the forest corridor leave the legacy renderer');
 }
 for(const tree of state.trees){
  const nearest=after.nearestRoad(tree.x,tree.z);
  assert.ok(isForest(after,nearest.d)&&nearest.distance<=WOODLAND_LIMITS.lateralLimit,'replacement tree centres stay inside the forest corridor');
  assert.ok([tree.x,tree.y,tree.z,tree.height,tree.yaw,tree.spread].every(Number.isFinite));
 }
 for(const [kind,chunks] of [['shrubs',state.shrubChunks],['ferns',state.fernChunks],['litter',state.litterChunks]])for(const item of items(chunks)){
  assert.ok([item.x,item.y,item.z,item.size,item.yaw].every(Number.isFinite),'finite understory transforms');
  assert.ok(isForest(after,after.nearestRoad(item.x,item.z).d),kind+' centres remain in the forest survey');
 }
 const ground=after.localGroundMesh.geometry,road=after.roadMesh.geometry;
 assert.equal(ground.attributes.woodlandFade.count,ground.attributes.position.count,'forest blending covers the existing ground mesh');
 assert.equal(ground.attributes.woodlandPhotoUv.count,ground.attributes.position.count);
 assert.ok([...ground.attributes.woodlandFade.array].every(value=>Number.isFinite(value)&&value>=0&&value<=1));
 assert.equal(road.attributes.woodlandTrail.count,road.attributes.position.count,'worn trail shader uses the existing ribbon');
 const pool=[...state.kits.flatMap(kit=>[kit.wood,kit.leaves]),state.shrubLeaves,state.shrubTrunks,state.ferns,state.litter,...state.far];
 for(const mesh of pool)for(const name of ['position','normal'])assert.ok([...mesh.geometry.attributes[name].array].every(Number.isFinite),'finite vegetation positions and normals');
 const identities=pool.map(mesh=>[mesh.uuid,mesh.geometry.uuid,mesh.material.uuid]),children=state.group.children.length,chunks=state.chunkCount;
 const maxima={trees:0,shrubs:0,ferns:0,litter:0};
 const sequence=[...Array.from({length:36},(_,i)=>i*data.course.length/35),...data.survey.segments.filter(s=>s.forest).map(s=>(s.from+s.to)/2).reverse(),0,data.course.length];
 for(let i=0;i<sequence.length;i++){
  if(i%7===0)after.lastPresentationEpoch='seek-'+i;
  updateDentenbergWoodland(after,sequence[i]);
  assert.ok(state.nearTrees<=WOODLAND_LIMITS.treeBudget&&state.nearShrubs<=WOODLAND_LIMITS.shrubBudget&&state.nearFerns<=WOODLAND_LIMITS.fernBudget,'all near pools remain bounded during riding and seeking');
  assert.equal(state.kits.reduce((count,kit)=>count+kit.wood.count,0),state.nearTrees,'variant pools share the total tree budget');
  assert.equal(state.kits.reduce((count,kit)=>count+kit.leaves.count,0),state.nearTrees);
  assert.equal(state.shrubLeaves.count,state.nearShrubs);assert.equal(state.shrubTrunks.count,state.nearShrubs);assert.equal(state.ferns.count,state.nearFerns);assert.ok(state.litter.count<=100);
  assert.deepEqual(pool.map(mesh=>[mesh.uuid,mesh.geometry.uuid,mesh.material.uuid]),identities,'movement reuses the fixed meshes, geometries and materials');
  assert.equal(state.group.children.length,children);assert.equal(state.chunkCount,chunks,'seeking cannot accumulate new spatial chunks');
  for(const mesh of pool)assert.ok([...mesh.instanceMatrix.array].every(Number.isFinite),'every uploaded instance matrix is finite');
  for(const tree of state.nearSet){const matrix=new T.Matrix4();tree.far.getMatrixAt(tree.farIndex,matrix);assert.ok(new T.Vector3().setFromMatrixScale(matrix).length()<1e-7,'near and far versions of a tree are not drawn together');}
  maxima.trees=Math.max(maxima.trees,state.nearTrees);maxima.shrubs=Math.max(maxima.shrubs,state.nearShrubs);maxima.ferns=Math.max(maxima.ferns,state.nearFerns);maxima.litter=Math.max(maxima.litter,state.litter.count);
 }
 updateDentenbergWoodland(after,450,true);assert.equal(state.nearTrees+state.nearShrubs+state.nearFerns,0,'aerial mode hides all near vegetation');
 assert.ok(state.far.filter(mesh=>mesh.count>0).every(visibleInScene),'aerial mode retains the distant silhouettes removed from the legacy tree list');
 for(const tree of state.trees){const matrix=new T.Matrix4();tree.far.getMatrixAt(tree.farIndex,matrix);assert.ok(new T.Vector3().setFromMatrixScale(matrix).length()>0,'aerial mode releases every hidden far instance');}
 updateDentenbergWoodland(after,450,false);assert.equal(state.group.visible,true,'returning to the saddle restores the same woodland');
 assert.ok(maxima.trees>0&&maxima.shrubs>0&&maxima.ferns>0);
 return {label,before,after,result:{routeUnchanged:true,roadCentreAndElevationsUnchanged:true,sourceWorldUnchanged:true,forestScoped:true,fixedPools:true,treeChunks:chunks,maxNear:maxima}};
}

try{
 const data=syntheticCourse();
 for(const d of [-1,0,149,650,750,1200,Infinity,NaN])assert.equal(forestWeight(d,data.survey.segments),0,'nonforest and invalid locations have no forest overlay');
 for(const d of [220,300,450,925,1000])assert.ok(forestWeight(d,data.survey.segments)>.95,'continuous forest includes a change in road surface');
 for(let i=0;i<30;i++)assert.deepEqual(woodlandTreeStyle(i),woodlandTreeStyle(i),'tree variants are reproducible');
 const nearbyItems=[{id:3,x:1,z:0},{id:1,x:-1,z:0},{id:2,x:0,z:2},{id:4,x:400,z:400}];
 const grid=indexWoodland(nearbyItems);let lookups=0;const originalGet=grid.get.bind(grid);grid.get=key=>{lookups++;return originalGet(key);};
 assert.deepEqual(collectNearby(grid,0,0,104,2).map(item=>item.id),[1,3],'nearest selection has stable tie ordering and honors its cap');
 assert.ok(lookups<=25,'nearby selection visits only adjacent spatial cells');
 const synthetic=await verifyCourse(data,'synthetic');
 report.synthetic=synthetic.result;
 const camera=synthetic.after,entry=camera.at(149),legacyGeometry=new T.BoxGeometry(1,1,1),legacyMaterial=new T.MeshBasicMaterial();
 const legacy={list:Array.from({length:400},(_,i)=>[entry.x+(i%20)*.2,entry.y,entry.z+Math.floor(i/20)*.2,14,0]),far:new T.InstancedMesh(legacyGeometry,legacyMaterial,400),nearLeaves:new T.InstancedMesh(legacyGeometry,legacyMaterial,320),nearTrunks:new T.InstancedMesh(legacyGeometry,legacyMaterial,320)};
 camera.treeGroups=[legacy];camera.updateTrees=ForestRenderer.prototype.updateTrees.bind(camera);
 const visual={presentationEpoch:'camera-check',presentationInterpolated:true,presentation:{stableCamera:true},slip:0,recovery:0,brakePressure:0};
 ForestRenderer.prototype.render.call(camera,149,1/30,'demo',false,visual);assert.equal(legacy.nearLeaves.count,320);
 ForestRenderer.prototype.render.call(camera,151,1/30,'demo',false,visual);
 assert.ok(legacy.nearLeaves.count<=80,'entering woodland immediately caps legacy near trees without waiting another 25 metres');
 assert.equal(legacy.nearLeaves.count,legacy.nearTrunks.count);
 ForestRenderer.prototype.render.call(camera,450,1/30,'demo',false,visual);
 assert.equal(camera.scene.fog.near,120);assert.equal(camera.scene.fog.far,650);
 ForestRenderer.prototype.render.call(camera,450,1/30,'demo',true,visual);
 assert.equal(camera.scene.fog.near,1200);assert.equal(camera.scene.fog.far,3500,'overview restores the aerial fog range after woodland riding');
 ForestRenderer.prototype.render.call(camera,450,1/30,'demo',false,visual);
 assert.equal(camera.scene.fog.near,120);assert.equal(camera.scene.fog.far,650,'returning from aerial view restores woodland fog');
 report.synthetic.aerialSilhouettesAndFog='passed';report.synthetic.forestEntryLegacyBudget='passed';
 const privateFloor=rendererFixture(data,{videoFloor:true}),originalFloor=privateFloor.surfaceTextures.floor;
 await prepareDentenbergWoodland(privateFloor);
 assert.equal(privateFloor.dentenbergWoodland.groundSource,'private-video');
 assert.equal(privateFloor.dentenbergWoodland.materials.floor.map.source,originalFloor.source,'an available local video texture retains precedence over stock imagery');
 assert.equal(privateFloor.dentenbergWoodland.materials.floor.bumpMap,privateFloor.dentenbergWoodland.materials.floor.map,'private imagery uses its matching relief source');
 assert.equal(privateFloor.dentenbergWoodland.materials.floor.normalMap,null,'stock normals are not incorrectly applied to private imagery');
 const originalFetch=globalThis.fetch;
 try{
  T.TextureLoader.prototype.loadAsync=async()=>{throw Error('fixture: optional image unavailable');};
  const missing=rendererFixture(data);await prepareDentenbergWoodland(missing);
  assert.equal(missing.dentenbergWoodland.assetsLoaded,0);assert.equal(missing.dentenbergWoodland.assetFallbacks.length,3);
  assert.equal(missing.dentenbergWoodland.groundSource,'procedural-fallback');assert.equal(missing.dentenbergWoodland.materials.floor.map,missing.surfaceTextures.floor);
  addSurveyTrees(missing);selectDentenbergTrees(missing);buildSurveyRoad(missing);buildDentenbergWoodland(missing);updateDentenbergWoodland(missing,450);
  assert.ok(missing.dentenbergWoodland.nearTrees>0,'missing optional maps do not prevent a rideable woodland');
  const absentFoliage=rendererFixture(data);delete absentFoliage.beech;
  globalThis.fetch=async()=>({status:200,ok:true,json:async()=>({...data.survey,texture:'missing-floor.jpg',foliageTexture:'missing-foliage.png'})});
  await loadSurvey(absentFoliage);assert.equal(absentFoliage.groundSource,'procedural');assert.ok(absentFoliage.surfaceTextures.floor);
  await prepareDentenbergWoodland(absentFoliage);addSurveyTrees(absentFoliage);selectDentenbergTrees(absentFoliage);buildSurveyRoad(absentFoliage);buildDentenbergWoodland(absentFoliage);
  assert.ok(absentFoliage.dentenbergWoodland.group,'missing legacy foliage also has a generated replacement');
  T.TextureLoader.prototype.loadAsync=async path=>{if(path.includes('_diff_'))throw Error('fixture: missing albedo');return new T.Texture({width:16,height:16});};
  const missingAlbedo=rendererFixture(data);await prepareDentenbergWoodland(missingAlbedo);
  assert.equal(missingAlbedo.dentenbergWoodland.materials.floor.map,missingAlbedo.surfaceTextures.floor);
  assert.equal(missingAlbedo.dentenbergWoodland.materials.floor.normalMap,null,'stock normals require their matching albedo');
  assert.equal(missingAlbedo.dentenbergWoodland.materials.floor.roughnessMap,null,'stock roughness requires its matching albedo');
  report.optionalAssets={allStockMapsMissing:'passed',localGroundAndFoliageMissing:'passed',missingAlbedoReliefMismatch:'passed',localVideoPrecedence:'passed'};
 }finally{globalThis.fetch=originalFetch;T.TextureLoader.prototype.loadAsync=async()=>new T.Texture({width:16,height:16});}
 let complete;const warm=rendererFixture(data);warm.dentenbergWoodland={};warm.renderer.compileAsync=()=>new Promise(resolve=>{complete=resolve;});
 const compiling=prewarmDentenbergWoodland(warm);assert.equal(warm.dentenbergWoodland.prewarmStatus,undefined);complete();await compiling;assert.equal(warm.dentenbergWoodland.prewarmStatus,'complete');
 warm.renderer.compileAsync=async()=>{throw Error('fixture: optional prewarm failure');};await prewarmDentenbergWoodland(warm);assert.equal(warm.dentenbergWoodland.prewarmStatus,'fallback');
 report.optionalAssets.shaderPrewarmFailure='passed';
 for(const id of ['gurten','eiger-20','uetliberg','al-dente']){
  const other=rendererFixture(data,{id}),originalTrees=JSON.stringify(other.world.trees),materials={...other.surveyMaterials};
  if(id==='al-dente')ForestRenderer.prototype.setDentenbergWoodlandEnabled.call(other,false);
  const pilot={active:true,weight:.5};other.elTonyPilot=pilot;
  await prepareDentenbergWoodland(other);selectDentenbergTrees(other);buildDentenbergWoodland(other);updateDentenbergWoodland(other,450);await prewarmDentenbergWoodland(other);
  assert.equal(other.dentenbergWoodland,undefined);assert.equal(other.elTonyPilot,pilot);assert.equal(other.scene.children.length,0);
  assert.equal(JSON.stringify(other.world.trees),originalTrees);assert.deepEqual(other.surveyMaterials,materials,'other courses retain their materials');
 }
 report.otherCourses={gurten:'untouched',elTonyState:'untouched',eiger:'untouched',uetliberg:'untouched',explicitlyDisabledDentenberg:'untouched'};
 if(privateIndex>=0){
  const directory=resolve(args[privateIndex+1]);
  const [course,world,survey]=await Promise.all(['route.json','world.json','appearance.json'].map(async name=>JSON.parse(await readFile(resolve(directory,name),'utf8'))));
  const checked=await verifyCourse({course,world,survey},'private local course');
  report.privateCourse={checkedReadOnly:true,...checked.result};
 }
 console.log(JSON.stringify(report,null,2));
}finally{T.TextureLoader.prototype.loadAsync=originalLoad;restoreCanvas();}
