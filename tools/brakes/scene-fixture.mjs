// Offline visual/audio QA only. Emit these ordinary state messages through the
// app's existing host bridge; this file never connects to BLE or a trainer.
export function brakeSceneFixture({distance=5030,length=10000,epoch='synthetic-brake-qa'}={}) {
  const frames=[];let position=distance;
  for(let i=0;i<=80;i++){
    const t=i/10,locked=t>=2.4&&t<5.4,recovery=locked?Math.min(3,Math.max(0,5.4-t)):0;
    const rearBrake=t>=1&&t<2?.95:0,rearSlip=t>=1&&t<2?.85:0;
    const frontBrake=t>=2&&t<2.6?1:0,frontSlip=t>=2.1&&t<2.4?.8:0;
    const physicalSpeedKmh=locked?0:t>=5.4?Math.min(24,12+(t-5.4)*7):24;
    if(i>0)position+=physicalSpeedKmh/3.6*.1;
    frames.push({atMs:i*100,snapshot:{type:'state',mode:'demo',demo:true,practice:false,demoSpeed:1,
      presentationEpoch:epoch,stateSequence:i+1,shiftSequence:0,crashSequence:t>=2.4?1:0,
      crashKind:locked?'front-lock':null,recovery,frontBrake,rearBrake,frontSlip,rearSlip,
      physicalSpeedKmh,speed:physicalSpeedKmh,distance:position,length,elapsed:t,climbed:0,
      watts:0,cadence:0,heart:null,gear:5,gearCount:12,grade:-7,altitude:830,surface:'earth',
      brake:frontBrake>0||rearBrake>0,brakePressure:Math.max(frontBrake,rearBrake),slip:0,skidSide:1,
      control:false,busy:false,settingsWarning:'SYNTHETIC BRAKE QA · no Bluetooth or trainer control',
      presentation:{muted:false,volume:.35,immersive:false,stableCamera:true,targetFps:30},
      devices:[{role:'Brakes',label:'Simulated levers',state:'warning',status:'Synthetic QA · no hardware',detail:'Synthetic QA · no hardware',inputConfirmed:false}]
    }});
  }
  return frames;
}

// CLI output can be deserialized by the native scene-smoke host without adding
// any test-only controls or mock Bluetooth implementation to the public app.
if(typeof process!=='undefined'&&process.argv[1]?.replaceAll('\\','/').endsWith('/scene-fixture.mjs'))
  process.stdout.write(JSON.stringify(brakeSceneFixture(),null,2)+'\n');
