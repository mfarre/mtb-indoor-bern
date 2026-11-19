import {setupBikeSettings,updateBikeSettings,readBikeProfile} from '../../src/MTBIndoorBern/Scene/bike-settings.js';

// Application-owned regression harness. This bridge never imports the native
// WebView bridge, Bluetooth code, network APIs or the main game module.
const $=id=>document.getElementById(id);
const clone=value=>JSON.parse(JSON.stringify(value));
const baseProfile={name:'La meva MTB',riderKg:75,bikeKg:14,wheelCircumferenceM:2.3,chainring:32,sprockets:[51,45,39,33,28,24,21,18,16,14,12,10],difficulty:.5,lowCadenceAssist:true,physicalGearNote:'Plat 32 · pinyó 16'};
const sampleResult={completedUtc:'2026-11-19T08:00:00Z',settlingSeconds:3.2,meanErrorPercent:4.7,torqueRiseNmPerSecond:2.1,updateIntervalSeconds:.8,steps:5};
const idle={type:'calibration',phase:'idle',active:false,stepIndex:0,stepCount:5,progress:0};
let state,autoSave=true,running=false;
const actions=[],results=[];

function emitProfile(extra={}){updateBikeSettings({...clone(state),...extra});}
function emitCalibration(extra={}){updateBikeSettings({...idle,...extra});}
function send(action,extra={}){
 actions.push({action,...clone(extra)});
 if(action==='profile-request'){emitProfile();emitCalibration();}
 if(action==='profile-save'&&autoSave){state.profile=clone(extra.profile);emitProfile({saved:true,notice:'Perfil de prova desat (només en aquesta pàgina).'});}
 if(action==='calibration-start')emitCalibration({phase:'preparing',active:true,instruction:'Preparant una resposta simulada…',message:'Dades de prova: no hi ha cap KICKR connectat.'});
 if(action==='calibration-cancel')emitCalibration({phase:'cancelled',active:false,instruction:'Prova simulada aturada.',message:extra.reason});
 if(action==='calibration-forget'){state.calibrationResult=null;state.calibrationValid=false;emitProfile();}
}
const api=setupBikeSettings(send);
function reset(connected=false){
 api.close();autoSave=true;
 state={type:'bike-profile',profile:clone(baseProfile),calibrationResult:null,calibrationValid:false,trainerConnected:connected,canCalibrate:connected,notice:'Entorn de prova · no es desa res al joc.'};
 emitCalibration();emitProfile({saved:true,settingsWarning:''});
}
function open(tab='profile'){$('harness-profile').focus();api.open();$('bike-tab-'+tab).click();}
function edit(id,value,event='input'){const el=$(id);if(el.type==='checkbox')el.checked=value;else el.value=String(value);el.dispatchEvent(new Event(event,{bubbles:true}));}
function submit(){$('bike-profile-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}
function count(action){return actions.filter(item=>item.action===action).length;}
function assert(condition,message){if(!condition)throw new Error(message);}
function equal(actual,expected,message){assert(JSON.stringify(actual)===JSON.stringify(expected),`${message}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);}
function startFake(){edit('bike-ready',true,'change');$('bike-cal-start').click();}
function step(){emitCalibration({phase:'step',active:true,stepIndex:1,stepCount:5,instruction:'Mantén una pedalada estable.',targetCadenceMin:75,targetCadenceMax:90,targetPower:100,measuredPower:97,cadence:82,secondsRemaining:12,progress:.4});}
const pause=()=>new Promise(resolve=>requestAnimationFrame(resolve));

async function test(name,fn){
 try{await fn();results.push({name,passed:true});console.info('PASS',name);}
 catch(error){results.push({name,passed:false,error:error.message});console.error('FAIL',name,error);}
 const result=results.at(-1),row=document.createElement('li');row.className=result.passed?'pass':'fail';row.textContent=`${result.passed?'PASS':'FAIL'} · ${name}`;
 if(result.error){const detail=document.createElement('small');detail.textContent=result.error;row.append(detail);}$('harness-results').append(row);
}

async function run(){
 if(running)return;running=true;$('harness-run').disabled=true;results.length=0;actions.length=0;$('harness-results').replaceChildren();$('harness-result').textContent='Executant comprovacions amb sensors simulats…';
 reset();
 await test('Carrega el perfil, converteix metres a mm i mostra 12 marxes',()=>{
  open();assert(api.isOpen(),'El diàleg no s’ha obert');equal(count('profile-request'),1,'Peticions de perfil');equal($('bike-rider').value,'75','Pes');equal($('bike-wheel').value,'2300','Perímetre');equal($('bike-gear-count').textContent,'12 marxes','Nombre de marxes');assert(!$('bike-fields').disabled,'Formulari carregat bloquejat');
 });
 await test('La previsualització reflecteix els canvis de transmissió',()=>{
  edit('bike-chainring',30);equal($('bike-low-ratio').textContent,'30 × 51','Relació curta');equal($('bike-high-ratio').textContent,'30 × 10','Relació llarga');assert(!$('bike-save').disabled,'Desa no s’activa');
 });
 await test('Les actualitzacions periòdiques conserven l’esborrany',()=>{
  emitProfile({profile:{...state.profile,chainring:38}});equal($('bike-chainring').value,'30','El servidor ha sobreescrit el plat');equal($('bike-notice').textContent,'Canvis pendents de desar.','Avís d’esborrany');
 });
 await test('Rebutja pinyons duplicats i conserva l’error entre actualitzacions',()=>{
  const before=count('profile-save');edit('bike-sprockets','51, 45, 45, 10');submit();equal(count('profile-save'),before,'S’ha enviat un perfil invàlid');equal($('bike-sprockets').getAttribute('aria-invalid'),'true','Camp invàlid');const error=$('bike-notice').textContent;emitProfile();equal($('bike-notice').textContent,error,'Avís esborrat');
 });
 await test('Valida ordre, límits, quantitat de marxes i perímetre',()=>{
  const values={...baseProfile,wheelMm:2300,sprockets:baseProfile.sprockets.join(',')};
  for(const [key,value]of[['sprockets','10, 20, 30, 40'],['sprockets','51, 45, 10'],['sprockets','61, 50, 30, 10'],['riderKg',39],['bikeKg',36],['wheelMm',1499],['chainring',32.5],['difficulty',1.1],['difficulty','']])assert(readBikeProfile({...values,[key]:value}).errors[key],`S’ha acceptat ${key}=${value}`);
  assert(readBikeProfile(values).profile,'Perfil vàlid rebutjat');
 });
 await test('Desa valors convertits i espera la confirmació del servidor',()=>{
  autoSave=false;edit('bike-sprockets','46,37,32,28,24,21,19,17,15,13,11');edit('bike-wheel',2280);submit();const sent=actions.at(-1);equal(sent.action,'profile-save','Acció');equal(sent.profile.wheelCircumferenceM,2.28,'Conversió mm/m');equal(sent.profile.sprockets.length,11,'Cassette');assert($('bike-save').disabled&&$('bike-fields').disabled,'Petició pendent no bloquejada');emitProfile();equal($('bike-wheel').value,'2280','Esborrany pendent perdut');assert($('bike-fields').disabled,'Actualització ha eliminat l’espera');state.profile=clone(sent.profile);emitProfile({saved:true,notice:'Perfil desat.'});assert(!$('bike-fields').disabled&&$('bike-save').disabled,'Confirmació no aplicada');
 });
 await test('Un error de desament conserva els valors i el missatge',()=>{
  edit('bike-rider',81);submit();emitProfile({saved:true,error:'No s’ha pogut escriure la configuració.'});emitProfile();equal($('bike-rider').value,'81','Esborrany perdut');assert($('bike-notice').textContent.includes('No s’ha pogut escriure'),'Error no persistent');assert(!$('bike-save').disabled,'No es pot reintentar');
 });
 await test('settingsWarning persisteix fins a un desament correcte',()=>{
  reset();open();emitProfile({settingsWarning:'Configuració recuperada: revisa els valors.'});emitProfile();assert($('bike-notice').textContent.includes('Configuració recuperada'),'Advertiment esborrat');edit('bike-rider',76);submit();assert(!$('bike-notice').textContent.includes('Configuració recuperada'),'Advertiment no eliminat després de desar');
 });
 await test('Conserva dificultats existents de 60% i 0% sense arrodonir',()=>{
  for(const difficulty of [.6,0]){state.profile.difficulty=difficulty;emitProfile({saved:true});equal($('bike-difficulty').value,String(difficulty),'Dificultat carregada');edit('bike-rider',77);submit();equal(actions.at(-1).profile.difficulty,difficulty,'Dificultat desada');}
 });
 await test('Els pinyons predefinits actualitzen el nombre de marxes',()=>{
  edit('bike-cassette','11-46','change');equal($('bike-gear-count').textContent,'11 marxes','Cassette 11v');edit('bike-cassette','10-52','change');equal($('bike-low-ratio').textContent,'32 × 52','Cassette 52');submit();
 });
 await test('Sense connexió, la prova queda bloquejada malgrat marcar preparat',()=>{
  $('bike-tab-guide').click();edit('bike-ready',true,'change');assert($('bike-cal-start').disabled,'Inici habilitat sense KICKR');equal($('bike-calibration-badge').textContent,'Pendent de prova','Resultat inventat');
 });
 await test('Un calibratge desat espera el KICKR per validar la compatibilitat',()=>{
  state.calibrationResult=clone(sampleResult);emitProfile();equal($('bike-calibration-badge').textContent,'Desat · pendent de KICKR','Estat desconnectat');assert($('bike-guide-result').textContent.includes('Pendent de connectar'),'Detall de compatibilitat');
 });
 await test('La prova requereix una confirmació nova en cada obertura',()=>{
  reset(true);open('guide');assert(!$('bike-ready').checked&&$('bike-cal-start').disabled,'Confirmació inicial absent');edit('bike-ready',true,'change');api.close();open('guide');assert(!$('bike-ready').checked&&$('bike-cal-start').disabled,'Confirmació anterior reutilitzada');
 });
 await test('Les dades idle periòdiques no desmarquen la confirmació',()=>{
  edit('bike-ready',true,'change');emitCalibration();emitCalibration();emitProfile();assert($('bike-ready').checked&&!$('bike-cal-start').disabled,'Actualització ha reiniciat la confirmació');
 });
 await test('Començar envia una sola ordre i bloqueja el perfil',()=>{
  const before=count('calibration-start');$('bike-cal-start').click();equal(count('calibration-start'),before+1,'Nombre d’inicis');assert($('bike-fields').disabled&&$('bike-tab-profile').disabled,'Perfil actiu editable');assert(!$('bike-cal-stop').hidden&&$('bike-cal-start').hidden,'Atura no visible');equal($('bike-step-label').textContent,'PREPARANT','Etiqueta preparació');
 });
 await test('Mostra el pas zero-based, la cadència, els watts i el progrés',()=>{
  step();equal($('bike-step-label').textContent,'PAS 2 / 5','Pas');equal($('bike-live-cadence').textContent,'82','Cadència');equal($('bike-target-watts').textContent,'100','Objectiu');equal($('bike-measured-watts').textContent,'97','Mesurat');equal($('bike-cal-progress').value,.4,'Progrés');assert($('bike-live-cadence').classList.contains('in-range'),'Cadència en rang');
 });
 await test('Aturar cancel·la la prova i no fabrica un resultat',()=>{
  const before=count('calibration-cancel');$('bike-cal-stop').click();equal(count('calibration-cancel'),before+1,'Cancel·lacions');equal($('bike-step-label').textContent,'ATURADA','Etiqueta final');assert(!$('bike-ready').checked,'Confirmació no reiniciada');equal($('bike-calibration-badge').textContent,'Pendent de prova','Resultat fabricat');
 });
 await test('Les etiquetes de fase tenen prioritat sobre stepCount',()=>{
  for(const [phase,label]of[['warmup','PREPARACIÓ'],['complete','RESULTAT'],['failed','PROVA NO VÀLIDA'],['cancelled','ATURADA']]){emitCalibration({phase,active:phase==='warmup'});equal($('bike-step-label').textContent,label,'Etiqueta '+phase);}
 });
 await test('Un resultat antic no revalida un perfil incompatible',()=>{
  state.calibrationResult=clone(sampleResult);state.calibrationValid=false;emitProfile();emitCalibration({phase:'complete',result:sampleResult});equal($('bike-calibration-badge').textContent,'Cal repetir la prova','Validesa sobreescrita');
 });
 await test('Un resultat vàlid mostra mètriques i es pot esborrar',()=>{
  state.calibrationValid=true;emitProfile();equal($('bike-calibration-badge').textContent,'Calibratge vigent','Validesa');assert($('bike-guide-result').textContent.includes('3,2 s'),'Temps de resposta absent');$('bike-cal-forget').click();equal($('bike-calibration-badge').textContent,'Pendent de prova','Resultat no esborrat');
 });
 await test('Tancar una prova envia cancel·lació i profile-close',()=>{
  startFake();const cancels=count('calibration-cancel'),closes=count('profile-close');api.close();equal(count('calibration-cancel'),cancels+1,'Cancel·lació en tancar');equal(count('profile-close'),closes+1,'Avís de tancament');assert(!api.isOpen(),'Diàleg obert');equal(document.activeElement.id,'harness-profile','Focus no restaurat');
 });
 await test('Tancar inactiu només envia profile-close',()=>{
  open();const cancels=count('calibration-cancel'),closes=count('profile-close');api.close();equal(count('calibration-cancel'),cancels,'Cancel·lació innecessària');equal(count('profile-close'),closes+1,'Avís inactiu');api.close();equal(count('profile-close'),closes+1,'Tancament duplicat');
 });
 await test('Escape cancel·la i no arriba als controls del joc',()=>{
  open('guide');startFake();let reached=false;const listener=()=>{reached=true;};window.addEventListener('keydown',listener);const cancels=count('calibration-cancel');$('bike-cal-stop').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));window.removeEventListener('keydown',listener);assert(!api.isOpen()&&!reached,'Escape ha arribat al joc');equal(count('calibration-cancel'),cancels+1,'Cancel·lació Escape');
 });
 await test('Perdre el focus atura una prova activa',()=>{
  open('guide');startFake();const cancels=count('calibration-cancel');window.dispatchEvent(new Event('blur'));equal(count('calibration-cancel'),cancels+1,'Cancel·lació blur');assert($('bike-cal-stop').hidden,'Prova segueix activa');
 });
 await test('Les fletxes canvien de pestanya sense executar dreceres del joc',()=>{
  $('bike-tab-profile').click();$('bike-tab-profile').focus();$('bike-tab-profile').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));equal($('bike-tab-guide').getAttribute('aria-selected'),'true','Fletxa de pestanyes bloquejada');equal(document.activeElement.id,'bike-tab-guide','Focus de pestanya');let reached=false;const listener=()=>{reached=true;};window.addEventListener('keydown',listener);$('bike-tab-guide').dispatchEvent(new KeyboardEvent('keydown',{key:'b',bubbles:true,cancelable:true}));window.removeEventListener('keydown',listener);assert(!reached,'Drecera ha arribat al joc');
 });
 await test('El focus queda dins el diàleg amb Tab i Maj+Tab',()=>{
  $('bike-tab-profile').click();edit('bike-rider',79);$('bike-save').focus();$('bike-save').dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));equal(document.activeElement.id,'bike-close','Tab no torna al primer control');$('bike-close').dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));equal(document.activeElement.id,'bike-save','Maj+Tab no torna al final');
 });
 await test('El diàleg i els controls de tancament caben a la finestra',async()=>{
  await pause();const rect=$('bike-dialog').getBoundingClientRect(),close=$('bike-close').getBoundingClientRect(),footer=$('bike-save').getBoundingClientRect();assert(rect.left>=0&&rect.right<=innerWidth+1&&rect.top>=0&&rect.bottom<=innerHeight+1,'Diàleg fora de la finestra');assert(close.top>=0&&footer.bottom<=innerHeight+1,'Controls de tancament fora de la finestra');assert($('bike-dialog').scrollWidth<=$('bike-dialog').clientWidth+1,'Desbordament horitzontal');
 });
 reset();const failed=results.filter(result=>!result.passed).length;$('harness-result').textContent=`${results.length-failed}/${results.length} comprovacions correctes · ${failed} errors · cap accés al maquinari`;$('harness-result').classList.toggle('fail',failed>0);running=false;$('harness-run').disabled=false;console.info('BIKE_UI_RESULTS',JSON.stringify(results));
 // An optional test-only WebView host may collect this report. No device or
 // profile actions are ever sent to that host; those stay in the fake bridge.
 window.chrome?.webview?.postMessage?.({type:'test-result',running:false,total:results.length,failed,results:clone(results),viewport:{width:innerWidth,height:innerHeight}});
 return clone(results);
}

function preview(tab='profile'){if(running)return;reset();open(tab);}
$('harness-run').onclick=run;$('harness-profile').onclick=()=>preview();$('harness-guide').onclick=()=>preview('guide');
window.bikeUiHarness={run,preview,results,actions,getSummary:()=>({running,total:results.length,failed:results.filter(result=>!result.passed).length})};
await run();const requested=new URLSearchParams(location.search).get('preview');if(requested==='profile'||requested==='guide')preview(requested);
