import { AUDIO_VERSION, AUDIO_DEFAULTS, STALE_SECONDS, audioPreferences, RideAudioState } from './ride-audio-state.js';
import { synthesizeRideBuffer } from './ride-audio-synthesis.js';

export { AUDIO_VERSION };

// Audio is a best-effort consumer of snapshots. It has no bridge or simulation callbacks.
// Inject OfflineAudioContext and set watch:false to render exactly this graph for comparison video.
export function createRideAudio({ context = null, watch = true } = {}) {
  let ctx = context, owned = false, graph = null, failed = false, disposed = false;
  let preferences = { ...AUDIO_DEFAULTS }, latest = null, lastAcceptedAt = -Infinity;
  let lastArrival = -Infinity, timer = null;
  const state = new RideAudioState(), activeClicks = new Set();
  const doc = watch && typeof document !== 'undefined' ? document : null;
  const offline = () => !!ctx && typeof ctx.startRendering === 'function';
  const wallNow = () => (globalThis.performance?.now?.() ?? Date.now()) / 1000;
  const atNow = () => ctx?.currentTime ?? 0;
  const safe = fn => { try { return fn(); } catch { fail(); return undefined; } };

  function releaseNodes() {
    if (!graph) return;
    for (const voice of Object.values(graph.voices)) { try { voice.source.stop(); voice.source.disconnect(); voice.filter.disconnect(); voice.gain.disconnect(); } catch {} }
    for (const click of activeClicks) { try { click.source.stop(); click.source.disconnect(); click.gain.disconnect(); } catch {} }
    activeClicks.clear();
    try { graph.master.disconnect(); graph.compressor.disconnect(); } catch {}
    graph = null;
  }
  function fail() { failed = true; releaseNodes(); }
  function target(param, value, time, smoothing = .12) {
    param.cancelScheduledValues(time);
    param.setTargetAtTime(value, time, smoothing);
  }
  function buffer(kind) {
    const values = synthesizeRideBuffer(kind, ctx.sampleRate);
    const result = ctx.createBuffer(1, values.length, ctx.sampleRate);
    result.getChannelData(0).set(values);
    return result;
  }
  function buildGraph() {
    const master = ctx.createGain(), compressor = ctx.createDynamicsCompressor();
    master.gain.value = 0;
    compressor.threshold.value = -16; compressor.knee.value = 12;
    compressor.ratio.value = 2.5; compressor.attack.value = .005; compressor.release.value = .2;
    master.connect(compressor); compressor.connect(ctx.destination);
    // Assign early so partial initialization can always be disconnected on error.
    graph = { master, compressor, voices: {}, gear: null };
    for (const kind of ['earth', 'gravel', 'asphalt', 'leaves', 'wind', 'hub', 'brake', 'skid']) {
      const source = ctx.createBufferSource(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
      graph.voices[kind] = { source, gain, filter };
      source.buffer = buffer(kind); source.loop = true; gain.gain.value = 0;
      filter.type = 'lowpass'; filter.Q.value = .55;
      filter.frequency.value = { earth: 2600, gravel: 4300, asphalt: 1800, leaves: 4600, wind: 650, hub: 5400, brake: 3800, skid: 3600 }[kind];
      source.connect(filter); filter.connect(gain); gain.connect(master);
      source.start(atNow());
    }
    graph.gear = buffer('gear');
  }
  function masterAt(time, active) {
    if (!graph) return;
    const audible = active && !preferences.muted && !doc?.hidden;
    target(graph.master.gain, audible ? preferences.volume : 0, time, .035);
    // This watchdog is on the AUDIO timeline: even a blocked rendering thread fades to silence.
    // A new host packet cancels this future fade before rearming it. Pauses never need a timer.
    if (active) graph.master.gain.setTargetAtTime(0, time + STALE_SECONDS, .05);
  }
  function clickAt(time) {
    if (!graph || preferences.muted || doc?.hidden) return;
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = graph.gear; gain.gain.value = .09;
    source.connect(gain); gain.connect(graph.master);
    const click = { source, gain }; activeClicks.add(click);
    source.onended = () => { try { source.disconnect(); gain.disconnect(); } catch {} activeClicks.delete(click); };
    source.start(time); source.stop(time + graph.gear.duration + .01);
  }
  function apply(snapshot, time) {
    const values = state.update(snapshot, time);
    if (!values) return;
    lastAcceptedAt = time;
    if (values.discontinuity) {
      for (const click of activeClicks) { try { click.source.stop(time); } catch {} }
    }
    for (const kind of ['earth', 'gravel', 'asphalt', 'leaves']) {
      target(graph.voices[kind].gain.gain, values.surface === kind ? values.tire : 0, time, .18);
      target(graph.voices[kind].source.playbackRate, values.rate, time, .2);
    }
    for (const [kind, value] of [['wind', values.wind], ['hub', values.freehub], ['brake', values.brake], ['skid', values.skid]])
      target(graph.voices[kind].gain.gain, value, time, kind === 'hub' ? .13 : .1);
    target(graph.voices.hub.source.playbackRate, values.hubRate, time, .2);
    target(graph.voices.wind.filter.frequency, 350 + values.speed * 15, time, .3);
    masterAt(time, values.running);
    if (values.gearClick) clickAt(time);
  }
  function silence() {
    safe(() => {
      if (graph) target(graph.master.gain, 0, atNow(), .025);
      for (const click of activeClicks) { try { click.source.stop(atNow()); } catch {} }
      state.reset(); lastAcceptedAt = -Infinity;
    });
  }
  function visibility() { if (doc?.hidden) silence(); }

  const api = {
    // Call directly in the pointer/keyboard handler; NEVER await before forwarding Start to the host.
    // All errors, including blocked autoplay, are contained here instead of reaching global rejection handlers.
    unlock() {
      if (disposed || failed) return Promise.resolve(false);
      try {
        if (!ctx) {
          const AudioContextType = globalThis.AudioContext ?? globalThis.webkitAudioContext;
          if (!AudioContextType) { fail(); return Promise.resolve(false); }
          ctx = new AudioContextType({ latencyHint: 'interactive' }); owned = true;
        }
        const resume = offline() || ctx.state === 'running' ? Promise.resolve() : ctx.resume();
        return Promise.resolve(resume).then(() => {
          if (disposed || failed) return false;
          // Resume is requested in the gesture; buffer preparation is deferred until after
          // the handler can forward Start. It cannot delay the trainer command itself.
          if (!graph) safe(buildGraph);
          if (failed) return false;
          if (latest && wallNow() - lastArrival < STALE_SECONDS) { state.reset(); safe(() => apply(latest, atNow())); }
          return !failed;
        }).catch(() => false);
      } catch { fail(); return Promise.resolve(false); }
    },
    update(snapshot, atSeconds) {
      if (disposed || failed || !snapshot || typeof snapshot !== 'object') return;
      latest = snapshot; lastArrival = wallNow();
      if (snapshot.presentation) preferences = audioPreferences(snapshot.presentation, preferences);
      if (!graph) return;
      safe(() => apply(snapshot, Number.isFinite(atSeconds) ? Math.max(atNow(), atSeconds) : atNow()));
    },
    setPreferences(patch = {}) {
      preferences = audioPreferences(patch, preferences);
      if (disposed || failed || !graph) return;
      safe(() => {
        const now = atNow(), fresh = now - lastAcceptedAt < STALE_SECONDS;
        const running = latest && (latest.mode === 'ride' || latest.mode === 'demo') && !latest.busy;
        masterAt(now, !!running && fresh);
        // A settings interaction must not keep a stale host stream audible for another .9 s.
        if (fresh && running) graph.master.gain.setTargetAtTime(0, lastAcceptedAt + STALE_SECONDS, .05);
      });
    },
    silence,
    status() {
      if (failed || disposed) return 'unavailable';
      if (preferences.muted || preferences.volume === 0) return 'muted';
      return graph && (offline() || ctx.state === 'running') ? 'ready' : 'locked';
    },
    dispose() {
      if (disposed) return; disposed = true;
      if (timer !== null) clearInterval(timer);
      doc?.removeEventListener('visibilitychange', visibility);
      releaseNodes();
      if (owned && ctx) { try { Promise.resolve(ctx.close()).catch(() => {}); } catch {} }
    }
  };
  if (watch) {
    doc?.addEventListener('visibilitychange', visibility);
    timer = setInterval(() => { if (graph && wallNow() - lastArrival > STALE_SECONDS && lastAcceptedAt !== -Infinity) silence(); }, 200);
  }
  return api;
}
