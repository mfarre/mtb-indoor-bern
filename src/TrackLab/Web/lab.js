const $=id=>document.getElementById(id),bridge=window.chrome.webview;
const send=(action,data={})=>bridge.postMessage({action,...data});
const fmt=(n,d=2)=>Number(n).toLocaleString('en-GB',{maximumFractionDigits:d,minimumFractionDigits:d});
const clock=s=>`${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`;
let data,annotations={offsetSeconds:0,segments:[],captures:[]},current=0,point=null,mapXY,capturedSmoke=false;
const surfaceLabels={asphalt:'Asphalt',gravel:'Gravel',leaves:'Leaves / singletrack',soil:'Soil'};
const video=$('video');
const fail=e=>{const message=String(e?.message??e);$('status').textContent='Error: '+message;send('error',{message});};
addEventListener('error',e=>fail(e.error));addEventListener('unhandledrejection',e=>fail(e.reason));
function pointAt(time){const ps=data.track.points;let lo=0,hi=ps.length-1;while(hi-lo>1){let m=(lo+hi)>>1;if(ps[m].time<time)lo=m;else hi=m;}const p=Math.abs(ps[lo].time-time)<Math.abs(ps[hi].time-time)?ps[lo]:ps[hi];return Math.abs(p.time-time)<=3?p:null;}
function match(p){return p&&(!data.track.matching||(p.courseDistance!=null&&p.courseError<=12));}
function routeDistance(p){return data.track.matching?p.courseDistance:p.distance;}
function persist(){send('save',{data:annotations});}
function update(){if(!data)return;const v=data.videos[current],t=v.epoch+video.currentTime+annotations.offsetSeconds;point=pointAt(t);$('seek').value=video.currentTime;$('time').textContent=clock(video.currentTime)+' / '+clock(v.duration);$('play').textContent=video.paused?'▶':'Ⅱ';
 $('position').textContent=match(point)?`${data.track.matching?'Course':'FIT'} · km ${fmt(routeDistance(point)/1000)}`:point?`FIT · km ${fmt(point.distance/1000)}`:'Stopped or outside FIT recording';
 $('confidence').textContent=!data.track.matching?'FIT distance; no reference course':match(point)?`${fmt(point.courseError,1)} m from the reference course`:point?'Alternate route: not matched to the reference course':'No nearby GPS position';$('confidence').classList.toggle('warn',!match(point));
 $('fit-time').textContent=new Date(t*1000).toLocaleTimeString('en-GB',{timeZone:'Europe/Madrid'});$('marker').style.display=point?'':'none';if(point){const [x,y]=mapXY(point);$('marker').setAttribute('cx',x);$('marker').setAttribute('cy',y);}
}
function jump(index,seconds){current=index;const v=data.videos[index];const url=new URL(v.file,'https://session.local/').href;video.classList.toggle('upright',v.rotation!==180);$('angle').textContent=v.rotation+'°';$('clip-label').textContent=v.name;$('seek').max=v.duration;
 if(video.src!==url){video.onloadedmetadata=()=>{video.currentTime=seconds;update();};video.src=url;video.load();}else{video.currentTime=seconds;update();}
}
function renderGallery(){const gallery=$('gallery');gallery.replaceChildren();const all=[...data.frames,...annotations.captures];$('frame-count').textContent=all.length+' frames';
 for(const f of all){const b=document.createElement('button'),img=document.createElement('img'),label=document.createElement('small');img.src=new URL(f.image,'https://session.local/');img.loading='lazy';img.alt='Corrected frame from video '+(f.video+1);const p=pointAt(data.videos[f.video].epoch+f.seconds+annotations.offsetSeconds);label.textContent=`V${f.video+1} · ${clock(f.seconds)} · ${match(p)?fmt(routeDistance(p)/1000)+' km':p?'alternate route':'stopped / outside FIT'}`;b.append(img,label);b.onclick=()=>{gallery.querySelector('.selected')?.classList.remove('selected');b.classList.add('selected');jump(f.video,f.seconds);};gallery.append(b);}
}
function renderNotes(){const el=$('notes');el.replaceChildren();if(!annotations.segments.length){el.textContent='No observations yet. Mark a segment and describe its details.';return;}for(const s of annotations.segments){const row=document.createElement('div');row.className='note-row';for(const text of[`${fmt(s.from/1000)}–${fmt(s.to/1000)} km`,`${surfaceLabels[s.surface]??s.surface} · ${fmt(s.width,1)} m`,s.note]){const span=document.createElement('span');span.textContent=text;row.append(span);}el.append(row);}}
function map(reference){const ps=data.track.points;const all=[...ps,...reference];const lat=ps[0].lat,cos=Math.cos(lat*Math.PI/180),xs=all.map(p=>p.lon*cos),ys=all.map(p=>p.lat);const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),scale=Math.min(290/(maxX-minX),185/(maxY-minY));mapXY=p=>[160+(p.lon*cos-(minX+maxX)/2)*scale,105-(p.lat-(minY+maxY)/2)*scale];const path=points=>points.map((p,i)=>(i?'L':'M')+mapXY(p).join(',')).join(' ');$('route').setAttribute('d',path(ps));$('reference').setAttribute('d',path(reference));let gap='',prevBad=false;for(let i=0;i<ps.length;i++){const bad=!match(ps[i]);if(bad){gap+=(prevBad?'L':'M')+mapXY(ps[i]).join(',');}prevBad=bad;}$('unmatched').setAttribute('d',gap);}
video.ontimeupdate=update;video.onplay=update;video.onpause=update;video.onerror=()=>fail('Unable to read the local video. Check the preview folder.');
$('play').onclick=()=>video.paused?video.play().catch(fail):video.pause();$('seek').oninput=e=>{video.currentTime=Number(e.target.value);update();};$('back').onclick=()=>video.currentTime=Math.max(0,video.currentTime-5);$('forward').onclick=()=>video.currentTime=Math.min(video.duration-.1,video.currentTime+5);
$('open').onclick=()=>send('open');$('folder').onclick=()=>send('folder');$('import').onclick=()=>send('import',{rotation:Number($('rotation').value)});$('cancel').onclick=()=>send('cancel');$('capture').onclick=()=>send('capture',{video:current,seconds:video.currentTime});
$('offset').onchange=()=>{const value=Number($('offset').value);if(!Number.isFinite(value))return;annotations.offsetSeconds=value;persist();renderGallery();update();};
$('mark').onclick=()=>{if(!match(point)){ $('status').textContent='This point does not match the reference course; record the alternate route separately.';return;}$('from').value=(routeDistance(point)/1000).toFixed(3);$('to').value=((routeDistance(point)+50)/1000).toFixed(3);};
$('add').onclick=()=>{const from=Number($('from').value)*1000,to=Number($('to').value)*1000,width=Number($('width').value);if(!$('from').value||!$('to').value||!Number.isFinite(from+to+width)||from<0||to<=from||width<.3||width>20){$('status').textContent='Enter a valid interval and a width from 0.3 to 20 m.';return;}annotations.segments.push({from,to,width,surface:$('surface').value,note:$('note').value,video:data.videos[current].name,seconds:video.currentTime,confidence:'manual'});annotations.segments.sort((a,b)=>a.from-b.from);persist();renderNotes();};
$('export').onclick=()=>send('export',{data:{version:1,session:data.title,rotation:data.rotation,clockNote:data.clockNote,...annotations}});
bridge.addEventListener('message',e=>{const m=e.data;if(m.type==='status')$('status').textContent=m.text;if(m.type==='path')$('folder').title=m.path;if(m.type==='busy'){document.querySelectorAll('button,input,select,textarea').forEach(el=>{if(el.id!=='cancel')el.disabled=m.value;});$('cancel').hidden=!m.value;}if(m.type==='captured'){annotations.captures.push({image:m.file,video:m.video,seconds:m.seconds});persist();renderGallery();$('status').textContent='Corrected frame saved to '+m.file;}});
if(new URLSearchParams(location.search).get('empty')==='1'){
 $('title').textContent='Start a new field notebook';$('status').textContent='Open an existing session or import a FIT file with its videos. External tools are configured in config.json.';
 for(const id of ['play','back','forward','seek','capture','offset','mark','add','export'])$(id).disabled=true;
}else try{
 data=await fetch('https://session.local/analysis.json').then(r=>{if(!r.ok)throw Error('analysis.json was not found');return r.json();});
 annotations={...annotations,offsetSeconds:data.offsetSeconds};const saved=await fetch('https://session.local/annotations.json');if(saved.ok)annotations={...annotations,...await saved.json()};
 const reference=data.track.matching?await fetch('./reference-route.json').then(r=>r.ok?r.json():[]):[];map(reference);
 $('title').textContent=data.title;$('offset').value=annotations.offsetSeconds;$('clock-note').textContent=annotations.clockNote??'';
 const total=data.videos.reduce((n,v)=>n+v.duration,0);for(const [value,label]of[[fmt(data.track.summary.distance/1000)+' km','ORIGINAL FIT'],[data.track.summary.ascent+' m','ASCENT'],[clock(total),'VIDEO']]){const item=document.createElement('div'),b=document.createElement('b'),small=document.createElement('small');b.textContent=value;small.textContent=label;item.append(b,small);$('facts').append(item);}
 renderGallery();renderNotes();send('ready');$('status').textContent='Originals preserved · frames corrected · data stored on this PC';
 const smoke=new URLSearchParams(location.search).get('smoke')==='1';jump(0,smoke?Math.min(1925,data.videos[0].duration-1):Math.min(185,data.videos[0].duration-1));
 if(smoke){video.onseeked=()=>{if(capturedSmoke||video.readyState<2)return;capturedSmoke=true;requestAnimationFrame(()=>requestAnimationFrame(()=>send('smoke',{frames:data.frames.length,videoWidth:video.videoWidth,videoHeight:video.videoHeight,rotation:data.videos[current].rotation,time:video.currentTime,offset:annotations.offsetSeconds,matched:match(point),point,errors:[]})));};}
}catch(e){fail(e);}
