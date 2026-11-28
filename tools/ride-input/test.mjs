import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Load the browser's actual module without requiring a repository-wide Node package mode.
const source=await readFile(new URL('../../src/MTBIndoorBern/Scene/ride-input.js',import.meta.url),'utf8');
const {setupMouseShifting}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
class Target {
 listeners=new Map();
 addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
 removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
 emit(name,props={}){const e={target:this,pointerType:'mouse',pointerId:1,isPrimary:true,clientX:100,clientY:100,button:0,buttons:0,preventDefault(){this.prevented=true;},...props};for(const fn of this.listeners.get(name)??[])fn(e);return e;}
}
function fixture(){
 const win=new Target(),doc=new Target(),canvas=new Target(),commands=[];
 let modal=false,state={mode:'ride',busy:false};
 doc.defaultView=win;doc.visibilityState='visible';doc.querySelector=()=>modal?{}:null;canvas.ownerDocument=doc;
 const dispose=setupMouseShifting(canvas,(action,data)=>commands.push({action,...data}),()=>state);
 const down=(props={})=>canvas.emit('pointerdown',{buttons:1,...props});
 const up=(props={})=>win.emit('pointerup',{target:canvas,...props});
 const click=(button=0,props={})=>{down({button,buttons:button===0?1:button===2?2:4,...props});up({button,...props});};
 return {win,doc,canvas,commands,down,up,click,dispose,setState:value=>{state=value;},setModal:value=>{modal=value;}};
}

{
 const f=fixture();f.click();f.click(2);
 assert.deepEqual(f.commands,[{action:'gear',delta:1},{action:'gear',delta:-1}],'left and right scene clicks shift once in opposite directions');
 f.setState({mode:'demo'});f.click();assert.equal(f.commands.length,3,'demo also supports the mouse fallback');
}
for(const mode of ['ready','paused','finished']){
 const f=fixture();f.setState({mode});f.click();f.click(2);assert.equal(f.commands.length,0,`${mode} must not shift`);
}
for(const changes of [{busy:true},{modal:true},{hidden:true}]){
 const f=fixture();f.down();
 if(changes.busy)f.setState({mode:'ride',busy:true});
 if(changes.modal)f.setModal(true);
 if(changes.hidden)f.doc.visibilityState='hidden';
 f.up();assert.equal(f.commands.length,0,'an unavailable scene rejects a click that began before it was blocked');
}
for(const props of [{pointerType:'touch'},{pointerType:'pen'},{isPrimary:false},{altKey:true},{ctrlKey:true},{metaKey:true},{shiftKey:true}]){
 const f=fixture();f.click(0,props);assert.equal(f.commands.length,0,'non-mouse or modified input must not shift');
}
{
 const f=fixture();f.click(1);f.down({buttons:3});f.up();f.down();f.up({ctrlKey:true});
 assert.equal(f.commands.length,0,'middle click, chorded buttons and a late modifier do not shift');
}
for(const targetName of ['button','input','select','profile','map','brake','menu']){
 const f=fixture(),control=new Target();
 // Pointer-up is observed globally, but only a press and release on the world canvas can shift.
 f.down({target:control});f.up({target:control});f.down();f.up({target:control});
 assert.equal(f.commands.length,0,`${targetName} interaction does not leak into scene shifting`);
}
{
 const f=fixture();f.down();f.win.emit('pointermove',{clientX:120});f.win.emit('pointermove',{clientX:100});f.up();
 f.down();f.up({clientY:130});
 assert.equal(f.commands.length,0,'dragging, even back to the original point, never shifts');
 f.down();f.up({clientX:103});assert.equal(f.commands.length,1,'small click jitter is tolerated');
}
for(const cancel of ['blur','pointercancel','hidden']){
 const f=fixture();f.down();
 if(cancel==='hidden'){f.doc.visibilityState='hidden';f.doc.emit('visibilitychange');f.doc.visibilityState='visible';}
 else f.win.emit(cancel);
 f.up();assert.equal(f.commands.length,0,`${cancel} clears a held mouse button`);
}
{
 const f=fixture();f.down();f.up({pointerId:2});f.up();assert.equal(f.commands.length,0,'a mismatched pointer cannot shift');
 f.down();f.setState({mode:'paused'});f.up();assert.equal(f.commands.length,0,'pausing during a click cancels it');
 const event=f.canvas.emit('contextmenu');assert.equal(event.prevented,true,'the scene suppresses the right-click menu');
 f.dispose();f.click();assert.equal(f.commands.length,0,'cleanup removes input listeners');
}
console.log('Mouse shifting regression checks passed: scene-only left/right shifts, demo, UI controls, pause, modifiers, drags, cancellation and cleanup.');
