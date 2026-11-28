import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../src/MTBIndoorBern/Scene/ride-presentation.js',import.meta.url),'utf8');
const {PresentationTimeline,FrameMetrics,normalizePresentation}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const state=(distance,sequence,more={})=>({distance,stateSequence:sequence,presentationEpoch:'a',mode:'ride',speed:36,gear:5,...more});

{
 const t=new PresentationTimeline();t.push(state(100,1),0);t.push(state(101,2),100);t.push(state(102,3),200);
 assert.equal(t.sample(250).distance,101.5,'10 Hz host positions produce intermediate render positions');
 assert.equal(t.sample(250).gear,5,'only the visual position is interpolated');
 assert.equal(t.sample(250).presentationInterpolated,true);
 assert.equal(t.sample(1000).distance,102,'stale updates never extrapolate ongoing motion');
 assert.equal(t.push(state(90,2),260),false,'old snapshots do not rewind the ride');
 assert.equal(t.sample(260).distance,101.6);
}
{
 const t=new PresentationTimeline();t.push(state(100,1),0);t.push(state(101,2),100);
 t.push(state(5000,3,{presentationEpoch:'seek'}),200);
 assert.equal(t.sample(200).distance,5000,'seeking snaps immediately, without crossing the intervening track');
 assert.equal(t.push(state(102,4),210),false,'late packets from the old epoch are ignored');
 t.push(state(0,1,{presentationEpoch:'reset',mode:'ready'}),300);
 assert.equal(t.sample(300).distance,0,'reset allows a new sequence and resets the visible position');
}
{
 const t=new PresentationTimeline();t.push(state(100,1),0);t.push(state(101,2),100);
 t.push(state(101,3,{mode:'paused'}),110);
 assert.equal(t.sample(110).distance,101,'pausing does not allow buffered motion to continue');
 t.push(state(101,4),200);assert.equal(t.sample(200).distance,101);
 t.push(state(3000,5),300);assert.equal(t.sample(300).distance,3000,'legacy large seeks without epochs also snap');
 t.push(state(5,6),400);assert.equal(t.sample(400).distance,5,'backwards seeks snap');
 t.push(state(20,7),1400);assert.equal(t.sample(1400).distance,20,'a stale source does not leave a trailing buffer when it resumes');
 t.clear();assert.equal(t.sample(1500).distance,20,'visibility reset preserves the current position');
 assert.equal(t.push(state(NaN,8),1600),false);
}
{
 // Both refresh rates sample the same timeline, with no render-count based movement.
 const t=new PresentationTimeline();for(let i=0;i<10;i++)t.push(state(100+i,i+1),i*100);
 for(const fps of [30,60])for(let frame=0;frame<=fps;frame++)t.sample(850+frame*1000/fps);
 assert.equal(t.sample(950).distance,108.5);
}
{
 const m=new FrameMetrics();for(let i=0;i<91;i++)m.record(i*1000/30,2);
 const result=m.snapshot(30);assert.ok(Math.abs(result.fps-30)<.001);assert.ok(Math.abs(result.frameMsP95-1000/30)<.001);
 assert.equal(result.renderSubmitMsP95,2,'CPU submission duration is distinct from frame duration');assert.equal(result.stallsOver100Ms,0);
 m.record(3200,14);assert.equal(m.snapshot().stallsOver100Ms,1);assert.equal(m.snapshot().frameMsMax,200);
 m.reset();m.record(9000,3);assert.equal(m.snapshot().stallsOver100Ms,0,'time hidden is not counted as an active render stall');
 assert.equal(m.snapshot().fps,0,'one frame cannot establish cadence');
}
{
 const m=new FrameMetrics();m.record(0,2);m.record(33,2);m.snapshot();
 m.reset({preserveLastAt:true});m.record(200,2);
 assert.equal(m.snapshot().stallsOver100Ms,1,'a stall across the reporting boundary belongs to the new window');
 assert.equal(m.snapshot().frameMsMax,167,'ordinary reports retain the last delivered frame timestamp');
 m.reset();m.record(10000,2);assert.equal(m.snapshot().stallsOver100Ms,0,'visibility and target changes still discard inactive time');
}
{
 assert.deepEqual(normalizePresentation(),{muted:false,volume:.35,immersive:false,targetFps:30,stableCamera:true});
 assert.equal(normalizePresentation({volume:5,targetFps:120}).volume,1);assert.equal(normalizePresentation({targetFps:120}).targetFps,30);
 assert.equal(normalizePresentation({volume:NaN}).volume,.35);assert.equal(normalizePresentation({stableCamera:'false'}).stableCamera,true);
 assert.equal(normalizePresentation({targetFps:60,stableCamera:false}).targetFps,60);
}
console.log('Presentation checks passed: interpolation, stale/late snapshots, seek/reset/pause, refresh-rate independence, frame intervals vs CPU submission and preference validation.');
