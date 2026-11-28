// node tools/gurten/verify-pilot.mjs — actual geometry and course locality, no GPU/sensors.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from '../../src/MTBIndoorBern/Scene/vendor/three.module.js';
import {ForestRenderer} from '../../src/MTBIndoorBern/Scene/forest.js';
import {addSurveyTrees,buildSurveyRoad} from '../../src/MTBIndoorBern/Scene/course-details.js';
import {gurtenLiftAt,gurtenWidthAt,buildGurtenEarth} from '../../src/MTBIndoorBern/Scene/gurten-features.js';
import {EL_TONY_PILOT,pilotContains,pilotWeight,pilotEdgeOffset,pilotTreeCandidates} from '../../src/MTBIndoorBern/Scene/el-tony-profile.js';
import {createPilotTreeGeometry,prepareElTonyPilot,selectPilotTrees,prewarmElTonyPilot} from '../../src/MTBIndoorBern/Scene/el-tony-pilot.js';
const base=new URL('../../src/MTBIndoorBern/Scene/courses/gurten/',import.meta.url);
const json=async name=>JSON.parse(await readFile(new URL(name,base),'utf8'));
const [course,world,survey,features]=await Promise.all(['route.json','world.json','appearance.json','features.json'].map(json));
const courseBefore=JSON.stringify(course),featuresBefore=JSON.stringify(features);
for(const d of[-100,0,4969,5311,7000,NaN])assert.equal(pilotWeight(d),0);
for(const d of[4970,5310]){assert.equal(pilotWeight(d),0);assert.ok(pilotWeight(d+(d===4970?.001:-.001))<1e-7,'lighting has a smooth endpoint');}
assert.equal(pilotWeight(5083),1);assert.equal(pilotWeight(5083,false),0);
assert.equal(pilotContains(5083,25),false);assert.equal(pilotContains(1000,0),false);
for(let d=4950;d<=5330;d+=.1)for(const side of[-1,1]){const e=pilotEdgeOffset(d,side);assert.ok(Math.abs(e)<=.191);assert.ok(e*side>=0,'edge never narrows or crosses ride centre');}
assert.deepEqual(pilotTreeCandidates(),pilotTreeCandidates(),'fixed seeds prevent LOD reshuffling');
assert.ok(pilotTreeCandidates().every(v=>pilotContains(v.d,v.offset)));
const treeCounts=[];
for(let variant=0;variant<3;variant++){
 const kit=createPilotTreeGeometry(variant),again=createPilotTreeGeometry(variant);
 for(const key of['wood','leaves']){
  const g=kit[key],p=g.attributes.position,n=g.attributes.normal;
  assert.deepEqual(p.array,again[key].attributes.position.array,'variant geometry is reproducible');
  assert.ok([...p.array,...n.array].every(Number.isFinite),'finite vertices/normals');
  g.computeBoundingBox();assert.ok(g.boundingBox.min.y>-.03&&g.boundingBox.max.y<1.25,'bounded tree height');
  assert.ok(g.boundingBox.max.x-g.boundingBox.min.x>.3&&g.boundingBox.max.z-g.boundingBox.min.z>.3,'genuinely three-dimensional crown/branches');
  assert.ok(p.count/3<2500,'bounded per-tree geometry');
 }
 treeCounts.push({wood:kit.wood.attributes.position.count/3,leaves:kit.leaves.attributes.position.count/3});
}
function fixture(pilot){
 const r={info:{id:'gurten'},course,world:{...world,trees:[]},survey,gurtenFeatures:features,gurtenEarthTexture:new T.Texture(),scene:new T.Scene(),aerial:new T.Texture(),surveyMaterials:Object.fromEntries(['asphalt','gravel','leaves','earth','floor'].map(k=>[k,new T.MeshBasicMaterial()]))};
 for(const method of['at','height','uv'])r[method]=ForestRenderer.prototype[method].bind(r);
 r.featureHeight=d=>gurtenLiftAt(d,features);r.featureWidth=(d,w)=>gurtenWidthAt(d,features,w);
 if(pilot){r.elTonyPilot={materials:{earth:new T.MeshBasicMaterial(),floor:new T.MeshBasicMaterial()}};r.pilotAt=pilotContains;}
 addSurveyTrees(r);buildSurveyRoad(r);return r;
}
const before=fixture(false),after=fixture(true),ap=after.roadMesh.geometry.attributes.position,bp=before.roadMesh.geometry.attributes.position;
assert.equal(ap.count,bp.count);let changedEdges=0;
for(let row=0;row<after.roadPoints.length;row++)for(let column=0;column<5;column++){
 const i=row*5+column,d=after.roadPoints[row].d;
 assert.equal(ap.getY(i),bp.getY(i),'visual surface must retain every elevation');
 if(column===2||!pilotWeight(d)){assert.equal(ap.getX(i),bp.getX(i));assert.equal(ap.getZ(i),bp.getZ(i));}
 else if(ap.getX(i)!==bp.getX(i)||ap.getZ(i)!==bp.getZ(i))changedEdges++;
}
assert.ok(changedEdges>20,'pilot irregularity actually reaches the built road');
const groundBlend=after.localGroundMesh.geometry.attributes.pilotBlend.array;
assert.ok([...groundBlend].every(v=>Number.isFinite(v)&&v>=0&&v<=1),'ground fade is bounded');
assert.ok([...groundBlend].some(v=>v>.1&&v<.9),'ground includes a real feathered margin');
const groups=after.roadMesh.geometry.groups;assert.ok(groups.some(g=>g.materialIndex===4),'pilot material assigned');
for(const g of groups)if(g.materialIndex===4){const first=g.start/24,last=(g.start+g.count)/24;for(let i=first;i<last;i++)assert.ok(pilotContains((after.roadPoints[i].d+after.roadPoints[i+1].d)/2),'material only in pilot');}
const sourceTrees=after.world.trees.slice();selectPilotTrees(after);
assert.ok(after.world.trees.length<sourceTrees.length,'old nearby silhouettes replaced');
for(const tree of sourceTrees){const n=after.nearestRoad(tree[0],tree[2]);if(!pilotContains(n.d,n.distance))assert.ok(after.world.trees.includes(tree),'all outside trees retained');}
after.updateRoadVisibility(5083);assert.ok(after.roadMesh.geometry.groups.some(g=>g.materialIndex===4),'seeking keeps correct material groups');
const oldEarth=new T.Group(),newEarth=new T.Group();after.elTonyPilot.materials.featureEarth=new T.MeshBasicMaterial();
buildGurtenEarth(before,features,oldEarth);buildGurtenEarth(after,features,newEarth);
const oldGeometry=oldEarth.children[0].geometry,newGeometry=newEarth.children[0].geometry;
assert.deepEqual(newGeometry.attributes.position.array,oldGeometry.attributes.position.array,'all table/berm surfaces retain their exact shape');
assert.deepEqual(newGeometry.index.array,oldGeometry.index.array,'surface topology unchanged');
assert.equal(newGeometry.groups.reduce((n,g)=>n+g.count,0),newGeometry.index.count,'material groups cover every feature triangle');
assert.equal(newGeometry.groups.filter(g=>g.materialIndex===1).length,8,'only six complete pilot jumps and two berms use pilot material');
assert.equal(JSON.stringify(course),courseBefore,'route/grades unchanged');assert.equal(JSON.stringify(features),featuresBefore,'jump physics unchanged');
// Run the real renderer camera path without a GPU: interpolation and seeks are
// presentation-only and cannot inherit a previous skid's lateral camera offset.
const cameraFixture={...after,camera:new T.PerspectiveCamera(),bike:new T.Group(),sun:new T.DirectionalLight(),hemisphere:new T.HemisphereLight(),isAlpine:false,distance:5080,trailOffset:1.2,frames:0,treeGroups:[],updateTrees(){},renderer:{render(){},toneMappingExposure:1}};
cameraFixture.scene.fog=new T.Fog('#c3d4dc',500,1550);
const visual={presentationEpoch:3,presentationInterpolated:true,presentation:{stableCamera:true},recovery:0,slip:0,brakePressure:1};
ForestRenderer.prototype.render.call(cameraFixture,5086,1/30,'demo',false,visual);
assert.equal(cameraFixture.distance,5086,'interpolated frame position is not smoothed twice');assert.equal(cameraFixture.trailOffset,0,'seek clears prior skid offset');
const stable=cameraFixture.camera.quaternion.clone();visual.brakePressure=0;ForestRenderer.prototype.render.call(cameraFixture,5086,1/30,'demo',false,visual);assert.ok(stable.angleTo(cameraFixture.camera.quaternion)<1e-7,'stable camera removes brake bob');
const quality={quality:1,renderer:{setPixelRatio(value){this.ratio=value;}}};
for(let i=0;i<2;i++)ForestRenderer.prototype.adjustQuality.call(quality,30,{targetFps:30,frameMsP95:60,renderMsP95:4});
assert.equal(quality.quality,.9,'persistent frame stalls lower resolution even when CPU submission is cheap');
for(let i=0;i<9;i++)ForestRenderer.prototype.adjustQuality.call(quality,30,{targetFps:30,frameMsP95:34,renderMsP95:4});
assert.equal(quality.quality,.9,'short recovery does not oscillate resolution');
ForestRenderer.prototype.adjustQuality.call(quality,30,{targetFps:30,frameMsP95:34,renderMsP95:4});assert.ok(quality.quality>.9,'sustained healthy rendering recovers cautiously');
// Loading is optional: all six missing files still produce usable fallback materials.
const originalLoad=T.TextureLoader.prototype.loadAsync;T.TextureLoader.prototype.loadAsync=async()=>{throw Error('fixture unavailable');};
const fallback={info:{id:'gurten'},surfaceTextures:{earth:new T.Texture(),floor:new T.Texture()},renderer:{capabilities:{getMaxAnisotropy:()=>8}}};
try{await prepareElTonyPilot(fallback);assert.equal(fallback.elTonyPilot.assetFallbacks.length,6);assert.equal(fallback.elTonyPilot.materials.earth.map,fallback.surfaceTextures.earth);assert.equal(fallback.elTonyPilot.materials.floor.map,fallback.surfaceTextures.floor);for(const id of['al-dente','eiger-20','uetliberg']){const other={info:{id}};await prepareElTonyPilot(other);assert.equal(other.elTonyPilot,undefined);}}
finally{T.TextureLoader.prototype.loadAsync=originalLoad;}
let completeCompile;const prewarm={elTonyPilot:{},scene:{},camera:{},renderer:{compileAsync(scene,camera){assert.equal(scene,prewarm.scene);assert.equal(camera,prewarm.camera);return new Promise(resolve=>{completeCompile=resolve;});}}};
const pending=prewarmElTonyPilot(prewarm);assert.equal(prewarm.elTonyPilot.prewarmStatus,undefined,'prewarm awaits actual readiness');completeCompile();await pending;assert.equal(prewarm.elTonyPilot.prewarmStatus,'complete');
prewarm.renderer.compileAsync=async()=>{throw Error('fixture driver unavailable');};await prewarmElTonyPilot(prewarm);assert.equal(prewarm.elTonyPilot.prewarmStatus,'fallback','optional shader-prewarm failure cannot reject course loading');
await prewarmElTonyPilot({renderer:{compileAsync(){assert.fail('other courses must retain their startup path');}}});
console.log(JSON.stringify({ok:true,range:EL_TONY_PILOT,treeCandidates:pilotTreeCandidates().length,treeCounts,changedEdges,courseAndFeaturesUnchanged:true,optionalTextureFailure:'passed',otherCourses:'untouched'},null,2));
