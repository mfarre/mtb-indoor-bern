import * as T from '../../src/MTBIndoorBern/Scene/vendor/three.module.js';
import {ForestRenderer} from '../../src/MTBIndoorBern/Scene/forest.js';

// Invented coordinates and surfaces, unrelated to a recorded route or location.
// The public regression suite must remain runnable without personal geodata.
export function syntheticCourse(length=1200){
 const height=(x,z)=>50-z*.025+3*Math.sin(-z/65)+x*.012;
 const points=[];
 for(let i=0;i<=length/5;i++){
  const t=i*5,x=Math.sin(t/90)*19,z=-t,y=height(x,z),previous=points.at(-1);
  points.push({x,y,z,alt:y+400,d:previous?previous.d+Math.hypot(x-previous.x,z-previous.z):0,grade:0});
 }
 for(let i=0;i<points.length-1;i++){
  const a=points[i],b=points[i+1];a.grade=(b.y-a.y)/Math.hypot(b.x-a.x,b.z-a.z)*100;
 }
 points.at(-1).grade=points.at(-2).grade;
 const course={points,length:points.at(-1).d,origin:{lat:0,lon:0},ascent:40};
 const terrain={x0:-80,z0:-length-60,nx:17,nz:Math.ceil((length+120)/10)+1,spacing:10,heights:[]};
 for(let z=0;z<terrain.nz;z++)for(let x=0;x<terrain.nx;x++)terrain.heights.push(height(terrain.x0+x*10,terrain.z0+z*10));
 const trees=[];
 for(let i=4;i<points.length-4;i+=4){
  const p=points[i],next=points[i+1],dx=next.x-p.x,dz=next.z-p.z,l=Math.hypot(dx,dz);
  for(const offset of [-38,-22,-7,7,22,38]){
   const x=p.x-dz/l*offset,z=p.z+dx/l*offset;
   trees.push([x,height(x,z),z,14+(i%3)*3,i%2]);
  }
 }
 const world={terrain,trees,buildings:[],vertices:[],indices:[],imagery:{zoom:12,x0:2047,x1:2049,y0:2047,y1:2049,file:'synthetic.png'}};
 const survey={version:1,season:'late-autumn',segments:[
  {from:0,to:150,surface:'asphalt',width:3,forest:false,confidence:'observed'},
  {from:150,to:300,surface:'asphalt',width:2.8,forest:true,confidence:'observed'},
  {from:300,to:650,surface:'leaves',width:1,forest:true,confidence:'observed'},
  {from:650,to:850,surface:'gravel',width:2.2,forest:false,confidence:'observed'},
  {from:850,to:1100,surface:'leaves',width:1.1,forest:true,confidence:'inferred'},
  {from:1100,to:course.length+1,surface:'asphalt',width:3,forest:false,confidence:'observed'}
 ]};
 return {course,world,survey};
}

export function rendererFixture(data,{id='al-dente',videoFloor=false}={}){
 const textures=Object.fromEntries(['asphalt','gravel','leaves','earth','floor'].map(key=>[key,new T.Texture()]));
 const renderer={info:{id,folder:'synthetic-course'},course:data.course,world:{...data.world,trees:data.world.trees.map(tree=>[...tree])},survey:structuredClone(data.survey),
  scene:new T.Scene(),camera:new T.PerspectiveCamera(),bike:new T.Group(),sun:new T.DirectionalLight(),hemisphere:new T.HemisphereLight(),
  aerial:new T.Texture({width:1,height:1}),bark:new T.Texture(),beech:new T.Texture(),leaves:[new T.Texture(),new T.Texture()],sprites:[new T.Texture(),new T.Texture()],
  groundSource:videoFloor?'video':'procedural',surfaceTextures:textures,
  surveyMaterials:Object.fromEntries(Object.entries(textures).map(([key,map])=>[key,new T.MeshStandardMaterial({map,vertexColors:true})])),
  renderer:{capabilities:{getMaxAnisotropy:()=>8},toneMappingExposure:1.12,compileAsync:async()=>{},render(){},info:{render:{triangles:0,calls:0}},domElement:{width:1280,height:720},getPixelRatio:()=>1,getContext:()=>({VERSION:0,getParameter:()=> 'CPU fixture; no WebGL'})},
  treeGroups:[],quality:1,distance:0,frames:0,isAlpine:id==='eiger-20'};
 renderer.scene.fog=new T.Fog('#c3d4dc',500,1550);
 for(const name of ['at','height','uv'])renderer[name]=ForestRenderer.prototype[name].bind(renderer);
 return renderer;
}

// Canvas painting is not under test here. This minimal surface lets the real
// procedural material and geometry constructors execute without a DOM or GPU.
export function installCanvasStub(){
 const previous=globalThis.document;
 const context=new Proxy({
  getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
  createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}}),
  measureText:()=>({width:1})
 },{get:(target,key)=>key in target?target[key]:()=>{}});
 globalThis.document={createElement:tag=>{
  if(tag!=='canvas')throw Error('Unexpected DOM element in geometry fixture: '+tag);
  return {width:1,height:1,getContext:()=>context};
 }};
 return ()=>{globalThis.document=previous;};
}
