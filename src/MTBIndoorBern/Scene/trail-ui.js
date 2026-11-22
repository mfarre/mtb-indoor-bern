const $=id=>document.getElementById(id);
const number=(n,d=0)=>Number(n).toLocaleString('en-GB',{minimumFractionDigits:d,maximumFractionDigits:d});
const clock=n=>`${Math.floor(n/60).toString().padStart(2,'0')}:${(n%60).toFixed(1).padStart(4,'0')}`;
export function setupTrail(send){
 let keys=new Set(),pointer=false;
 const pressed=()=>pointer||keys.size>0;
 const publish=()=>send('brake',{pressed:pressed()});
 const clear=()=>{keys.clear();pointer=false;publish();};
 $('practice').onclick=()=>send('practice');
 $('brake').addEventListener('pointerdown',e=>{e.preventDefault();pointer=true;e.currentTarget.setPointerCapture(e.pointerId);publish();});
 for(const type of['pointerup','pointercancel','lostpointercapture'])$('brake').addEventListener(type,()=>{pointer=false;publish();});
 window.addEventListener('keydown',e=>{if(e.target.matches('input,select,textarea'))return;if(e.code==='KeyA'||e.code==='Space'){e.preventDefault();keys.add(e.code);publish();}});
 window.addEventListener('keyup',e=>{if(keys.delete(e.code)){e.preventDefault();publish();}});
 window.addEventListener('blur',clear);document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});
 setInterval(()=>{if(pressed())publish();},150);
 return clear;
}
export function updateTrail(s){
 const running=s.mode==='ride'||s.mode==='demo',active=running&&(!s.demo||s.practice),down=s.grade<-1,up=s.grade>1;
 $('ride-focus').hidden=!running;$('corner-card').hidden=!active||!s.corner;$('descent-card').hidden=!active||!s.descent?.name||s.descent.status==='passed';
 $('practice').disabled=!!s.busy;$('brake').disabled=!running||s.busy;
 $('brake').classList.toggle('pressed',!!s.brake);$('brake').setAttribute('aria-pressed',String(!!s.brake));
 $('brake').textContent=s.brake?'● BRAKING':'A / Space · Brake';
 $('focus-label').textContent=up?'↗ CLIMB':down?'↘ DESCENT':'→ RIDING';
 $('focus-value').textContent=up?'+'+number(s.grade,1):number(s.speed,1);
 $('focus-unit').textContent=up?'%':'km/h';
 $('focus-detail').textContent=up?`${number(s.speed,1)} km/h · Gear ${s.gear}/${s.gearCount??12}`:`${s.grade>0?'+':''}${number(s.grade,1)}% · ${s.brake?'Braking':s.watts>10?(s.practice?'Demo boost':'Pedalling'):'Coasting'}`;
 $('demo').textContent=s.practice&&s.mode==='paused'?'Resume practice':'Explore in demo';
 $('ride-focus').classList.toggle('climbing',up);
 const c=s.corner;
 if(c){$('corner-arrow').textContent=c.direction>0?'↱':'↰';$('corner-title').textContent=c.distance<1?'IN THE CORNER':`CORNER IN ${number(c.distance)} m`;
  $('corner-speed').textContent=number(c.limit);$('corner-surface').textContent=({leaves:'Leaves · singletrack',asphalt:'Asphalt',gravel:'Gravel',earth:'Compacted earth'})[c.surface]??'Trail';
  $('corner-card').classList.toggle('urgent',!!c.urgent);$('corner-instruction').textContent=c.urgent?'BRAKE BEFORE ENTERING':'GAME TARGET SPEED';}
 const r=s.descent;
 if(r){$('descent-name').textContent=r.name;$('descent-time').textContent=r.status==='waiting'?`${number(r.remaining)} m`:clock(r.seconds);
  $('descent-label').textContent=r.status==='waiting'?'TO THE START':r.status==='finished'?(r.newBest?'NEW PERSONAL BEST':'DESCENT COMPLETE'):r.partial?'PARTIAL DESCENT':'DESCENT TIMER';
  $('descent-best').textContent=`Best ${r.best==null?'—':clock(r.best)} · ${r.offTracks} ${r.offTracks===1?'runout':'runouts'}`;
  $('descent-valid').textContent=r.warning??(s.practice?'PRACTICE · NO RECORD':r.partial?'PARTIAL DESCENT · NO RECORD':r.status!=='waiting'&&!r.eligible?'NOT ELIGIBLE · PAUSED':r.status==='running'?`${number(r.remaining)} m to finish`:'Local time · complete the whole stage');
 }
 const recovery=s.recovery??0,slip=s.slip??0;
 $('traction').hidden=!active;$('traction-fill').style.width=`${Math.min(100,slip*100)}%`;
 $('traction-label').textContent=recovery>0?'RECOVERING CONTROL':slip>.05?'SKIDDING · BRAKE':'STABLE GRIP';
 $('runout').hidden=!(active&&recovery>0);$('runout-time').textContent=`${recovery.toFixed(1)} s`;
 document.body.classList.toggle('slipping',active&&slip>.1);
}
