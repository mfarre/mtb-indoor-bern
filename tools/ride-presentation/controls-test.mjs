import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const url=relative=>new URL('../../src/MTBIndoorBern/Scene/'+relative,import.meta.url);
const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const dependency=dataUrl(await readFile(url('ride-presentation.js'),'utf8'));
const source=(await readFile(url('presentation-controls.js'),'utf8')).replace("'./ride-presentation.js'",JSON.stringify(dependency));
const {setupPresentationControls}=await import(dataUrl(source));
class Element {
 constructor(){this.listeners=new Map();this.attributes=new Map();this.classList={toggle(){}};this.value='';}
 addEventListener(name,fn){this.listeners.set(name,fn);}
 setAttribute(name,value){this.attributes.set(name,value);}
 emit(name,props={}){this.listeners.get(name)?.({preventDefault(){},stopPropagation(){},...props});}
 focus(){document.activeElement=this;}
 showModal(){this.open=true;}
 close(){this.open=false;}
}
const original=globalThis.document,elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
globalThis.document={getElementById:get,activeElement:null,body:new Element()};
try{
 const sent=[],changes=[];let audioState='locked',unlocks=0,brakeClears=0;
 const audio={status:()=>audioState,setPreferences(){},unlock(){unlocks++;audioState='ready';}};
 const controls=setupPresentationControls((action,data)=>sent.push({action,...data}),audio,(next,previous)=>changes.push({next,previous}),()=>brakeClears++);
 controls.receive({muted:false,volume:.35,immersive:false,targetFps:30,stableCamera:true});
 get('immersive-toggle').onclick();assert.equal(controls.value.immersive,true);
 assert.deepEqual(sent.at(-1),{action:'presentation-settings',preferences:{immersive:true}});
 controls.receive({immersive:false,volume:.35});assert.equal(controls.value.immersive,true,'old host snapshots cannot undo a pending local change');
 controls.receive({immersive:true,volume:.35});assert.equal(controls.value.immersive,true);
 controls.receive({immersive:false,volume:.35});assert.equal(controls.value.immersive,false,'after acknowledgement the host can restore a saved preference');
 const before=sent.length;
 get('sound-volume').value='64';get('sound-volume').emit('input');
 assert.equal(controls.value.volume,.64);assert.equal(sent.length,before,'dragging volume does not write settings on every input event');
 controls.receive({volume:.35});assert.equal(controls.value.volume,.64,'volume stays steady until acknowledged');
 get('sound-volume').emit('change');assert.equal(sent.length,before+1);assert.equal(sent.at(-1).preferences.volume,.64);
 assert.equal(unlocks,1,'a volume gesture can unlock audio without a host round trip');
 audioState='locked';get('sound-toggle').onclick();assert.equal(controls.value.muted,false);assert.equal(unlocks,2,'Enable sound unlocks instead of toggling it off');
 get('sound-toggle').onclick();assert.equal(controls.value.muted,true);assert.equal(unlocks,2);
 get('sound-toggle').onclick();assert.equal(controls.value.muted,false);assert.equal(unlocks,3);
 get('target-fps').value='60';get('target-fps').onchange();assert.equal(sent.at(-1).preferences.targetFps,60);
 get('stable-camera').checked=false;get('stable-camera').onchange();assert.equal(sent.at(-1).preferences.stableCamera,false);
 const opener=get('presentation-settings');opener.focus();opener.onclick();assert.equal(brakeClears,1);assert.equal(get('presentation-dialog').open,true);
 let stopped=false;get('presentation-dialog').emit('keydown',{stopPropagation(){stopped=true;}});assert.equal(stopped,true,'dialog keyboard input does not leak into ride shortcuts');
 get('presentation-dialog').emit('cancel');assert.equal(get('presentation-dialog').open,false);assert.equal(document.activeElement,opener);
 audioState='unavailable';controls.refreshAudio();assert.equal(get('sound-toggle').disabled,true);assert.equal(controls.value.targetFps,60,'audio unavailability does not change ride rendering settings');
 assert.ok(changes.length>0);
 console.log('Presentation controls checks passed: host acknowledgement, volume save cadence, audio gestures, persisted camera/FPS and modal keyboard isolation.');
}finally{globalThis.document=original;}
