import * as T from './vendor/three.module.js';
import {WOODLAND_LIMITS as LIMITS,woodlandRandom,woodlandSeed,woodlandTreeStyle,forestWeight,indexWoodland,collectNearby} from './dentenberg-profile.js';

function painted(size,paint){const canvas=document.createElement('canvas');canvas.width=canvas.height=size;paint(canvas.getContext('2d'),size);const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;return map;}
function repeat(map,tileMetres){const copy=map.clone();copy.wrapS=copy.wrapT=T.RepeatWrapping;copy.repeat.setScalar(1.6/tileMetres);return copy;}
function beechAtlas(source){const random=woodlandRandom(311);return painted(512,(c,s)=>{
 if(source?.image){c.filter='saturate(.26) brightness(1.65)';for(let i=0;i<18;i++){const a=random()*6.28,r=Math.sqrt(random())*s*.30,size=s*(.23+random()*.12);c.save();c.translate(s/2+Math.cos(a)*r,s/2+Math.sin(a)*r);c.rotate(random()*6.28);c.drawImage(source.image,-size/2,-size/2,size,size);c.restore();}c.filter='none';}
 else for(let i=0;i<650;i++){const a=random()*6.28,r=Math.sqrt(random())*s*.43,x=s/2+Math.cos(a)*r,y=s/2+Math.sin(a)*r;c.fillStyle=['#9b8a54','#b9a368','#a38d53','#c4b47d','#87764a','#aca575'][i%6];c.beginPath();c.ellipse(x,y,6+random()*10,3+random()*5,random()*6.28,0,6.28);c.fill();}
 });}
function needles(){const r=woodlandRandom(910);return painted(256,(c,s)=>{for(let branch=0;branch<9;branch++){const a=branch*2.399,ex=s/2+Math.cos(a)*s*.41,ey=s/2+Math.sin(a)*s*.41;c.strokeStyle='#4a5337';c.lineWidth=2;c.beginPath();c.moveTo(s/2,s/2);c.lineTo(ex,ey);c.stroke();for(let n=0;n<80;n++){const t=r(),x=T.MathUtils.lerp(s/2,ex,t),y=T.MathUtils.lerp(s/2,ey,t),length=5+r()*13;c.strokeStyle=['#354733','#4e6042','#60714d','#2d4032'][n%4];c.lineWidth=1.7;c.beginPath();c.moveTo(x,y);c.lineTo(x+Math.cos(a+1.1)*length,y+Math.sin(a+1.1)*length);c.moveTo(x,y);c.lineTo(x+Math.cos(a-1.1)*length,y+Math.sin(a-1.1)*length);c.stroke();}}});}
function merge(parts){const p=[],n=[],uv=[];for(const original of parts){const g=original.index?original.toNonIndexed():original;p.push(...g.attributes.position.array);n.push(...g.attributes.normal.array);uv.push(...g.attributes.uv.array);if(g!==original)g.dispose();original.dispose();}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('normal',new T.Float32BufferAttribute(n,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeBoundingSphere();return g;}
function crossed(width=1,height=1){const a=new T.PlaneGeometry(width,height);a.translate(0,height/2,0);const b=a.clone();b.rotateY(Math.PI/2);return merge([a,b]);}
function coniferSapling(){const planes=[],r=woodlandRandom(584);for(let level=0;level<7;level++){const y=.19+level*.12,width=((1-y)*.92+.10)*(.8+r()*.35);for(let side=0;side<6;side++){if(r()<.14)continue;const a=side*6.28/6+level*.71,g=new T.PlaneGeometry(width,.22+r()*.08);g.rotateX(-.35+r()*.3);g.rotateZ(.1+r()*.4);g.translate(width*.23,y+(r()-.5)*.06,0);g.rotateY(a);planes.push(g);}}return merge(planes);}
function brownBracken(){const r=woodlandRandom(444);return painted(256,(c,s)=>{for(let stem=0;stem<8;stem++){c.save();c.translate(s/2,s*.95);c.rotate((stem-3.5)*.22);const length=100+r()*115;c.strokeStyle='#746b46';c.lineWidth=2;c.beginPath();c.moveTo(0,0);c.lineTo(5,-length);c.stroke();for(let j=0;j<13;j++){const t=j/14,y=-length*t,w=Math.sin(t*Math.PI)*25;c.strokeStyle=j%3?'#6c7149':'#96855a';c.lineWidth=3;for(const side of[-1,1]){c.beginPath();c.moveTo(0,y);c.lineTo(side*w,y-12);c.stroke();}}c.restore();}});}
function distantBeech(leafMap,variant){const r=woodlandRandom(480+variant);return painted(512,(c,s)=>{
 const trunkX=s*.5;c.strokeStyle='#6c6b60';c.lineWidth=7;c.beginPath();c.moveTo(trunkX,s);c.lineTo(trunkX-4,s*.10);c.stroke();
 for(let i=0;i<9;i++){const side=i%2?1:-1,y=s*(.46-i*.047),x=trunkX+side*(s*.12+r()*s*.18);c.lineWidth=2;c.beginPath();c.moveTo(trunkX,y+s*.13);c.quadraticCurveTo(trunkX+side*s*.12,y+.02*s,x,y);c.stroke();
  const retained=variant===0?i%2===1:variant===1&&i%3===0;
  if(retained)for(let k=0;k<2;k++){const size=s*(.16+r()*.06);c.drawImage(leafMap.image,x+(r()-.5)*s*.09-size/2,y+(r()-.5)*s*.07-size/2,size,size);}
 }
 });}
function branch(points,radius,segments=4,sides=5){const curve=new T.CatmullRomCurve3(points),g=new T.TubeGeometry(curve,segments,radius,sides,false),p=g.attributes.position;for(let ring=0;ring<=segments;ring++){const center=curve.getPointAt(ring/segments),scale=1-ring/segments*.78;for(let j=0;j<=sides;j++){const i=ring*(sides+1)+j;p.setXYZ(i,center.x+(p.getX(i)-center.x)*scale,center.y+(p.getY(i)-center.y)*scale,center.z+(p.getZ(i)-center.z)*scale);}}g.computeVertexNormals();return g;}
export function createAutumnBeechGeometry(variant){
 const r=woodlandRandom(583+variant*139),wood=[],leaves=[],lean=new T.Vector3((r()-.5)*.07,0,(r()-.5)*.07);
 wood.push(branch([new T.Vector3(),new T.Vector3(lean.x*.3,.3,lean.z*.3),new T.Vector3(lean.x,.65,lean.z),new T.Vector3(lean.x*.8,1,lean.z*1.2)],.0135,10,8));
 for(let k=0;k<4;k++){const a=k*Math.PI/2+variant;wood.push(branch([new T.Vector3(0,.06,0),new T.Vector3(Math.cos(a)*.025,.015,Math.sin(a)*.025),new T.Vector3(Math.cos(a)*.055,0,Math.sin(a)*.055)],.0075,3,4));}
 for(let b=0;b<9;b++){const a=b*2.399+variant,base=.40+b*.057,spread=(.17+r()*.12)*(1-b*.035),start=new T.Vector3(lean.x*base,base,lean.z*base),mid=new T.Vector3(Math.cos(a)*spread*.6+lean.x,base+.06,Math.sin(a)*spread*.6+lean.z),end=new T.Vector3(Math.cos(a)*spread+lean.x,Math.min(1.05,base+.14+r()*.06),Math.sin(a)*spread+lean.z);wood.push(branch([start,mid,end],.0043*(1-b/18),4,5));
  for(let twig=0;twig<2;twig++){const angle=a+(twig?-.55:.55),tip=end.clone().add(new T.Vector3(Math.cos(angle)*.07,.045+r()*.03,Math.sin(angle)*.07));wood.push(branch([mid.clone().lerp(end,.5),end.clone().lerp(tip,.5),tip],.0013,3,4));
   // Retained pale leaf patches; bare branches remain the dominant silhouette.
   if(variant===2||variant===1&&b%3!==0||variant===0&&b%2===0)continue;
   for(let k=0;k<3;k++){const size=.14+r()*.065,g=new T.PlaneGeometry(size,size*.8);g.rotateX((r()-.5)*2.5);g.rotateY(r()*6.28);g.translate(tip.x+(r()-.5)*.07,tip.y+(r()-.5)*.09,tip.z+(r()-.5)*.07);leaves.push(g);}
  }
 }
 return {wood:merge(wood),leaves:leaves.length?merge(leaves):new T.PlaneGeometry(0,0)};
}
function scope(engine,distance){return engine.survey?.segments?.some(s=>s.forest&&distance>=s.from&&distance<s.to)??false;}
async function loadStock(engine){const maps={},state=engine.dentenbergWoodland;await Promise.all([['map','diff'],['normalMap','nor_gl'],['roughnessMap','rough']].map(async([key,suffix])=>{const path=`assets/dentenberg/forest_floor_${suffix}_1k.jpg`;try{const map=await new T.TextureLoader().loadAsync(path);map.colorSpace=key==='map'?T.SRGBColorSpace:T.NoColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;map.repeat.setScalar(1.6/2.1);map.anisotropy=Math.min(8,engine.renderer.capabilities.getMaxAnisotropy());maps[key]=map;state.assetsLoaded++;}catch{state.assetFallbacks.push(path);}}));return maps;}
function groundShader(material,aerial,{trail=false}={}){
 material.onBeforeCompile=shader=>{
  shader.uniforms.woodlandAerial={value:aerial};
  const attributes=trail?'attribute vec2 woodlandTrail;varying vec2 vWoodlandTrail;':'attribute vec2 woodlandPhotoUv;attribute float woodlandFade;varying vec2 vWoodlandPhotoUv;varying float vWoodlandFade;';
  shader.vertexShader=attributes+'varying vec2 vWoodlandWorld;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvWoodlandWorld=position.xz;'+(trail?'vWoodlandTrail=woodlandTrail;':'vWoodlandPhotoUv=woodlandPhotoUv;vWoodlandFade=woodlandFade;'));
  shader.fragmentShader='uniform sampler2D woodlandAerial;varying vec2 vWoodlandWorld;'+(trail?'varying vec2 vWoodlandTrail;':'varying vec2 vWoodlandPhotoUv;varying float vWoodlandFade;')+'\n'+shader.fragmentShader;
  const variation='float woodlandNoise=sin(vWoodlandWorld.x*.73+sin(vWoodlandWorld.y*.51))*sin(vWoodlandWorld.y*.87);\n#ifdef USE_MAP\nvec2 secondUv=mat2(.8,-.6,.6,.8)*(vWoodlandWorld/2.1)+vec2(.31,.73);diffuseColor.rgb=mix(diffuseColor.rgb,texture2D(map,secondUv).rgb*diffuse,.34);\n#endif\ndiffuseColor.rgb*=.94+.06*woodlandNoise;';
  const worn='float line=abs(vWoodlandTrail.x+.08*sin(vWoodlandTrail.y*.29)+.025*sin(vWoodlandTrail.y*1.4));float wear=(1.0-smoothstep(.08,.58,line))*(.72+.10*woodlandNoise);vec3 dampEarth=vec3(.025,.022,.017)*(1.0+woodlandNoise*.24);diffuseColor.rgb=mix(diffuseColor.rgb,dampEarth,wear);';
  const feather='diffuseColor.rgb=mix(texture2D(woodlandAerial,vWoodlandPhotoUv).rgb,diffuseColor.rgb,clamp(vWoodlandFade,0.0,1.0));';
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\n'+variation+(trail?worn:feather));
 };
 material.customProgramCacheKey=()=>trail?'dentenberg-worn-leaf-trail-v1':'dentenberg-soft-floor-v1';
}
export async function prepareDentenbergWoodland(engine){
 if(engine.info.id!=='al-dente'||engine.dentenbergWoodlandEnabled===false||!engine.survey)return;
 const state=engine.dentenbergWoodland={assetsLoaded:0,assetFallbacks:[],active:false,nearTrees:0,nearShrubs:0,nearFerns:0,limits:LIMITS,lastX:Infinity,lastZ:Infinity};
 const stock=await loadStock(engine),video=engine.groundSource==='video',originalFloor=engine.surfaceTextures.floor;
 const map=video?repeat(originalFloor,2.1):stock.map??originalFloor;
 const base={map,roughness:1,side:T.DoubleSide,vertexColors:true,color:video?'#ede8de':'#c5b5a0'};
 if(video){base.bumpMap=map;base.bumpScale=.008;state.groundSource='private-video';}
 else{Object.assign(base,{normalMap:stock.map?stock.normalMap??null:null,normalScale:new T.Vector2(.24,.24),roughnessMap:stock.map?stock.roughnessMap??null:null});state.groundSource=stock.map?'cc0-autumn':'procedural-fallback';}
 state.materials={floor:new T.MeshStandardMaterial(base),trail:new T.MeshStandardMaterial({...base,color:video?'#f1ede4':'#c6b9a4'})};
 groundShader(state.materials.floor,engine.aerial);groundShader(state.materials.trail,engine.aerial,{trail:true});
 engine.surveyMaterials.floor=state.materials.floor;engine.surveyMaterials.leaves=state.materials.trail;
 engine.woodlandAt=d=>scope(engine,d);
}
export function selectDentenbergTrees(engine){
 const state=engine.dentenbergWoodland;if(!state)return;
 const trees=[],retained=[];
 for(const source of engine.world.trees){const nearest=engine.nearestRoad(source[0],source[2]);if(!scope(engine,nearest.d)||nearest.distance>LIMITS.lateralLimit){retained.push(source);continue;}
  const seed=woodlandSeed(source[0],source[2]),style=woodlandTreeStyle(seed);trees.push({id:trees.length,x:source[0],y:source[1],z:source[2],height:T.MathUtils.clamp(source[3],12,27),d:nearest.d,...style});
 }
 engine.world={...engine.world,trees:retained};state.trees=trees;state.treeChunks=indexWoodland(trees);state.totalTrees=trees.length;
}
export function configureWoodlandGround(engine,geometry,positions,photoUv){
 if(!engine.dentenbergWoodland)return;
 const fade=[];for(let i=0;i<positions.length;i+=3){const x=positions[i],z=positions[i+2],nearest=engine.nearestRoad(x,z),edge=9+Math.sin(x*.31)*1.8+Math.cos(z*.27)*1.4;fade.push(1-T.MathUtils.smoothstep(nearest.distance,edge,17));}
 geometry.setAttribute('woodlandPhotoUv',photoUv);geometry.setAttribute('woodlandFade',new T.Float32BufferAttribute(fade,1));
}
function pooled(geometry,material,capacity,group,shadow=false){const mesh=new T.InstancedMesh(geometry,material,capacity);mesh.count=0;mesh.frustumCulled=false;mesh.castShadow=shadow;mesh.receiveShadow=true;group.add(mesh);return mesh;}
function place(mesh,items,transform){const dummy=new T.Object3D();for(let i=0;i<items.length;i++){const item=items[i];dummy.position.set(item.x,item.y,item.z);dummy.rotation.set(0,item.yaw??0,0);dummy.scale.setScalar(1);transform(dummy,item);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);}mesh.count=items.length;mesh.instanceMatrix.needsUpdate=true;}
function offsetPoint(engine,distance,offset){const p=engine.at(distance),a=engine.at(distance-.5),b=engine.at(distance+.5),l=Math.hypot(b.x-a.x,b.z-a.z)||1;p.x-=(b.z-a.z)/l*offset;p.z+=(b.x-a.x)/l*offset;p.y=engine.localGround(p.x,p.z);return p;}
export function buildDentenbergWoodland(engine){
 const state=engine.dentenbergWoodland;if(!state)return;
 state.group=new T.Group();state.group.name='Dentenberg · spatial autumn woodland';engine.scene.add(state.group);
 const leafMap=beechAtlas(engine.beech),wood=new T.MeshStandardMaterial({map:engine.bark,color:'#cac9b7',roughness:1}),leaves=new T.MeshStandardMaterial({map:leafMap,alphaTest:.30,alphaToCoverage:true,side:T.DoubleSide,roughness:1,color:'#e5e0cf'});
 state.kits=[];state.far=[];
 for(let variant=0;variant<3;variant++){
  const kit=createAutumnBeechGeometry(variant);if(variant===2)kit.leaves.setDrawRange(0,0);
  state.kits.push({wood:pooled(kit.wood,wood,LIMITS.treeBudget,state.group,true),leaves:pooled(kit.leaves,leaves,LIMITS.treeBudget,state.group,true)});
  const items=state.trees.filter(t=>t.variant===variant),far=pooled(crossed(),new T.MeshStandardMaterial({map:distantBeech(leafMap,variant),alphaTest:.30,side:T.DoubleSide,color:'#c3bdad',roughness:1}),items.length,state.group);
  items.forEach((item,i)=>{item.far=far;item.farIndex=i;});place(far,items,(o,item)=>o.scale.set(item.height*.65,item.height*.97,item.height*.65));far.frustumCulled=true;far.computeBoundingSphere();state.far.push(far);
 }
 const shrubs=[],ferns=[],litter=[],r=woodlandRandom(1117),ps=engine.course.points;
 for(let i=1;i<ps.length-1;i++){const q=ps[i],surface=engine.survey.segments.find(s=>q.d>=s.from&&q.d<s.to);if(!surface?.forest)continue;
  for(const side of[-1,1]){
   const bush=offsetPoint(engine,q.d+(r()-.5)*3,side*(surface.width/2+1.5+r()*6));if(scope(engine,engine.nearestRoad(bush.x,bush.z).d)&&engine.roadClearance(bush.x,bush.z)>1.0)shrubs.push({id:shrubs.length,x:bush.x,y:bush.y,z:bush.z,size:.9+r()*2.6,yaw:r()*6.28});
   const fern=offsetPoint(engine,q.d,side*(surface.width/2+.45+r()*3.3));if(i%2===0&&scope(engine,engine.nearestRoad(fern.x,fern.z).d)&&engine.roadClearance(fern.x,fern.z)>.25)ferns.push({id:ferns.length,x:fern.x,y:fern.y+.015,z:fern.z,size:.15+r()*.28,yaw:r()*6.28});
   if(i%2===0){const p=offsetPoint(engine,q.d,side*(surface.width/2+.18+r()*.6));if(scope(engine,engine.nearestRoad(p.x,p.z).d))litter.push({id:litter.length,x:p.x,y:p.y+.018,z:p.z,size:.045+r()*.055,yaw:r()*6.28});}
  }
 }
 state.shrubChunks=indexWoodland(shrubs);state.fernChunks=indexWoodland(ferns);state.litterChunks=indexWoodland(litter);state.totalShrubs=shrubs.length;state.totalFerns=ferns.length;
 state.shrubLeaves=pooled(coniferSapling(),new T.MeshStandardMaterial({map:needles(),alphaTest:.27,alphaToCoverage:true,side:T.DoubleSide,color:'#eef1dc',roughness:1}),LIMITS.shrubBudget,state.group,true);
 const trunk=new T.CylinderGeometry(.008,.025,1,6);trunk.translate(0,.5,0);state.shrubTrunks=pooled(trunk,wood,LIMITS.shrubBudget,state.group);
 state.ferns=pooled(crossed(),new T.MeshStandardMaterial({map:brownBracken(),alphaTest:.30,side:T.DoubleSide,roughness:1,color:'#b7b492'}),LIMITS.fernBudget,state.group);
 const leaf=new T.CircleGeometry(1,5);leaf.rotateX(-Math.PI/2);state.litter=pooled(leaf,new T.MeshStandardMaterial({color:'#a18e72',roughness:1,side:T.DoubleSide}),100,state.group);
 state.nearSet=new Set();state.chunkCount=state.treeChunks.size;
}
function farMatrix(item,hidden){const dummy=new T.Object3D();dummy.position.set(item.x,item.y,item.z);dummy.rotation.y=item.yaw;dummy.scale.set(hidden?0:item.height*.65,hidden?0:item.height*.97,hidden?0:item.height*.65);dummy.updateMatrix();item.far.setMatrixAt(item.farIndex,dummy.matrix);item.far.instanceMatrix.needsUpdate=true;}
export function updateDentenbergWoodland(engine,distance,overview=false){
 const state=engine.dentenbergWoodland;if(!state)return;
 const weight=overview?0:forestWeight(distance,engine.survey.segments),wasActive=state.active;state.active=weight>0;state.weight=weight;state.group.visible=true;if(wasActive!==state.active)engine.nearRefresh=-Infinity;
 engine.hemisphere.intensity=T.MathUtils.lerp(2.1,1.50,weight);engine.sun.intensity=T.MathUtils.lerp(2.3,1.85,weight);engine.renderer.toneMappingExposure=T.MathUtils.lerp(1.12,1.08,weight);
 if(!overview){engine.scene.fog.near=T.MathUtils.lerp(500,120,weight);engine.scene.fog.far=T.MathUtils.lerp(1550,650,weight);}
 const p=engine.at(distance),epoch=engine.lastPresentationEpoch;
 if(Math.hypot(p.x-state.lastX,p.z-state.lastZ)<10&&overview===state.lastOverview&&epoch===state.lastEpoch)return;
 state.lastX=p.x;state.lastZ=p.z;state.lastOverview=overview;state.lastEpoch=epoch;
 const trees=overview?[]:collectNearby(state.treeChunks,p.x,p.z,LIMITS.treeRadius,LIMITS.treeBudget),next=new Set(trees);
 for(const old of state.nearSet)if(!next.has(old))farMatrix(old,false);for(const tree of trees)if(!state.nearSet.has(tree))farMatrix(tree,true);state.nearSet=next;
 for(let variant=0;variant<3;variant++){const selected=trees.filter(t=>t.variant===variant),transform=(o,t)=>{const h=t.height*.85;o.scale.set(h*t.spread,h,h/t.spread);};place(state.kits[variant].wood,selected,transform);place(state.kits[variant].leaves,selected,transform);}
 const shrubs=overview?[]:collectNearby(state.shrubChunks,p.x,p.z,LIMITS.shrubRadius,LIMITS.shrubBudget),ferns=overview?[]:collectNearby(state.fernChunks,p.x,p.z,LIMITS.fernRadius,LIMITS.fernBudget),litter=overview?[]:collectNearby(state.litterChunks,p.x,p.z,32,100);
 place(state.shrubLeaves,shrubs,(o,t)=>o.scale.set(t.size*.7,t.size,t.size*.7));place(state.shrubTrunks,shrubs,(o,t)=>o.scale.setScalar(t.size));place(state.ferns,ferns,(o,t)=>o.scale.set(t.size*1.4,t.size,t.size*1.4));place(state.litter,litter,(o,t)=>o.scale.set(t.size,1,t.size*.62));
 state.nearTrees=trees.length;state.nearShrubs=shrubs.length;state.nearFerns=ferns.length;
}
export async function prewarmDentenbergWoodland(engine){if(!engine.dentenbergWoodland)return;try{await engine.renderer.compileAsync(engine.scene,engine.camera);engine.dentenbergWoodland.prewarmStatus='complete';}catch{engine.dentenbergWoodland.prewarmStatus='fallback';}}
