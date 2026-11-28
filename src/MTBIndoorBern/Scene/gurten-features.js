import * as T from './vendor/three.module.js';

// The feature positions/dimensions are a visual interpretation of the official
// trail map and photographs, not a measured jump survey. Keep the route's DEM
// grade for trainer resistance; use this same lift for the road and camera.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
const seeded=(seed=913)=>()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);

export function gurtenLiftAt(distance,descriptors){
 if(!Number.isFinite(distance))return 0;
 let lift=0;
 for(const jump of descriptors?.jumps??[]){
  const start=finite(jump.distance,0),length=finite(jump.length,0),height=Math.max(0,finite(jump.height,0));
  if(length<=0||distance<start||distance>start+length)continue;
  const t=(distance-start)/length;
  if(jump.kind==='roller')lift=Math.max(lift,height*Math.sin(Math.PI*t)**2);
  else{
   const a=clamp(finite(jump.crestStart,.34),.15,.48),b=clamp(finite(jump.crestEnd,.60),a+.08,.82);
   const profile=t<a?smooth(t/a):t<=b?1:1-smooth((t-b)/(1-b));
   lift=Math.max(lift,height*profile);
  }
 }
 return lift;
}

export function gurtenWidthAt(distance,descriptors,baseWidth=2.8){
 baseWidth=Number.isFinite(baseWidth)?baseWidth:2.8;
 if(!Number.isFinite(distance))return baseWidth;
 let width=baseWidth;
 for(const jump of descriptors?.jumps??[]){
  const start=finite(jump.distance,0),length=finite(jump.length,0);
  if(length<=0||distance<start||distance>start+length)continue;
  const fade=Math.min(smooth((distance-start)/2),smooth((start+length-distance)/2));
  width=Math.max(width,baseWidth+(finite(jump.width,baseWidth)-baseWidth)*fade);
 }
 return width;
}

// The earth footprint must meet the ordinary ribbon at both ends: a full-width
// zero-height shoulder would otherwise leave a rectangular patch on the slope.
export function gurtenCrossSectionAt(distance,jump,baseWidth=2.8){
 const start=finite(jump.distance,0),length=finite(jump.length,0),height=Math.max(0,finite(jump.height,0));
 const envelope=length>0?Math.min(smooth((distance-start)/3),smooth((start+length-distance)/3)):0;
 const halfWidth=gurtenWidthAt(distance,{jumps:[jump]},baseWidth)/2,shoulder=(1.1+height*.6)*envelope;
 return {lift:gurtenLiftAt(distance,{jumps:[jump]}),halfWidth,shoulder,edge:halfWidth+shoulder};
}

function canvasTexture(width,height,paint){
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 paint(canvas.getContext('2d'),width,height);
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
 return texture;
}

export function createGurtenDirtTexture(palette={}){
 const random=seeded();
 const map=canvasTexture(512,512,(c,w,h)=>{
  c.fillStyle=palette.base??'#b6a18a';c.fillRect(0,0,w,h);
  // Fine, pale compacted aggregate, with occasional dark grains. The palette
  // follows trailnet's 2025 photographs; no photograph is used as a texture.
  for(let i=0;i<52000;i++){
   const shade=70+random()*95,size=.3+random()*1.4;
   c.fillStyle=`rgba(${shade+40},${shade+30},${shade+15},${.08+random()*.22})`;
   c.fillRect(random()*w,random()*h,size,size*.65);
  }
  for(let i=0;i<1300;i++){
   const x=random()*w,y=random()*h,size=.3+random()*1.8;
   c.fillStyle=i%7?(palette.grain??'#c9baa5'):'#756d5d';c.globalAlpha=.2+random()*.3;
   c.beginPath();c.ellipse(x,y,size,size*.65,random()*Math.PI,0,Math.PI*2);c.fill();
  }
  c.globalAlpha=.10;c.strokeStyle='#776a55';c.lineWidth=1;
  for(let k=0;k<12;k++){const x=w*(.25+k*.04);c.beginPath();c.moveTo(x,0);c.bezierCurveTo(x-7,h*.3,x+4,h*.7,x,h);c.stroke();}
  c.globalAlpha=1;
 });
 map.wrapS=map.wrapT=T.RepeatWrapping;return map;
}

function normalized(descriptors,length){
 const data={...descriptors};
 data.jumps=(descriptors?.jumps??[]).filter(j=>Number.isFinite(j.distance)&&Number.isFinite(j.length)&&j.length>0&&j.distance>=0&&j.distance+j.length<=length)
  .map(j=>({...j,height:clamp(finite(j.height,.7),0,3),width:clamp(finite(j.width,3),2,7),kind:j.kind==='roller'?'roller':'table'}));
 data.berms=(descriptors?.berms??[]).filter(b=>Number.isFinite(b.distance)&&Number.isFinite(b.length)&&b.length>0&&b.distance>=0&&b.distance+b.length<=length)
  .map(b=>({...b,height:clamp(finite(b.height,1),.2,2.8),width:clamp(finite(b.width,3.5),2.5,7),side:b.side<0?-1:1}));
 data.landmarks=(descriptors?.landmarks??[]).filter(s=>Number.isFinite(s.distance)&&s.distance>=0&&s.distance<=length);
 if(data.branding&&(!Number.isFinite(data.branding.distance)||data.branding.distance<0||data.branding.distance>length))throw Error('The El Tony sign position is outside the course.');
 return data;
}

export function prepareGurtenFeatures(engine,descriptors){
 const data=normalized(descriptors,engine.course.length);
 engine.gurtenFeatures=data;
 engine.featureHeight=distance=>gurtenLiftAt(distance,data);
 engine.featureWidth=(distance,baseWidth=2.8)=>gurtenWidthAt(distance,data,baseWidth);
 engine.gurtenEarthTexture=createGurtenDirtTexture(data.palette);
 const zones=[];
 if(data.branding){
  const b=data.branding,frame=frameAt(engine,b.distance),board=frame.p.clone().addScaledVector(frame.side,finite(b.offset,4.2)*(b.side<0?-1:1));
  zones.push({x:board.x,z:board.z,radius:1.9});
  // A narrow viewing corridor from the preview position, not an open clearing
  // through the forest. Its endpoints stay within 22 m of the actual board.
  const preview=engine.at(clamp(finite(data.previewDistance,b.distance-14),Math.max(0,b.distance-22),b.distance));
  zones.push({x:board.x,z:board.z,x2:preview.x,z2:preview.z,radius:.85});
  if(b.flags!==false){
   const jump=data.jumps.find(j=>j.id===b.featureId),d=jump?jump.distance+jump.length*finite(jump.crestStart,.34):b.distance+8,flagFrame=frameAt(engine,d),off=(jump?.width??3.4)/2+.7;
   for(const side of[-1,1]){const p=flagFrame.p.clone().addScaledVector(flagFrame.side,off*side);zones.push({x:p.x,z:p.z,radius:1.2});}
  }
 }
 engine.gurtenVegetationZones=zones;
 engine.gurtenVegetationClearance=(x,z)=>gurtenVegetationClearanceAt(x,z,zones);
 engine.gurtenKeepClear=(x,z)=>engine.gurtenVegetationClearance(x,z)<=0;
 return data;
}

// Signed distance: negative/zero means vegetation should be excluded. Infinity
// means the course has no branding zones. Independent of Three.js/DOM for tests.
export function gurtenVegetationClearanceAt(x,z,zones){
 let distance=Infinity;
 for(const zone of zones??[]){
  let cx=zone.x,cz=zone.z;
  if(Number.isFinite(zone.x2)&&Number.isFinite(zone.z2)){
   const dx=zone.x2-zone.x,dz=zone.z2-zone.z,length=dx*dx+dz*dz,t=length>0?clamp(((x-zone.x)*dx+(z-zone.z)*dz)/length,0,1):0;
   cx+=dx*t;cz+=dz*t;
  }
  distance=Math.min(distance,Math.hypot(x-cx,z-cz)-zone.radius);
 }
 return distance;
}

function frameAt(engine,distance){
 const p=engine.at(distance),a=engine.at(Math.max(0,distance-.7)),b=engine.at(Math.min(engine.course.length,distance+.7));
 const forward=b.clone().sub(a).setY(0).normalize();
 return {p,forward,side:new T.Vector3(-forward.z,0,forward.x)};
}

function localGround(engine,x,z,fallback){return engine.localGround?.(x,z)??engine.height?.(x,z)??fallback;}

function baseWidthAt(engine,distance){
 const segments=engine.survey?.segments;
 return (segments?.find(s=>distance>=s.from&&distance<s.to)??segments?.at(-1))?.width??2.8;
}

function pileSurface(engine,jump,distance,offset){
 const {p,side}=frameAt(engine,distance),x=p.x+side.x*offset,z=p.z+side.z*offset;
 const {lift,halfWidth:half,shoulder}=gurtenCrossSectionAt(distance,jump,baseWidthAt(engine,distance));
 const blend=smooth((Math.abs(offset)-half)/Math.max(.001,shoulder)),base=localGround(engine,x,z,p.y);
 return new T.Vector3(x,T.MathUtils.lerp(p.y+lift,base,blend)+.015,z);
}

function meshFromRows(rows,positions,uvs,indices){
 const first=positions.length/3,columns=rows[0].length;
 rows.forEach((row,i)=>row.forEach((p,j)=>{
  positions.push(p.x,p.y,p.z);uvs.push(p.x/2,p.z/2);
  if(i&&j<columns-1){const a=first+(i-1)*columns+j;indices.push(a,a+columns,a+1,a+1,a+columns,a+columns+1);}
 }));
}

export function buildGurtenEarth(engine,data,group){
 const positions=[],uvs=[],indices=[],materialGroups=[];
 for(const jump of data.jumps){
  const steps=Math.max(12,Math.ceil(jump.length/.45)),rows=[];
  for(let i=0;i<=steps;i++){
   const d=jump.distance+jump.length*i/steps,{halfWidth:half,edge}=gurtenCrossSectionAt(d,jump,baseWidthAt(engine,d));
   const lateral=[-edge,-(half+edge)/2,-half,-half*.5,0,half*.5,half,(half+edge)/2,edge];
   rows.push(lateral.map(off=>pileSurface(engine,jump,d,off)));
  }
  const start=indices.length;meshFromRows(rows,positions,uvs,indices);
  materialGroups.push({start,count:indices.length-start,materialIndex:engine.pilotAt?.(jump.distance+jump.length/2)?1:0});
 }
 for(const berm of data.berms){
  const steps=Math.max(12,Math.ceil(berm.length/.7)),half=berm.width/2,rows=[];
  // A filled earthen bank rises outside the wheel line, then merges into the
  // local forest ground. It follows the actual route curve rather than a torus.
  for(let i=0;i<=steps;i++){
   const t=i/steps,d=berm.distance+berm.length*t,{p,side}=frameAt(engine,d),window=Math.sin(t*Math.PI)**2,footprint=smooth(Math.min(t/.16,(1-t)/.16));
   const row=[];
   for(let j=0;j<=7;j++){
    const u=j/7,off=berm.side*(half*.65+u*(half*.8+1.6)*footprint),x=p.x+side.x*off,z=p.z+side.z*off;
    const rise=u<.64?Math.sin(u/.64*Math.PI/2)**2:1-smooth((u-.64)/.36);
    const blend=smooth((u-.65)/.35),base=T.MathUtils.lerp(p.y,localGround(engine,x,z,p.y),blend);
    row.push(new T.Vector3(x,base+berm.height*window*rise+.02,z));
   }
   if(berm.side<0)row.reverse();rows.push(row);
  }
  const start=indices.length;meshFromRows(rows,positions,uvs,indices);
  materialGroups.push({start,count:indices.length-start,materialIndex:engine.pilotAt?.(berm.distance+berm.length/2)?1:0});
 }
 if(!positions.length)return 0;
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
 const material=new T.MeshStandardMaterial({map:engine.gurtenEarthTexture,bumpMap:engine.gurtenEarthTexture,bumpScale:.018,roughness:1,color:'#ffffff',side:T.DoubleSide});
 if(engine.elTonyPilot)for(const g of materialGroups)geometry.addGroup(g.start,g.count,g.materialIndex);
 const mesh=new T.Mesh(geometry,engine.elTonyPilot?[material,engine.elTonyPilot.materials.featureEarth]:material);mesh.name='Gurten · compacted earth tables and berms';mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);
 return indices.length/3;
}

function timberTexture(){
 const random=seeded(700);
 const texture=canvasTexture(128,512,(c,w,h)=>{
  c.fillStyle='#97836a';c.fillRect(0,0,w,h);
  for(let i=0;i<320;i++){c.strokeStyle=`rgba(${45+random()*100},${35+random()*75},${23+random()*50},.30)`;c.lineWidth=.4+random()*1.3;const x=random()*w;c.beginPath();c.moveTo(x,0);c.bezierCurveTo(x-5,h*.3,x+7,h*.6,x+2,h);c.stroke();}
 });texture.wrapS=texture.wrapT=T.RepeatWrapping;return texture;
}

function logoBoardTexture(logo){
 return canvasTexture(768,1200,(c,w,h)=>{
  c.fillStyle='#071217';c.fillRect(0,0,w,h);
  if(logo){const size=w*.83,scale=Math.min(size/logo.width,size/logo.height);c.drawImage(logo,(w-logo.width*scale)/2,50,logo.width*scale,logo.height*scale);}
  c.strokeStyle='#d8c9a2';c.lineWidth=2;c.beginPath();c.moveTo(75,823);c.lineTo(w-75,823);c.stroke();
  c.fillStyle='#e4d3ac';c.textAlign='center';c.font='500 78px Segoe UI';c.fillText('Jump Line',w/2,953);c.font='38px Segoe UI';c.fillText('powered by El Tony',w/2,1045);
 });
}

function labelTexture(label,detail){
 return canvasTexture(768,360,(c,w,h)=>{
  c.fillStyle='#15241f';c.fillRect(0,0,w,h);c.strokeStyle='#dfd4b9';c.lineWidth=5;c.strokeRect(16,16,w-32,h-32);
  c.fillStyle='#f1e8d2';c.textAlign='center';c.font='bold 56px Segoe UI';c.fillText(String(label).slice(0,26),w/2,163);
  c.font='29px Segoe UI';c.fillText(String(detail??'').slice(0,42),w/2,245);
 });
}

function addBoard(engine,group,wood,texture,descriptor,branding=false){
 const {p,forward,side}=frameAt(engine,descriptor.distance),offset=finite(descriptor.offset,branding?4.2:2.8)*(descriptor.side<0?-1:1);
 const node=new T.Group(),width=finite(descriptor.width,branding?1.2:1.6),height=finite(descriptor.height,branding?1.9:.75),bottom=branding ? .55 : 1.05;
 node.position.copy(p).addScaledVector(side,offset);node.position.y=localGround(engine,node.position.x,node.position.z,p.y);node.rotation.y=Math.atan2(-forward.x,-forward.z);
 function beam(x,y,w,h,depth=.08){const beam=new T.Mesh(new T.BoxGeometry(w,h,depth),wood);beam.position.set(x,y,-.035);beam.castShadow=beam.receiveShadow=true;node.add(beam);}
 for(const sign of[-1,1]){beam(sign*(width/2+.045),(bottom+height)/2,.09,bottom+height+.15);}
 for(const y of[bottom-.025,bottom+height+.025])beam(0,y,width+.16,.075);
 const board=new T.Mesh(new T.PlaneGeometry(width,height),new T.MeshBasicMaterial({map:texture,side:T.DoubleSide,toneMapped:false}));board.position.set(0,bottom+height/2,.018);node.add(board);node.name=branding?'El Tony · Jump Line board':String(descriptor.label??'Gurten landmark');group.add(node);
 return board;
}

function featherTexture(logo){
 return canvasTexture(512,1536,(c,w,h)=>{
  c.fillStyle='#112549';c.beginPath();c.moveTo(38,h);c.lineTo(38,310);c.bezierCurveTo(36,125,125,20,247,18);c.bezierCurveTo(448,20,493,184,489,410);c.lineTo(470,1120);c.bezierCurveTo(464,1315,358,1450,38,h);c.closePath();c.fill();
  if(logo){const scale=350/logo.width;c.drawImage(logo,86,500,logo.width*scale,logo.height*scale);}
 });
}

function addFeather(engine,group,material,distance,offset){
 const {p,forward,side}=frameAt(engine,distance),base=p.clone().addScaledVector(side,offset);
 const data=engine.gurtenFeatures,jump=data.jumps.find(j=>distance>=j.distance&&distance<=j.distance+j.length);
 base.y=jump?pileSurface(engine,jump,distance,offset).y:localGround(engine,base.x,base.z,p.y);
 const node=new T.Group();node.position.copy(base);node.rotation.y=Math.atan2(-forward.x,-forward.z);
 const pole=new T.Mesh(new T.CylinderGeometry(.013,.019,3.4,6),new T.MeshStandardMaterial({color:'#3b4447',metalness:.45,roughness:.65}));pole.position.set(-.33,1.7,0);pole.castShadow=true;node.add(pole);
 const geometry=new T.PlaneGeometry(.85,3.2,4,10),positions=geometry.getAttribute('position');
 for(let i=0;i<positions.count;i++){const x=positions.getX(i),y=positions.getY(i);positions.setZ(i,.035*Math.sin(y*3+x*4)+.04*x*x);}
 geometry.computeVertexNormals();const flag=new T.Mesh(geometry,material);flag.position.y=1.78;flag.castShadow=true;node.add(flag);group.add(node);return flag;
}

export async function addGurtenFeatures(engine,descriptors=engine.gurtenFeatures){
 const data=engine.gurtenFeatures??prepareGurtenFeatures(engine,descriptors),group=new T.Group();group.name='Gurtentrail · reference-based features';engine.scene.add(group);engine.gurtenFeatureGroup=group;
 const triangles=buildGurtenEarth(engine,data,group),wood=new T.MeshStandardMaterial({map:timberTexture(),color:'#d3c6ac',roughness:1});
 for(const mark of data.landmarks)addBoard(engine,group,wood,labelTexture(mark.label,mark.detail),mark);
 let logo=null,logoTexture=null,brandBoard=null,flagCount=0;
 if(data.branding){
  if(!data.branding.logo)throw Error('The Gurten course requires the El Tony logo.');
  logoTexture=await new T.TextureLoader().loadAsync(`${engine.info.folder}/${data.branding.logo}`);logo=logoTexture.image;
  brandBoard=addBoard(engine,group,wood,logoBoardTexture(logo),data.branding,true);
  if(data.branding.flags!==false){
   const jump=data.jumps.find(j=>j.id===data.branding.featureId),d=jump?jump.distance+jump.length*finite(jump.crestStart,.34):data.branding.distance+8;
   const off=(jump?.width??3.4)/2+.7,texture=featherTexture(logo),material=new T.MeshStandardMaterial({map:texture,alphaTest:.4,side:T.DoubleSide,roughness:1,color:'#ffffff'});
   for(const side of[-1,1])addFeather(engine,group,material,d,side*off);flagCount=2;
  }
  logoTexture.dispose();
 }
 engine.gurtenFeatureStats={jumps:data.jumps.length,berms:data.berms.length,earthTriangles:triangles,elTonyLogoLoaded:!!logo,elTonyFlags:flagCount,approximatePlacement:data.approximatePlacement!==false};
 engine.gurtenBrandState=()=>{
  if(!brandBoard)return null;
  engine.scene.updateMatrixWorld();engine.camera.updateMatrixWorld();
  const centre=brandBoard.getWorldPosition(new T.Vector3()),projected=centre.clone().project(engine.camera),box=new T.Box3().setFromObject(brandBoard),points=[];
  for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z])points.push(new T.Vector3(x,y,z).project(engine.camera));
  return {distance:engine.camera.position.distanceTo(centre),visible:projected.z>=-1&&projected.z<=1&&Math.abs(projected.x)<=1&&Math.abs(projected.y)<=1,
   bounds:{left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.max(...points.map(p=>p.y)),bottom:Math.min(...points.map(p=>p.y))}};
 };
 return group;
}
