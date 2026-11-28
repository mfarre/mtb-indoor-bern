// Visual feedback only. The host owns pressure, traction, crashes and recovery.
const number = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, number(value)));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const running = state => (state.mode === 'ride' || state.mode === 'demo') && !state.busy;
const neutral = () => ({ active: false, drop: 0, pitch: 0, roll: 0, sideOffset: 0, progress: 0 });
export const BRAKE_VISUAL_STALE_MS = 500;

export function frontLockPose(recovery, stableCamera = true, skidSide = 1) {
  if (!(recovery > 0) || !Number.isFinite(recovery) || recovery > 3) return neutral();
  const elapsed = 3 - recovery;
  const amount = smooth(elapsed / .35) * (1 - smooth((elapsed - 1.6) / 1.4));
  const side = skidSide < 0 ? -1 : 1;
  return { active: true, drop: amount * 1.25,
    pitch: -amount * (stableCamera ? .48 : .72), roll: amount * side * (stableCamera ? .58 : 1.0),
    sideOffset: amount * side * (stableCamera ? .16 : .24), progress: clamp(elapsed / 3) };
}

export class BrakePresentation {
  constructor() { this.reset(); }
  reset() { this.previous = null; this.retiredEpochs = new Set(); this.activeCrash = null; }
  update(snapshot = {}, atMs = 0) {
    if (!Number.isFinite(atMs)) return false;
    const epoch = String(snapshot.presentationEpoch ?? ''), sequence = Number.isSafeInteger(snapshot.stateSequence) ? snapshot.stateSequence : null;
    const previous = this.previous, sameEpoch = previous && epoch !== '' && epoch === previous.epoch;
    if (this.retiredEpochs.has(epoch) || (sameEpoch && sequence !== null && previous.sequence !== null && sequence <= previous.sequence)) return false;
    if (previous && previous.epoch && epoch !== previous.epoch) {
      this.retiredEpochs.add(previous.epoch);
      if (this.retiredEpochs.size > 16) this.retiredEpochs.delete(this.retiredEpochs.values().next().value);
    }
    const counter = Number.isSafeInteger(snapshot.crashSequence) && snapshot.crashSequence >= 0 ? snapshot.crashSequence : null;
    const continuous = sameEpoch && sequence !== null && previous.sequence !== null && atMs >= previous.atMs &&
      atMs - previous.atMs <= BRAKE_VISUAL_STALE_MS && running(previous.snapshot) && running(snapshot) && previous.snapshot.mode === snapshot.mode;
    if (!continuous || counter === null || (sameEpoch && previous.counter !== null && counter < previous.counter) || snapshot.crashKind !== 'front-lock' || !(snapshot.recovery > 0)) this.activeCrash = null;
    if (continuous && previous.counterValid && counter !== null && previous.counter !== null && counter > previous.counter && snapshot.crashKind === 'front-lock' && snapshot.recovery > 0)
      this.activeCrash = counter;
    const watermark = sameEpoch && previous.counter !== null ? Math.max(counter ?? 0, previous.counter) : counter;
    this.previous = { epoch, sequence, counter: watermark, counterValid: counter !== null, atMs, snapshot: { ...snapshot } };
    return true;
  }
  sample(atMs) {
    const p = this.previous;
    if (!p || this.activeCrash === null || !Number.isFinite(atMs) || atMs < p.atMs || atMs - p.atMs > BRAKE_VISUAL_STALE_MS || !running(p.snapshot)) return neutral();
    // A small interpolation between host recovery packets smooths the camera;
    // it cannot extend the penalty or keep animating a missing host stream.
    const remaining = number(p.snapshot.recovery) - Math.min(.15, (atMs - p.atMs) / 1000);
    return frontLockPose(remaining, p.snapshot.presentation?.stableCamera !== false, p.snapshot.skidSide);
  }
}

export function brakeHud(state = {}, hostFresh = true) {
  const live = running(state) && hostFresh;
  const device = state.devices?.find(value => value.role === 'Brakes');
  const front = live ? clamp(state.frontBrake) : 0, rear = live ? clamp(state.rearBrake) : 0;
  const frontSlip = live ? clamp(state.frontSlip) : 0, rearSlip = live ? clamp(state.rearSlip) : 0;
  const recovery = live ? clamp(state.recovery, 0, 3) : 0;
  let notice = device?.detail || device?.status || (state.demo ? 'Demo · simulated braking' : 'A / Space: balanced brake');
  let kind = device?.inputConfirmed === false || ['warning', 'arming', 'uncalibrated', 'stale', 'waiting', 'searching', 'fault', 'disconnected'].includes(device?.state) ? 'warn' : '';
  if (!hostFresh) { notice = 'Ride signal stale · brake display unavailable'; kind = 'warn'; }
  else if (recovery > 0 && state.crashKind === 'front-lock') { notice = `FRONT WHEEL LOCK · recovering ${recovery.toFixed(1)} s`; kind = 'danger'; }
  else if (frontSlip > .25) { notice = 'Front losing grip · ease the front brake'; kind = 'danger'; }
  else if (rearSlip > .2) { notice = 'Rear skidding · ease pressure'; kind = 'warn'; }
  return { front, rear, frontSlip, rearSlip, recovery, notice, kind, available: live, device };
}
