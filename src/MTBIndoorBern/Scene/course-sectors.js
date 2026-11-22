const $=id=>document.getElementById(id);
const km=value=>(value/1000).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});

export function setupCourseSectors(info,send){
 const sectors=info.sectors??[];
 document.body.classList.toggle('has-sectors',sectors.length>0);
 $('sector-picker').hidden=!sectors.length;
 $('sector-choice').replaceChildren();
 const whole=document.createElement('option');whole.value='';whole.textContent='Whole course · km 0.00';$('sector-choice').append(whole);
 sectors.forEach((sector,index)=>{const option=document.createElement('option');option.value=sector.id;option.textContent=`${index+1}. ${sector.name} · km ${km(sector.start)}`;$('sector-choice').append(option);});
 $('sector-choice').onchange=()=>send('start-sector',{id:$('sector-choice').value});
}

export function updateCourseSectors(info,state){
 const sectors=info?.sectors??[];if(!sectors.length)return;
 const selected=sectors.find(s=>s.id===state.startSector);
 $('sector-choice').value=selected?.id??'';
 $('sector-choice').disabled=!state.canSelectStart;
 $('sector-help').textContent=state.canSelectStart?`${selected?`Start at km ${km(selected.start)}`:'Start at km 0.00'} · ride through to the finish`:'Stop / restart to change your starting point';
 $('start-hint').textContent=selected?`Starting at ${selected.name}, km ${km(selected.start)}.`:'The preview shows part of the course. Your ride starts at km 0.';
 const current=state.sector??sectors.find(s=>state.distance>=s.start&&state.distance<s.end)??sectors.at(-1);
 $('sector-status').hidden=!current;
 if(current){
  const index=current.index??sectors.findIndex(s=>s.id===current.id)+1;
  $('sector-status').textContent=`SECTOR ${index}/${sectors.length} · ${current.name}`;
  $('sector-status').title=`Km ${km(current.start)}–${km(current.end)} · ${(Math.max(0,(state.distance??0)-(state.startDistance??0))/1000).toFixed(2)} km ridden`;
 }
 if(state.startDistance>0&&state.descent?.name)$('descent-valid').textContent=state.descent.partial?'PARTIAL DESCENT · NO RECORD':'SECTOR START · NO RECORD';
}

export function drawSectorProfile(context,width,height,length,sectors,startId){
 if(!sectors?.length)return;
 context.save();context.font='bold 16px Segoe UI';context.textBaseline='top';
 sectors.forEach((sector,index)=>{
  const x=sector.start/length*width;
  context.strokeStyle=sector.id===startId?'#f3cb7f':'#d7e4c26b';context.lineWidth=1.5;context.setLineDash([4,4]);context.beginPath();context.moveTo(x,0);context.lineTo(x,height);context.stroke();context.setLineDash([]);
  context.fillStyle=sector.id===startId?'#f3cb7f':'#cdddb7';context.fillText(String(index+1),Math.max(4,x+5),2);
 });context.restore();
}
