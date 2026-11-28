// Presentation only: this module never sends ride, trainer or Bluetooth commands.
export const DEFAULT_PRESENTATION = Object.freeze({muted:false,volume:.35,immersive:false,targetFps:30,stableCamera:true});

export function normalizePresentation(value={}) {
 const finiteVolume=typeof value.volume==='number'&&Number.isFinite(value.volume);
 return {
  muted:typeof value.muted==='boolean'?value.muted:DEFAULT_PRESENTATION.muted,
  volume:finiteVolume?Math.max(0,Math.min(1,value.volume)):DEFAULT_PRESENTATION.volume,
  immersive:typeof value.immersive==='boolean'?value.immersive:DEFAULT_PRESENTATION.immersive,
  targetFps:value.targetFps===60?60:30,
  stableCamera:typeof value.stableCamera==='boolean'?value.stableCamera:DEFAULT_PRESENTATION.stableCamera
 };
}

const moving=state=>state.mode==='ride'||state.mode==='demo';

// Buffer host snapshots, not physics steps. The visual distance is interpolated
// between two received positions; it never predicts motion past the newest one.
export class PresentationTimeline {
 constructor({delayMs=100,staleMs=500}={}) {
  this.delayMs=delayMs;this.staleMs=staleMs;this.samples=[];this.latest=null;this.retiredEpochs=[];
 }
 clear() {this.samples=[];}
 push(snapshot,now) {
  if(!snapshot||!Number.isFinite(snapshot.distance)||!Number.isFinite(now))return false;
  const previous=this.latest,epoch=snapshot.presentationEpoch;
  if(epoch&&this.retiredEpochs.includes(epoch))return false;
  const sameEpoch=previous&&previous.presentationEpoch===epoch;
  if(sameEpoch&&Number.isFinite(snapshot.stateSequence)&&Number.isFinite(previous.stateSequence)&&snapshot.stateSequence<=previous.stateSequence)return false;
  const last=this.samples.at(-1),elapsed=last?Math.max(0,(now-last.at)/1000):0;
  const rate=Math.max(1,snapshot.demoSpeed??1,previous?.demoSpeed??1);
  const plausibleStep=Math.max(15,elapsed*Math.max(snapshot.speed??0,previous?.speed??0)/3.6*rate*2.5);
  const reset=!last||!previous||!sameEpoch||previous.mode!==snapshot.mode||now-last.at>this.staleMs||now<last.at||snapshot.distance<previous.distance||Math.abs(snapshot.distance-previous.distance)>plausibleStep;
  if(previous?.presentationEpoch&&epoch&&previous.presentationEpoch!==epoch){
   this.retiredEpochs.push(previous.presentationEpoch);if(this.retiredEpochs.length>16)this.retiredEpochs.shift();
  }
  this.latest={...snapshot};
  if(reset)this.samples=[];
  this.samples.push({at:now,state:this.latest});
  if(this.samples.length>12)this.samples.shift();
  return true;
 }
 sample(now) {
  if(!this.latest)return null;
  let distance=this.latest.distance;
  const newest=this.samples.at(-1);
  if(moving(this.latest)&&this.samples.length>1&&now-newest.at<=this.staleMs){
   const target=now-this.delayMs;
   distance=this.samples[0].state.distance;
   for(let i=1;i<this.samples.length;i++){
    const a=this.samples[i-1],b=this.samples[i];
    if(target<=b.at){const t=Math.max(0,Math.min(1,(target-a.at)/Math.max(1,b.at-a.at)));distance=a.state.distance+(b.state.distance-a.state.distance)*t;break;}
    distance=b.state.distance;
   }
  }
  return {...this.latest,distance,presentationInterpolated:true};
 }
}

function percentile(values,p) {
 if(!values.length)return 0;
 const sorted=[...values].sort((a,b)=>a-b);
 return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];
}
function summary(values,prefix) {
 return {[prefix+'P50']:percentile(values,.5),[prefix+'P95']:percentile(values,.95),[prefix+'P99']:percentile(values,.99),[prefix+'Max']:values.length?Math.max(...values):0};
}

// Frame intervals measure delivered cadence. renderSubmitMs measures synchronous
// CPU submission to WebGL, NOT GPU completion or display latency.
export class FrameMetrics {
 constructor(){this.reset();}
 reset({preserveLastAt=false}={}){this.intervals=[];this.submissions=[];if(!preserveLastAt)this.lastAt=null;}
 record(at,renderSubmitMs){
  if(!Number.isFinite(at)||!Number.isFinite(renderSubmitMs))return;
  if(this.lastAt!==null&&at>this.lastAt)this.intervals.push(at-this.lastAt);
  this.lastAt=at;this.submissions.push(Math.max(0,renderSubmitMs));
  if(this.intervals.length>600)this.intervals.shift();
  if(this.submissions.length>600)this.submissions.shift();
 }
 snapshot(targetFps=30){
  const duration=this.intervals.reduce((sum,n)=>sum+n,0),budget=1000/targetFps;
  return {targetFps,measuredFrames:this.submissions.length,fps:duration?this.intervals.length*1000/duration:0,
   ...summary(this.intervals,'frameMs'),...summary(this.submissions,'renderSubmitMs'),
   slowFrames:this.intervals.filter(ms=>ms>budget*1.5).length,stallsOver100Ms:this.intervals.filter(ms=>ms>100).length};
 }
}
