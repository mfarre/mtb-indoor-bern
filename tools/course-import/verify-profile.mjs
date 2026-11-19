import assert from 'node:assert/strict';
import {profilePosition,setupProfileSeek,updateProfileSeek} from '../../src/MTBIndoorBern/Scene/profile-seek.js';
const nodes=new Map();
function element(){return {style:{},attrs:{},handlers:{},classList:{toggle(){}},addEventListener(n,f){this.handlers[n]=f;},setAttribute(k,v){this.attrs[k]=v;},append(v){nodes.set(v.id,v);},getBoundingClientRect(){return {left:30,width:400}},clientWidth:400};}
globalThis.document={createElement:element,getElementById:id=>nodes.get(id)};
const canvas=element(),label=element();canvas.parentElement={...element(),querySelector:()=>label};
let state={canSeek:true,distance:1000,length:25000},course={length:25000};const messages=[];
setupProfileSeek(canvas,(action,args)=>messages.push({action,...args}),()=>state,()=>course);
assert.equal(profilePosition(230,{left:30,width:400},25000),12500);
assert.equal(profilePosition(-1,{left:30,width:400},25000),0);
assert.equal(profilePosition(900,{left:30,width:400},25000),25000);
for(const [x,rect,len] of [[NaN,{left:0,width:10},100],[1,{left:NaN,width:10},100],[1,{left:0,width:0},100],[1,{left:0,width:10},Infinity]])assert.equal(profilePosition(x,rect,len),null);
canvas.handlers.click({clientX:230});assert.deepEqual(messages.pop(),{action:'seek',distance:12500});
for(const [key,shiftKey,expected] of [['ArrowLeft',false,900],['ArrowRight',true,2000],['Home',false,0],['End',false,25000]]){let prevented=false;canvas.handlers.keydown({key,shiftKey,preventDefault(){prevented=true}});assert.equal(prevented,true);assert.equal(messages.pop().distance,expected);}
canvas.handlers.pointermove({clientX:230});assert.equal(nodes.get('seek-preview').hidden,false);
state.canSeek=false;canvas.handlers.click({clientX:230});canvas.handlers.keydown({key:'End'});assert.equal(messages.length,0);updateProfileSeek(canvas,state);assert.equal(canvas.tabIndex,-1);assert.equal(canvas.attrs['aria-disabled'],'true');assert.equal(nodes.get('seek-preview').hidden,true);
state.canSeek=true;updateProfileSeek(canvas,state);assert.equal(canvas.tabIndex,0);assert.equal(canvas.attrs['aria-valuenow'],'1000');
console.log('PASS: profile click mapping, clamps, invalid input, keyboard seeking, disabled real ride and accessible position');
