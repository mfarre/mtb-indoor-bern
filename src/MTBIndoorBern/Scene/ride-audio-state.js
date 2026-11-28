// Pure presentation adapter. None of these values control the trainer or the simulation.
export const AUDIO_VERSION = 1;
export const STALE_SECONDS = .9;
export const AUDIO_DEFAULTS = Object.freeze({ volume: .35, muted: false });
const finite = (v, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, finite(v, lo)));
export function audioPreferences(value = {}, previous = AUDIO_DEFAULTS) {
  return { volume: typeof value.volume === 'number' && Number.isFinite(value.volume) ? clamp(value.volume, 0, 1) : previous.volume,
    muted: typeof value.muted === 'boolean' ? value.muted : previous.muted };
}
export function audioSurface(value) {
  if (value === 'asphalt' || value === 'leaves' || value === 'gravel') return value;
  return 'earth'; // Existing appearance files call packed earth "dirt" or "soil".
}
export function audioTargets(state = {}) {
  const running = (state.mode === 'ride' || state.mode === 'demo') && state.busy !== true;
  // Fast preview changes travel time, not the imaginary wheel's timbre. Practice uses real simulated speed.
  const previewMultiplier = state.demo && !state.practice ? clamp(finite(state.demoSpeed, 1), 1, 8) : 1;
  const speed = running ? clamp(finite(state.speed) / previewMultiplier, 0, 80) : 0;
  const moving = clamp((speed - .3) / 4, 0, 1), intensity = clamp(speed / 35, 0, 1.8);
  const synthetic = state.demo === true || state.mode === 'demo';
  const coasting = typeof state.audio?.coasting === 'boolean' ? state.audio.coasting : synthetic
    ? finite(state.grade) <= -1.3 || state.brake === true
    : ((Number.isFinite(state.watts) && state.watts <= 5) || (Number.isFinite(state.cadence) && state.cadence <= 2));
  const brake = clamp(state.audio?.brake ?? state.brakePressure ?? (state.brake ? 1 : 0), 0, 1);
  // Slip is the game's corner-grip model, not a wheel-lock measurement; use a restrained scrub texture.
  const slip = state.demo && !state.practice ? 0 : clamp(finite(state.slip) - .12, 0, 1);
  return { running, speed, surface: audioSurface(state.surface), coasting,
    tire: moving * (.19 + .27 * Math.sqrt(intensity)), wind: moving * .16 * intensity ** 1.45,
    freehub: moving * (coasting ? .25 : 0), brake: moving * brake * .105,
    skid: moving * slip * .14, rate: clamp(.6 + speed / 42, .6, 2), hubRate: clamp(speed / 23, .3, 2.8) };
}

export class RideAudioState {
  constructor() { this.reset(); }
  reset() { this.previous = null; this.retiredEpochs = new Set(); }
  update(state = {}, at = 0) {
    const targets = audioTargets(state), epoch = String(state.presentationEpoch ?? ''), previous = this.previous;
    const sequence = Number.isSafeInteger(state.stateSequence) ? state.stateSequence : null;
    if (this.retiredEpochs.has(epoch) || (previous && epoch === previous.epoch && sequence !== null && previous.sequence !== null && sequence <= previous.sequence)) return null;
    const changedEpoch = previous && epoch !== previous.epoch;
    if (changedEpoch && previous.epoch) {
      this.retiredEpochs.add(previous.epoch);
      if (this.retiredEpochs.size > 16) this.retiredEpochs.delete(this.retiredEpochs.values().next().value);
    }
    const gear = Number.isInteger(state.gear) && state.gear >= 1 && state.gear <= clamp(finite(state.gearCount, 32), 1, 32) ? state.gear : null;
    const distance = finite(state.distance), time = finite(at);
    const continuous = previous && !changedEpoch && time >= previous.time && time - previous.time < STALE_SECONDS &&
      Math.abs(distance - previous.distance) < Math.max(25, targets.speed / 3.6 * (time - previous.time) * 9 + 8);
    const gearClick = !!(continuous && previous.running && targets.running && gear !== null && previous.gear !== null && previous.gear !== gear);
    this.previous = { epoch, sequence, gear, distance, time, running: targets.running };
    return { ...targets, gearClick, discontinuity: !continuous };
  }
}
