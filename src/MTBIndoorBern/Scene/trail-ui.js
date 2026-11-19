const $=id=>document.getElementById(id);
const number=(n,d=0)=>Number(n).toLocaleString('ca-ES',{minimumFractionDigits:d,maximumFractionDigits:d});
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
 $('ride-focus').hidden=!running;$('corner-card').hidden=!active||!s.corner;$('descent-card').hidden=!active||!s.descent?.name;
 $('practice').disabled=!!s.busy;$('brake').disabled=!running||s.busy;
 $('brake').classList.toggle('pressed',!!s.brake);$('brake').setAttribute('aria-pressed',String(!!s.brake));
 $('brake').textContent=s.brake?'● FRE ACTIU':'A / Espai · Fre';
 $('focus-label').textContent=up?'↗ PUJADA':down?'↘ BAIXADA':'→ RODANT';
 $('focus-value').textContent=up?'+'+number(s.grade,1):number(s.speed,1);
 $('focus-unit').textContent=up?'%':'km/h';
 $('focus-detail').textContent=up?`${number(s.speed,1)} km/h · Marxa ${s.gear}/12`:`${s.grade>0?'+':''}${number(s.grade,1)}% · ${s.brake?'Frenant':s.watts>10?(s.practice?'Impuls demo':'Pedalant'):'Roda lliure'}`;
 $('demo').textContent=s.practice&&s.mode==='paused'?'Reprèn pràctica':'Explora en demo';
 $('ride-focus').classList.toggle('climbing',up);
 const c=s.corner;
 if(c){$('corner-arrow').textContent=c.direction>0?'↱':'↰';$('corner-title').textContent=c.distance<1?'DINS DEL REVOLT':`REVOLT A ${number(c.distance)} m`;
  $('corner-speed').textContent=number(c.limit);$('corner-surface').textContent=({leaves:'Fulles · corriol',asphalt:'Asfalt',gravel:'Grava'})[c.surface]??'Camí';
  $('corner-card').classList.toggle('urgent',!!c.urgent);$('corner-instruction').textContent=c.urgent?'FRENA ABANS D’ENTRAR':'VELOCITAT OBJECTIU DEL JOC';}
 const r=s.descent;
 if(r){$('descent-name').textContent=r.name;$('descent-time').textContent=r.status==='waiting'?`${number(r.remaining)} m`:clock(r.seconds);
  $('descent-label').textContent=r.status==='waiting'?'FINS A LA SORTIDA':r.status==='finished'?(r.newBest?'NOU RÈCORD PERSONAL':'BAIXADA COMPLETADA'):'CRONÒMETRE DE BAIXADA';
  $('descent-best').textContent=`Rècord ${r.best==null?'—':clock(r.best)} · ${r.offTracks} sortides`;
  $('descent-valid').textContent=r.warning??(s.practice?'PRÀCTICA · SENSE RÈCORD':r.status!=='waiting'&&!r.eligible?'FORA DE RÈCORD · PAUSA':r.status==='running'?`${number(r.remaining)} m fins a meta`:'Temps local · recorre el tram sencer');
 }
 const recovery=s.recovery??0,slip=s.slip??0;
 $('traction').hidden=!active;$('traction-fill').style.width=`${Math.min(100,slip*100)}%`;
 $('traction-label').textContent=recovery>0?'RECUPERANT EL CONTROL':slip>.05?'DERRAPANT · FRENA':'ADHERÈNCIA ESTABLE';
 $('runout').hidden=!(active&&recovery>0);$('runout-time').textContent=`${recovery.toFixed(1)} s`;
 document.body.classList.toggle('slipping',active&&slip>.1);
}
