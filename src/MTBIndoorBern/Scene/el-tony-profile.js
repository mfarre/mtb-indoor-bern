// Visual estimates only. No course elevations, handling or trainer resistance use this file.
export const EL_TONY_PILOT = Object.freeze({from:4970,to:5310,fade:26,lateralLimit:24,seed:5083});
const clamp=v=>Math.max(0,Math.min(1,v));
const smooth=v=>{v=clamp(v);return v*v*(3-2*v);};
export function pilotWeight(distance,enabled=true){
 if(!enabled||!Number.isFinite(distance))return 0;
 const p=EL_TONY_PILOT;
 return smooth((distance-p.from)/p.fade)*smooth((p.to-distance)/p.fade);
}
export function pilotContains(distance,offset=0,enabled=true){return enabled&&distance>=EL_TONY_PILOT.from&&distance<=EL_TONY_PILOT.to&&Math.abs(offset)<EL_TONY_PILOT.lateralLimit;}
export function pilotEdgeOffset(distance,side,enabled=true){
 // Irregular exposed earth, always outside the centreline. Maximum 19 cm.
 return pilotWeight(distance,enabled)*side*(.10+.05*Math.sin(distance*.83+side)+.04*Math.sin(distance*2.11));
}
export function pilotRandom(seed=EL_TONY_PILOT.seed){return()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);}
export function pilotTreeCandidates(){
 const r=pilotRandom(),out=[];
 for(let d=EL_TONY_PILOT.from+3;d<EL_TONY_PILOT.to-3;d+=5.4){
  for(const side of[-1,1]){
   const offset=side*(4.8+r()*13),height=12+r()*10;
   out.push({d:d+(r()-.5)*3,offset,height,yaw:r()*Math.PI*2,variant:Math.floor(r()*3),scaleX:.86+r()*.28});
  }
 }
 return out;
}
