export const SERVICE_UUID = '7d9f0001-6f5b-4ad7-9f2a-6a52b5b3a001';
export const TELEMETRY_UUID = '7d9f0002-6f5b-4ad7-9f2a-6a52b5b3a001';
export const PROTOCOL_VERSION = 1;
export const STALE_MS = 750;
export const COUNTS = 4096;

export function decodeFrame(input) {
  const v = input instanceof DataView ? input : new DataView(input.buffer ?? input, input.byteOffset ?? 0, input.byteLength);
  if (v.byteLength !== 20) throw new Error(`Expected 20 bytes, received ${v.byteLength}.`);
  if (v.getUint8(0) !== PROTOCOL_VERSION) throw new Error(`Unsupported protocol version ${v.getUint8(0)}.`);
  if (v.getUint8(1) & 0xf8 || v.getUint32(16, true) !== 0) throw new Error('Unsupported frame flags or reserved data.');
  return {
    version: v.getUint8(0), flags: v.getUint8(1), sequence: v.getUint16(2, true), uptime: v.getUint32(4, true),
    channels: [0, 1].map(i => ({ raw: v.getUint16(8 + 2 * i, true), status: v.getUint8(12 + i), agc: v.getUint8(14 + i) })),
  };
}

export function channelState(frame, channel) {
  const fault = text => ({ healthy: false, usable: false, text, kind: 'fault' });
  if (!frame) return { healthy: false, usable: false, text: 'Waiting for a sample', kind: 'idle' };
  const value = frame.channels?.[channel];
  if (![0, 1].includes(channel) || !value || !Number.isInteger(frame.flags) || frame.flags < 0 || frame.flags > 7)
    return fault('Invalid telemetry');
  if (!(frame.flags & 1)) return fault('Multiplexer not responding');
  if (!(frame.flags & (2 << channel)) || !validRaw(value.raw) || value.status === 255 ||
      !Number.isInteger(value.agc) || value.agc < 0 || value.agc > 128)
    return fault('Encoder read failed');
  if (!Number.isInteger(value.status) || value.status < 0 || value.status > 255 || (value.status & ~0x38) || (value.status & 0x18) === 0x18)
    return fault('Invalid magnetic status');
  if (!(value.status & 0x20)) return fault('Magnet not detected');
  // A detected magnet with ML or MH still supplies an angle for provisional
  // bench calibration. Keep the warning distinct from a healthy magnetic setup.
  if (value.status & 0x10) return { healthy: false, usable: true, text: 'Magnetic field too weak · provisional', kind: 'warn' };
  if (value.status & 0x08) return { healthy: false, usable: true, text: 'Magnetic field too strong · provisional', kind: 'warn' };
  return { healthy: true, usable: true, text: 'Magnetic field healthy', kind: 'good' };
}

export const wrapDelta = (value, origin) => ((value - origin + 6144) % COUNTS) - 2048;
export const validRaw = v => Number.isInteger(v) && v >= 0 && v < COUNTS;

export function buildCalibration(released, pulled) {
  if (!validRaw(released) || !validRaw(pulled)) throw new Error('Both endpoints must be valid encoder readings.');
  const span = wrapDelta(pulled, released);
  if (Math.abs(span) < 16) throw new Error('Travel is too small. Capture release, then a distinct comfortable full pull.');
  if (Math.abs(span) > 1024) throw new Error('Travel exceeds 90°. Check the magnet and endpoints.');
  return { released, pulled, span };
}

export function normalize(raw, calibration) {
  if (!calibration || !validRaw(raw)) return null;
  let checked;
  try { checked = buildCalibration(calibration.released, calibration.pulled); } catch { return null; }
  const displacement = wrapDelta(raw, checked.released);
  const fraction = displacement / checked.span;
  const tolerance = Math.max(16 / Math.abs(checked.span), 0.2);
  if (fraction < -tolerance || fraction > 1 + tolerance) return null;
  return Math.min(1, Math.max(0, fraction));
}

export function stableCapture(samples, now) {
  if (!Array.isArray(samples) || !Number.isFinite(now) || samples.some((s, i) =>
    !s || !Number.isFinite(s.time) || s.time < 0 || s.time > now || (i > 0 && s.time <= samples[i - 1].time)))
    throw new Error('Invalid sample timing. Wait for fresh telemetry and try again.');
  const recent = samples.filter(s => now - s.time <= 650);
  if (recent.length < 10 || now - recent.at(-1).time > 150 || recent.at(-1).time - recent[0].time < 450)
    throw new Error('Hold this lever still with usable readings for at least half a second.');
  // Legacy healthy-only callers remain supported. Explicit usable:false always
  // wins; a missing or truthy non-boolean flag cannot bypass the sensor checks.
  if (recent.some(s => !(s.usable === true || (s.usable === undefined && s.healthy === true)) || !validRaw(s.raw)))
    throw new Error('Valid sensor readings with a detected magnet are required before calibration.');
  const origin = recent[0].raw;
  const deltas = recent.map(s => wrapDelta(s.raw, origin));
  if (Math.max(...deltas) - Math.min(...deltas) > 12) throw new Error('The lever is still moving. Hold it steady and try again.');
  return ((Math.round(origin + deltas.reduce((a, b) => a + b, 0) / deltas.length) % COUNTS) + COUNTS) % COUNTS;
}

export function storageKey(deviceId) { return `mtb-brake-bench:calibration:v${PROTOCOL_VERSION}:${deviceId}`; }
export function parseCalibration(text, deviceId) {
  const value = JSON.parse(text);
  if (value.version !== PROTOCOL_VERSION || value.deviceId !== deviceId || !Array.isArray(value.channels) || value.channels.length !== 2)
    throw new Error('Saved calibration is for a different device or protocol.');
  return value.channels.map(c => {
    if (c === null) return null;
    const calibration = buildCalibration(c.released, c.pulled);
    if (c.provisional === undefined) return calibration;
    if (typeof c.provisional !== 'boolean') throw new Error('Saved calibration has an invalid provisional flag.');
    return { ...calibration, provisional: c.provisional };
  });
}

export class FrameClock {
  constructor() { this.reset(); }
  reset() { this.last = null; this.received = null; this.dropped = 0; }
  accept(frame, now) {
    let restarted = false;
    if (this.last) {
      const advance = (frame.sequence - this.last.sequence + 65536) % 65536;
      const timeAdvance = (frame.uptime - this.last.uptime + 4294967296) % 4294967296;
      // Notifications are ordered, but an initial GATT read can race a newer
      // notification. A small backwards step is not a reboot. A physical
      // reboot normally disconnects and resets this clock; accept an inferred
      // new epoch only when both device counters have clearly restarted.
      restarted = timeAdvance > 2147483648 && frame.uptime < 1000 && frame.sequence < 40 && this.last.uptime > 2000;
      if (!restarted && advance === 0 && timeAdvance === 0) return { accepted: false, reason: 'duplicate' };
      if (!restarted && timeAdvance > 2147483648) return { accepted: false, reason: 'out-of-order' };
      if (!restarted) {
        // The 16-bit sequence alone becomes ambiguous after ~27 minutes of
        // missed notifications. Forward 32-bit uptime resolves that case,
        // including an entire sequence wrap back to the same value. Reject
        // contradictory counters: acquisition is ~50 ms, never >1 sample/ms.
        const minimumAdvance = advance || 65536;
        if (timeAdvance < minimumAdvance) return { accepted: false, reason: 'out-of-order' };
        // Multiple complete sequence wraps cannot be counted exactly from
        // this protocol, so the UI reports a lower bound on skipped samples.
        this.dropped += minimumAdvance - 1;
      }
    }
    this.last = frame; this.received = now;
    return { accepted: true, restarted };
  }
  fresh(now) { return this.received !== null && now - this.received < STALE_MS; }
}

export function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\r\n]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str;
}
