import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = new URL('../../src/MTBIndoorBern/Scene/', import.meta.url);
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const stateUrl = moduleUrl(await readFile(new URL('ride-audio-state.js', root), 'utf8'));
const synthesisUrl = moduleUrl(await readFile(new URL('ride-audio-synthesis.js', root), 'utf8'));
const runtimeUrl = moduleUrl((await readFile(new URL('ride-audio.js', root), 'utf8'))
  .replace("'./ride-audio-state.js'", JSON.stringify(stateUrl)).replace("'./ride-audio-synthesis.js'", JSON.stringify(synthesisUrl)));
const { audioTargets, audioPreferences, RideAudioState, STALE_SECONDS } = await import(stateUrl);
const { synthesizeRideBuffer } = await import(synthesisUrl);
const { createRideAudio } = await import(runtimeUrl);
const ride = { mode: 'ride', speed: 24, watts: 160, cadence: 75, surface: 'gravel', gear: 5, gearCount: 12, presentationEpoch: 'one', distance: 100 };

assert.ok(audioTargets(ride).tire > 0 && audioTargets(ride).wind > 0, 'drivetrain removal does not mute tyres or wind');
assert.ok(audioTargets({ ...ride, brakePressure: 1, slip: .8 }).brake > 0 && audioTargets({ ...ride, slip: .8 }).skid > 0, 'braking and corner scrub remain');
assert.deepEqual(audioTargets({ ...ride, watts: 0, cadence: 0, gear: 1, audio: { coasting: true } }), audioTargets(ride), 'coasting and shifting cannot add drivetrain noise');
assert.deepEqual(audioTargets({ ...ride, watts: null, cadence: null }), audioTargets(ride), 'power/cadence changes do not affect remaining sounds');
assert.ok(!('freehub' in audioTargets(ride)) && !('hubRate' in audioTargets(ride)), 'no drivetrain audio targets');
assert.equal(audioTargets({ ...ride, surface: 'earth', corner: { surface: 'asphalt' } }).surface, 'earth', 'under-wheel surface wins over upcoming corner');
for (const mode of ['ready', 'paused', 'finished', 'unknown']) {
  const target = audioTargets({ ...ride, mode, brakePressure: 1, slip: 1, watts: 0 });
  for (const field of ['tire', 'wind', 'brake', 'skid']) assert.equal(target[field], 0, `${mode} silences ${field}`);
}
for (const speed of [NaN, Infinity, -5, 0, undefined]) {
  const target = audioTargets({ ...ride, speed }); assert.equal(target.tire, 0); assert.equal(target.wind, 0);
}
assert.equal(audioTargets({ ...ride, busy: true }).speed, 0);
const demo = { ...ride, mode: 'demo', demo: true, demoSpeed: 8, speed: 178.56, grade: -7, cadence: 82, watts: 170 };
assert.equal(audioTargets(demo).speed, 22.32, '8x preview keeps natural audio playback');
assert.deepEqual(audioTargets({ ...demo, audio: { coasting: true } }), audioTargets({ ...demo, audio: { coasting: false } }), 'demo coasting has no drivetrain layer');
assert.equal(audioTargets({ ...demo, practice: true, speed: 12, grade: 7, cadence: 0, watts: 160 }).speed, 12, 'practice uses simulated speed');
assert.ok(audioTargets({ ...demo, audio: { brake: .8 } }).brake > 0, 'normal demo brake has an explicit sound path');
assert.deepEqual(audioPreferences({ volume: NaN, muted: 'yes' }), { volume: .35, muted: false });
assert.deepEqual(audioPreferences({ volume: 6, muted: true }), { volume: 1, muted: true });

{
  const model = new RideAudioState();
  assert.deepEqual(model.update({ ...ride, stateSequence: 1 }, 0), audioTargets(ride));
  assert.deepEqual(model.update({ ...ride, stateSequence: 2, gear: 6 }, .1), audioTargets(ride), 'confirmed gear changes create no events');
  assert.equal(model.update({ ...ride, stateSequence: 2, gear: 7 }, .15), null, 'duplicate snapshots are ignored');
  assert.equal(model.update({ ...ride, stateSequence: 1, gear: 7 }, .16), null, 'out-of-order snapshots are ignored');
  assert.equal(model.update({ ...ride, stateSequence: 3, gear: 6 }, .2).gearClick, undefined);
  assert.equal(model.update({ ...ride, stateSequence: 4, gear: 7 }, 2).gearClick, undefined, 'stale reconnect never replays a gear event');
  assert.equal(model.update({ ...ride, presentationEpoch: 'seek', stateSequence: 1, gear: 8, distance: 2000 }, 2.1).gearClick, undefined);
  assert.equal(model.update({ ...ride, presentationEpoch: 'one', stateSequence: 5 }, 2.15), null, 'retired epoch is rejected');
  assert.equal(model.update({ ...ride, presentationEpoch: 'seek', stateSequence: 2, mode: 'paused', gear: 9 }, 2.2).gearClick, undefined);
  assert.equal(model.update({ ...ride, presentationEpoch: 'seek', stateSequence: 3, gear: 10 }, 2.3).gearClick, undefined, 'resume never clicks');
}
for (const removed of ['hub', 'gear']) assert.throws(() => synthesizeRideBuffer(removed), /Invalid ride buffer/, 'removed drivetrain buffers cannot be generated');
for (const kind of ['earth', 'gravel', 'asphalt', 'leaves', 'wind', 'brake', 'skid']) {
  const data = synthesizeRideBuffer(kind, 12000); let energy = 0, peak = 0, mean = 0;
  for (const sample of data) { assert.ok(Number.isFinite(sample)); energy += sample * sample; peak = Math.max(peak, Math.abs(sample)); mean += sample; }
  assert.ok(peak < 1 && peak > .1, `${kind} has headroom and audible material`);
  assert.ok(Math.sqrt(energy / data.length) < .3); assert.ok(Math.abs(mean / data.length) < .015, `${kind} DC bias`);
  assert.equal(Math.abs(data[0]), 0); assert.equal(Math.abs(data.at(-1)), 0);
  assert.deepEqual(data, synthesizeRideBuffer(kind, 12000), `${kind} synthesis is reproducible`);
}

class Param {
  value = 0; events = [];
  cancelScheduledValues(time) { this.events = this.events.filter(e => e.time < time); }
  setTargetAtTime(value, time, smoothing) { assert.ok(Number.isFinite(value) && time >= 0 && smoothing > 0); this.events.push({ value, time, smoothing }); }
}
class Node {
  gain = new Param(); frequency = new Param(); Q = new Param(); playbackRate = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  connect() {} disconnect() {} start(time) { this.started = time; } stop(time = 0) { this.stopped = time; }
}
class Context {
  currentTime = 0; sampleRate = 12000; state = 'suspended'; destination = new Node(); sources = []; gains = [];
  createGain() { const node = new Node(); this.gains.push(node); return node; }
  createDynamicsCompressor() { return new Node(); } createBiquadFilter() { return new Node(); }
  createBufferSource() { const node = new Node(); this.sources.push(node); return node; }
  createBuffer(channels, length, rate) { const data = new Float32Array(length); return { duration: length / rate, getChannelData: () => data }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
}
{
  const ctx = new Context(), engine = createRideAudio({ context: ctx, watch: false });
  engine.update(ride); assert.equal(ctx.sources.length, 0, 'no graph before gesture');
  assert.equal(engine.status(), 'locked'); await engine.unlock(); assert.equal(engine.status(), 'ready');
  assert.equal(ctx.sources.length, 7, 'seven environmental/friction loops, no freehub source');
  ctx.currentTime = .1; engine.update({ ...ride, gear: 6 });
  assert.equal(ctx.sources.length, 7, 'confirmed shifting adds no one-shot source');
  for (let i = 2; i < 20; i++) { ctx.currentTime = i / 10; engine.update({ ...ride, gear: 1 + i % 12, watts: 0, cadence: 0, audio: { coasting: true } }); }
  assert.equal(ctx.sources.length, 7, 'repeated shifts and coasting reuse only environmental/friction loops');
  const master = ctx.gains[0].gain;
  assert.ok(master.events.some(e => e.value === .35) && ctx.gains[2].gain.events.some(e => e.value > 0), 'default master and gravel source remain audible');
  assert.ok(master.events.some(e => Math.abs(e.time - (1.9 + STALE_SECONDS)) < .00001 && e.value === 0), 'audio timeline fades when host packets stop');
  ctx.currentTime = 2; engine.setPreferences({ muted: true }); assert.equal(engine.status(), 'muted');
  assert.equal(master.events.find(e => e.time === 2).value, 0);
  engine.setPreferences({ muted: false }); ctx.currentTime = 2.1; engine.update({ ...ride, mode: 'paused' });
  assert.equal(master.events.find(e => e.time === 2.1).value, 0, 'pause silences without awaiting a timer');
  engine.silence(); ctx.currentTime = 2.2; engine.update({ ...ride, gear: 9 });
  assert.equal(ctx.sources.length, 7, 'silencing/resume never adds gear sources');
  engine.dispose(); engine.dispose(); assert.equal(engine.status(), 'unavailable');
  assert.ok(ctx.sources.every(s => s.stopped !== undefined), 'dispose stops all sources');
}
{
  const ctx = new Context(); ctx.startRendering = () => {}; ctx.resume = () => { throw new Error('Offline context must not resume'); };
  const engine = createRideAudio({ context: ctx, watch: false });
  assert.equal(await engine.unlock(), true);
  for (let i = 0; i < 300; i++) engine.update({ ...demo, stateSequence: i }, i / 10);
  assert.equal(ctx.sources.length, 7); assert.equal(engine.status(), 'ready'); engine.dispose();
}
{
  const ctx = new Context(); ctx.resume = () => Promise.reject(new Error('autoplay denied'));
  const engine = createRideAudio({ context: ctx, watch: false });
  assert.equal(await engine.unlock(), false, 'blocked autoplay is a contained promise'); engine.dispose();
}
{
  const ctx = new Context(); ctx.createBufferSource = () => { throw new Error('audio unavailable'); };
  const engine = createRideAudio({ context: ctx, watch: false });
  assert.equal(await engine.unlock(), false); assert.equal(engine.status(), 'unavailable');
  assert.doesNotThrow(() => { engine.update(ride); engine.setPreferences({ volume: .7 }); engine.silence(); engine.dispose(); });
}
console.log('Ride audio checks passed: drivetrain sources and triggers removed, terrain/wind/braking preserved, mode/seek/stale handling, persistent graph, fades, settings and isolated failures.');
