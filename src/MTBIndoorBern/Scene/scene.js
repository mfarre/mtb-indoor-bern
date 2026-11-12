import * as THREE from './vendor/three.module.js';
import {ForestRenderer} from './forest.js';
const $=id=>document.getElementById(id),bridge=window.chrome?.webview;
const send=(action,extra={})=>bridge?.postMessage({action,...extra});
const format=(v,n=0)=>Number(v).toLocaleString('ca-ES',{minimumFractionDigits:n,maximumFractionDigits:n});
let state={mode:'ready',distance:0,speed:0,elapsed:0,climbed:0,gear:8,demo:false},course,world,info,engine,overview=false,lastFrame=0,lastStats=performance.now(),frames=0,totalFrames=0,errors=[],devicesKey='';
function fail(error){const message=String(error?.message??error);errors.push(message);$('loading').style.display='flex';$('loading').querySelector('h2').textContent='No s’ha pogut carregar el circuit';$('loading').querySelector('p').textContent=message;send('error',{message});}
window.addEventListener('error',e=>fail(e.error??e.message));window.addEventListener('unhandledrejection',e=>fail(e.reason));
bridge?.addEventListener('message',event=>{if(event.data?.type==='state'){state=event.data;refreshHud();}});
$('start').onclick=()=>send('start');$('demo').onclick=()=>send('demo');$('pause').onclick=()=>send('pause');$('stop').onclick=()=>send('stop');$('devices').onclick=()=>send('devices');
$('up').onclick=()=>send('gear',{delta:1});$('down').onclick=()=>send('gear',{delta:-1});
const settings=()=>send('settings',{weight:Number($('weight').value),difficulty:Number($('difficulty').value),chainring:Number($('chainring').value)});
$('weight').onchange=settings;$('difficulty').onchange=settings;$('chainring').onchange=settings;
$('course-choice').onchange=()=>send('course',{id:$('course-choice').value});
$('view').onclick=()=>{overview=!overview;$('view').textContent=overview?'Primera persona ↙':'Vista aèria ↗';};
window.addEventListener('keydown',e=>{if(e.target.matches('input,select'))return;if(e.key==='Escape'){send('pause');e.preventDefault();}if(e.key==='+'||e.key==='='){send('gear',{delta:1});e.preventDefault();}if(e.key==='-'||e.key==='b'||e.key==='B'){send('gear',{delta:-1});e.preventDefault();}});
$('world').addEventListener('webglcontextlost',e=>{e.preventDefault();fail('El motor gràfic s’ha interromput. Reinicia MTB Indoor - Bern.');});
setInterval(()=>send('heartbeat'),1000);
function refreshDevices(){const snapshot=state.devices??[{label:'KICKR',state:'searching'},{label:'Click dret',state:'searching'},{label:'Pulsòmetre',state:'searching'}],key=JSON.stringify(snapshot);if(key===devicesKey)return;devicesKey=key;$('equipment').replaceChildren();for(const d of snapshot){const b=document.createElement('button');b.className='device-chip '+d.state;b.title=d.name||d.label;const icon=document.createElement('i');icon.className='connection-icon';icon.textContent=d.state==='connected'?'✓':d.state==='paused'?'Ⅱ':'';const label=document.createElement('span'),strong=document.createElement('b'),small=document.createElement('small');strong.textContent=d.label;small.textContent=({connected:'Connectat',connecting:'Connectant',searching:'Buscant · cada 5 s',paused:'Pausat',unpaired:'Sense vincular'})[d.state];label.append(strong,small);b.append(icon,label);b.setAttribute('aria-label',d.label+': '+small.textContent);b.onclick=()=>send('devices');$('equipment').append(b);}}
function refreshHud(){
 const running=state.mode==='ride'||state.mode==='demo';document.body.classList.toggle('riding',running);document.body.classList.toggle('demo',state.demo&&running);document.body.classList.toggle('paused',state.mode==='paused'||state.mode==='finished');
 for(const id of['watts','cadence','heart'])$(id).textContent=state[id]==null?'—':format(state[id]);$('speed').textContent=format(state.speed,1);$('distance').textContent=format(state.distance/1000,2);
 $('remaining').textContent=`${format(Math.max(0,(state.length??info?.length??0)-state.distance)/1000,2)} km per fer`;
 $('time').textContent=`${Math.floor(state.elapsed/60).toString().padStart(2,'0')}:${Math.floor(state.elapsed%60).toString().padStart(2,'0')}`;
 $('ascent').textContent=`${format(state.climbed)} m`;$('altitude').textContent=`${format(state.altitude??0)} m`;$('gear').innerHTML=`${state.gear}<span>/12</span>`;
 $('ratio').textContent=`${state.chainring??32} × ${state.sprocket??18} · ${format(state.development??4.09,2)} m/volta`;
 $('grade').textContent=`${state.grade>0?'+':''}${format(state.grade??0,1)}%`;$('applied').textContent=state.control?`${format(state.targetPower??0)} W · confirmat`:'Inactiu';
 $('progress').style.width=`${Math.min(100,state.distance/(state.length??info?.length??1)*100)}%`;$('profile-distance').textContent=`${format(state.distance/1000,1)} km`;
 $('status').textContent=state.settingsWarning??state.message??'Preparant el circuit…';$('connection-dot').classList.toggle('on',state.control);$('mode-tag').textContent=state.demo&&running?'DEMO · SENSE RODILLO':'CIRCUITS DE BERNA';
 $('start').textContent=state.mode==='paused'&&state.distance>0?'Reprèn la ruta →':state.mode==='finished'?'Torna a començar →':'Inicia la ruta →';
 $('pause').disabled=!running||state.busy;for(const id of['start','demo','stop'])$(id).disabled=!!state.busy;
 for(const [id,value] of[['weight',state.weight],['difficulty',state.difficulty],['chainring',state.chainring]]){const el=$(id);el.disabled=running||state.busy;if(value!=null&&document.activeElement!==el)el.value=String(value);}
 $('course-choice').disabled=running||state.busy;refreshDevices();if(course){drawMap();drawProfile();}
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
 c.strokeStyle='#d1ef91';c.lineWidth=5;c.beginPath();let moved=false;for(const p of course.points){if(p.d>state.distance)break;if(!moved){c.moveTo(x(p.x),z(p.z));moved=true;}else c.lineTo(x(p.x),z(p.z));}c.stroke();
 const p=pointAt(state.distance);c.beginPath();c.fillStyle='#d1ef912d';c.arc(x(p.x),z(p.z),15,0,Math.PI*2);c.fill();c.beginPath();c.fillStyle='#d7f6a0';c.arc(x(p.x),z(p.z),6,0,Math.PI*2);c.fill();c.strokeStyle='#15271d';c.lineWidth=3;c.stroke();c.fillStyle='#bdc9b2';c.font='16px Segoe UI';c.fillText('N ↑',w-45,20);
}
function drawProfile(){
 const canvas=$('profile'),c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;c.clearRect(0,0,w,h);
 const x=d=>d/course.length*w,y=alt=>h-7-(alt-profileBounds.min)/(profileBounds.max-profileBounds.min)*(h-18);
 c.beginPath();c.moveTo(0,h);for(let i=0;i<course.points.length;i+=4){const p=course.points[i];c.lineTo(x(p.d),y(p.alt));}c.lineTo(w,h);c.closePath();c.fillStyle='#99b87530';c.fill();c.strokeStyle='#adc78d';c.lineWidth=2;c.stroke();
 const px=x(state.distance);c.save();c.beginPath();c.rect(0,0,px,h);c.clip();c.fillStyle='#b7db8350';c.fill();c.restore();c.strokeStyle='#d7f69b';c.lineWidth=3;c.beginPath();c.moveTo(px,4);c.lineTo(px,h);c.stroke();
}

function animate(now){requestAnimationFrame(animate);if(!engine||errors.length)return;if(now-lastFrame<1000/30-.4)return;const dt=Math.min(.12,(now-lastFrame)/1000);lastFrame=now;engine.render(state.distance,dt,state.mode,overview);frames++;totalFrames++;
 if(now-lastStats>=3000){const fps=Math.round(frames*1000/(now-lastStats));frames=0;lastStats=now;$('performance').textContent=`${fps} fps · ${overview?'foto aèria real':'primera persona'}`;engine.adjustQuality(fps);send('stats',{fps,...engine.stats(),width:innerWidth,height:innerHeight,routePoints:course.points.length,trees:world.trees.length,distance:state.distance,mode:state.mode,maxGradeErrorPercent:gradeError,errors});}}
let gradeError=0;
try{
 const catalog=await fetch('./courses.json').then(r=>r.json()),id=new URLSearchParams(location.search).get('course');info=catalog.find(c=>c.id===id)??catalog[0];
 for(const c of catalog){const option=document.createElement('option');option.value=c.id;option.textContent=c.name;$('course-choice').append(option);}$('course-choice').value=info.id;
 [course,world]=await Promise.all([fetch(`./${info.folder}/route.json`).then(r=>{if(!r.ok)throw Error('No es troba el traçat');return r.json();}),fetch(`./${info.folder}/world.json`).then(r=>{if(!r.ok)throw Error('No es troba el terreny');return r.json();})]);
 $('world').setAttribute('aria-label','Circuit 3D: '+info.name);document.querySelectorAll('.profile-axis span').forEach((el,i)=>el.textContent=i===0?'0':format(course.length/1000*i/4,i===4?2:1)+' km');$('course-name').textContent=info.name;$('map-title').textContent=info.name.toUpperCase()+' / VOLTA 01';$('course-km').textContent=format(course.length/1000,2);$('total-km').textContent='/ '+format(course.length/1000,2)+' km';$('course-ascent').textContent=format(course.ascent);
 const xs=course.points.map(p=>p.x),zs=course.points.map(p=>p.z),alts=course.points.map(p=>p.alt);mapBounds={minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)};profileBounds={min:Math.min(...alts)-10,max:Math.max(...alts)+10};
 for(let i=0;i<course.points.length-1;i++){const a=course.points[i],b=course.points[i+1];gradeError=Math.max(gradeError,Math.abs(a.grade-(b.y-a.y)/Math.hypot(b.x-a.x,b.z-a.z)*100));}if(gradeError>.002)throw Error('El pendent no coincideix amb la geometria del circuit.');
 engine=new ForestRenderer($('world'),course,world,info);await engine.initialize();$('loading').style.display='none';refreshHud();send('ready');requestAnimationFrame(animate);
}catch(e){fail(e);}
