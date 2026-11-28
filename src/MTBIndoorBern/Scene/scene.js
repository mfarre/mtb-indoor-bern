import * as THREE from './vendor/three.module.js';
import {ForestRenderer} from './forest.js';
import {setupTrail,updateTrail} from './trail-ui.js';
import {addTrailMarkers} from './trail-markers.js';
import {setupProfileSeek,updateProfileSeek} from './profile-seek.js';
import {setupBikeSettings,updateBikeSettings} from './bike-settings.js';
import {setupCourseSectors,updateCourseSectors,drawSectorProfile} from './course-sectors.js';
import {setupMouseShifting} from './ride-input.js';
import {PresentationTimeline,FrameMetrics} from './ride-presentation.js';
import {setupPresentationControls} from './presentation-controls.js';
import {createRideAudio} from './ride-audio.js';
import {setupActivities,calorieDisplay} from './activities-ui.js';
const $=id=>document.getElementById(id),bridge=window.chrome?.webview;
// Sound is optional. An unavailable audio device must never reach fail(), which
// deliberately pauses the host for actual scene/renderer failures.
let rideAudio,audioUnavailable=false;
try{rideAudio=createRideAudio();}catch{audioUnavailable=true;}
const audio=Object.fromEntries(['unlock','update','setPreferences','silence','dispose','status'].map(method=>[method,(...args)=>{
 if(audioUnavailable)return method==='status'?'unavailable':undefined;
 try{const result=rideAudio[method](...args);result?.catch?.(()=>{audioUnavailable=true;});return result;}catch{audioUnavailable=true;return method==='status'?'unavailable':undefined;}
}]));
const send=(action,extra={})=>{
 if(['start','demo','practice','resume','preview'].includes(action))audio.unlock();
 if(['pause','stop','devices','course','profile-request','activities-open','error'].includes(action))audio.silence();
 return bridge?.postMessage({action,...extra});
};
const format=(v,n=0)=>Number(v).toLocaleString('en-GB',{minimumFractionDigits:n,maximumFractionDigits:n});
let state={mode:'ready',distance:0,speed:0,elapsed:0,climbed:0,gear:8,demo:false},course,world,info,engine,overview=false,lastFrame=0,nextFrameAt=0,lastStats=performance.now(),totalFrames=0,errors=[],devicesKey='',lastDetailDraw=-Infinity,lastVisualDistance=0,lastFrameMetrics={};
const timeline=new PresentationTimeline(),frameMetrics=new FrameMetrics();
const presentation=setupPresentationControls(send,audio,(next,previous)=>{
 if(next.targetFps!==previous.targetFps){frameMetrics.reset();lastFrame=0;nextFrameAt=0;lastStats=performance.now();}
 if(next.immersive!==previous.immersive){lastDetailDraw=-Infinity;if(course)refreshHud();}
},()=>clearBrake());
function fail(error){const message=String(error?.message??error);errors.push(message);$('loading').style.display='flex';$('loading').querySelector('h2').textContent='Could not load the course';$('loading').querySelector('p').textContent=message;send('error',{message});}
window.addEventListener('error',e=>fail(e.error??e.message));window.addEventListener('unhandledrejection',e=>fail(e.reason));
const clearBrake=setupTrail(send);
const activities=setupActivities(send,clearBrake);
bridge?.addEventListener('message',event=>activities.receive(event.data));
const bikeSettings=setupBikeSettings(send);
setupMouseShifting($('world'),send,()=>state);
$('bike-settings').onclick=()=>bikeSettings.open();
bridge?.addEventListener('message',event=>{if(event.data?.type==='open-profile')bikeSettings.open();else if(event.data?.type==='bike-profile'||event.data?.type==='calibration')updateBikeSettings(event.data);});
setupProfileSeek($('profile'),send,()=>state,()=>course);
bridge?.addEventListener('message',event=>{
 if(event.data?.type==='state'){
  if(!timeline.push(event.data,performance.now()))return;
  const wasRunning=state.mode==='ride'||state.mode==='demo';state=event.data;
  presentation.receive(state.presentation);audio.update({...state,presentation:presentation.value});
  if(wasRunning&&state.mode!=='ride'&&state.mode!=='demo')clearBrake();refreshHud();
 }else if(event.data?.type==='presentation-settings')presentation.receive(event.data.preferences);
 else if(event.data?.type==='catalog'){for(const option of [...$('course-choice').options])if(!event.data.ids.includes(option.value))option.remove();}
 else if(event.data?.type==='trail'){addTrailMarkers(engine,event.data);$('practice').hidden=!event.data.stage;if(event.data.stage)$('practice').textContent='↓ Practise the descent · '+event.data.stage.name;}
});
$('start').onclick=()=>send('start');$('demo').onclick=()=>send('demo');$('pause').onclick=()=>send(state.mode==='paused'?'resume':'pause');$('stop').onclick=()=>send('stop');$('devices').onclick=()=>send('devices');
$('up').onclick=()=>send('gear',{delta:1});$('down').onclick=()=>send('gear',{delta:-1});
$('demo-speed').onclick=()=>send('demo-speed');
$('course-highlight').onclick=()=>send('preview',{distance:engine?.gurtenFeatures?.previewDistance??info.previewDistance});
$('course-choice').onchange=()=>send('course',{id:$('course-choice').value});
$('view').onclick=()=>{overview=!overview;$('view').textContent=overview?'First-person view ↙':'Aerial view ↗';};
window.addEventListener('keydown',e=>{if(e.target.matches('input,select,textarea')||document.querySelector('dialog[open]'))return;if(e.key==='Escape'){send('pause');e.preventDefault();}if(e.key==='+'||e.key==='='){send('gear',{delta:1});e.preventDefault();}if(e.key==='-'||e.key==='b'||e.key==='B'){send('gear',{delta:-1});e.preventDefault();}});
$('world').addEventListener('webglcontextlost',e=>{e.preventDefault();fail('The graphics engine stopped. Restart MTB Indoor - Bern.');});
setInterval(()=>send('heartbeat'),1000);
document.addEventListener('visibilitychange',()=>{frameMetrics.reset();timeline.clear();lastFrame=0;nextFrameAt=0;lastStats=performance.now();if(document.hidden)audio.silence();});
window.addEventListener('pagehide',()=>audio.dispose());
window.mtbPresentationDiagnostics=()=>({...lastFrameMetrics,...engine?.stats(),totalFrames,distance:state.distance,visualDistance:lastVisualDistance,presentation:presentation.value,audio:audio.status()});
function refreshDevices(){
 const snapshot=state.devices??['KICKR','Right Click','Left Click','Heart rate'].map(label=>({label,state:'searching'})),key=JSON.stringify(snapshot);
 if(key===devicesKey)return;devicesKey=key;$('equipment').replaceChildren();
 const labels={connected:'Connected',connecting:'Connecting',searching:'Searching · every 5 s',paused:'Paused',unpaired:'Not paired',waiting:'Waiting for data',stale:'No recent data'};
 for(const d of snapshot){
  const b=document.createElement('button');b.className='device-chip '+d.state;
  const icon=document.createElement('i');icon.className='connection-icon';icon.textContent=d.state==='connected'?'✓':d.state==='paused'?'Ⅱ':d.state==='waiting'||d.state==='stale'?'!':'';
  const label=document.createElement('span'),strong=document.createElement('b'),small=document.createElement('small');
  strong.textContent=d.label;small.textContent=d.status??labels[d.state]??'Checking';
  b.title=[d.name||d.label,small.textContent].join(' · ');
  label.append(strong,small);b.append(icon,label);b.setAttribute('aria-label',d.label+': '+small.textContent);b.onclick=()=>send('devices');$('equipment').append(b);
 }
}
function refreshHud(){
 const running=state.mode==='ride'||state.mode==='demo',pausedDemo=state.demo&&state.mode==='paused';document.body.classList.toggle('riding',running||pausedDemo);document.body.classList.toggle('demo',state.demo&&(running||pausedDemo));document.body.classList.toggle('paused',state.mode==='paused'||state.mode==='finished');document.body.classList.toggle('demo-paused',pausedDemo);
 for(const id of['watts','cadence','heart'])$(id).textContent=state[id]==null?'—':format(state[id]);$('speed').textContent=format(state.speed,1);$('distance').textContent=format(state.distance/1000,2);
 const energy=calorieDisplay(state);$('calories').textContent=energy.text;$('calorie-metric').title=energy.note;
 const hrDevice=state.devices?.find(d=>d.role==='HeartRate');
 $('heart-status').textContent=state.heart!=null?'♥ bpm':hrDevice?.state==='waiting'?'Waiting for pulse':hrDevice?.state==='stale'?'No recent pulse':'♥ bpm';
 $('remaining').textContent=`${format(Math.max(0,(state.length??info?.length??0)-state.distance)/1000,2)} km remaining`;
 $('time').textContent=`${Math.floor(state.elapsed/60).toString().padStart(2,'0')}:${Math.floor(state.elapsed%60).toString().padStart(2,'0')}`;
 $('ascent').textContent=`${format(state.climbed)} m`;$('altitude').textContent=`${format(state.altitude??0)} m`;$('gear').innerHTML=`${state.gear}<span>/${state.gearCount??12}</span>`;
 $('ratio').textContent=`${state.chainring??32} × ${state.sprocket??18} · ${format(state.development??4.09,2)} m/rev`;
 $('grade').textContent=`${state.grade>0?'+':''}${format(state.grade??0,1)}%`;$('applied').textContent=state.control?`${format(state.targetPower??0)} W · confirmed`:'Inactive';
 $('progress').style.width=`${Math.min(100,state.distance/(state.length??info?.length??1)*100)}%`;$('profile-distance').textContent=`${format(state.distance/1000,1)} km`;
 $('status').textContent=state.settingsWarning??state.message??'Preparing course…';$('connection-dot').classList.toggle('on',state.control);$('mode-tag').textContent=state.demo&&running?'DEMO · NO TRAINER CONTROL':'MTB INDOOR · SWITZERLAND';
 $('start').textContent=state.mode==='paused'&&state.elapsed>0?'Resume ride →':state.mode==='finished'?'Start again →':'Start ride →';
 $('pause').disabled=(!running&&!pausedDemo)||state.busy;$('pause').textContent=pausedDemo?'▶ Resume demo':'Pause';for(const id of['start','demo','stop'])$(id).disabled=!!state.busy;
 const demoSpeed=$('demo-speed'),rate=state.demoSpeed??1,nextRate=rate===8?1:rate*2;
 demoSpeed.hidden=state.practice||!(state.demo&&(state.mode==='demo'||state.mode==='paused'));demoSpeed.disabled=!!state.busy;
 demoSpeed.textContent=`⏩ Demo ×${rate}`;demoSpeed.title=`Speed ×${rate}. Click to switch to ×${nextRate}`;
 demoSpeed.setAttribute('aria-label',`Demo speed ×${rate}. Switch to ×${nextRate}`);
 $('bike-summary').textContent=`${state.bikeName??'My MTB'} · ${format(state.weight??75)} + ${format(state.bikeKg??14)} kg · ${state.gearCount??12} gears`;
 $('course-choice').disabled=running||state.busy;$('course-highlight').disabled=running||state.busy;refreshDevices();updateTrail(state);updateCourseSectors(info,state);updateProfileSeek($('profile'),state);presentation.refreshAudio();
 const detailsVisible=!(presentation.value.immersive&&(running||pausedDemo)),now=performance.now();
 if(course&&detailsVisible&&(!running||now-lastDetailDraw>=250)){drawMap();drawProfile();lastDetailDraw=now;}
}
function pointAt(d){
 const ps=course.points;d=THREE.MathUtils.clamp(d,0,course.length);let l=0,r=ps.length-1;while(r-l>1){const m=(l+r)>>1;if(ps[m].d<=d)l=m;else r=m;}const a=ps[l],b=ps[r],t=(d-a.d)/(b.d-a.d);return new THREE.Vector3(THREE.MathUtils.lerp(a.x,b.x,t),THREE.MathUtils.lerp(a.y,b.y,t),THREE.MathUtils.lerp(a.z,b.z,t));
}
let mapBounds,profileBounds;
function drawMap(){
 const canvas=$('map'),c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;c.clearRect(0,0,w,h);
 const b=mapBounds,scale=Math.min((w-45)/(b.maxX-b.minX),(h-35)/(b.maxZ-b.minZ));const x=v=>w/2+(v-(b.minX+b.maxX)/2)*scale,z=v=>h/2+(v-(b.minZ+b.maxZ)/2)*scale;
 c.strokeStyle='#9eb48515';c.lineWidth=1;for(let i=0;i<5;i++){c.beginPath();c.moveTo(0,i*h/4);c.lineTo(w,i*h/4);c.stroke();}
 c.lineWidth=4;c.strokeStyle='#8da17d';c.lineJoin='round';c.beginPath();course.points.forEach((p,i)=>i?c.lineTo(x(p.x),z(p.z)):c.moveTo(x(p.x),z(p.z)));c.stroke();
 c.strokeStyle='#d1ef91';c.lineWidth=5;c.beginPath();let moved=false;for(const p of course.points){if(p.d>state.distance)break;if(p.d<(state.startDistance??0))continue;if(!moved){c.moveTo(x(p.x),z(p.z));moved=true;}else c.lineTo(x(p.x),z(p.z));}c.stroke();
 const p=pointAt(state.distance);c.beginPath();c.fillStyle='#d1ef912d';c.arc(x(p.x),z(p.z),15,0,Math.PI*2);c.fill();c.beginPath();c.fillStyle='#d7f6a0';c.arc(x(p.x),z(p.z),6,0,Math.PI*2);c.fill();c.strokeStyle='#15271d';c.lineWidth=3;c.stroke();c.fillStyle='#bdc9b2';c.font='16px Segoe UI';c.fillText('N ↑',w-45,20);
}
function drawProfile(){
 const canvas=$('profile'),c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;c.clearRect(0,0,w,h);
 const x=d=>d/course.length*w,y=alt=>h-7-(alt-profileBounds.min)/(profileBounds.max-profileBounds.min)*(h-18);
 c.beginPath();c.moveTo(0,h);for(let i=0;i<course.points.length;i+=4){const p=course.points[i];c.lineTo(x(p.d),y(p.alt));}c.lineTo(w,h);c.closePath();c.fillStyle='#99b87530';c.fill();c.strokeStyle='#adc78d';c.lineWidth=2;c.stroke();
 const px=x(state.distance),sx=x(state.startDistance??0);c.save();c.beginPath();c.rect(sx,0,Math.max(0,px-sx),h);c.clip();c.fillStyle='#b7db8350';c.fill();c.restore();drawSectorProfile(c,w,h,course.length,info.sectors,state.startSector);c.strokeStyle='#d7f69b';c.lineWidth=3;c.beginPath();c.moveTo(px,4);c.lineTo(px,h);c.stroke();
}

function animate(now){
 requestAnimationFrame(animate);if(!engine||errors.length||document.hidden)return;
 const targetFps=presentation.value.targetFps,interval=1000/targetFps;
 if(now<nextFrameAt-.4)return;
 if(!nextFrameAt)nextFrameAt=now;
 nextFrameAt+=interval;if(nextFrameAt<now-.4)nextFrameAt=now+interval;
 const dt=lastFrame?Math.min(.12,(now-lastFrame)/1000):1/targetFps;lastFrame=now;
 const visual=timeline.sample(now)??{...state,presentationInterpolated:true};visual.presentation=presentation.value;lastVisualDistance=visual.distance;
 const started=performance.now();
 engine.render(visual.distance,dt,visual.mode==='ready'&&visual.startSector?'paused':visual.mode,overview,visual);
 frameMetrics.record(now,performance.now()-started);totalFrames++;
 if(now-lastStats>=3000){
  lastFrameMetrics=frameMetrics.snapshot(targetFps);frameMetrics.reset({preserveLastAt:true});lastStats=now;
  const fps=Math.round(lastFrameMetrics.fps);
  $('performance').textContent=`${fps} fps · ${overview?'real aerial imagery':'first-person view'}`;
  $('performance').title=`Target ${targetFps} fps · frame p95 ${lastFrameMetrics.frameMsP95.toFixed(1)} ms · CPU submission p95 ${lastFrameMetrics.renderSubmitMsP95.toFixed(1)} ms · ${lastFrameMetrics.stallsOver100Ms} stalls over 100 ms`;
  engine.adjustQuality(fps,{targetFps,frameMsP95:lastFrameMetrics.frameMsP95,renderMsP95:lastFrameMetrics.renderSubmitMsP95});
  send('stats',{...lastFrameMetrics,...engine.stats(),width:innerWidth,height:innerHeight,routePoints:course.points.length,trees:engine.world.trees.length,distance:state.distance,visualDistance:visual.distance,mode:state.mode,immersive:presentation.value.immersive,stableCamera:presentation.value.stableCamera,audio:audio.status(),maxGradeErrorPercent:gradeError,errors});
 }
}
let gradeError=0;
try{
 const catalog=await fetch('./courses.json').then(r=>r.json()),id=new URLSearchParams(location.search).get('course');info=catalog.find(c=>c.id===id)??catalog[0];
 for(const c of catalog){const option=document.createElement('option');option.value=c.id;option.textContent=c.name;$('course-choice').append(option);}$('course-choice').value=info.id;setupCourseSectors(info,send);
 [course,world]=await Promise.all([fetch(`./${info.folder}/route.json`).then(r=>{if(!r.ok)throw Error('Route data not found');return r.json();}),fetch(`./${info.folder}/world.json`).then(r=>{if(!r.ok)throw Error('Terrain data not found');return r.json();})]);
 $('world').setAttribute('aria-label','3D course: '+info.name);document.querySelectorAll('.profile-axis span').forEach((el,i)=>el.textContent=i===0?'0':format(course.length/1000*i/4,i===4?2:1)+' km');$('course-name').textContent=info.name;$('course-description').textContent=info.description;$('map-title').textContent=info.name.toUpperCase()+' / RIDE 01';$('course-km').textContent=format(course.length/1000,2);$('total-km').textContent='/ '+format(course.length/1000,2)+' km';$('course-ascent').textContent=format(course.ascent);
 const xs=course.points.map(p=>p.x),zs=course.points.map(p=>p.z),alts=course.points.map(p=>p.alt);mapBounds={minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)};profileBounds={min:Math.min(...alts)-10,max:Math.max(...alts)+10};
 for(let i=0;i<course.points.length-1;i++){const a=course.points[i],b=course.points[i+1];gradeError=Math.max(gradeError,Math.abs(a.grade-(b.y-a.y)/Math.hypot(b.x-a.x,b.z-a.z)*100));}if(gradeError>.002)throw Error('The gradient does not match the course geometry.');
 engine=new ForestRenderer($('world'),course,world,info);engine.setElTonyPilotEnabled(new URLSearchParams(location.search).get('pilot')!=='off');await engine.initialize();$('course-highlight').hidden=!engine.gurtenFeatures?.branding;$('loading').style.display='none';refreshHud();lastStats=performance.now();send('ready');requestAnimationFrame(animate);
}catch(e){fail(e);}
