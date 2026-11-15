import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const [input,output,sdkFile,courseFile]=process.argv.slice(2);
if(!input||!output||!sdkFile)throw Error('Usage: node decode-fit.mjs input.fit output.json sdk/src/index.js [course.json]');
const {Decoder,Stream}=await import(pathToFileURL(sdkFile));
const decoder=new Decoder(Stream.fromByteArray(await fs.readFile(input)));
if(!decoder.checkIntegrity())throw Error('FIT integrity check failed');
const {messages,errors}=decoder.read();
if(errors.length)throw Error(JSON.stringify(errors));
const session=messages.sessionMesgs[0];
const semicircle=180/2**31;
let points=messages.recordMesgs.filter(r=>Number.isFinite(r.positionLat)&&Number.isFinite(r.positionLong)).map(r=>({
 timestamp:r.timestamp.toISOString(),time:r.timestamp.getTime()/1000,
 lat:r.positionLat*semicircle,lon:r.positionLong*semicircle,
 altitude:r.enhancedAltitude??r.altitude??null,distance:r.distance??null,speed:r.enhancedSpeed??r.speed??0
}));
let matching=null;
if(courseFile){
 const course=JSON.parse(await fs.readFile(courseFile,'utf8'));const sx=111320*Math.cos(course.origin.lat*Math.PI/180);
 const cells=new Map(),size=35,ps=course.points;
 for(let i=0;i<ps.length-1;i++){const a=ps[i],b=ps[i+1];let minx=Math.floor(Math.min(a.x,b.x)/size),maxx=Math.floor(Math.max(a.x,b.x)/size),minz=Math.floor(Math.min(a.z,b.z)/size),maxz=Math.floor(Math.max(a.z,b.z)/size);for(let ix=minx;ix<=maxx;ix++)for(let iz=minz;iz<=maxz;iz++){let key=ix+','+iz;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(i);}}
 let previous=null;
 for(let j=0;j<points.length;j++){
  const p=points[j],q=points[Math.min(points.length-1,j+3)];const x=(p.lon-course.origin.lon)*sx,z=(course.origin.lat-p.lat)*111320;
  let candidates=new Set();for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)for(const i of cells.get((Math.floor(x/size)+dx)+','+(Math.floor(z/size)+dz))??[])candidates.add(i);
  let best=null;
  for(const i of candidates){const a=ps[i],b=ps[i+1],vx=b.x-a.x,vz=b.z-a.z,l2=vx*vx+vz*vz,t=Math.max(0,Math.min(1,((x-a.x)*vx+(z-a.z)*vz)/l2));const error=Math.hypot(x-a.x-t*vx,z-a.z-t*vz),d=a.d+t*(b.d-a.d);const hx=(q.lon-p.lon)*sx,hz=(p.lat-q.lat)*111320,hl=Math.hypot(hx,hz);const alignment=hl>2?(hx*vx+hz*vz)/(hl*Math.sqrt(l2)):1;const continuity=previous!==null?Math.min(30,Math.abs(d-previous)/50):0;const score=error+Math.max(0,1-alignment)*8+continuity;if(!best||score<best.score)best={d,error,score,segment:i};}
  if(best&&best.error<60){p.courseDistance=+best.d.toFixed(2);p.courseError=+best.error.toFixed(2);previous=best.d;}else{p.courseDistance=null;p.courseError=best?+best.error.toFixed(2):null;}
 }
 const good=points.filter(p=>p.courseDistance!==null);const errors=good.map(p=>p.courseError).sort((a,b)=>a-b);
 matching={matched:good.length,total:points.length,medianErrorM:errors[Math.floor(errors.length/2)],p95ErrorM:errors[Math.floor(errors.length*.95)],minCourseDistance:Math.min(...good.map(p=>p.courseDistance)),maxCourseDistance:Math.max(...good.map(p=>p.courseDistance))};
}
const result={version:1,source:input.split(/[\\/]/).at(-1),integrity:true,summary:{start:session.startTime.toISOString(),end:session.timestamp.toISOString(),distance:session.totalDistance,ascent:session.totalAscent,elapsed:session.totalElapsedTime,moving:session.totalTimerTime},matching,points};
await fs.writeFile(output,JSON.stringify(result));
console.log(JSON.stringify({summary:result.summary,matching,points:points.length,first:points[0],last:points.at(-1)},null,2));
