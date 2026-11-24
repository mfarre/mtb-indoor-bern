import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFrame, channelState, wrapDelta, buildCalibration, normalize, stableCapture, parseCalibration, FrameClock, STALE_MS, csvEscape } from './core.mjs';

function frame({ sequence = 0, uptime = 100, flags = 7, left = 4050, right = 1200, status = 32, agc = 64 } = {}) {
  const bytes = new Uint8Array(20); const v = new DataView(bytes.buffer);
  v.setUint8(0, 1); v.setUint8(1, flags); v.setUint16(2, sequence, true); v.setUint32(4, uptime, true);
  v.setUint16(8, left, true); v.setUint16(10, right, true); v.setUint8(12, status); v.setUint8(13, 32); v.setUint8(14, agc); v.setUint8(15, 64);
  return bytes;
}
test('frame is decoded little-endian, including offset DataViews', () => {
  const buffer = new Uint8Array(24); buffer.set(frame({ sequence: 500, uptime: 123456 }), 3);
  const value = decodeFrame(new DataView(buffer.buffer, 3, 20));
  assert.equal(value.sequence, 500); assert.equal(value.uptime, 123456); assert.equal(value.channels[0].raw, 4050);
  assert.equal(channelState(value, 0).healthy, true);
});
test('malformed and incompatible frames are rejected', () => {
  assert.throws(() => decodeFrame(new Uint8Array(19)), /20 bytes/);
  let bytes = frame(); bytes[0] = 2; assert.throws(() => decodeFrame(bytes), /version/);
  bytes = frame(); bytes[16] = 1; assert.throws(() => decodeFrame(bytes), /reserved/);
  bytes = frame(); bytes[1] |= 128; assert.throws(() => decodeFrame(bytes), /flags/);
});
test('I2C, missing magnet, weak/strong fields and invalid raw values never report healthy', () => {
  for (const settings of [{ flags: 0 }, { flags: 1 }, { status: 0 }, { status: 48 }, { status: 40 }, { status: 56 }, { left: 65535 }, { agc: 255 }]) assert.equal(channelState(decodeFrame(frame(settings)), 0).healthy, false);
  assert.equal(channelState(decodeFrame(frame({ flags: 3 })), 0).healthy, true);
  assert.equal(channelState(decodeFrame(frame({ flags: 3 })), 1).healthy, false);
});
test('calibration crosses zero and supports the reversed lever', () => {
  const left = buildCalibration(4050, 204), right = buildCalibration(1200, 950);
  assert.equal(left.span, 250); assert.equal(right.span, -250);
  assert.equal(normalize(79, left), .5); assert.equal(normalize(1075, right), .5);
  assert.equal(normalize(4050, left), 0); assert.equal(normalize(204, left), 1);
  assert.equal(wrapDelta(2, 4094), 4); assert.equal(wrapDelta(4094, 2), -4);
});
test('bad endpoints and distant angle jumps cannot become full brake', () => {
  assert.throws(() => buildCalibration(50, 55), /too small/); assert.throws(() => buildCalibration(0, 1500), /90/);
  assert.throws(() => buildCalibration(null, 1200), /valid/);
  const c = buildCalibration(1000, 1250);
  assert.equal(normalize(3000, c), null); assert.equal(normalize(65535, c), null);
  assert.equal(normalize(990, c), 0); assert.equal(normalize(1260, c), 1);
});
test('stable endpoint capture averages through wrap and rejects moving/fault/stale samples', () => {
  const samples = Array.from({ length: 12 }, (_, i) => ({ time: i * 50, raw: i % 2 ? 0 : 4095, healthy: true }));
  assert.equal(stableCapture(samples, 560), 0);
  assert.throws(() => stableCapture(samples, 1000), /half a second/);
  assert.throws(() => stableCapture(samples.map((s, i) => ({ ...s, raw: 1000 + i * 3 })), 560), /moving/);
  assert.throws(() => stableCapture(samples.map((s, i) => ({ ...s, healthy: i !== 10 })), 560), /Healthy/);
});
test('saved endpoints are strictly bound to device and protocol', () => {
  const text = JSON.stringify({ version: 1, deviceId: 'a', channels: [{ released: 4050, pulled: 204 }, null] });
  assert.equal(parseCalibration(text, 'a')[0].span, 250);
  assert.throws(() => parseCalibration(text, 'b'), /different device/);
  assert.throws(() => parseCalibration(text.replace('"version":1', '"version":2'), 'a'), /protocol/);
});
test('duplicate packets do not refresh a frozen stream; sequence and uptime wrap work', () => {
  const clock = new FrameClock(); const a = decodeFrame(frame({ sequence: 65535, uptime: 4294967250 }));
  assert.equal(clock.accept(a, 0).accepted, true); assert.equal(clock.accept(a, 600).accepted, false);
  assert.equal(clock.fresh(STALE_MS), false);
  assert.equal(clock.accept(decodeFrame(frame({ sequence: 0, uptime: 4 })), 800).accepted, true);
  assert.equal(clock.fresh(801), true); assert.equal(clock.dropped, 0);
  assert.equal(clock.accept(decodeFrame(frame({ sequence: 3, uptime: 154 })), 950).accepted, true); assert.equal(clock.dropped, 2);
});
test('out-of-order frames are ignored; controller reboot is recognized', () => {
  const clock = new FrameClock(); clock.accept(decodeFrame(frame({ sequence: 100, uptime: 10000 })), 100);
  assert.equal(clock.accept(decodeFrame(frame({ sequence: 99, uptime: 10050 })), 150).accepted, false);
  assert.equal(clock.accept(decodeFrame(frame({ sequence: 99, uptime: 9950 })), 160).accepted, false);
  assert.equal(clock.received, 100);
  assert.deepEqual(clock.accept(decodeFrame(frame({ sequence: 0, uptime: 20 })), 200), { accepted: true, restarted: true });
});
test('telemetry recovers after a background gap longer than half the sequence range', () => {
  const clock = new FrameClock();
  const first = decodeFrame(frame({ sequence: 100, uptime: 10000 }));
  clock.accept(first, 0);
  assert.equal(clock.fresh(1800000), false);
  const resumed = decodeFrame(frame({ sequence: 36100, uptime: 1810000 }));
  assert.deepEqual(clock.accept(resumed, 1800000), { accepted: true, restarted: false });
  assert.equal(clock.fresh(1800001), true); assert.equal(clock.dropped, 35999);
  assert.equal(clock.accept(first, 1800010).accepted, false);
  assert.equal(clock.accept(resumed, 1800700).accepted, false);
  assert.equal(clock.fresh(1800000 + STALE_MS), false);
  assert.equal(clock.accept(decodeFrame(frame({ sequence: 36101, uptime: 1810050 })), 1800800).accepted, true);
});
test('a complete sequence wrap and multiple wraps recover using forward uptime', () => {
  const clock = new FrameClock();
  clock.accept(decodeFrame(frame({ sequence: 500, uptime: 20000 })), 0);
  const once = decodeFrame(frame({ sequence: 500, uptime: 20000 + 65536 * 50 }));
  assert.equal(clock.accept(once, 65536 * 50).accepted, true);
  assert.equal(clock.dropped, 65535);
  const twiceMore = decodeFrame(frame({ sequence: 501, uptime: once.uptime + (131072 + 1) * 50 }));
  assert.equal(clock.accept(twiceMore, (65536 + 131072 + 1) * 50).accepted, true);
  assert.equal(clock.dropped, 65535, 'Skipped count is a lower bound when extra complete wraps are unknowable.');
});
test('same sequence with a short timestamp advance cannot keep a stalled stream alive', () => {
  const clock = new FrameClock();
  clock.accept(decodeFrame(frame({ sequence: 30, uptime: 1500 })), 0);
  assert.equal(clock.accept(decodeFrame(frame({ sequence: 30, uptime: 1550 })), 50).accepted, false);
  assert.equal(clock.accept(decodeFrame(frame({ sequence: 31, uptime: 1500 })), 100).accepted, false);
  assert.equal(clock.received, 0); assert.equal(clock.fresh(STALE_MS), false);
});
test('CSV quoting preserves exported names and multiline values', () => {
  assert.equal(csvEscape('Bench, "A"'), '"Bench, ""A"""'); assert.equal(csvEscape(null), ''); assert.equal(csvEscape('a\nb'), '"a\nb"');
});
