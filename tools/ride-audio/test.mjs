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

assert.equal(audioTargets(ride).freehub, 0, 'pedalling has no freehub');
assert.ok(audioTargets({ ...ride, watts: 0, cadence: 0 }).freehub > 0, 'coasting rolls with freehub');
assert.equal(audioTargets({ ...ride, watts: null, cadence: null }).freehub, 0, 'missing telemetry is not a zero cadence measurement');
assert.equal(audioTargets({ ...ride, surface: 'earth', corner: { surface: 'asphalt' } }).surface, 'earth', 'under-wheel surface wins over upcoming corner');
for (const mode of ['ready', 'paused', 'finished', 'unknown']) {
  const target = audioTargets({ ...ride, mode, brakePressure: 1, slip: 1, watts: 0 });
  for (const field of ['tire', 'wind', 'freehub', 'brake', 'skid']) assert.equal(target[field], 0, `${mode} silences ${field}`);
}
for (const speed of [NaN, Infinity, -5, 0, undefined]) {
  const target = audioTargets({ ...ride, speed }); assert.equal(target.tire, 0); assert.equal(target.wind, 0);
}
assert.equal(audioTargets({ ...ride, busy: true }).speed, 0);
const demo = { ...ride, mode: 'demo', demo: true, demoSpeed: 8, speed: 178.56, grade: -7, cadence: 82, watts: 170 };
assert.equal(audioTargets(demo).speed, 22.32, '8x preview keeps natural audio playback');
assert.ok(audioTargets(demo).freehub > 0, 'demo descending ignores synthetic cadence');
assert.equal(audioTargets({ ...demo, practice: true, speed: 12, grade: 7, cadence: 0, watts: 160 }).freehub, 0, 'practice uphill zero cadence is synthetic');
assert.equal(audioTargets({ ...demo, audio: { coasting: false, brake: .8 } }).freehub, 0, 'explicit host adapter is authoritative');
assert.ok(audioTargets({ ...demo, audio: { brake: .8 } }).brake > 0, 'normal demo brake has an explicit sound path');
assert.deepEqual(audioPreferences({ volume: NaN, muted: 'yes' }), { volume: .35, muted: false });
assert.deepEqual(audioPreferences({ volume: 6, muted: true }), { volume: 1, muted: true });

{
  const model = new RideAudioState();
  assert.equal(model.update({ ...ride, stateSequence: 1 }, 0).gearClick, false);
  assert.equal(model.update({ ...ride, stateSequence: 2, gear: 6 }, .1).gearClick, true, 'only a changed host-confirmed gear clicks');
  assert.equal(model.update({ ...ride, stateSequence: 2, gear: 7 }, .15), null, 'duplicate snapshots are ignored');
  assert.equal(model.update({ ...ride, stateSequence: 1, gear: 7 }, .16), null, 'out-of-order snapshots are ignored');
  assert.equal(model.update({ ...ride, stateSequence: 3, gear: 6 }, .2).gearClick, false);
  assert.equal(model.update({ ...ride, stateSequence: 4, gear: 7 }, 2).gearClick, false, 'stale reconnect never replays a gear event');
  assert.equal(model.update({ ...ride, presentationEpoch: 'seek', stateSequence: 1, gear: 8, distance: 2000 }, 2.1).gearClick, false);
  assert.equal(model.update({ ...ride, presentationEpoch: 'one', stateSequence: 5 }, 2.15), null, 'retired epoch is rejected');
  assert.equal(model.update({ ...ride, presentationEpoch: 'seek', stateSequence: 2, mode: 'paused', gear: 9 }, 2.2).gearClick, false);
  assert.equal(model.update({ ...ride, presentationEpoch: 'seek', stateSequence: 3, gear: 10 }, 2.3).gearClick, false, 'resume never clicks');
}
for (const kind of ['earth', 'gravel', 'asphalt', 'leaves', 'wind', 'hub', 'brake', 'skid', 'gear']) {
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
  assert.equal(ctx.sources.length, 8, 'one persistent voice per layer');
  ctx.currentTime = .1; engine.update({ ...ride, gear: 6 });
  assert.equal(ctx.sources.length, 9, 'one confirmed gear click');
  for (let i = 2; i < 20; i++) { ctx.currentTime = i / 10; engine.update({ ...ride, gear: 6 }); }
  assert.equal(ctx.sources.length, 9, 'loop nodes are reused');
  const master = ctx.gains[0].gain;
  assert.ok(master.events.some(e => Math.abs(e.time - (1.9 + STALE_SECONDS)) < .00001 && e.value === 0), 'audio timeline fades when host packets stop');
  ctx.currentTime = 2; engine.setPreferences({ muted: true }); assert.equal(engine.status(), 'muted');
  assert.equal(master.events.find(e => e.time === 2).value, 0);
  engine.setPreferences({ muted: false }); ctx.currentTime = 2.1; engine.update({ ...ride, mode: 'paused' });
  assert.equal(master.events.find(e => e.time === 2.1).value, 0, 'pause silences without awaiting a timer');
  engine.silence(); ctx.currentTime = 2.2; engine.update({ ...ride, gear: 9 });
  assert.equal(ctx.sources.length, 9, 'silencing/resume never replays gear events');
  engine.dispose(); engine.dispose(); assert.equal(engine.status(), 'unavailable');
  assert.ok(ctx.sources.every(s => s.stopped !== undefined), 'dispose stops all sources');
}
{
  const ctx = new Context(); ctx.startRendering = () => {}; ctx.resume = () => { throw new Error('Offline context must not resume'); };
  const engine = createRideAudio({ context: ctx, watch: false });
  assert.equal(await engine.unlock(), true);
  for (let i = 0; i < 300; i++) engine.update({ ...demo, stateSequence: i }, i / 10);
  assert.equal(ctx.sources.length, 8); assert.equal(engine.status(), 'ready'); engine.dispose();
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
console.log('Ride audio checks passed: mode adapters, surface, gear/seek/stale events, deterministic sound buffers, persistent graph, fades, settings and isolated failures.');
