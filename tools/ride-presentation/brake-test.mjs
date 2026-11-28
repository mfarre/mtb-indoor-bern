import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {brakeSceneFixture} from '../brakes/scene-fixture.mjs';
const source=await readFile(new URL('../../src/MTBIndoorBern/Scene/brake-presentation.js',import.meta.url),'utf8');
const {BrakePresentation,frontLockPose,brakeHud,BRAKE_VISUAL_STALE_MS}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const base={mode:'ride',presentationEpoch:'ride1',stateSequence:1,crashSequence:0,crashKind:null,recovery:0,frontBrake:0,rearBrake:0};
const crash={...base,stateSequence:2,crashSequence:1,crashKind:'front-lock',recovery:3,frontBrake:1,frontSlip:1};
for(const invalid of [0,-1,NaN,Infinity,4])assert.equal(frontLockPose(invalid).active,false);
assert.equal(frontLockPose(3).drop,0,'fall starts at normal camera height');
assert.equal(frontLockPose(2.5).drop,1.25,'camera reaches ground-level position without crossing the route');
assert.ok(frontLockPose(.1).drop<.03,'camera rises smoothly by the end of the three-second recovery');
assert.equal(frontLockPose(0).drop,0);
assert.ok(Math.abs(frontLockPose(2,false).roll)>Math.abs(frontLockPose(2,true).roll),'stable camera reduces tilt without concealing the crash');
assert.equal(frontLockPose(2,true,-1).roll,-frontLockPose(2,true,1).roll);
assert.ok(frontLockPose(2).pitch<0,'camera points down toward the ground');
{
 const view=new BrakePresentation();view.update(base,0);view.update(crash,100);
 assert.equal(view.sample(100).active,true);assert.ok(view.sample(200).drop>0);
 view.update({...crash,stateSequence:3,recovery:2.5},600);assert.equal(view.sample(600).drop,1.25);
 view.update({...crash,stateSequence:4,recovery:1.2},700);assert.ok(view.sample(700).drop<1.25);
 assert.equal(view.sample(700+BRAKE_VISUAL_STALE_MS+1).active,false,'missing host stream cannot keep a camera effect running');
 view.update({...crash,stateSequence:5,recovery:1},1400);assert.equal(view.sample(1400).active,false,'returning after stale data establishes a baseline');
 view.update({...crash,stateSequence:6,crashSequence:2,recovery:3},1500);assert.equal(view.sample(1500).active,true,'a new confirmed crash still works');
 view.update({...crash,stateSequence:7,mode:'paused'},1600);assert.equal(view.sample(1600).active,false,'pause immediately removes fall');
 view.update({...crash,stateSequence:8,crashSequence:3},1700);assert.equal(view.sample(1700).active,false,'resume does not replay a crash');
}
{
 const view=new BrakePresentation();view.update(crash,0);assert.equal(view.sample(100).active,false,'initial recovery packet is not a new crash');
 view.update({...crash,stateSequence:3,crashSequence:2},100);assert.equal(view.sample(200).active,true);
 assert.equal(view.update({...crash,stateSequence:2,crashSequence:99},150),false,'old packet cannot inject a crash');
 view.update({...crash,stateSequence:4,presentationEpoch:'seek'},300);assert.equal(view.sample(300).active,false,'seek resets camera');
 assert.equal(view.update({...crash,stateSequence:5},350),false,'retired epoch stays ignored');
 view.reset();assert.equal(view.sample(400).active,false);
}
{
 const view=new BrakePresentation();view.update(base,0);view.update({...crash,crashKind:'corner'},100);
 assert.equal(view.sample(200).active,false,'existing corner runout never becomes a front-wheel crash');
 for(const counter of [null,-1,NaN,'1']){view.reset();view.update(base,0);view.update({...crash,crashSequence:counter},100);assert.equal(view.sample(200).active,false);}
}
{
 const device={role:'Brakes',state:'warning',status:'Connected',detail:'Provisional calibration · weak magnetic field',inputConfirmed:true};
 const state={...base,frontBrake:.25,rearBrake:.8,devices:[device]};
 assert.deepEqual([brakeHud(state).front,brakeHud(state).rear],[.25,.8]);
 assert.equal(brakeHud(state).kind,'warn');assert.match(brakeHud(state).notice,/Provisional/);
 assert.equal(brakeHud(state,false).front,0);assert.match(brakeHud(state,false).notice,/stale/);
 assert.equal(brakeHud({...state,mode:'paused'}).rear,0);
 assert.match(brakeHud({...state,rearSlip:.9}).notice,/Rear skidding/);
 assert.match(brakeHud(crash).notice,/FRONT WHEEL LOCK/);
 assert.equal(brakeHud({...state,frontBrake:NaN,rearBrake:99}).front,0);assert.equal(brakeHud({...state,rearBrake:99}).rear,1);
}
console.log('Brake presentation checks passed: confirmed front-lock camera, 3s recovery, stable view, lifecycle/order/stale suppression and applied-pressure HUD.');
{
 const view=new BrakePresentation(),frames=brakeSceneFixture();let maximumDrop=0;
 for(const {atMs,snapshot} of frames){
  assert.equal(snapshot.demo,true);assert.equal(snapshot.control,false);assert.match(snapshot.settingsWarning,/SYNTHETIC.*no Bluetooth/);
  view.update(snapshot,atMs);const pose=view.sample(atMs);maximumDrop=Math.max(maximumDrop,pose.drop);
  if(atMs===1500)assert.match(brakeHud(snapshot).notice,/Rear skidding/);
  if(atMs===3000){assert.equal(pose.drop,1.25);assert.equal(snapshot.physicalSpeedKmh,0);}
  if(atMs>=5400)assert.equal(pose.active,false,'fixture recovers once without replaying the crash');
 }
 assert.equal(maximumDrop,1.25);
}
