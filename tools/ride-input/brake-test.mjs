import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../src/MTBIndoorBern/Scene/trail-ui.js',import.meta.url),'utf8');
const {setupTrail}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
class Target {
 constructor({tag='canvas',parent=null,role=null,editable=false}={}){this.tag=tag;this.parent=parent;this.role=role;this.editable=editable;this.listeners=new Map();}
 addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(fn);}
 closest(selector){return selector.split(',').some(s=>s===this.tag||s==='[role="button"]'&&this.role==='button'||s==='[contenteditable="true"]'&&this.editable)?this:this.parent?.closest(selector)??null;}
 emit(name,props={}){const event={target:this,code:'Space',defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...props};for(const fn of this.listeners.get(name)??[])fn(event);return event;}
 setPointerCapture(){}
}
const original={document:globalThis.document,window:globalThis.window,setInterval:globalThis.setInterval};
try{
 const win=new Target(),doc=new Target(),scene=new Target(),brake=new Target({tag:'button'}),practice=new Target({tag:'button'}),sent=[];
 let dialogOpen=false;
 doc.getElementById=id=>id==='brake'?brake:practice;doc.querySelector=()=>dialogOpen?{}:null;
 globalThis.window=win;globalThis.document=doc;globalThis.setInterval=()=>0;
 const clear=setupTrail((action,data)=>sent.push({action,...data}));
 const key=(type,code='Space',target=scene,extra={})=>win.emit(type,{code,target,...extra});
 for(const code of ['Space','KeyA']){
  assert.equal(key('keydown',code).defaultPrevented,true);assert.deepEqual(sent.at(-1),{action:'brake',pressed:true});
  key('keyup',code);assert.deepEqual(sent.at(-1),{action:'brake',pressed:false});
 }
 for(const target of [new Target({tag:'button'}),new Target({tag:'span',parent:new Target({tag:'button'})}),new Target({tag:'input'}),new Target({tag:'select'}),new Target({tag:'textarea'}),new Target({tag:'a'}),new Target({tag:'div',role:'button'}),new Target({tag:'div',editable:true})]){
  const count=sent.length;
  assert.equal(key('keydown','Space',target).defaultPrevented,false,'native Space activation stays available on interactive controls');
  key('keydown','KeyA',target);key('keyup','Space',target);key('keyup','KeyA',target);
  assert.equal(sent.length,count,'typing or activating controls does not brake');
 }
 dialogOpen=true;
 const count=sent.length;assert.equal(key('keydown').defaultPrevented,false,'an open dialog keeps Space even if focus is on its body');
 key('keydown','KeyA');assert.equal(sent.length,count);
 dialogOpen=false;key('keydown','KeyA');dialogOpen=true;
 key('keyup','KeyA',new Target({tag:'button'}));assert.deepEqual(sent.at(-1),{action:'brake',pressed:false},'keyup clears a held brake after focus moves into a dialog');
 dialogOpen=false;
 const ignored=sent.length;key('keydown','KeyA',scene,{defaultPrevented:true});assert.equal(sent.length,ignored,'already handled keys do not create brake input');
 key('keydown','KeyA');key('keydown','Space');key('keyup','KeyA');assert.equal(sent.at(-1).pressed,true,'releasing one of two held brake keys keeps the other active');
 key('keyup','Space');assert.equal(sent.at(-1).pressed,false);
 brake.emit('pointerdown',{currentTarget:brake,pointerId:1});assert.equal(sent.at(-1).pressed,true,'on-screen pointer brake remains available');
 brake.emit('pointerup');assert.equal(sent.at(-1).pressed,false);
 const brakeKey=brake.emit('keydown',{code:'Space'});assert.equal(brakeKey.defaultPrevented,true);assert.equal(sent.at(-1).pressed,true,'the focused brake button retains its dedicated hold shortcut');
 key('keyup','Space',brake);assert.equal(sent.at(-1).pressed,false);
 key('keydown');clear();assert.equal(sent.at(-1).pressed,false);
 console.log('Brake keyboard checks passed: scene A/Space, interactive controls, dialog isolation, held-key release, combined keys and pointer brake.');
}finally{Object.assign(globalThis,original);}
