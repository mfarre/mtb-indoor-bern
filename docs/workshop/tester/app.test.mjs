import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { storageKey } from './core.mjs';

// Exercises the real DOM event handlers with an in-memory Bluetooth peripheral.
// No browser, radio, native dialog, network or personal calibration is accessed.
class Element {
  constructor(id) { this.id = id; this.value = ''; this.textContent = ''; this.disabled = false; this.hidden = false; this.dataset = {}; this.style = {}; this.attributes = new Map(); this.listeners = new Map(); this.firstElementChild = { style: {} }; }
  get value() { return this._value; }
  set value(value) { this._value = String(value); }
  get textContent() { return this._text; }
  set textContent(value) { this._text = String(value); }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  setCustomValidity(value) { this.validationMessage = value; }
  reportValidity() { return !this.validationMessage; }
  async emit(name, extra = {}) {
    const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (const fn of this.listeners.get(name) ?? []) await fn(event);
    return event;
  }
  async click() { if (!this.disabled) await this.emit('click'); }
}

const DEVICE_ID = 'test-only-brake-bench';
const initialCalibration = { version: 1, deviceId: DEVICE_ID, channels: [
  { released: 674, pulled: 950, span: 276, provisional: false },
  { released: 347, pulled: 50, span: -297, provisional: true },
] };
let importSequence = 0;

async function fixture(options = {}) {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element(match[1])]));
  const get = id => { const el = elements.get(id); assert.ok(el, `index.html contains #${id}`); return el; };
  const savedGlobals = new Map();
  const install = (name, value) => { savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); };
  let now = 1000, nextTimer = 1, sequence = 0;
  const timers = new Map();
  const setTimer = (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms, next: now + ms }); return id; };
  const data = new Map(options.saved ? [[storageKey(DEVICE_ID), JSON.stringify(options.saved)]] : []);
  const storage = { reads: 0, writes: 0, failWrites: false, failReads: false,
    getItem(key) { this.reads++; if (this.failReads) throw new Error('Storage denied'); return data.get(key) ?? null; },
    setItem(key, value) { this.writes++; if (this.failWrites) throw new Error('Storage full'); data.set(key, value); },
    removeItem(key) { this.writes++; if (this.failWrites) throw new Error('Storage denied'); data.delete(key); },
  };
  const readings = { left: 674, right: 347, leftStatus: 32, rightStatus: 32, leftAgc: 64, rightAgc: 64, flags: 7, ...options.readings };
  const frame = () => {
    const bytes = new ArrayBuffer(20), v = new DataView(bytes);
    v.setUint8(0, 1); v.setUint8(1, readings.flags); v.setUint16(2, sequence++, true); v.setUint32(4, now, true);
    v.setUint16(8, readings.left, true); v.setUint16(10, readings.right, true);
    v.setUint8(12, readings.leftStatus); v.setUint8(13, readings.rightStatus); v.setUint8(14, readings.leftAgc); v.setUint8(15, readings.rightAgc);
    return v;
  };
  const characteristic = new Element('fake-characteristic');
  Object.defineProperty(characteristic, 'value', { writable: true, value: null });
  characteristic.startNotifications = async () => characteristic;
  characteristic.readValue = async () => frame();
  const device = new Element('fake-device'); device.id = DEVICE_ID; device.name = 'Test-only bench';
  const server = { getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) };
  device.gatt = { connected: false, connections: 0, connect: async () => { device.gatt.connections++; device.gatt.connected = true; return server; }, disconnect: () => { device.gatt.connected = false; } };
  let resolvePicker;
  const delayedPicker = options.delayPicker ? new Promise(resolve => { resolvePicker = () => resolve(device); }) : null;
  const window = new Element('window'); Object.assign(window, { isSecureContext: true, setInterval: setTimer, clearInterval: id => timers.delete(id) });
  install('window', window); install('document', { getElementById: id => elements.get(id) ?? null });
  install('navigator', { bluetooth: { requestDevice: async () => delayedPicker ?? device } });
  install('localStorage', storage); install('performance', { now: () => now }); install('location', { search: '' });
  install('setInterval', setTimer); install('clearInterval', id => timers.delete(id));
  const restore = () => { for (const [key, descriptor] of savedGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } };
  try {
    let source = await readFile(new URL('./app.mjs', import.meta.url), 'utf8');
    source = source.replace(/from '\.\/core\.mjs[^']*'/, `from '${new URL('./core.mjs', import.meta.url).href}'`);
    await import('data:text/javascript;base64,' + Buffer.from(source + `\n// test import ${++importSequence}`).toString('base64'));
  } catch (error) { restore(); throw error; }
  const advance = async ms => {
    const end = now + ms;
    while (true) {
      const next = [...timers.values()].reduce((min, timer) => Math.min(min, timer.next), Infinity);
      if (next > end) break;
      now = next;
      for (const [id, timer] of [...timers]) if (timer.next <= now && timers.has(id)) { timer.next += timer.ms; await timer.fn(); }
    }
    now = end;
  };
  const notify = async (values = {}, elapsed = 50) => { await advance(elapsed); Object.assign(readings, values); characteristic.value = frame(); await characteristic.emit('characteristicvaluechanged'); };
  const hold = async values => { for (let i = 0; i < 15; i++) await notify(values); };
  const manual = async (channel, released, pulled) => {
    get(`released-input-${channel}`).value = String(released); get(`pulled-input-${channel}`).value = String(pulled);
    await get(`endpoints-${channel}`).emit('submit');
  };
  return { get, storage, data, device, resolvePicker, advance, notify, hold, manual, restore,
    connect: () => get('connect').click(), disconnect: () => get('disconnect').click(),
    saved: () => { const value = data.get(storageKey(DEVICE_ID)); return value ? JSON.parse(value) : null; },
  };
}

function appTest(name, body) {
  test(name, async () => { const f = await fixture(body.options); try { await body(f); } finally { f.restore(); } });
}

appTest('manual endpoints autosave per device while typing remains an unsaved draft', async f => {
  await f.connect(); await f.manual(0, 674, 950); await f.manual(1, 347, 50);
  assert.equal(f.saved().deviceId, DEVICE_ID); assert.equal(f.saved().version, 1);
  assert.equal(f.saved().channels[0].released, 674); assert.equal(f.saved().channels[1].span, -297);
  assert.match(f.get('storage-0').textContent, /saved/i); assert.match(f.get('storage-1').textContent, /saved/i);
  await f.notify({ left: 812, right: 199 });
  assert.equal(String(f.get('percent-0').textContent), '50'); assert.equal(String(f.get('percent-1').textContent), '50');
  f.get('released-input-0').value = '700'; f.get('pulled-input-0').value = '1000';
  await f.get('released-input-0').emit('input'); await f.get('pulled-input-0').emit('input');
  await f.notify({ left: 812 }); await f.advance(150);
  assert.equal(f.get('released-input-0').value, '700'); assert.equal(f.get('pulled-input-0').value, '1000');
  assert.equal(f.saved().channels[0].released, 674); assert.equal(String(f.get('percent-0').textContent), '50');
  const writes = f.storage.writes;
  for (const [released, pulled] of [['', 950], ['674.5', 950], [-1, 950], [674, 4096], [674, 680]]) await f.manual(0, released, pulled);
  assert.equal(f.storage.writes, writes, 'invalid drafts do not overwrite a working saved profile');
  assert.equal(f.saved().channels[0].released, 674);
});

appTest('weak-field manual calibration remains visible and provisional after the field recovers', async f => {
  await f.connect(); await f.notify({ leftStatus: 48, leftAgc: 128 }); await f.manual(0, 674, 950);
  assert.equal(f.saved().channels[0].provisional, true);
  await f.notify({ left: 812 }); assert.equal(String(f.get('percent-0').textContent), '50');
  assert.match(f.get('health-0').textContent, /weak/i); assert.match(f.get('calibration-0').textContent, /provisional/i);
  await f.notify({ leftStatus: 32, leftAgc: 64 });
  assert.match(f.get('health-0').textContent, /healthy/i); assert.match(f.get('calibration-0').textContent, /provisional/i);
  await f.notify({ left: 2000, leftStatus: 48, leftAgc: 128 });
  assert.equal(f.get('percent-0').textContent, '—'); assert.match(f.get('health-0').textContent, /weak/i, 'out-of-range travel does not mask the field warning');
});

appTest('capture autosaves, remembers a weak release, and only invalidates the edited channel', async f => {
  await f.connect(); await f.manual(0, 674, 950); await f.manual(1, 347, 50);
  await f.hold({ left: 674, leftStatus: 48, leftAgc: 128 });
  assert.equal(f.get('release-0').disabled, false); await f.get('release-0').click();
  assert.equal(f.saved().channels[0], null, 'starting a new release removes the previous saved calibration');
  assert.equal(f.saved().channels[1].released, 347);
  await f.hold({ left: 950, leftStatus: 32, leftAgc: 64 }); await f.get('pull-0').click();
  assert.equal(f.saved().channels[0].released, 674); assert.equal(f.saved().channels[0].pulled, 950);
  assert.equal(f.saved().channels[0].provisional, true, 'a healthy full pull does not erase the weak release warning');
  assert.equal(String(f.get('percent-0').textContent), '100');
  await f.get('clear-1').click(); assert.equal(f.saved().channels[1], null); assert.equal(f.saved().channels[0].pulled, 950);
  assert.equal(f.get('released-input-1').value, ''); assert.equal(f.get('pulled-input-1').value, '');
});

appTest('stale or missing-magnet readings block capture while explicit manual endpoints stay provisional', async f => {
  await f.connect(); await f.manual(0, 674, 950); await f.hold({ left: 674 });
  await f.advance(850); assert.equal(f.get('release-0').disabled, true); assert.equal(f.get('percent-0').textContent, '—');
  const writes = f.storage.writes; await f.get('release-0').click(); assert.equal(f.storage.writes, writes);
  await f.manual(0, 674, 950); assert.equal(f.saved().channels[0].provisional, true);
  await f.hold({ leftStatus: 0 }); assert.equal(f.get('release-0').disabled, true); assert.match(f.get('health-0').textContent, /not detected/i);
  assert.equal(f.get('percent-0').textContent, '—');
  await f.disconnect(); const stored = f.storage.writes; await f.manual(0, 700, 1000);
  assert.equal(f.storage.writes, stored, 'disconnected forms cannot overwrite the saved device profile');
});

const reloadAndDemo = async f => {
  await f.get('demo').click(); await f.manual(0, 4050, 204); await f.advance(600);
  assert.equal(f.storage.reads, 0); assert.equal(f.storage.writes, 0, 'demo does not load or save real profiles');
  assert.match(f.get('storage-0').textContent, /demo|memory/i);
  await f.disconnect(); await f.connect();
  assert.equal(f.get('released-input-0').value, '674'); assert.equal(f.get('pulled-input-1').value, '50');
  assert.match(f.get('calibration-1').textContent, /provisional/i);
  assert.equal(f.saved().channels[1].provisional, true);
  await f.disconnect(); assert.equal(f.get('percent-0').textContent, '—');
  assert.equal(f.saved().channels[0].released, 674, 'disconnect clears session output without deleting the saved calibration');
};
reloadAndDemo.options = { saved: initialCalibration };
appTest('demo is isolated from real calibration and reconnect restores saved endpoints and warnings', reloadAndDemo);

appTest('storage failure is explicit and never claims new endpoints were saved', async f => {
  await f.connect(); await f.manual(0, 674, 950); const before = f.data.get(storageKey(DEVICE_ID));
  f.storage.failWrites = true; await f.manual(0, 700, 1000);
  assert.equal(f.data.get(storageKey(DEVICE_ID)), before, 'previous durable profile survives a failed replacement');
  assert.match(f.get('storage-0').textContent, /could not|not saved|unavailable|failed/i);
  await f.notify({ left: 850 }); assert.equal(String(f.get('percent-0').textContent), '50', 'in-memory calibration remains usable');
  await f.get('clear-0').click();
  assert.match(f.get('storage-0').textContent, /could not|not saved|unavailable|failed/i);
  assert.equal(f.data.get(storageKey(DEVICE_ID)), before, 'failure to clear stored data is reported rather than pretending it was removed');
});

const cancelledPicker = async f => {
  const pendingConnect = f.connect(); await Promise.resolve();
  assert.equal(f.get('disconnect').textContent, 'Cancel');
  await f.disconnect(); await f.get('demo').click();
  f.resolvePicker(); await pendingConnect;
  assert.equal(f.device.gatt.connections, 0, 'a late picker result cannot connect after cancellation');
  assert.equal(f.storage.reads, 0); assert.equal(f.storage.writes, 0);
  assert.equal(f.get('demo-panel').hidden, false); assert.match(f.get('device-name').textContent, /No hardware/i);
};
cancelledPicker.options = { saved: initialCalibration, delayPicker: true };
appTest('cancelled Bluetooth selection cannot replace a newly started demo', cancelledPicker);
