import * as T from './vendor/three.module.js';
import {surfaceAt} from './course-details.js';

// Race-day set dressing is an interpretation, not a surveyed event installation.
// Geography, the riding line and its elevation remain the source-data geometry.
const rng=(seed=720)=>()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
const clamp=T.MathUtils.clamp;
const mat=(color,extra={})=>new T.MeshStandardMaterial({color,roughness:.83,...extra});
function canvasMap(width,height,paint){const c=document.createElement('canvas');c.width=width;c.height=height;paint(c.getContext('2d'),width,height);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.anisotropy=4;return t;}
function bannerTexture(title,subtitle='',color='#ebbf43'){
 return canvasMap(1024,256,(c,w,h)=>{c.fillStyle='#102d33';c.fillRect(0,0,w,h);c.fillStyle=color;c.fillRect(0,0,w,12);c.fillRect(0,h-12,w,12);c.textAlign='center';c.textBaseline='middle';c.fillStyle='#ffffff';c.font='700 66px Segoe UI';c.fillText(title,w/2,subtitle?106:128,w-70);if(subtitle){c.fillStyle=color;c.font='600 27px Segoe UI';c.fillText(subtitle,w/2,180,w-80);}for(let i=0;i<8;i++){c.fillStyle=i%2?'#f4f0d8':'#263f44';c.fillRect(i*32,h-42,32,30);c.fillRect(w-(i+1)*32,h-42,32,30);}});
}
function box(parent,w,h,d,x,y,z,material){const mesh=new T.Mesh(new T.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function tube(parent,a,b,r,material){const delta=new T.Vector3().subVectors(b,a),mesh=new T.Mesh(new T.CylinderGeometry(r,r,delta.length(),6),material);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());mesh.castShadow=true;parent.add(mesh);return mesh;}
function roadFrame(renderer,d){const p=renderer.at(clamp(d,0,renderer.course.length)),a=renderer.at(Math.max(0,d-4)),b=renderer.at(Math.min(renderer.course.length,d+4));const dir=b.sub(a).setY(0).normalize(),right=new T.Vector3(-dir.z,0,dir.x);return {p,dir,right,angle:Math.atan2(dir.x,dir.z)};}
function place(renderer,d,side=0){const f=roadFrame(renderer,d);f.p.addScaledVector(f.right,side);f.p.y=side?(renderer.localGround?.(f.p.x,f.p.z)??renderer.height(f.p.x,f.p.z)):f.p.y;return f;}
function addSign(renderer,group,frame,title,subtitle,width=6.3){
 const g=new T.Group();g.position.copy(frame.p);g.rotation.y=frame.angle;group.add(g);
 const dark=mat('#183c42'),yellow=mat('#edbd42'),silver=mat('#bcc6c5',{metalness:.65});
 box(g,.38,4.3,.5,-width/2,2.15,0,dark);box(g,.38,4.3,.5,width/2,2.15,0,dark);
 box(g,width+.4,.85,.55,0,4.05,0,dark);box(g,.7,.26,.8,-width/2,.13,0,yellow);box(g,.7,.26,.8,width/2,.13,0,yellow);
 for(const side of [-1,1])for(let i=0;i<4;i++)box(g,.4,.13,.55,side*width/2,.8+i*.7,0,yellow);
 const map=bannerTexture(title,subtitle),panel=new T.Mesh(new T.PlaneGeometry(width,.75),new T.MeshStandardMaterial({map,roughness:.9,side:T.DoubleSide}));panel.position.set(0,4.07,-.292);panel.rotation.y=Math.PI;g.add(panel);
 const back=panel.clone();back.position.z=.292;back.rotation.y=0;g.add(back);
 for(const side of[-1,1])tube(g,new T.Vector3(side*width/2,3.85,.2),new T.Vector3(side*(width/2+1.2),0,1),.018,silver);
 return g;
}
function flagTexture(warm=false){return canvasMap(256,1024,(c,w,h)=>{c.fillStyle=warm?'#d96343':'#153d47';c.fillRect(0,0,w,h);c.fillStyle='#eac04a';c.fillRect(0,0,14,h);c.fillRect(w-14,0,14,h);c.translate(w/2,h/2);c.rotate(Math.PI/2);c.textAlign='center';c.textBaseline='middle';c.fillStyle='#fff8dd';c.font='800 104px Segoe UI';c.fillText(warm?'RACE DAY':'EIGER 20',0,0,h-120);});}
function flags(renderer,group,locations,animated){
 const pole=mat('#ced4d2',{metalness:.6}),maps=[flagTexture(),flagTexture(true)];
 for(const [i,item] of locations.entries()){
  const f=place(renderer,item.d,item.side),g=new T.Group();g.position.copy(f.p);g.rotation.y=f.angle;group.add(g);
  const p=new T.Mesh(new T.CylinderGeometry(.018,.026,4.5,6),pole);p.position.y=2.25;g.add(p);
  const geo=new T.PlaneGeometry(.85,2.8,5,10),mesh=new T.Mesh(geo,new T.MeshStandardMaterial({map:maps[i%2],side:T.DoubleSide,roughness:1}));mesh.position.set(.43,2.95,0);mesh.rotation.y=Math.PI;mesh.userData.animatedRaceFlag=true;g.add(mesh);
  animated.push({mesh,base:geo.attributes.position.array.slice(),phase:i*.67});
 }
}
function barriers(renderer,group,start,end,side,rows){
 const steel=mat('#929f9e',{metalness:.65}),fabric=mat('#1b494d'),yellow=mat('#eec04c');
 for(let d=start;d<end;d+=3){const f=place(renderer,d,side),g=new T.Group();g.position.copy(f.p);g.rotation.y=f.angle;group.add(g);for(const z of[-1.25,1.25]){box(g,.06,1.05,.06,0,.53,z,steel);box(g,.75,.06,.08,0,.03,z,steel);}box(g,.07,.07,2.5,0,1.03,0,steel);box(g,.045,.045,2.5,0,.27,0,steel);box(g,.03,.48,2.32,0,.65,0,rows%2?fabric:yellow);for(let z=-1;z<=1;z+=.5)box(g,.035,.75,.035,0,.65,z,steel);rows++;}
}
function spectators(renderer,group,clusters){
 const random=rng(912),people=[];
 for(const cluster of clusters){for(let i=0;i<cluster.count;i++){const d=clamp(cluster.d+(random()-.5)*cluster.spread,2,renderer.course.length-2),side=(i%2?1:-1)*(surfaceAt(renderer,d).width/2+2.5+random()*1.8),f=place(renderer,d,side);if(!Number.isFinite(f.p.y))continue;people.push({p:f.p,angle:f.angle+(side>0?Math.PI/2:-Math.PI/2),scale:.84+random()*.2,shirt:new T.Color(['#e66147','#eac64a','#317c9a','#edf0e4','#586f9c','#7b9654'][i%6]),skin:new T.Color(['#c79771','#e6b898','#986a4c'][i%3]),pose:i%4});}}
 const parts={body:{g:new T.CapsuleGeometry(.19,.36,3,6),m:mat('#ffffff')},head:{g:new T.SphereGeometry(.135,8,6),m:mat('#ffffff')},leg:{g:new T.CylinderGeometry(.065,.075,.72,6),m:mat('#26383c')},arm:{g:new T.CylinderGeometry(.043,.052,.58,5),m:mat('#ffffff')},cap:{g:new T.SphereGeometry(.14,8,5,0,Math.PI*2,0,Math.PI/2),m:mat('#e7e3d6')}};
 const dummy=new T.Object3D(),rotation=new T.Quaternion();
 for(const [name,part] of Object.entries(parts)){const count=people.length*(name==='leg'||name==='arm'?2:1),mesh=new T.InstancedMesh(part.g,part.m,count);let index=0;for(const person of people){for(let side=0;side<(name==='leg'||name==='arm'?2:1);side++){const sign=side?1:-1;let x=0,y=1.2,z=0,lean=0;if(name==='head'){y=1.62;}if(name==='cap'){y=1.66;}if(name==='body'){y=1.15;}if(name==='leg'){x=sign*.1;y=.4;lean=sign*.07;}if(name==='arm'){x=sign*.31;y=person.pose===0?1.58:1.13;lean=person.pose===0?sign*.55:sign*.14;}
    dummy.position.set(x*person.scale,y*person.scale,z);dummy.position.applyAxisAngle(new T.Vector3(0,1,0),person.angle).add(person.p);dummy.scale.setScalar(person.scale);dummy.rotation.set(0,person.angle,lean);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);if(name==='body')mesh.setColorAt(index,person.shirt);else if(name==='head'||name==='arm')mesh.setColorAt(index,person.skin);index++;}}
  mesh.castShadow=name==='body';mesh.receiveShadow=true;mesh.computeBoundingSphere();group.add(mesh);
 }
 return people.length;
}
function aidTent(renderer,group,d,side){const f=place(renderer,d,side),g=new T.Group();g.position.copy(f.p);g.rotation.y=f.angle;group.add(g);const legs=mat('#d6d9d5',{metalness:.55}),cloth=mat('#ecbf48'),dark=mat('#25454a');for(const x of[-2,2])for(const z of[-1.5,1.5])box(g,.055,2.5,.055,x,1.25,z,legs);const roof=new T.Mesh(new T.ConeGeometry(2.55,1,4),cloth);roof.rotation.y=Math.PI/4;roof.scale.set(1.12,1,.85);roof.position.y=2.8;g.add(roof);box(g,3.8,.14,1.15,0,.94,.3,dark);for(const x of[-1.5,1.5])box(g,.08,.9,1,x,.45,.3,legs);const bottles=[mat('#bfdef0'),mat('#ece4bb')];for(let i=0;i<16;i++){const bottle=new T.Mesh(new T.CylinderGeometry(.035,.035,.16,7),bottles[i%2]);bottle.position.set(-1.5+i*.19,1.1,.25);g.add(bottle);}const panel=new T.Mesh(new T.PlaneGeometry(3.4,.46),new T.MeshStandardMaterial({map:bannerTexture('FEED ZONE','WATER · ENERGY'),side:T.DoubleSide}));panel.position.set(0,2.23,-1.54);panel.rotation.y=Math.PI;g.add(panel);return g;}

// Combine static set dressing per material. Individual rails/cups never cost a draw call.
function batchStatic(group){
 group.updateMatrixWorld(true);const batches=new Map(),remove=[];
 group.traverse(mesh=>{if(!mesh.isMesh||mesh.isInstancedMesh||mesh.userData.animatedRaceFlag||Array.isArray(mesh.material))return;const key=mesh.material.uuid;if(!batches.has(key))batches.set(key,{material:mesh.material,p:[],n:[],uv:[],shadow:false});const b=batches.get(key),g=(mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);for(const [name,out]of[['position',b.p],['normal',b.n],['uv',b.uv]]){const a=g.getAttribute(name);if(a)for(const v of a.array)out.push(v);else{const size=name==='uv'?2:3;for(let i=0;i<g.getAttribute('position').count*size;i++)out.push(0);}}b.shadow||=mesh.castShadow;g.dispose();remove.push(mesh);});
 for(const mesh of remove)mesh.parent.remove(mesh);
 for(const b of batches.values()){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(b.p,3));g.setAttribute('normal',new T.Float32BufferAttribute(b.n,3));g.setAttribute('uv',new T.Float32BufferAttribute(b.uv,2));g.computeBoundingSphere();const mesh=new T.Mesh(g,b.material);mesh.castShadow=b.shadow;mesh.receiveShadow=true;group.add(mesh);}
 return batches.size;
}

export function addEigerRace(renderer){
 if(renderer.info.id!=='eiger-20')return;
 const group=new T.Group();group.name='Eiger summer race-day scenery';renderer.scene.add(group);const animated=[];
 const sectors=renderer.info.sectors??[],length=renderer.course.length;
 const stations=[{d:35,count:58,spread:85},{d:Math.min(6800,length*.35),count:24,spread:80},{d:sectors[2]?.start??length*.56,count:26,spread:90},{d:length-80,count:40,spread:90}];
 const gates=[];gates.push(addSign(renderer,group,place(renderer,42),'EIGER · 20 KM','GRINDELWALD · START / FINISH',Math.max(6.3,surfaceAt(renderer,42).width+1.4)));
 for(const [i,sector] of sectors.entries()){if(i===0)continue;gates.push(addSign(renderer,group,place(renderer,sector.start+20),`SECTOR ${i+1}`,sector.name.toUpperCase(),Math.max(5.2,surfaceAt(renderer,sector.start).width+1.8)));}
 for(const side of[-1,1]){barriers(renderer,group,5,110,side*(surfaceAt(renderer,35).width/2+1.1),0);barriers(renderer,group,length-100,length-30,side*(surfaceAt(renderer,length-65).width/2+1.1),1);}
 const locations=[];for(const station of stations)for(let i=0;i<4;i++)locations.push({d:clamp(station.d-20+i*16,4,length-4),side:(i%2?1:-1)*(surfaceAt(renderer,station.d).width/2+2)});flags(renderer,group,locations,animated);
 aidTent(renderer,group,stations[1].d,9);aidTent(renderer,group,Math.min(stations[2].d+45,length-100),-9);
 const people=spectators(renderer,group,stations);
 // Sparse roadside pennants mark race direction without claiming surveyed positions.
 const poles=mat('#e9e0c9'),cloths=[mat('#ebc148',{side:T.DoubleSide}),mat('#efefdf',{side:T.DoubleSide}),mat('#d96545',{side:T.DoubleSide})];
 let pennants=0;for(let d=220;d<length-120;d+=420){const f=place(renderer,d,surfaceAt(renderer,d).width/2+1.3),g=new T.Group();g.position.copy(f.p);g.rotation.y=f.angle;group.add(g);box(g,.028,1.4,.028,0,.7,0,poles);const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute([0,1.38,0,.48,1.17,0,0,.96,0],3));geo.computeVertexNormals();g.add(new T.Mesh(geo,cloths[pennants%3]));pennants++;}
 const staticBatches=batchStatic(group);
 renderer.eigerRaceStats={arches:gates.length,spectators:people,flags:animated.length,aidStations:2,routePennants:pennants,staticBatches,season:'summer',mountainSource:renderer.world.alpineTerrain?'swisstopo far terrain':'swisstopo terrain',placement:'Illustrative race-day scenery along the official GPX'};
 renderer.updateEigerRace=(dt,overview)=>{renderer.eigerRaceTime=(renderer.eigerRaceTime??0)+Math.min(dt,.1);group.visible=!overview;for(const f of animated){const p=f.mesh.geometry.attributes.position,a=p.array;for(let i=0;i<a.length;i+=3){const reach=(f.base[i]+.425)/.85;a[i+2]=f.base[i+2]+Math.sin(renderer.eigerRaceTime*2+f.base[i+1]*2+f.phase)*reach*.1;}p.needsUpdate=true;}};
 addMeadowFlowers(renderer);
}

function addMeadowFlowers(renderer){const random=rng(1047),items=[];for(let d=40;d<renderer.course.length;d+=16){const s=surfaceAt(renderer,d);if(s.forest||s.surface==='asphalt')continue;for(let k=0;k<3;k++){const f=place(renderer,d+random()*10,(k%2?1:-1)*(s.width/2+1+random()*5));items.push([f.p.x,f.p.y+.13,f.p.z,.6+random()*.8,k]);}}
 const texture=canvasMap(64,128,(c,w,h)=>{c.strokeStyle='#548637';c.lineWidth=3;c.beginPath();c.moveTo(32,128);c.lineTo(30,35);c.stroke();c.fillStyle='#f2e6a5';for(let i=0;i<5;i++){c.beginPath();c.ellipse(32+Math.cos(i*1.26)*9,34+Math.sin(i*1.26)*9,7,4,i*1.26,0,Math.PI*2);c.fill();}c.fillStyle='#d9a92f';c.beginPath();c.arc(32,34,4,0,Math.PI*2);c.fill();});const geo=new T.PlaneGeometry(.17,.32);geo.translate(0,.16,0);const flowers=new T.InstancedMesh(geo,new T.MeshLambertMaterial({map:texture,alphaTest:.45,side:T.DoubleSide}),items.length),o=new T.Object3D();items.forEach((p,i)=>{o.position.set(p[0],p[1],p[2]);o.rotation.y=i*2.4;o.scale.setScalar(p[3]);o.updateMatrix();flowers.setMatrixAt(i,o.matrix);});flowers.computeBoundingSphere();renderer.scene.add(flowers);renderer.eigerRaceStats.wildflowers=items.length;}

export function buildAlpineBuildings(renderer){
 const walls=[],wood=[],roofs=[],windows=[];
 const append=(out,a,b,c)=>out.push(...a,...b,...c);
 const quad=(out,a,b,c,d)=>{append(out,a,b,c);append(out,b,d,c);};
 for(const building of renderer.world.buildings){const ps=building.footprint;if(ps.length<3)continue;const base=building.base,top=base+building.height,split=Math.max(base+.8,top-Math.min(2.8,building.height*.55));
  let longest=0,angle=0;for(let i=0;i<ps.length;i++){const a=ps[i],b=ps[(i+1)%ps.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len>longest){longest=len;angle=Math.atan2(b[1]-a[1],b[0]-a[0]);}quad(walls,[a[0],base,a[1]],[b[0],base,b[1]],[a[0],split,a[1]],[b[0],split,b[1]]);quad(wood,[a[0],split,a[1]],[b[0],split,b[1]],[a[0],top,a[1]],[b[0],top,b[1]]);
   const dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len;if(len>4&&building.height>3){for(let t=1.4;t<len-1;t+=2.5){const x=a[0]+dx*t,z=a[1]+dz*t,off=.04;quad(windows,[x-dx*.43+dz*off,split+.3,z-dz*.43-dx*off],[x+dx*.43+dz*off,split+.3,z+dz*.43-dx*off],[x-dx*.43+dz*off,Math.min(top-.25,split+1.35),z-dz*.43-dx*off],[x+dx*.43+dz*off,Math.min(top-.25,split+1.35),z+dz*.43-dx*off]);}}}
  const cx=ps.reduce((s,p)=>s+p[0],0)/ps.length,cz=ps.reduce((s,p)=>s+p[1],0)/ps.length,co=Math.cos(angle),si=Math.sin(angle),local=ps.map(p=>[(p[0]-cx)*co+(p[1]-cz)*si,-(p[0]-cx)*si+(p[1]-cz)*co]);const minx=Math.min(...local.map(p=>p[0]))-.55,maxx=Math.max(...local.map(p=>p[0]))+.55,minz=Math.min(...local.map(p=>p[1]))-.55,maxz=Math.max(...local.map(p=>p[1]))+.55,mid=(minz+maxz)/2,rise=Math.min(3.5,(maxz-minz)*.34),v=(x,y,z)=>[cx+x*co-z*si,y,cz+x*si+z*co];
  quad(roofs,v(minx,top+.12,minz),v(maxx,top+.12,minz),v(minx,top+rise,mid),v(maxx,top+rise,mid));quad(roofs,v(minx,top+rise,mid),v(maxx,top+rise,mid),v(minx,top+.12,maxz),v(maxx,top+.12,maxz));append(wood,v(minx+.55,top,minz+.55),v(minx+.55,top,maxz-.55),v(minx+.55,top+rise,mid));append(wood,v(maxx-.55,top,maxz-.55),v(maxx-.55,top,minz+.55),v(maxx-.55,top+rise,mid));
 }
 const timber=canvasMap(128,256,(c,w,h)=>{const r=rng(14);c.fillStyle='#76513a';c.fillRect(0,0,w,h);for(let y=0;y<h;y+=18){c.fillStyle=y%36?'#876347':'#6e4d35';c.fillRect(0,y,w,17);c.strokeStyle='#392c23';c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();}for(let i=0;i<500;i++){c.strokeStyle=`rgba(37,25,17,${r()*.25})`;c.beginPath();const y=r()*h;c.moveTo(r()*w,y);c.lineTo(r()*w,y+r()*2);c.stroke();}});timber.wrapS=timber.wrapT=T.RepeatWrapping;
 const glass=canvasMap(128,128,(c,w,h)=>{c.fillStyle='#cad7d2';c.fillRect(0,0,w,h);c.fillStyle='#26414b';c.fillRect(8,8,112,112);c.fillStyle='#b0b7a1';c.fillRect(61,8,6,112);c.fillRect(8,61,112,6);});
 for(const [positions,color,map] of[[walls,'#d3cbb8',null],[wood,'#c5ae91',timber],[roofs,'#66564e',null],[windows,'#ffffff',glass]]){if(!positions.length)continue;const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));if(map){const uv=[];for(let i=0;i<positions.length;i+=3)uv.push(map===glass?([0,1,0,1,1,0][Math.floor(i/3)%6]):(positions[i]+positions[i+2])/3,map===glass?([0,0,1,0,1,1][Math.floor(i/3)%6]):positions[i+1]/2);g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));}g.computeVertexNormals();const mesh=new T.Mesh(g,mat(color,{map,side:T.DoubleSide}));mesh.receiveShadow=true;mesh.castShadow=true;renderer.scene.add(mesh);}
}

export function alpineMaterialGeometry(vertices,indices){
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();const normal=g.attributes.normal.array,colors=[];
 for(let i=0;i<vertices.length;i+=3){const y=vertices[i+1],slope=1-Math.abs(normal[i+1]),noise=Math.sin(vertices[i]*.017+vertices[i+2]*.011)*.025,grass=new T.Color('#6c8050'),rock=new T.Color('#9c9b90'),snow=new T.Color('#e0e5df');const stone=clamp((y-1900)/850+slope*.8,0,1),c=grass.lerp(rock,stone);if(y>2750)c.lerp(snow,clamp((y-2900)/700+(Math.abs(normal[i+1])-.55)*.8,0,.86));c.multiplyScalar(.94+noise);colors.push(c.r,c.g,c.b);}
 g.setAttribute('color',new T.Float32BufferAttribute(colors,3));return g;
}

export function buildAlpineTerrain(renderer,source){
 const grid=renderer.world.terrain,left=grid.x0,right=left+(grid.nx-1)*grid.spacing,top=grid.z0,bottom=top+(grid.nz-1)*grid.spacing;
 const vertices=source.vertices.slice(),indices=[];let clippedTriangles=0;
 function clip(poly,axis,bound,sign){const result=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],ain=(a[axis]-bound)*sign>=0,bin=(b[axis]-bound)*sign>=0;if(ain)result.push(a);if(ain!==bin){const t=(bound-a[axis])/(b[axis]-a[axis]);result.push(a.map((v,j)=>v+(b[j]-v)*t));}}return result;}
 function emit(poly){if(poly.length<3)return;const start=vertices.length/3;for(const p of poly){const atVertical=(Math.abs(p[0]-left)<.001||Math.abs(p[0]-right)<.001)&&p[2]>=top-.001&&p[2]<=bottom+.001,atHorizontal=(Math.abs(p[2]-top)<.001||Math.abs(p[2]-bottom)<.001)&&p[0]>=left-.001&&p[0]<=right+.001;vertices.push(p[0],atVertical||atHorizontal?renderer.height(p[0],p[2]):p[1],p[2]);}for(let i=1;i<poly.length-1;i++)indices.push(start,start+i,start+i+1);}
 for(let i=0;i<source.indices.length;i+=3){const a=source.indices[i],b=source.indices[i+1],c=source.indices[i+2],ids=[a,b,c],xs=ids.map(j=>source.vertices[j*3]),zs=ids.map(j=>source.vertices[j*3+2]);const minx=Math.min(...xs),maxx=Math.max(...xs),minz=Math.min(...zs),maxz=Math.max(...zs);
  if(maxx<=left||minx>=right||maxz<=top||minz>=bottom){indices.push(a,b,c);continue;}
  if(minx>=left&&maxx<=right&&minz>=top&&maxz<=bottom)continue;
  // A centroid test leaves triangular holes at a high-/low-resolution mesh seam.
  // Clip each crossing triangle into four non-overlapping outside regions instead.
  const triangle=ids.map(j=>source.vertices.slice(j*3,j*3+3));emit(clip(triangle,0,left,-1));emit(clip(triangle,0,right,1));const middle=clip(clip(triangle,0,left,1),0,right,-1);emit(clip(middle,2,top,-1));emit(clip(middle,2,bottom,1));clippedTriangles++;
 }
 renderer.alpineSeamStats={clippedTriangles,edgeHeightsMatched:true};return alpineMaterialGeometry(vertices,indices);
}
