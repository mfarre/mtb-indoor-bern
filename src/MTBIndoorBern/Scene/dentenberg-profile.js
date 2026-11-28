// Appearance only: these helpers never change route elevations, width or grade.
export const WOODLAND_LIMITS=Object.freeze({chunkSize:64,treeRadius:94,treeBudget:96,shrubRadius:65,shrubBudget:110,fernRadius:36,fernBudget:64,lateralLimit:25});
export function woodlandRandom(seed=93){return()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);}
const smooth=value=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};
export function forestWeight(distance,segments=[]){
 if(!Number.isFinite(distance))return 0;
 let weight=0;
 for(const segment of segments){if(!segment.forest)continue;const before=segments.some(s=>s.forest&&Math.abs(s.to-segment.from)<.01),after=segments.some(s=>s.forest&&Math.abs(s.from-segment.to)<.01);if(distance>=segment.from&&distance<=segment.to)weight=Math.max(weight,(before?1:smooth((distance-segment.from)/24))*(after?1:smooth((segment.to-distance)/24)));}
 return weight;
}
export function woodlandTreeStyle(seed){const r=woodlandRandom(seed),v=r();return {variant:v<.52?0:v<.85?1:2,yaw:r()*Math.PI*2,spread:.88+r()*.22};}
export function woodlandSeed(x,z){return (Math.imul(Math.round(x*10),73856093)^Math.imul(Math.round(z*10),19349663))>>>0;}
export function indexWoodland(items,size=WOODLAND_LIMITS.chunkSize){
 const chunks=new Map();for(const item of items){const x=item.x??item.p?.x,z=item.z??item.p?.z,key=`${Math.floor(x/size)},${Math.floor(z/size)}`;if(!chunks.has(key))chunks.set(key,[]);chunks.get(key).push(item);}return chunks;
}
export function collectNearby(chunks,x,z,maxDistance,maxCount,size=WOODLAND_LIMITS.chunkSize){
 if(![x,z,maxDistance,maxCount,size].every(Number.isFinite)||maxDistance<=0||maxCount<=0||size<=0)return [];
 const radius=Math.ceil(maxDistance/size),cx=Math.floor(x/size),cz=Math.floor(z/size),found=[];
 for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius;dz<=radius;dz++)for(const item of chunks.get(`${cx+dx},${cz+dz}`)??[]){const ix=item.x??item.p?.x,iz=item.z??item.p?.z,d2=(ix-x)**2+(iz-z)**2;if(d2<maxDistance**2)found.push({item,d2});}
 found.sort((a,b)=>a.d2-b.d2||(a.item.id??0)-(b.item.id??0));return found.slice(0,maxCount).map(v=>v.item);
}
