import * as T from './vendor/three.module.js';
const rng=(seed=61)=>()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
function texture(paint){const c=document.createElement('canvas');c.width=c.height=512;paint(c.getContext('2d'),512);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=8;return t;}
function aggregate(kind){const r=rng(kind==='asphalt'?44:97);return texture((c,s)=>{c.fillStyle=kind==='asphalt'?'#555955':'#827e6d';c.fillRect(0,0,s,s);for(let i=0;i<45000;i++){const v=r()*65+35;c.fillStyle=kind==='asphalt'?`rgba(${v},${v+3},${v+2},.35)`:`rgba(${v+45},${v+40},${v+25},.6)`;const w=kind==='asphalt'?.4+r()*1.5:1+r()*4;c.fillRect(r()*s,r()*s,w,w*.65);}if(kind==='asphalt'){c.strokeStyle='#323735';c.lineWidth=.8;for(let i=0;i<4;i++){c.beginPath();let x=r()*s;c.moveTo(x,0);for(let y=0;y<s;y+=20){x+=(r()-.5)*12;c.lineTo(x,y);}c.stroke();}}});}
function genericLeafFloor(){const r=rng(771);return texture((c,s)=>{c.fillStyle='#625444';c.fillRect(0,0,s,s);for(let i=0;i<26000;i++){c.fillStyle=`rgba(${35+r()*60},${30+r()*45},${22+r()*30},.3)`;c.fillRect(r()*s,r()*s,1+r()*3,1+r()*3);}for(let i=0;i<2000;i++){c.save();c.translate(r()*s,r()*s);c.rotate(r()*Math.PI*2);c.fillStyle=['#7c6245','#a68c61','#9a784c','#b39e76','#675640'][i%5];c.beginPath();c.ellipse(0,0,2+r()*5,1+r()*2,0,0,Math.PI*2);c.fill();c.restore();}});}
export function surfaceAt(renderer,d){const segs=renderer.survey?.segments;return segs?.find(s=>d>=s.from&&d<s.to)??segs?.at(-1)??{surface:'gravel',width:2.8,forest:false};}
export async function loadSurvey(renderer){
 const response=await fetch(`${renderer.info.folder}/appearance.json`);if(response.status===404)return;if(!response.ok)throw Error('No es pot llegir l’aspecte del circuit');
 renderer.survey=await response.json();let source;
 try{if(!renderer.survey.texture)throw Error('Use generated ground');source=await new T.TextureLoader().loadAsync(`${renderer.info.folder}/${renderer.survey.texture}`);renderer.groundSource='video';}
 catch{source=genericLeafFloor();renderer.groundSource='procedural';}
 if(renderer.survey.foliageTexture){renderer.beech=await new T.TextureLoader().loadAsync(`${renderer.info.folder}/${renderer.survey.foliageTexture}`);renderer.beech.colorSpace=T.SRGBColorSpace;renderer.beech.anisotropy=4;}
 // Mirror the extracted ground patch at the borders, preserving its real leaf detail.
 const floor=texture((c,s)=>{for(let y=0;y<2;y++)for(let x=0;x<2;x++){c.save();c.translate(x?s:0,y?s:0);c.scale(x?-1:1,y?-1:1);c.drawImage(source.image,0,0,s/2,s/2);c.restore();}
  // Remove broad lighting bands from the camera crop while keeping the photographed leaf detail.
  const pixels=c.getImageData(0,0,s,s),a=pixels.data,rows=new Float64Array(s),cols=new Float64Array(s);let mean=0;
  for(let y=0;y<s;y++)for(let x=0;x<s;x++){const i=(y*s+x)*4,v=(a[i]+a[i+1]+a[i+2])/3;rows[y]+=v/s;cols[x]+=v/s;mean+=v/(s*s);}
  for(let y=0;y<s;y++)for(let x=0;x<s;x++){const i=(y*s+x)*4,correction=(mean*2-rows[y]-cols[x])*.8;for(let k=0;k<3;k++)a[i+k]=Math.max(0,Math.min(255,a[i+k]+correction));}c.putImageData(pixels,0,0);
 });source.dispose();
 const worn=texture((c,s)=>{c.drawImage(floor.image,0,0);const r=rng(8);for(let i=0;i<7000;i++){const x=s*.5+(r()+r()-1)*s*.25,y=r()*s;c.fillStyle=`rgba(42,37,30,${r()*.27})`;c.fillRect(x,y,1+r()*9,2+r()*13);}});
 renderer.surfaceTextures={asphalt:aggregate('asphalt'),gravel:aggregate('gravel'),leaves:worn,floor};
 renderer.surveyMaterials=Object.fromEntries(Object.entries(renderer.surfaceTextures).map(([key,map])=>[key,new T.MeshStandardMaterial({map,bumpMap:map,bumpScale:key==='asphalt'?.012:.035,roughness:1,side:T.DoubleSide,vertexColors:true})]));
}
function ribbon(renderer,rows,material,worldUv=false){const p=[],uv=[],colors=[],idx=[];const ps=renderer.course.points;
 for(let i=0;i<ps.length;i++){const q=ps[i],a=ps[Math.max(0,i-1)],b=ps[Math.min(ps.length-1,i+1)],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz)||1;const row=rows(q,i);
  row.forEach(v=>{const x=q.x-dz/l*v.off,z=q.z+dx/l*v.off,w=surfaceAt(renderer,q.d).width/2,t=T.MathUtils.smoothstep(Math.abs(v.off),w+1,22),y=T.MathUtils.lerp(q.y,renderer.height(x,z),t);p.push(x,y+v.lift,z);uv.push(...(worldUv==='aerial'?renderer.uv(x,z):worldUv?[x/1.6,z/1.6]:[v.off/2,q.d/2]));const color=new T.Color(v.color??'#ffffff');colors.push(color.r,color.g,color.b);});
  if(i){const count=row.length;for(let j=0;j<count-1;j++){const k=(i-1)*count+j;idx.push(k,k+count,k+1,k+1,k+count,k+count+1);}}
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(idx);g.computeVertexNormals();const mesh=new T.Mesh(g,material);mesh.receiveShadow=true;renderer.scene.add(mesh);return mesh;
}
export function buildSurveyRoad(renderer){
 const ps=renderer.course.points;
 // A single height field cannot fold over itself at a hairpin, unlike wide road ribbons.
 buildSurveyGround(renderer);
 // Segment groups share the same centreline and elevations as the physics model.
 const mesh=ribbon(renderer,q=>{const s=surfaceAt(renderer,q.d);const w=s.width*(1+(s.forest ? .07 : .015)*Math.sin(q.d*.13));return [-1,-.82,0,.82,1].map(side=>({off:side*w/2,lift:.062,color:s.surface==='leaves'?'#a09b8c':'#dedbd0'}));},Object.values(renderer.surveyMaterials).slice(0,3),true);
 mesh.geometry.clearGroups();let previous=-1,start=0,count=0;const order=['asphalt','gravel','leaves'];
 for(let i=1;i<ps.length;i++){const kind=order.indexOf(surfaceAt(renderer,(ps[i-1].d+ps[i].d)/2).surface);if(kind!==previous&&count){mesh.geometry.addGroup(start,count,previous);start+=count;count=0;}previous=kind;count+=24;}if(count)mesh.geometry.addGroup(start,count,previous);
 // The recorded route revisits the same path with slightly different GPS/barometric heights.
 // Keep its original elevations, but hide the other pass immediately around the rider.
 const original=mesh.geometry.index.array.slice(),visible=new original.constructor(original.length);
 renderer.updateRoadVisibility=(distance,overview=false)=>{const rider=renderer.at(distance);let n=0,group=-1,groupStart=0;mesh.geometry.clearGroups();
  for(let i=1;i<ps.length;i++){const a=ps[i-1],b=ps[i],d=(a.d+b.d)/2,near=Math.hypot((a.x+b.x)/2-rider.x,(a.z+b.z)/2-rider.z);
   if(!overview&&near<20&&Math.abs(d-distance)>near*2+8)continue;
   const kind=order.indexOf(surfaceAt(renderer,d).surface);if(kind!==group){if(n>groupStart)mesh.geometry.addGroup(groupStart,n-groupStart,group);group=kind;groupStart=n;}
   visible.set(original.subarray((i-1)*24,i*24),n);n+=24;
  }
  if(n>groupStart)mesh.geometry.addGroup(groupStart,n-groupStart,group);mesh.geometry.index.array.set(visible);mesh.geometry.index.needsUpdate=true;mesh.geometry.setDrawRange(0,n);
 };
}
function buildSurveyGround(renderer){
 const spacing=2,cells=new Set(),vertices=new Map(),p=[],uv=[],color=[],indices=[[],[]];
 for(const q of renderer.course.points){const cx=Math.floor(q.x/spacing),cz=Math.floor(q.z/spacing);for(let dz=-15;dz<=15;dz++)for(let dx=-15;dx<=15;dx++)cells.add(`${cx+dx},${cz+dz}`);}
 function vertex(ix,iz,forest){const key=`${ix},${iz},${forest}`;if(vertices.has(key))return vertices.get(key);const x=ix*spacing,z=iz*spacing,index=p.length/3;p.push(x,renderer.localGround(x,z)-.025,z);uv.push(...(forest?[x/1.6,z/1.6]:renderer.uv(x,z)));const c=new T.Color(forest?'#b9b09a':'#e1dece');color.push(c.r,c.g,c.b);vertices.set(key,index);return index;}
 for(const cell of cells){const [ix,iz]=cell.split(',').map(Number),x=(ix+.5)*spacing,z=(iz+.5)*spacing,n=renderer.nearestRoad(x,z);if(n.distance>28)continue;const s=surfaceAt(renderer,n.d),forest=s.forest&&n.distance<17,kind=forest?1:0,a=vertex(ix,iz,forest),b=vertex(ix+1,iz,forest),c=vertex(ix,iz+1,forest),d=vertex(ix+1,iz+1,forest);indices[kind].push(a,c,b,b,c,d);}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setAttribute('color',new T.Float32BufferAttribute(color,3));g.setIndex([...indices[0],...indices[1]]);g.addGroup(0,indices[0].length,0);g.addGroup(indices[0].length,indices[1].length,1);g.computeVertexNormals();
 const material=new T.MeshStandardMaterial({map:renderer.aerial,roughness:1,vertexColors:true});const mesh=new T.Mesh(g,[material,renderer.surveyMaterials.floor]);mesh.receiveShadow=true;renderer.scene.add(mesh);
 renderer.localGroundVertices=p.length/3;renderer.localGroundMesh=mesh;renderer.localGroundAerialMaterial=material;renderer.localGroundForestUv=g.getAttribute("uv");const photoUv=[];for(let i=0;i<p.length;i+=3)photoUv.push(...renderer.uv(p[i],p[i+2]));renderer.localGroundPhotoUv=new T.Float32BufferAttribute(photoUv,2);
}
export function addSurveyTrees(renderer){
 const r=rng(153),ps=renderer.course.points,cells=new Map(),size=16;
 for(let i=0;i<ps.length-1;i++){const p=ps[i],key=Math.floor(p.x/size)+','+Math.floor(p.z/size);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(i);}
 function nearest(x,z){let best={distance:1e6,y:0,d:0},floor=Infinity;for(let ix=-2;ix<=2;ix++)for(let iz=-2;iz<=2;iz++)for(const i of cells.get((Math.floor(x/size)+ix)+','+(Math.floor(z/size)+iz))??[]){const a=ps[i],b=ps[i+1],dx=b.x-a.x,dz=b.z-a.z,t=T.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1),distance=Math.hypot(x-a.x-t*dx,z-a.z-t*dz);if(distance<4)floor=Math.min(floor,T.MathUtils.lerp(a.y,b.y,t)+Math.max(0,distance-1)*.3);if(distance<best.distance)best={distance,y:T.MathUtils.lerp(a.y,b.y,t),d:T.MathUtils.lerp(a.d,b.d,t)};}return {...best,floor};}
 function clearance(x,z){const n=nearest(x,z);return n.distance-surfaceAt(renderer,n.d).width/2;}
 renderer.roadClearance=clearance;renderer.nearestRoad=nearest;
 renderer.localGround=(x,z)=>{const n=nearest(x,z),raw=renderer.height(x,z);const base=n.distance>=22?raw:T.MathUtils.lerp(n.y,raw,T.MathUtils.smoothstep(n.distance,surfaceAt(renderer,n.d).width/2+1,22));return Math.min(base,n.floor-.15);};
 renderer.world={...renderer.world,trees:renderer.world.trees.filter(p=>clearance(p[0],p[2])>1.4).map(p=>[p[0],renderer.localGround(p[0],p[2]),...p.slice(2)])};
 for(let i=2;i<ps.length-2;i+=2){const q=ps[i],s=surfaceAt(renderer,q.d);if(!s.forest)continue;const b=ps[i+1],dx=b.x-q.x,dz=b.z-q.z,l=Math.hypot(dx,dz)||1;
  for(let k=0;k<6;k++){const off=(s.width/2+2+r()*15)*(k%2?1:-1),forward=(r()-.5)*7,x=q.x-dz/l*off+dx/l*forward,z=q.z+dx/l*off+dz/l*forward;if(clearance(x,z)<1.7)continue;renderer.world.trees.push([x,renderer.localGround(x,z),z,14+r()*12,r()<.5?1:0]);}
 }
}
export function buildSurveyDetails(renderer){
 const r=rng(29),ps=renderer.course.points,rocks=[],roots=[],shrubs=[],saplings=[];
 for(let i=2;i<ps.length-2;i+=2){const q=ps[i],s=surfaceAt(renderer,q.d),a=ps[i-1],b=ps[i+1],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz)||1;
  for(let k=0;k<(s.forest?5:1);k++){const off=(s.width/2+.6+r()*(s.forest?6:1.4))*(k%2?1:-1),x=q.x-dz/l*off,z=q.z+dx/l*off,y=renderer.localGround(x,z); if(s.forest){shrubs.push([x,y+.05,z,.35+r()*.75,r()*6]);if(k===3&&i%6===0)saplings.push([x,y,z,2+r()*2]);}else if(s.surface==='gravel')rocks.push([x,y+.06,z,.07+r()*.13]);}
  // Root placement is illustrative, not a surveyed obstacle. Restrict to observed forest sections.
  if(s.surface==='leaves'&&s.confidence==='observed'&&i%18===0)roots.push([q.x,q.y+.09,q.z,Math.atan2(dx,dz),s.width*.95]);
 }
 const dummy=new T.Object3D();function instances(geometry,material,items,place){const mesh=new T.InstancedMesh(geometry,material,items.length);items.forEach((v,i)=>{dummy.position.set(v[0],v[1],v[2]);dummy.rotation.set(0,0,0);dummy.scale.set(1,1,1);place(dummy,v,i);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});mesh.receiveShadow=true;mesh.computeBoundingSphere();renderer.scene.add(mesh);return mesh;}
 instances(new T.DodecahedronGeometry(1,0),new T.MeshStandardMaterial({color:'#8b8b7a',roughness:1}),rocks,(o,p)=>o.scale.set(p[3],p[3]*.45,p[3]*.8));
 instances(new T.CylinderGeometry(.018,.035,1,6),new T.MeshStandardMaterial({map:renderer.bark,roughness:1}),roots,(o,p)=>{o.rotation.set(0,p[3],Math.PI/2-.08);o.scale.y=p[4];});
 const foliage=texture((c,s)=>{const r=rng(82);for(let k=0;k<950;k++){const x=r()*s,y=r()*s,prob=1-Math.hypot((x-s/2)/(s/2),(y-s/2)/(s/2));if(r()>prob)continue;c.fillStyle=['#596544','#67724a','#89805b','#9e8756'][k%4];c.beginPath();c.ellipse(x,y,3+r()*9,2+r()*5,r()*6,0,Math.PI*2);c.fill();}});
 const g=new T.PlaneGeometry(1,1);g.translate(0,.4,0);for(const angle of[0,Math.PI/2])instances(g,new T.MeshLambertMaterial({map:renderer.beech??foliage,alphaTest:.4,side:T.DoubleSide}),shrubs,(o,p)=>{o.rotation.y=p[4]+angle;o.scale.set(p[3]*1.8,p[3]*1.5,1);});
 const youngTree=new T.PlaneGeometry(1,1);youngTree.translate(0,.5,0);
 for(const angle of[0,Math.PI/2])instances(youngTree,new T.MeshLambertMaterial({map:renderer.sprites[0],alphaTest:.4,side:T.DoubleSide}),saplings,(o,p)=>{o.scale.set(p[3]*.6,p[3],1);o.rotation.y=p[3]+angle;});
 renderer.surveyDetailCounts={shrubs:shrubs.length,saplings:saplings.length,roots:roots.length,rocks:rocks.length};
}
