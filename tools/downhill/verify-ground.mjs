import fs from 'node:fs';
import * as T from '../../src/MTBIndoorBern/Scene/vendor/three.module.js';
import {addSurveyTrees,buildSurveyRoad} from '../../src/MTBIndoorBern/Scene/course-details.js';
import {ForestRenderer} from '../../src/MTBIndoorBern/Scene/forest.js';
const folder=new URL('../../src/MTBIndoorBern/Scene/courses/al-dente/',import.meta.url),read=f=>JSON.parse(fs.readFileSync(new URL(f,folder),'utf8'));
const r=Object.create(ForestRenderer.prototype);Object.assign(r,{course:read('route.json'),world:read('world.json'),survey:read('appearance.json'),scene:new T.Scene(),aerial:null});
r.surveyMaterials=Object.fromEntries(['asphalt','gravel','leaves','floor'].map(k=>[k,new T.MeshStandardMaterial({side:T.DoubleSide})]));
addSurveyTrees(r);r.buildTerrain();buildSurveyRoad(r);r.scene.updateMatrixWorld(true);
const distances=[...Array.from({length:25},(_,i)=>4670+i*5),...Array.from({length:25},(_,i)=>4900+i*5),2050,4300,5500,6000,6500];
let covered=0,maxRoadError=0;
for(const d of distances){r.updateRoadVisibility(d);const p=r.at(d),up=new T.Raycaster(new T.Vector3(p.x,p.y+1.65,p.z),new T.Vector3(0,1,0),0,40);if(up.intersectObjects(r.scene.children).length)covered++;const down=new T.Raycaster(new T.Vector3(p.x,p.y+1.65,p.z),new T.Vector3(0,-1,0),0,3);const hits=down.intersectObjects(r.scene.children);if(!hits.length)throw Error(`Road missing at ${d}`);if(Math.abs(hits[0].point.y-p.y)>.15)console.log({d,error:hits[0].point.y-p.y,mesh:r.scene.children.indexOf(hits[0].object)});maxRoadError=Math.max(maxRoadError,Math.abs(hits[0].point.y-p.y));}
const result={samples:distances.length,terrainAboveRider:covered,maxRoadErrorMeters:maxRoadError,localGroundVertices:r.localGroundVertices};
fs.mkdirSync(new URL('../../artifacts/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../../artifacts/ground-tests.json',import.meta.url),JSON.stringify(result,null,2));console.log(result);
if(covered||maxRoadError>.15)throw Error('Terrain covers or disagrees with the route');
