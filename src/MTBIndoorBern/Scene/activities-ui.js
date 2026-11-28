const number=(value,digits=0)=>Number(value).toLocaleString('en-GB',{maximumFractionDigits:digits,minimumFractionDigits:digits});
export function activityDuration(seconds){const total=Math.max(0,Math.floor(Number(seconds)||0));return total>=3600?`${Math.floor(total/3600)}:${String(Math.floor(total/60)%60).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`:`${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;}
export function calorieDisplay(state={}){
 const available=!state.demo&&!state.practice&&Number.isFinite(state.calories)&&state.calories>=0;
 return {text:available?number(state.calories):'—',note:state.demo||state.practice?'Demo and practice do not count as exercise.':'Estimated from measured trainer power using 24% cycling efficiency. Paused or missing data and resting metabolism are not counted.'};
}

export function setupActivities(send,onOpen=()=>{}){
 const $=id=>document.getElementById(id),dialog=$('activities-dialog');
 let entries=[],selected=null,exportedId=null,pending=false,previousFocus,opened=false,requestSequence=0,pendingRequest=null;
 const nextRequest=()=>`${Date.now()}-${++requestSequence}`;
 const text=(id,value)=>{$(id).textContent=value;};
 function select(id){selected=entries.find(entry=>entry.id===id)??null;exportedId=null;text('activity-notice','');render();}
 function render(){
  const list=$('activity-list');list.replaceChildren();
  $('activities-empty').hidden=entries.length>0;$('activity-details').hidden=!selected;
  for(const entry of entries){
   const button=document.createElement('button');button.className='activity-row';button.type='button';
   button.setAttribute('aria-pressed',String(entry.id===selected?.id));
   const title=document.createElement('strong'),date=document.createElement('span'),details=document.createElement('small');
   title.textContent=entry.courseName||'Indoor ride';date.textContent=new Date(entry.startedUtc).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'});
   details.textContent=`${activityDuration(entry.activeSeconds)} · ${number(entry.distanceMeters/1000,2)} km`;
   button.append(title,date,details);button.disabled=pending;button.onclick=()=>select(entry.id);list.append(button);
  }
  if(selected){
   text('activity-course',selected.courseName||'Indoor ride');text('activity-status',selected.isComplete?'RECORDED RIDE':'SAVED PARTIAL RIDE');
   text('activity-duration',activityDuration(selected.activeSeconds));text('activity-distance',number(selected.distanceMeters/1000,2));
   text('activity-calories',number(selected.calories));text('activity-work',number(selected.workKj));
   text('activity-average-power',number(selected.averagePower));
   text('activity-recording-note',selected.truncated?'Recording reached its sample limit. Export is unavailable.':!selected.canExport?'Record a few seconds of fresh trainer data before exporting.':selected.isComplete?'Recorded locally from the trainer.':'A checkpoint of the ride so far. Resume the same ride to continue recording, or export this part.');
  }
  $('activity-export').disabled=pending||!selected?.canExport;
  $('activity-strava').disabled=pending||!selected||exportedId!==selected.id;
  $('activities-refresh').disabled=pending;
 }
 $('activities-open').onclick=()=>{
  previousFocus=document.activeElement;onOpen();opened=true;pending=true;exportedId=null;pendingRequest=null;
  text('activity-notice','Loading saved rides…');dialog.showModal();$('activities-close').focus();render();pendingRequest=nextRequest();send('activities-open',{requestId:pendingRequest});
 };
 const close=()=>{dialog.close();opened=false;pendingRequest=null;send('activities-close');previousFocus?.focus();};
 $('activities-close').onclick=close;
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('keydown',event=>event.stopPropagation());dialog.addEventListener('keyup',event=>event.stopPropagation());
 $('activities-refresh').onclick=()=>{pending=true;exportedId=null;pendingRequest=null;render();pendingRequest=nextRequest();send('activities-list',{requestId:pendingRequest});};
 $('activity-export').onclick=()=>{if(!selected||pending)return;pending=true;exportedId=null;render();text('activity-notice','Choose where to save the TCX file…');pendingRequest=nextRequest();send('activity-export',{id:selected.id,requestId:pendingRequest});};
 $('activity-strava').onclick=()=>{if(!selected||pending||exportedId!==selected.id)return;pending=true;pendingRequest=nextRequest();render();send('activity-strava',{id:selected.id,requestId:pendingRequest});};
 return {receive(message){
  if(message?.type==='activities'&&opened){
   if(message.requestId!==pendingRequest)return;
   pendingRequest=null;exportedId=null;entries=Array.isArray(message.activities)?message.activities:[];selected=entries.find(entry=>entry.id===selected?.id)??entries[0]??null;pending=false;
   text('activity-notice',message.error||message.notice||'');text('activities-warning',message.warning||'');render();
  }else if(message?.type==='activity-result'&&opened){
   if(message.id&&message.id!==selected?.id)return;
   if(message.requestId?message.requestId!==pendingRequest:pending)return;
   pending=false;pendingRequest=null;
   if(message.exported&&selected?.id===message.id)exportedId=message.id;
   text('activity-notice',message.error||message.notice||'');render();
  }
 },get isOpen(){return opened;}};
}
