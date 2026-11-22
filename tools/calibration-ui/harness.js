import {setupBikeSettings,updateBikeSettings,readBikeProfile} from '../../src/MTBIndoorBern/Scene/bike-settings.js';

// Application-owned regression harness. This bridge never imports the native
// WebView bridge, Bluetooth code, network APIs or the main game module.
const $=id=>document.getElementById(id);
const clone=value=>JSON.parse(JSON.stringify(value));
const baseProfile={name:'My MTB',riderKg:75,bikeKg:14,wheelCircumferenceM:2.3,chainring:32,sprockets:[51,45,39,33,28,24,21,18,16,14,12,10],difficulty:.5,lowCadenceAssist:true,physicalGearNote:'32T chainring · 16T sprocket'};
const sampleResult={completedUtc:'2026-11-19T08:00:00Z',settlingSeconds:3.2,meanErrorPercent:4.7,torqueRiseNmPerSecond:2.1,updateIntervalSeconds:.8,steps:5};
const idle={type:'calibration',phase:'idle',active:false,stepIndex:0,stepCount:5,progress:0};
let state,autoSave=true,running=false;
const actions=[],results=[];

function emitProfile(extra={}){updateBikeSettings({...clone(state),...extra});}
function emitCalibration(extra={}){updateBikeSettings({...idle,...extra});}
function send(action,extra={}){
 actions.push({action,...clone(extra)});
 if(action==='profile-request'){emitProfile();emitCalibration();}
 if(action==='profile-save'&&autoSave){state.profile=clone(extra.profile);emitProfile({saved:true,notice:'Test profile saved (on this page only).'});}
 if(action==='calibration-start')emitCalibration({phase:'preparing',active:true,instruction:'Preparing a simulated response…',message:'Test data: no KICKR is connected.'});
 if(action==='calibration-cancel')emitCalibration({phase:'cancelled',active:false,instruction:'Simulated test stopped.',message:extra.reason});
 if(action==='calibration-forget'){state.calibrationResult=null;state.calibrationValid=false;emitProfile();}
}
const api=setupBikeSettings(send);
function reset(connected=false){
 api.close();autoSave=true;
 state={type:'bike-profile',profile:clone(baseProfile),calibrationResult:null,calibrationValid:false,trainerConnected:connected,canCalibrate:connected,notice:'Test environment · nothing is saved to the game.'};
 emitCalibration();emitProfile({saved:true,settingsWarning:''});
}
function open(tab='profile'){$('harness-profile').focus();api.open();$('bike-tab-'+tab).click();}
function edit(id,value,event='input'){const el=$(id);if(el.type==='checkbox')el.checked=value;else el.value=String(value);el.dispatchEvent(new Event(event,{bubbles:true}));}
function submit(){$('bike-profile-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}
function count(action){return actions.filter(item=>item.action===action).length;}
function assert(condition,message){if(!condition)throw new Error(message);}
function equal(actual,expected,message){assert(JSON.stringify(actual)===JSON.stringify(expected),`${message}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);}
function startFake(){edit('bike-ready',true,'change');$('bike-cal-start').click();}
function step(){emitCalibration({phase:'step',active:true,stepIndex:1,stepCount:5,instruction:'Keep pedalling steadily.',targetCadenceMin:75,targetCadenceMax:90,targetPower:100,measuredPower:97,cadence:82,secondsRemaining:12,progress:.4});}
const pause=()=>new Promise(resolve=>requestAnimationFrame(resolve));

async function test(name,fn){
 try{await fn();results.push({name,passed:true});console.info('PASS',name);}
 catch(error){results.push({name,passed:false,error:error.message});console.error('FAIL',name,error);}
 const result=results.at(-1),row=document.createElement('li');row.className=result.passed?'pass':'fail';row.textContent=`${result.passed?'PASS':'FAIL'} · ${name}`;
 if(result.error){const detail=document.createElement('small');detail.textContent=result.error;row.append(detail);}$('harness-results').append(row);
}

async function run(){
 if(running)return;running=true;$('harness-run').disabled=true;results.length=0;actions.length=0;$('harness-results').replaceChildren();$('harness-result').textContent='Running checks with simulated sensors…';
 reset();
 await test('Loads the profile, converts metres to mm and displays 12 gears',()=>{
  open();assert(api.isOpen(),'The dialog did not open');equal(count('profile-request'),1,'Profile requests');equal($('bike-rider').value,'75','Weight');equal($('bike-wheel').value,'2300','Circumference');equal($('bike-gear-count').textContent,'12 gears','Gear count');assert(!$('bike-fields').disabled,'Loaded form is disabled');
 });
 await test('Preview reflects drivetrain changes',()=>{
  edit('bike-chainring',30);equal($('bike-low-ratio').textContent,'30 × 51','Low gear ratio');equal($('bike-high-ratio').textContent,'30 × 10','High gear ratio');assert(!$('bike-save').disabled,'Save did not become available');
 });
 await test('Periodic updates preserve the draft',()=>{
  emitProfile({profile:{...state.profile,chainring:38}});equal($('bike-chainring').value,'30','The server overwrote the chainring');equal($('bike-notice').textContent,'Unsaved changes.','Draft notice');
 });
 await test('Rejects duplicate sprockets and preserves the error between updates',()=>{
  const before=count('profile-save');edit('bike-sprockets','51, 45, 45, 10');submit();equal(count('profile-save'),before,'An invalid profile was sent');equal($('bike-sprockets').getAttribute('aria-invalid'),'true','Invalid field');const error=$('bike-notice').textContent;emitProfile();equal($('bike-notice').textContent,error,'Notice cleared');
 });
 await test('Validates order, limits, gear count and circumference',()=>{
  const values={...baseProfile,wheelMm:2300,sprockets:baseProfile.sprockets.join(',')};
  for(const [key,value]of[['sprockets','10, 20, 30, 40'],['sprockets','51, 45, 10'],['sprockets','61, 50, 30, 10'],['riderKg',39],['bikeKg',36],['wheelMm',1499],['chainring',32.5],['difficulty',1.1],['difficulty','']])assert(readBikeProfile({...values,[key]:value}).errors[key],`Accepted ${key}=${value}`);
  assert(readBikeProfile(values).profile,'Valid profile rejected');
 });
 await test('Saves converted values and waits for server confirmation',()=>{
  autoSave=false;edit('bike-sprockets','46,37,32,28,24,21,19,17,15,13,11');edit('bike-wheel',2280);submit();const sent=actions.at(-1);equal(sent.action,'profile-save','Action');equal(sent.profile.wheelCircumferenceM,2.28,'mm/m conversion');equal(sent.profile.sprockets.length,11,'Cassette');assert($('bike-save').disabled&&$('bike-fields').disabled,'Pending request did not lock the form');emitProfile();equal($('bike-wheel').value,'2280','Pending draft lost');assert($('bike-fields').disabled,'Update removed the pending state');state.profile=clone(sent.profile);emitProfile({saved:true,notice:'Profile saved.'});assert(!$('bike-fields').disabled&&$('bike-save').disabled,'Confirmation not applied');
 });
 await test('A save error preserves values and the message',()=>{
  edit('bike-rider',81);submit();emitProfile({saved:true,error:'Unable to write the settings.'});emitProfile();equal($('bike-rider').value,'81','Draft lost');assert($('bike-notice').textContent.includes('Unable to write'),'Error did not persist');assert(!$('bike-save').disabled,'Retry unavailable');
 });
 await test('settingsWarning persists until a successful save',()=>{
  reset();open();emitProfile({settingsWarning:'Settings recovered: review the values.'});emitProfile();assert($('bike-notice').textContent.includes('Settings recovered'),'Warning cleared');edit('bike-rider',76);submit();assert(!$('bike-notice').textContent.includes('Settings recovered'),'Warning remained after saving');
 });
 await test('Preserves existing 60% and 0% difficulty without rounding',()=>{
  for(const difficulty of [.6,0]){state.profile.difficulty=difficulty;emitProfile({saved:true});equal($('bike-difficulty').value,String(difficulty),'Loaded difficulty');edit('bike-rider',77);submit();equal(actions.at(-1).profile.difficulty,difficulty,'Saved difficulty');}
 });
 await test('Cassette presets update the gear count',()=>{
  edit('bike-cassette','11-46','change');equal($('bike-gear-count').textContent,'11 gears','11-speed cassette');edit('bike-cassette','10-52','change');equal($('bike-low-ratio').textContent,'32 × 52','Cassette 52');submit();
 });
 await test('Without a connection, the test stays blocked even when ready is selected',()=>{
  $('bike-tab-guide').click();edit('bike-ready',true,'change');assert($('bike-cal-start').disabled,'Start enabled without KICKR');equal($('bike-calibration-badge').textContent,'Test pending','Result invented');
 });
 await test('A saved calibration waits for the KICKR to validate compatibility',()=>{
  state.calibrationResult=clone(sampleResult);emitProfile();equal($('bike-calibration-badge').textContent,'Saved · awaiting KICKR','Disconnected status');assert($('bike-guide-result').textContent.includes('Connect the KICKR to verify compatibility.'),'Compatibility detail');
 });
 await test('The test requires fresh confirmation each time it opens',()=>{
  reset(true);open('guide');assert(!$('bike-ready').checked&&$('bike-cal-start').disabled,'Initial confirmation missing');edit('bike-ready',true,'change');api.close();open('guide');assert(!$('bike-ready').checked&&$('bike-cal-start').disabled,'Previous confirmation reused');
 });
 await test('Periodic idle data does not clear the ready confirmation',()=>{
  edit('bike-ready',true,'change');emitCalibration();emitCalibration();emitProfile();assert($('bike-ready').checked&&!$('bike-cal-start').disabled,'Update reset the confirmation');
 });
 await test('Starting sends one command and locks the profile',()=>{
  const before=count('calibration-start');$('bike-cal-start').click();equal(count('calibration-start'),before+1,'Start count');assert($('bike-fields').disabled&&$('bike-tab-profile').disabled,'Active profile is editable');assert(!$('bike-cal-stop').hidden&&$('bike-cal-start').hidden,'Stop not visible');equal($('bike-step-label').textContent,'PREPARING','Preparation label');
 });
 await test('Displays the zero-based step, cadence, watts and progress',()=>{
  step();equal($('bike-step-label').textContent,'STEP 2 / 5','Step');equal($('bike-live-cadence').textContent,'82','Cadence');equal($('bike-target-watts').textContent,'100','Target');equal($('bike-measured-watts').textContent,'97','Measured');equal($('bike-cal-progress').value,.4,'Progress');assert($('bike-live-cadence').classList.contains('in-range'),'Cadence in range');
 });
 await test('Stopping cancels the test without inventing a result',()=>{
  const before=count('calibration-cancel');$('bike-cal-stop').click();equal(count('calibration-cancel'),before+1,'Cancellations');equal($('bike-step-label').textContent,'STOPPED','Final label');assert(!$('bike-ready').checked,'Confirmation not reset');equal($('bike-calibration-badge').textContent,'Test pending','Result fabricated');
 });
 await test('Phase labels take precedence over stepCount',()=>{
  for(const [phase,label]of[['warmup','WARM-UP'],['complete','RESULT'],['failed','INVALID TEST'],['cancelled','STOPPED']]){emitCalibration({phase,active:phase==='warmup'});equal($('bike-step-label').textContent,label,'Label '+phase);}
 });
 await test('An old result does not revalidate an incompatible profile',()=>{
  state.calibrationResult=clone(sampleResult);state.calibrationValid=false;emitProfile();emitCalibration({phase:'complete',result:sampleResult});equal($('bike-calibration-badge').textContent,'Test needed','Validity overwritten');
 });
 await test('A valid result displays metrics and can be cleared',()=>{
  state.calibrationValid=true;emitProfile();equal($('bike-calibration-badge').textContent,'Calibration current','Validity');assert($('bike-guide-result').textContent.includes('3.2 s'),'Response time missing');$('bike-cal-forget').click();equal($('bike-calibration-badge').textContent,'Test pending','Result not cleared');
 });
 await test('Closing a test sends cancellation and profile-close',()=>{
  startFake();const cancels=count('calibration-cancel'),closes=count('profile-close');api.close();equal(count('calibration-cancel'),cancels+1,'Cancellation on close');equal(count('profile-close'),closes+1,'Close notification');assert(!api.isOpen(),'Dialog open');equal(document.activeElement.id,'harness-profile','Focus not restored');
 });
 await test('Closing while idle only sends profile-close',()=>{
  open();const cancels=count('calibration-cancel'),closes=count('profile-close');api.close();equal(count('calibration-cancel'),cancels,'Unnecessary cancellation');equal(count('profile-close'),closes+1,'Idle notification');api.close();equal(count('profile-close'),closes+1,'Duplicate close');
 });
 await test('Escape cancels without reaching the game controls',()=>{
  open('guide');startFake();let reached=false;const listener=()=>{reached=true;};window.addEventListener('keydown',listener);const cancels=count('calibration-cancel');$('bike-cal-stop').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));window.removeEventListener('keydown',listener);assert(!api.isOpen()&&!reached,'Escape reached the game');equal(count('calibration-cancel'),cancels+1,'Escape cancellation');
 });
 await test('Losing focus stops an active test',()=>{
  open('guide');startFake();const cancels=count('calibration-cancel');window.dispatchEvent(new Event('blur'));equal(count('calibration-cancel'),cancels+1,'Blur cancellation');assert($('bike-cal-stop').hidden,'Test remains active');
 });
 await test('Arrow keys switch tabs without triggering game shortcuts',()=>{
  $('bike-tab-profile').click();$('bike-tab-profile').focus();$('bike-tab-profile').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));equal($('bike-tab-guide').getAttribute('aria-selected'),'true','Tab arrow key blocked');equal(document.activeElement.id,'bike-tab-guide','Tab focus');let reached=false;const listener=()=>{reached=true;};window.addEventListener('keydown',listener);$('bike-tab-guide').dispatchEvent(new KeyboardEvent('keydown',{key:'b',bubbles:true,cancelable:true}));window.removeEventListener('keydown',listener);assert(!reached,'Shortcut reached the game');
 });
 await test('Focus stays inside the dialog with Tab and Shift+Tab',()=>{
  $('bike-tab-profile').click();edit('bike-rider',79);$('bike-save').focus();$('bike-save').dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));equal(document.activeElement.id,'bike-close','Tab did not return to the first control');$('bike-close').dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));equal(document.activeElement.id,'bike-save','Shift+Tab did not return to the last control');
 });
 await test('The dialog and close controls fit within the window',async()=>{
  await pause();const rect=$('bike-dialog').getBoundingClientRect(),close=$('bike-close').getBoundingClientRect(),footer=$('bike-save').getBoundingClientRect();assert(rect.left>=0&&rect.right<=innerWidth+1&&rect.top>=0&&rect.bottom<=innerHeight+1,'Dialog outside the window');assert(close.top>=0&&footer.bottom<=innerHeight+1,'Close controls outside the window');assert($('bike-dialog').scrollWidth<=$('bike-dialog').clientWidth+1,'Horizontal overflow');
 });
 reset();const failed=results.filter(result=>!result.passed).length;$('harness-result').textContent=`${results.length-failed}/${results.length} checks passed · ${failed} failures · no hardware access`;$('harness-result').classList.toggle('fail',failed>0);running=false;$('harness-run').disabled=false;console.info('BIKE_UI_RESULTS',JSON.stringify(results));
 // An optional test-only WebView host may collect this report. No device or
 // profile actions are ever sent to that host; those stay in the fake bridge.
 window.chrome?.webview?.postMessage?.({type:'test-result',running:false,total:results.length,failed,results:clone(results),viewport:{width:innerWidth,height:innerHeight}});
 return clone(results);
}

function preview(tab='profile'){if(running)return;reset();open(tab);}
$('harness-run').onclick=run;$('harness-profile').onclick=()=>preview();$('harness-guide').onclick=()=>preview('guide');
window.bikeUiHarness={run,preview,results,actions,getSummary:()=>({running,total:results.length,failed:results.filter(result=>!result.passed).length})};
await run();const requested=new URLSearchParams(location.search).get('preview');if(requested==='profile'||requested==='guide')preview(requested);
