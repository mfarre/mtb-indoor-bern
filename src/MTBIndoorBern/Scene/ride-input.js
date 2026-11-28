// Mouse shifting belongs to the 3D scene, never to controls or profile seeking.
export function setupMouseShifting(canvas, send, getState) {
 const doc=canvas.ownerDocument,win=doc.defaultView;
 let press=null;
 const clear=()=>{press=null;};
 const unmodified=e=>!e.altKey&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey;
 const available=()=>{
  const state=getState();
  return (state.mode==='ride'||state.mode==='demo')&&!state.busy&&
   doc.visibilityState!=='hidden'&&!doc.querySelector('dialog[open]');
 };
 const down=e=>{
  clear();
  const expectedButtons=e.button===0?1:e.button===2?2:0;
  if(e.target!==canvas||e.pointerType!=='mouse'||e.isPrimary===false||
   !expectedButtons||e.buttons!==expectedButtons||!unmodified(e)||!available())return;
  press={id:e.pointerId,button:e.button,x:e.clientX,y:e.clientY};
 };
 const move=e=>{
  if(press&&e.pointerId===press.id&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>6)clear();
 };
 const up=e=>{
  const started=press;
  clear();
  if(!started||e.pointerId!==started.id||e.button!==started.button||e.target!==canvas||
   e.pointerType!=='mouse'||e.buttons!==0||!unmodified(e)||!available()||
   Math.hypot(e.clientX-started.x,e.clientY-started.y)>6)return;
  e.preventDefault();
  send('gear',{delta:e.button===0?1:-1});
 };
 const context=e=>{if(e.target===canvas)e.preventDefault();};
 const visibility=()=>{if(doc.visibilityState==='hidden')clear();};
 canvas.addEventListener('pointerdown',down);
 canvas.addEventListener('contextmenu',context);
 win.addEventListener('pointermove',move);
 win.addEventListener('pointerup',up);
 win.addEventListener('pointercancel',clear);
 win.addEventListener('blur',clear);
 doc.addEventListener('visibilitychange',visibility);
 return ()=>{
  clear();
  canvas.removeEventListener('pointerdown',down);
  canvas.removeEventListener('contextmenu',context);
  win.removeEventListener('pointermove',move);
  win.removeEventListener('pointerup',up);
  win.removeEventListener('pointercancel',clear);
  win.removeEventListener('blur',clear);
  doc.removeEventListener('visibilitychange',visibility);
 };
}
