import {normalizePresentation} from './ride-presentation.js';

export function setupPresentationControls(send,audio,onChange,onDialogOpen=()=>{}) {
 const $=id=>document.getElementById(id),dialog=$('presentation-dialog');
 let stored=normalizePresentation(),pending={},value=stored,previousFocus;
 function render(){
  document.body.classList.toggle('immersive',value.immersive);
  $('immersive-toggle').textContent=value.immersive?'Show details':'Focus view';
  $('immersive-toggle').setAttribute('aria-pressed',String(value.immersive));
  $('immersive-toggle').title=value.immersive?'Show the map, elevation profile and ride details':'Hide ride details while keeping essential telemetry visible';
  if(document.activeElement!==$('sound-volume'))$('sound-volume').value=String(Math.round(value.volume*100));
  $('sound-volume-value').textContent=Math.round(value.volume*100)+'%';
  $('stable-camera').checked=value.stableCamera;$('target-fps').value=String(value.targetFps);
  refreshAudio();
 }
 function refreshAudio(){
  const status=audio.status(),button=$('sound-toggle');
  button.textContent=status==='unavailable'?'Sound unavailable':value.muted?'Sound off':value.volume===0?'Sound 0%':status==='locked'?'Enable sound':'Sound on';
  button.disabled=status==='unavailable';button.setAttribute('aria-pressed',String(!value.muted&&status==='ready'));
  button.title=value.muted?'Enable trail and bike sound':value.volume===0?'Volume is 0%. Raise it in View & sound.':status==='locked'?'Click to enable sound':'Mute trail and bike sound';
  $('sound-note').textContent=status==='unavailable'?'Audio is unavailable. The ride still works normally.':status==='locked'?'Sound starts after you press Start, Demo or Enable sound.':'Procedural trail, tyre, wind and bike sounds. No music.';
 }
 function apply(){
  const next=normalizePresentation({...stored,...pending}),before=value;value=next;
  audio.setPreferences(value);render();onChange(value,before);
 }
 function change(patch,persist=true){pending={...pending,...patch};apply();if(persist)send('presentation-settings',{preferences:patch});}
 $('immersive-toggle').onclick=()=>change({immersive:!value.immersive});
 $('sound-toggle').onclick=()=>{
  const locked=audio.status()==='locked';
  change({muted:locked?false:!value.muted});if(!value.muted)audio.unlock();refreshAudio();
 };
 $('sound-volume').addEventListener('input',()=>change({volume:Number($('sound-volume').value)/100},false));
 $('sound-volume').addEventListener('change',()=>{change({volume:Number($('sound-volume').value)/100});audio.unlock();});
 $('stable-camera').onchange=()=>change({stableCamera:$('stable-camera').checked});
 $('target-fps').onchange=()=>change({targetFps:Number($('target-fps').value)});
 $('presentation-settings').onclick=()=>{previousFocus=document.activeElement;onDialogOpen();render();dialog.showModal();$('presentation-close').focus();};
 const close=()=>{dialog.close();previousFocus?.focus();};
 $('presentation-close').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 // The ride's A/Space brake shortcuts must not consume keyboard interaction in
 // this dialog. Clear held brake input when opening it, then keep its keys local.
 dialog.addEventListener('keydown',event=>event.stopPropagation());
 dialog.addEventListener('keyup',event=>event.stopPropagation());
 render();
 return {
  get value(){return value;},refreshAudio,
  receive(incoming){
   if(!incoming)return;
   stored=normalizePresentation(incoming);
   // Host snapshots may arrive while a slider is being dragged or a save is in
   // flight. Keep the user's pending value until the host acknowledges it.
   for(const key of Object.keys(pending))if(stored[key]===pending[key])delete pending[key];
   apply();
  }
 };
}
