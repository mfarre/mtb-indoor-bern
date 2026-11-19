export function profilePosition(clientX,rect,length){
 if(!Number.isFinite(clientX)||!Number.isFinite(rect.left)||!Number.isFinite(rect.width)||rect.width<=0||!Number.isFinite(length)||length<=0)return null;
 return Math.max(0,Math.min(1,(clientX-rect.left)/rect.width))*length;
}
export function setupProfileSeek(canvas,send,getState,getCourse){
 const hint=document.createElement('span');hint.id='profile-help';hint.textContent='Demo: clica el perfil per saltar';canvas.parentElement.querySelector('.profile-label').append(hint);
 const preview=document.createElement('span');preview.id='seek-preview';preview.hidden=true;canvas.parentElement.append(preview);
 const seek=distance=>{if(getState().canSeek&&Number.isFinite(distance))send('seek',{distance});};
 canvas.addEventListener('click',e=>{const d=profilePosition(e.clientX,canvas.getBoundingClientRect(),getCourse()?.length);if(d!==null)seek(d);});
 canvas.addEventListener('pointermove',e=>{if(!getState().canSeek){preview.hidden=true;return;}const rect=canvas.getBoundingClientRect(),d=profilePosition(e.clientX,rect,getCourse()?.length);if(d===null)return;preview.hidden=false;preview.textContent=`Anar a ${(d/1000).toLocaleString('ca-ES',{minimumFractionDigits:2,maximumFractionDigits:2})} km`;preview.style.left=`${Math.max(60,Math.min(canvas.parentElement.clientWidth-70,e.clientX-canvas.parentElement.getBoundingClientRect().left))}px`;});
 canvas.addEventListener('pointerleave',()=>preview.hidden=true);
 canvas.addEventListener('keydown',e=>{if(!getState().canSeek)return;let d=getState().distance,step=e.shiftKey?1000:100;switch(e.key){case 'ArrowLeft':d-=step;break;case 'ArrowRight':d+=step;break;case 'Home':d=0;break;case 'End':d=getCourse().length;break;default:return;}e.preventDefault();seek(Math.max(0,Math.min(getCourse().length,d)));});
}
export function updateProfileSeek(canvas,state){
 const enabled=!!state.canSeek;canvas.classList.toggle('seekable',enabled);canvas.setAttribute('role','slider');canvas.setAttribute('aria-label',enabled?'Posició de la demo. Clica o usa les fletxes per saltar pel circuit.':'Perfil d’altitud. Inicia la demo per poder saltar a un punt.');canvas.tabIndex=enabled?0:-1;canvas.setAttribute('aria-disabled',String(!enabled));canvas.setAttribute('aria-valuemin','0');canvas.setAttribute('aria-valuemax',String(state.length??0));canvas.setAttribute('aria-valuenow',String(Math.round(state.distance??0)));canvas.setAttribute('aria-valuetext',`${((state.distance??0)/1000).toFixed(2)} km`);
 document.getElementById('profile-help').textContent=enabled?'CLICA EL PERFIL PER SALTAR · ← →':'DEMO: CLICA EL PERFIL PER SALTAR';
 if(!enabled)document.getElementById('seek-preview').hidden=true;
}
