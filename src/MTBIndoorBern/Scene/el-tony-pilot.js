import * as T from './vendor/three.module.js';
import {EL_TONY_PILOT,pilotWeight,pilotContains,pilotRandom,pilotTreeCandidates} from './el-tony-profile.js';

// A small reusable broadleaf kit, inspired by the published Gurtentrail forest
// photographs. Positions and dimensions are illustrative, not photogrammetry.
function paintedTexture(size,paint){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
 paint(canvas.getContext('2d'),size);
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
 texture.anisotropy=4;return texture;
}
function leafSprigTexture(){
 const r=pilotRandom(908);
 return paintedTexture(512,(c,s)=>{
  // Separate leafy twigs and visible negative space, instead of a solid crown disc.
  for(let stem=0;stem<7;stem++){
   const a=stem*2.399,x=s*(.48+Math.cos(a)*.20),y=s*(.48+Math.sin(a)*.20);
   c.strokeStyle='#4b5130';c.lineWidth=2;c.beginPath();c.moveTo(s*.5,s*.62);c.lineTo(x,y);c.stroke();
   for(let k=0;k<92;k++){
    const angle=r()*6.28,rad=Math.sqrt(r())*91,lx=x+Math.cos(angle)*rad,ly=y+Math.sin(angle)*rad;
    c.save();c.translate(lx,ly);c.rotate(angle);const length=19+r()*21;
    c.fillStyle=['#647b39','#899d51','#455f2b','#768e42','#a0ad65','#607e3b'][k%6];
    c.beginPath();c.moveTo(-length/2,0);c.bezierCurveTo(-length*.2,-length*.36,length*.35,-length*.29,length/2,0);c.bezierCurveTo(length*.25,length*.33,-length*.22,length*.30,-length/2,0);c.fill();
    c.strokeStyle='rgba(168,182,102,.35)';c.lineWidth=.6;c.beginPath();c.moveTo(-length*.4,0);c.lineTo(length*.4,0);c.stroke();c.restore();
   }
  }
 });
}
function fernTexture(){
 return paintedTexture(256,(c,s)=>{
  const r=pilotRandom(44);
  for(let f=0;f<7;f++){
   const angle=(f-3)*.23,length=130+r()*70,baseX=s/2,baseY=s-8;
   c.save();c.translate(baseX,baseY);c.rotate(angle);c.strokeStyle='#708343';c.lineWidth=2;c.beginPath();c.moveTo(0,0);c.quadraticCurveTo(8,-length*.5,0,-length);c.stroke();
   for(let j=1;j<17;j++){const t=j/18,w=Math.sin(t*Math.PI)*24*(1-t*.4),y=-length*t;c.fillStyle=['#526f35','#6d8641','#3c5b2d'][j%3];for(const side of[-1,1]){c.beginPath();c.moveTo(0,y+4);c.quadraticCurveTo(side*w*.55,y-10,side*w,y-14);c.quadraticCurveTo(side*w*.5,y+1,0,y+4);c.fill();}}
   c.restore();
  }
 });
}
function mergeGeometries(list){
 const positions=[],normals=[],uv=[];
 for(const source of list){const g=source.index?source.toNonIndexed():source;positions.push(...g.attributes.position.array);normals.push(...g.attributes.normal.array);uv.push(...g.attributes.uv.array);if(g!==source)g.dispose();source.dispose();}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeBoundingSphere();return g;
}
function limb(points,radius,segments=7,sides=5){
 const curve=new T.CatmullRomCurve3(points),g=new T.TubeGeometry(curve,segments,radius,sides,false),p=g.attributes.position;
 // Taper each ring toward the end; branch tips remain attached to their twigs.
 for(let ring=0;ring<=segments;ring++){const center=curve.getPointAt(ring/segments),scale=1-ring/segments*.78;for(let j=0;j<=sides;j++){const i=ring*(sides+1)+j;p.setXYZ(i,center.x+(p.getX(i)-center.x)*scale,center.y+(p.getY(i)-center.y)*scale,center.z+(p.getZ(i)-center.z)*scale);}}
 g.computeVertexNormals();return g;
}
export function createPilotTreeGeometry(variant){
 const r=pilotRandom(620+variant*127),wood=[],leaves=[],tips=[],lean=new T.Vector3((r()-.5)*.09,0,(r()-.5)*.09);
 const trunk=[new T.Vector3(0,0,0),new T.Vector3(lean.x*.3,.28,lean.z*.3),new T.Vector3(lean.x,.61,lean.z),new T.Vector3(lean.x*1.3,.97,lean.z*.6)];
 wood.push(limb(trunk,.0125,12,8));
 for(let root=0;root<5;root++){const a=root*1.256+variant;wood.push(limb([new T.Vector3(0,.055,0),new T.Vector3(Math.cos(a)*.027,.015,Math.sin(a)*.027),new T.Vector3(Math.cos(a)*.055,0,Math.sin(a)*.055)],.008,4,5));}
 for(let b=0;b<13;b++){
  const angle=b*2.399+variant,base=.30+b*.043,spread=(.19+r()*.10)*(1-(base-.3)*.55);
  const start=new T.Vector3(lean.x*base,base,lean.z*base),mid=new T.Vector3(Math.cos(angle)*spread*.60+lean.x,base+.055,Math.sin(angle)*spread*.60+lean.z),end=new T.Vector3(Math.cos(angle)*spread+lean.x,Math.min(1.05,base+.14+r()*.09),Math.sin(angle)*spread+lean.z);
  wood.push(limb([start,mid,end],.0046*(1-b/22),6,5));
  for(let twig=0;twig<3;twig++){
   const a=angle+(twig-1)*.70,tip=end.clone().add(new T.Vector3(Math.cos(a)*(.045+r()*.05),.035+r()*.055,Math.sin(a)*(.045+r()*.05)));
   wood.push(limb([mid.clone().lerp(end,.45),end.clone().lerp(tip,.45),tip],.0016,3,4));tips.push(tip);
  }
 }
 for(const tip of tips)for(let k=0;k<4;k++){
  const size=.22+r()*.105,plane=new T.PlaneGeometry(size,size*.78);
  // Mixed upright/tilted clusters overlap vertically into a crown volume;
  // parallel horizontal cards otherwise read as stacked discs from the saddle.
  plane.rotateX([-.45,.35,-1.1,.95][k]+(r()-.5)*1.2);plane.rotateY(r()*Math.PI*2);plane.rotateZ((r()-.5)*.7);
  plane.translate(tip.x+(r()-.5)*.085,Math.min(1.08,tip.y+(r()-.5)*.15+(k===0?-.03:k===3?.025:0)),tip.z+(r()-.5)*.085);leaves.push(plane);
 }
 return {wood:mergeGeometries(wood),leaves:mergeGeometries(leaves)};
}
function createUnderstoryGeometry(){
 const r=pilotRandom(682),wood=[],leaves=[];
 for(let b=0;b<4;b++){const a=b*2.399,tip=new T.Vector3(Math.cos(a)*.20,.60+r()*.24,Math.sin(a)*.20);wood.push(limb([new T.Vector3(0,0,0),new T.Vector3(tip.x*.3,.36,tip.z*.3),tip],.013,5,4));}
 for(let k=0;k<38;k++){const angle=k*2.399,rad=.12+r()*.19,y=.25+r()*.65,plane=new T.PlaneGeometry(.36+r()*.14,.30+r()*.13);plane.rotateX(-.55+(r()-.5)*1.7);plane.rotateY(r()*6.28);plane.translate(Math.cos(angle)*rad,y,Math.sin(angle)*rad);leaves.push(plane);}
 return {wood:mergeGeometries(wood),leaves:mergeGeometries(leaves)};
}
function featherGroundEdge(material,aerial){
 material.onBeforeCompile=shader=>{
  shader.uniforms.pilotAerial={value:aerial};
  shader.vertexShader='attribute vec2 pilotPhotoUv;attribute float pilotBlend;varying vec2 vPilotPhotoUv;varying float vPilotBlend;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvPilotPhotoUv=pilotPhotoUv;vPilotBlend=pilotBlend;');
  shader.fragmentShader='uniform sampler2D pilotAerial;varying vec2 vPilotPhotoUv;varying float vPilotBlend;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\ndiffuseColor.rgb=mix(texture2D(pilotAerial,vPilotPhotoUv).rgb,diffuseColor.rgb,clamp(vPilotBlend,0.0,1.0));');
 };
 material.customProgramCacheKey=()=> 'el-tony-feathered-ground-v1';
}

async function materialSet(engine,name,fallback,tileMetres,uvMetres){
 const pilot=engine.elTonyPilot,loader=new T.TextureLoader(),maps={};
 // Optional assets must never prevent opening a course or starting a ride.
 await Promise.all(['albedo','normal','roughness'].map(async key=>{
  const suffix={albedo:'diff',normal:'nor_gl',roughness:'rough'}[key];
  const path=`assets/el-tony/${name}_${suffix}_1k.jpg`;
  try{const t=await loader.loadAsync(path);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.setScalar(uvMetres/tileMetres);t.anisotropy=Math.min(8,engine.renderer.capabilities.getMaxAnisotropy());t.colorSpace=key==='albedo'?T.SRGBColorSpace:T.NoColorSpace;maps[key]=t;pilot.assetsLoaded++;}
  catch{pilot.assetFallbacks.push(path);}
 }));
 return new T.MeshStandardMaterial({map:maps.albedo??fallback,normalMap:maps.normal??null,normalScale:new T.Vector2(.38,.38),roughnessMap:maps.roughness??null,roughness:1,side:T.DoubleSide,vertexColors:true});
}
export async function prepareElTonyPilot(engine){
 if(engine.info.id!=='gurten'||engine.elTonyPilotEnabled===false)return;
 engine.elTonyPilot={enabled:true,group:null,assetsLoaded:0,assetFallbacks:[],treeCount:0,range:[EL_TONY_PILOT.from,EL_TONY_PILOT.to]};
 const [earth,floor]=await Promise.all([materialSet(engine,'aerial_ground_rock',engine.surfaceTextures.earth,2,1.6),materialSet(engine,'brown_mud_leaves_01',engine.surfaceTextures.floor,3,1.6)]);
 earth.color.set('#ffffff');floor.color.set('#9ba884');
 featherGroundEdge(floor,engine.aerial);
 engine.elTonyPilot.materials={earth,floor};
 // Feature UVs are x/2,z/2. A clone uses the same 2 m physical texture scale.
 const featureEarth=earth.clone();for(const key of['map','normalMap','roughnessMap'])if(featureEarth[key]&&featureEarth[key]!==engine.surfaceTextures.earth){featureEarth[key]=featureEarth[key].clone();featureEarth[key].repeat.setScalar(1);}
 featureEarth.vertexColors=false;engine.elTonyPilot.materials.featureEarth=featureEarth;
 engine.pilotAt=(d,offset=0)=>pilotContains(d,offset);
 engine.pilotWeight=d=>pilotWeight(d);
}
export function selectPilotTrees(engine){
 if(!engine.elTonyPilot)return;
 // Keep all baseline trees outside the pilot. Within it use fixed spatial
 // positions; the near tree silhouette does not change when the camera moves.
 engine.world={...engine.world,trees:engine.world.trees.filter(t=>{const n=engine.nearestRoad(t[0],t[2]);return !pilotContains(n.d,n.distance);})};
}
function positionAt(engine,d,offset){const p=engine.at(d),a=engine.at(d-.5),b=engine.at(d+.5),forward=b.sub(a).setY(0).normalize();p.x-=forward.z*offset;p.z+=forward.x*offset;p.y=engine.localGround(p.x,p.z);return p;}
function instances(geometry,material,items,group,place){
 const mesh=new T.InstancedMesh(geometry,material,items.length),o=new T.Object3D();
 items.forEach((v,i)=>{o.position.copy(v.p);o.rotation.set(0,v.yaw??0,0);o.scale.setScalar(1);place(o,v,i);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);});
 mesh.computeBoundingSphere();mesh.receiveShadow=true;group.add(mesh);return mesh;
}
function buildContactShadows(engine,trees,group){
 const map=paintedTexture(128,(c,s)=>{const g=c.createRadialGradient(s/2,s/2,3,s/2,s/2,s/2);g.addColorStop(0,'rgba(25,29,17,.42)');g.addColorStop(.35,'rgba(25,29,17,.18)');g.addColorStop(1,'rgba(25,29,17,0)');c.fillStyle=g;c.fillRect(0,0,s,s);});
 const p=[],uv=[],idx=[];
 for(const tree of trees){const start=p.length/3,size=tree.height*.095;for(let j=0;j<=4;j++)for(let i=0;i<=4;i++){const x=tree.p.x+(i/4-.5)*size*2,z=tree.p.z+(j/4-.5)*size*2;p.push(x,engine.localGround(x,z)+.006,z);uv.push(i/4,j/4);if(i<4&&j<4){const a=start+j*5+i;idx.push(a,a+5,a+1,a+1,a+5,a+6);}}}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
 const mesh=new T.Mesh(g,new T.MeshBasicMaterial({map,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,toneMapped:false}));mesh.renderOrder=1;mesh.name='Subtle terrain-following tree contact shadows';group.add(mesh);
}
export function buildElTonyPilot(engine){
 const pilot=engine.elTonyPilot;if(!pilot)return;
 const group=new T.Group();group.name='El Tony · summer forest pilot';engine.scene.add(group);pilot.group=group;
 const candidates=pilotTreeCandidates().map(v=>({...v,p:positionAt(engine,v.d,v.offset)})).filter(v=>engine.roadClearance(v.p.x,v.p.z)>2.2&&!engine.gurtenKeepClear?.(v.p.x,v.p.z));
 const leafMap=leafSprigTexture(),leaves=new T.MeshStandardMaterial({map:leafMap,alphaTest:.30,alphaToCoverage:true,side:T.DoubleSide,roughness:.93,color:'#eef1da'}),wood=new T.MeshStandardMaterial({map:engine.bark,color:'#b7b7a5',roughness:.96});
 for(let variant=0;variant<3;variant++){
  const kit=createPilotTreeGeometry(variant),list=candidates.filter(v=>v.variant===variant),place=(o,v)=>o.scale.set(v.height*v.scaleX,v.height,v.height/v.scaleX);
  const trunk=instances(kit.wood,wood,list,group,place),canopy=instances(kit.leaves,leaves,list,group,place);trunk.castShadow=true;canopy.castShadow=true;
 }
 buildContactShadows(engine,candidates,group);
 const r=pilotRandom(996),ferns=[],stones=[],stems=[],litter=[],understory=[];
 for(let d=EL_TONY_PILOT.from+1;d<EL_TONY_PILOT.to;d+=1.4)for(const side of[-1,1]){
  const width=engine.featureWidth?.(d,2.6)??2.6,lift=engine.featureHeight?.(d)??0,offset=side*(width/2+1.1+lift*.7+r()*4.5),p=positionAt(engine,d,offset);
  if(engine.gurtenKeepClear?.(p.x,p.z)||engine.roadClearance(p.x,p.z)<.6)continue;
  const size=.28+r()*.65;ferns.push({p,size,yaw:r()*6.28});
  if(r()<.56){const bush=positionAt(engine,d,side*(width/2+2.3+lift*.7+r()*5)),height=1.7+r()*3.8,brandClearance=engine.gurtenVegetationClearance?.(bush.x,bush.z)??Infinity;if(!engine.gurtenKeepClear?.(bush.x,bush.z)&&brandClearance>height*.53&&engine.roadClearance(bush.x,bush.z)>1.9)understory.push({p:bush,size:height,yaw:r()*6.28});}
  if(r()<.23)stones.push({p:p.clone().add(new T.Vector3(0,.035,0)),size:.08+r()*.16,yaw:r()*6.28});
  if(r()<.12)stems.push({p,size:.5+r()*1.6,yaw:r()*6.28});
  // Small leaf/twig debris sits outside the compacted ride line.
  for(let k=0;k<3;k++){const lp=positionAt(engine,d+(r()-.5)*1.1,side*(width/2+.12+r()*.8+lift*.7));if(!engine.gurtenKeepClear?.(lp.x,lp.z))litter.push({p:lp.add(new T.Vector3(0,.018,0)),size:.04+r()*.10,yaw:r()*6.28});}
 }
 const plantParts=[];for(const angle of[0,Math.PI/3,2*Math.PI/3]){const g=new T.PlaneGeometry(1,1);g.translate(0,.48,0);g.rotateY(angle);plantParts.push(g);}
 instances(mergeGeometries(plantParts),new T.MeshStandardMaterial({map:fernTexture(),alphaTest:.42,side:T.DoubleSide,roughness:1,color:'#b9c6a1'}),ferns,group,(o,v)=>o.scale.set(v.size*1.25,v.size,v.size*1.25));
 const saplings=createUnderstoryGeometry();instances(saplings.wood,wood,understory,group,(o,v)=>o.scale.setScalar(v.size));const understoryLeaves=instances(saplings.leaves,leaves,understory,group,(o,v)=>o.scale.setScalar(v.size));understoryLeaves.castShadow=true;
 instances(new T.DodecahedronGeometry(1,0),new T.MeshStandardMaterial({color:'#8a8876',roughness:1}),stones,group,(o,v)=>o.scale.set(v.size,v.size*.55,v.size*.8));
 const fallen=new T.CylinderGeometry(.055,.08,1,6);fallen.rotateZ(Math.PI/2);fallen.translate(0,.06,0);instances(fallen,wood,stems,group,(o,v)=>o.scale.set(v.size,1,1));
 const leafGeometry=new T.CircleGeometry(1,5);leafGeometry.rotateX(-Math.PI/2);instances(leafGeometry,new T.MeshStandardMaterial({color:'#807255',roughness:1,side:T.DoubleSide}),litter,group,(o,v)=>o.scale.set(v.size,v.size,v.size*.48));
 pilot.treeCount=candidates.length;pilot.fernCount=ferns.length;pilot.understoryCount=understory.length;pilot.detailCount=stones.length+stems.length+litter.length;
}
export function updateElTonyPilot(engine,distance,overview){
 const pilot=engine.elTonyPilot;if(!pilot)return;
 const weight=overview?0:pilotWeight(distance);pilot.active=weight>0;pilot.weight=weight;
 if(pilot.group)pilot.group.visible=!overview;
 // Preserve the base course lighting outside the 340 m window. Broadleaf
 // shadows provide contrast without turning the Swiss summer forest into night.
 engine.hemisphere.intensity=T.MathUtils.lerp(2.1,1.15,weight);
 engine.sun.intensity=T.MathUtils.lerp(2.3,2.05,weight);
 engine.renderer.toneMappingExposure=T.MathUtils.lerp(1.12,1.04,weight);
 if(!overview){engine.scene.fog.near=T.MathUtils.lerp(500,165,weight);engine.scene.fog.far=T.MathUtils.lerp(1550,670,weight);}
}
export async function prewarmElTonyPilot(engine){
 if(!engine.elTonyPilot)return;
 // Compile offscreen material variants while the course is still loading.
 // This is optional; unavailable/failed prewarming must not block a ride.
 try{await engine.renderer.compileAsync(engine.scene,engine.camera);engine.elTonyPilot.prewarmStatus='complete';}
 catch{engine.elTonyPilot.prewarmStatus='fallback';}
}
