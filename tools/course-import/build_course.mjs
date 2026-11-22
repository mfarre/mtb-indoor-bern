import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import nodePath from 'node:path';
import {pathToFileURL} from 'node:url';
const work=nodePath.resolve(process.argv[2]??'');
if(!process.argv[2])throw Error('Usage: node build_course.mjs WORK_FOLDER');
const root=pathToFileURL(work+nodePath.sep);
const config=JSON.parse(await fs.readFile(new URL('manifest.json',root)));
const input=JSON.parse(await fs.readFile(new URL('input-route.json',root)));
const dir=new URL('terrain/',root);
const origin=config.origin;
const sx=111320*Math.cos(origin.lat*Math.PI/180), sz=111320;
const local=(lat,lon)=>[(lon-origin.lon)*sx,-(lat-origin.lat)*sz];
const tiles=new Map(), vertices=[], indices=[];
const step=180/2**14;
for(const file of (await fs.readdir(dir)).filter(x=>x.endsWith('.terrain'))){
 let b=await fs.readFile(new URL(file,dir));
 if(b[0]===31&&b[1]===139)b=zlib.gunzipSync(b);
 const [,tx,ty]=file.match(/14-(\d+)-(\d+)/).map(Number);
 const lo=b.readFloatLE(24), hi=b.readFloatLE(28), n=b.readUInt32LE(88);
 if(n>500000)throw Error('Invalid mesh '+file);
 let offset=92, arrays=[];
 for(let a=0;a<3;a++){let previous=0,vals=[];for(let i=0;i<n;i++){let code=b.readUInt16LE(offset);offset+=2;previous+=(code>>1)^-(code&1);vals.push(previous);}arrays.push(vals);}
 const size=n>65536?4:2;offset=Math.ceil(offset/size)*size;
 const count=b.readUInt32LE(offset);offset+=4;
 let highest=0,tri=[];
 for(let i=0;i<count*3;i++){let code=size===2?b.readUInt16LE(offset):b.readUInt32LE(offset);offset+=size;tri.push(highest-code);if(code===0)highest++;}
 const [u,v,h]=arrays;let vs=[];const base=vertices.length/3;
 for(let i=0;i<n;i++){let [x,z]=local(ty*step-90+v[i]/32767*step,tx*step-180+u[i]/32767*step);let y=lo+h[i]/32767*(hi-lo);vs.push([x,y,z]);vertices.push(+x.toFixed(2),+y.toFixed(2),+z.toFixed(2));}
 indices.push(...tri.map(x=>x+base));
 const bins=Array.from({length:32*32},()=>[]);
 for(let i=0;i<tri.length;i+=3){const ids=tri.slice(i,i+3);const minx=Math.max(0,Math.floor(Math.min(...ids.map(j=>u[j]))/32768*32));const maxx=Math.min(31,Math.floor(Math.max(...ids.map(j=>u[j]))/32768*32));const miny=Math.max(0,Math.floor(Math.min(...ids.map(j=>v[j]))/32768*32));const maxy=Math.min(31,Math.floor(Math.max(...ids.map(j=>v[j]))/32768*32));for(let y=miny;y<=maxy;y++)for(let x=minx;x<=maxx;x++)bins[y*32+x].push(i);}
 tiles.set(`${tx},${ty}`,{u,v,h,lo,hi,tri,bins});
}
let misses=0;
function height(x,z){
 let lon=x/sx+origin.lon,lat=origin.lat-z/sz,tx=Math.floor((lon+180)/step),ty=Math.floor((lat+90)/step),t=tiles.get(`${tx},${ty}`);
 if(!t){misses++;return 550;}
 const u=((lon+180)/step-tx)*32767,v=((lat+90)/step-ty)*32767;
 const bx=Math.min(31,Math.max(0,Math.floor(u/32768*32))),by=Math.min(31,Math.max(0,Math.floor(v/32768*32)));
 for(const j of t.bins[by*32+bx]){
 const [a,b,c]=t.tri.slice(j,j+3);const den=(t.v[b]-t.v[c])*(t.u[a]-t.u[c])+(t.u[c]-t.u[b])*(t.v[a]-t.v[c]);if(!den)continue;
 const p=((t.v[b]-t.v[c])*(u-t.u[c])+(t.u[c]-t.u[b])*(v-t.v[c]))/den;
 const q=((t.v[c]-t.v[a])*(u-t.u[c])+(t.u[a]-t.u[c])*(v-t.v[c]))/den;
 if(p>=-1e-5&&q>=-1e-5&&p+q<=1.00001)return t.lo+(p*t.h[a]+q*t.h[b]+(1-p-q)*t.h[c])/32767*(t.hi-t.lo);
 }
 misses++;return t.lo;
}
const raw=input.points.map(p=>{let[x,z]=local(p.lat,p.lon);return {x,z,alt:p.altitudeM};});
// Remove stationary GPS jitter, smooth positions lightly, resample along actual geometry.
const path=[];for(const p of raw){const last=path.at(-1);if(!last||Math.hypot(p.x-last.x,p.z-last.z)>1.5)path.push(p);}
const smooth=path.map((p,i)=>{const a=path[Math.max(0,i-1)],b=path[Math.min(path.length-1,i+1)];return {...p,x:(a.x+2*p.x+b.x)/4,z:(a.z+2*p.z+b.z)/4};});
let geo=0;for(let i=0;i<smooth.length;i++){if(i)geo+=Math.hypot(smooth[i].x-smooth[i-1].x,smooth[i].z-smooth[i-1].z);smooth[i].d=geo;}
const length=input.summary.distanceM, scale=length/geo;for(const p of smooth)p.d*=scale;
const firstAlt=smooth.findIndex(p=>Number.isFinite(p.alt));const offsetAlt=smooth[firstAlt].alt-height(smooth[firstAlt].x,smooth[firstAlt].z);
for(let i=0;i<smooth.length;i++){if(!Number.isFinite(smooth[i].alt))smooth[i].alt=height(smooth[i].x,smooth[i].z)+offsetAlt;}
const points=[];let cursor=0;
for(let d=0;d<length+5;d+=5){const target=Math.min(d,length);while(cursor<smooth.length-2&&smooth[cursor+1].d<target)cursor++;const a=smooth[cursor],b=smooth[cursor+1],t=Math.max(0,Math.min(1,(target-a.d)/(b.d-a.d||1)));const x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;points.push({d:target,x:+x.toFixed(3),z:+z.toFixed(3),y:+(height(x,z)+0.18).toFixed(3),alt:a.alt+(b.alt-a.alt)*t});if(target===length)break;}
const avg=points.map((p,i)=>{let sum=0,n=0;for(let j=Math.max(0,i-4);j<=Math.min(points.length-1,i+4);j++){sum+=points[j].alt;n++;}return sum/n;});
for(let i=0;i<points.length;i++){const l=Math.max(0,i-4),r=Math.min(points.length-1,i+4);points[i].alt=+avg[i].toFixed(2);points[i].grade=+Math.max(-25,Math.min(25,(avg[r]-avg[l])/(points[r].d-points[l].d)*100)).toFixed(3);}
// The GPX profile is the single elevation source for the riding line and controller.
const sortedOffsets=points.map(p=>p.y-.18-p.alt).sort((a,b)=>a-b);
const datum=sortedOffsets[Math.floor(sortedOffsets.length/2)];
for(const p of points)p.y=+(p.alt+.2).toFixed(3);
for(let i=0;i<points.length-1;i++){
 const a=points[i],b=points[i+1];a.grade=+((b.y-a.y)/Math.hypot(b.x-a.x,b.z-a.z)*100).toFixed(4);
}
points.at(-1).grade=points.at(-2).grade;
const rawTerrainHeight=height;
const routeCells=new Map(),cellSize=64;
for(let i=0;i<points.length-1;i++){
 const a=points[i],b=points[i+1];
 for(let bx=Math.floor((Math.min(a.x,b.x)-90)/cellSize);bx<=Math.floor((Math.max(a.x,b.x)+90)/cellSize);bx++)
 for(let bz=Math.floor((Math.min(a.z,b.z)-90)/cellSize);bz<=Math.floor((Math.max(a.z,b.z)+90)/cellSize);bz++){
  const key=`${bx},${bz}`;if(!routeCells.has(key))routeCells.set(key,[]);routeCells.get(key).push(i);
 }
}
height=function(x,z){
 const base=rawTerrainHeight(x,z)-datum;let best=90*90,hit=null;
 for(const i of routeCells.get(`${Math.floor(x/cellSize)},${Math.floor(z/cellSize)}`)??[]){
  const a=points[i],b=points[i+1],dx=b.x-a.x,dz=b.z-a.z;
  const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
  const px=a.x+dx*t,pz=a.z+dz*t,dd=(x-px)**2+(z-pz)**2;
  if(dd<best){best=dd;hit={x:px,z:pz,y:a.y+(b.y-a.y)*t-.2};}
 }
 if(!hit)return base;
 const distance=Math.sqrt(best),s=Math.max(0,Math.min(1,(distance-5)/80)),weight=1-s*s*(3-2*s);
 return base+(hit.y-(rawTerrainHeight(hit.x,hit.z)-datum))*weight;
};
const imagery=config.imagery;
delete imagery.tiles;imagery.file='aerial.jpg';imagery.attribution='SWISSIMAGE © swisstopo';
const tileN=2**imagery.zoom;
const lonAt=t=>t/tileN*360-180,latAt=t=>Math.atan(Math.sinh(Math.PI*(1-2*t/tileN)))*180/Math.PI;
const [gx0,gz0]=local(latAt(imagery.y0),lonAt(imagery.x0));
const [gx1,gz1]=local(latAt(imagery.y1+1),lonAt(imagery.x1+1));
const spacing=16,nx=Math.ceil((gx1-gx0)/spacing)+1,nz=Math.ceil((gz1-gz0)/spacing)+1,heights=[];
for(let j=0;j<nz;j++)for(let i=0;i<nx;i++)heights.push(+height(gx0+i*spacing,gz0+j*spacing).toFixed(3));
const terrain={x0:gx0,z0:gz0,nx,nz,spacing,heights};
for(let i=0;i<vertices.length;i+=3)vertices[i+1]=+(vertices[i+1]-datum).toFixed(2);
let maxGradeError=0,oppositeGrades=0;
for(let i=0;i<points.length-1;i++){
 const a=points[i],b=points[i+1],geometric=(b.y-a.y)/Math.hypot(b.x-a.x,b.z-a.z)*100;
 maxGradeError=Math.max(maxGradeError,Math.abs(a.grade-geometric));if(a.grade*geometric<0)oppositeGrades++;
}
await fs.writeFile(new URL('elevation-validation.json',root),JSON.stringify({datumOffsetM:datum,terrainGridVertices:heights.length,maxGradeErrorPercent:maxGradeError,oppositeGrades,profileSource:'Smoothed GPX altitude, shared by road mesh, HUD, physics and trainer'},null,2));

let osm={elements:[]};try{osm=JSON.parse(await fs.readFile(new URL('osm.json',root)));}catch{}
const forests=[],roads=[],buildings=[],mappedWays=[];
function nearestRoute(x,z){let best=Infinity;for(const i of routeCells.get(`${Math.floor(x/cellSize)},${Math.floor(z/cellSize)}`)??[]){const a=points[i],b=points[i+1],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));best=Math.min(best,Math.hypot(x-a.x-t*dx,z-a.z-t*dz));}return best;}
for(const feature of osm.elements??[]){const tags=feature.tags??{};
 const geometries=feature.geometry?[feature.geometry]:(feature.members??[]).filter(m=>m.role==='outer'&&m.geometry).map(m=>m.geometry);
 for(const geometry of geometries){if(geometry.length<2)continue;const coords=geometry.map(p=>local(p.lat,p.lon));
  if(tags.natural==='wood'||tags.landuse==='forest'){if(coords.length>=4)forests.push(coords.map(([x,z])=>[+x.toFixed(2),+z.toFixed(2)]));}
  else if(tags.highway){if(coords.some(([x,z])=>nearestRoute(x,z)<35))mappedWays.push({coords,tags});}
  else if(tags.building&&coords.length>=4){const center=coords.reduce((a,p)=>[a[0]+p[0]/coords.length,a[1]+p[1]/coords.length],[0,0]);if(nearestRoute(...center)>110)continue;
   const x0=Math.min(...coords.map(p=>p[0])),x1=Math.max(...coords.map(p=>p[0])),z0=Math.min(...coords.map(p=>p[1])),z1=Math.max(...coords.map(p=>p[1]));
   const nearby=routeCells.get(`${Math.floor(center[0]/cellSize)},${Math.floor(center[1]/cellSize)}`)??[];
   if(nearby.some(i=>{const p=points[i];return p.x>x0-3&&p.x<x1+3&&p.z>z0-3&&p.z<z1+3;}))continue;
   const top=Number.parseFloat(tags.height),levels=Number.parseFloat(tags['building:levels']);
   const base=Math.min(...coords.map(([x,z])=>height(x,z)));
   buildings.push({height:Math.min(45,Math.max(4,Number.isFinite(top)?top:Number.isFinite(levels)?levels*3:8)),base:+base.toFixed(2),footprint:coords.slice(0,-1).map(([x,z])=>[+x.toFixed(2),+z.toFixed(2)])});
  }
 }
}
// Deterministic low-poly vegetation. OSM forest footprints are used when available.
let seed=23103;const rand=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
function inside(x,z,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const[a,b]=poly[i],[c,d]=poly[j];if((b>z)!==(d>z)&&x<(c-a)*(z-b)/(d-b)+a)yes=!yes;}return yes;}
const bins=new Map();for(const p of points){const key=`${Math.floor(p.x/20)},${Math.floor(p.z/20)}`;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(p);}
function nearPath(x,z){const a=Math.floor(x/20),b=Math.floor(z/20);for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const p of bins.get(`${a+i},${b+j}`)??[])if(Math.hypot(p.x-x,p.z-z)<6)return true;return false;}
const trees=[];const xMin=Math.min(...points.map(p=>p.x))-300,xMax=Math.max(...points.map(p=>p.x))+300,zMin=Math.min(...points.map(p=>p.z))-300,zMax=Math.max(...points.map(p=>p.z))+300;
for(let i=0;i<32000;i++){let x=xMin+rand()*(xMax-xMin),z=zMin+rand()*(zMax-zMin);const inForest=forests.some(poly=>inside(x,z,poly));if(!inForest||nearPath(x,z))continue;trees.push([+x.toFixed(2),+height(x,z).toFixed(2),+z.toFixed(2),+(7+rand()*10).toFixed(2),Math.floor(rand()*3)]);if(trees.length>=11000)break;}
const surfaceRows=[];
for(let i=0;i<points.length;i+=10){const p=points[i];let best=25,tags={};
 for(const way of mappedWays)for(let j=1;j<way.coords.length;j++){const a=way.coords[j-1],b=way.coords[j],dx=b[0]-a[0],dz=b[1]-a[1],den=dx*dx+dz*dz;if(!den)continue;const t=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.z-a[1])*dz)/den)),d=Math.hypot(p.x-a[0]-t*dx,p.z-a[1]-t*dz);if(d<best){best=d;tags=way.tags;}}
 const forest=forests.some(poly=>inside(p.x,p.z,poly));const rough=['gravel','fine_gravel','compacted','unpaved','ground','dirt','earth','grass'].includes(tags.surface),paved=['asphalt','paved','concrete','paving_stones'].includes(tags.surface);
 const surface=rough?'gravel':paved?'asphalt':forest?'gravel':'asphalt';
 const narrow=tags.highway==='path'||tags.highway==='footway';let width=Number.parseFloat(tags.width);if(!Number.isFinite(width))width=narrow?1.8:forest?3:3.8;
 surfaceRows.push({from:p.d,to:Math.min(length,p.d+50),surface,width:Math.max(1.2,Math.min(5,width)),forest,confidence:'map-inferred'});
}
const segments=[];for(const s of surfaceRows){const last=segments.at(-1);if(last&&last.surface===s.surface&&last.width===s.width&&last.forest===s.forest)last.to=s.to;else segments.push({...s});}segments.at(-1).to=length;
const output=pathToFileURL(config.output+nodePath.sep);
await fs.mkdir(output,{recursive:true});
await fs.writeFile(new URL('appearance.json',output),JSON.stringify({version:1,season:'late-autumn',source:'OpenStreetMap geometry and surface tags; SWISSIMAGE aerial context',notes:'Surface and width are map estimates. Vegetation is recreated; no video survey was supplied for this course.',segments},null,2));
const summit=points.reduce((a,p)=>p.alt>a.alt?p:a,points[0]);const ring=config.waypoints.find(w=>w.name==='Ringlikon');let descentEnd=0;
if(ring){const [x,z]=local(ring.lat,ring.lon);descentEnd=points.filter(p=>p.d>summit.d+200).reduce((a,p)=>Math.hypot(p.x-x,p.z-z)<Math.hypot(a.x-x,a.z-z)?p:a).d;}
if(descentEnd>summit.d+500)await fs.writeFile(new URL('handling.json',output),JSON.stringify({version:1,descent:{id:'uetliberg-ringlikon',name:'Uetliberg · Ringlikon',start:summit.d+25,end:descentEnd}},null,2));
await fs.writeFile(new URL('provenance.json',output),JSON.stringify({name:config.name,inputSha256:config.inputSha256,prepared:'2026-11-19',routeSource:'User-supplied planned GPX (BRouter / OpenStreetMap)',imagerySource:'SWISSIMAGE © swisstopo',imageryZoom:imagery.zoom,terrainSource:'Terrain © swisstopo, quantized mesh 20250101',mapSource:'© OpenStreetMap contributors — ODbL',urls:['https://docs.geo.admin.ch/visualize-data/xyz.html','https://docs.geo.admin.ch/visualize-data/terrain-service.html','https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices','https://www.openstreetmap.org/copyright']},null,2));
await fs.writeFile(new URL('route.json',output),JSON.stringify({name:config.name,length,ascent:points.reduce((sum,p,i)=>sum+(i?Math.max(0,p.alt-points[i-1].alt):0),0),origin,points,source:input.source,originalGapM:input.summary.loopGapM}));
await fs.writeFile(new URL('world.json',output),JSON.stringify({terrain,imagery,vertices,indices,trees,roads,buildings,forestSource:forests.length?'OpenStreetMap':'Procedural',sources:['Terrain © swisstopo','© OpenStreetMap contributors — ODbL','Route: planned GPX supplied by the user']}));
const report={name:config.name,summitDistance:summit.d,descentEnd,appearanceSegments:segments.length,ascent:points.reduce((sum,p,i)=>sum+(i?Math.max(0,p.alt-points[i-1].alt):0),0),points:points.length,length,geoLength:geo,terrainVertices:vertices.length/3,triangles:indices.length/3,forests:forests.length,trees:trees.length,roads:roads.length,buildings:buildings.length,heightMisses:misses,gradeMin:Math.min(...points.map(p=>p.grade)),gradeMax:Math.max(...points.map(p=>p.grade)),tiles:tiles.size};
await fs.writeFile(new URL('report.json',root),JSON.stringify(report,null,2));console.log(report);


