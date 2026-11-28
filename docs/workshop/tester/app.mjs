import { SERVICE_UUID, TELEMETRY_UUID, PROTOCOL_VERSION, decodeFrame, channelState, buildCalibration, normalize, stableCapture, storageKey, parseCalibration, FrameClock } from './core.mjs?v=20261128-bench2';

const $ = id => document.getElementById(id);
const clock = new FrameClock();
const model = {
  mode: 'idle', device: null, characteristic: null, generation: 0, frame: null, fault: '',
  calibrations: [null, null], releases: [null, null], releaseProvisional: [false, false], windows: [[], []],
  dirty: [false, false], storage: ['', ''], storageKind: ['', ''],
  demoStartedAt: 0, demoTimer: null, demoSequence: 0,
};
let lastConnectionText = '';
const canBluetooth = Boolean(window.isSecureContext && navigator.bluetooth);
const active = () => ['live', 'demo'].includes(model.mode);
const sideName = channel => channel ? 'Right' : 'Left';

function message(text, kind = '') { $('message').textContent = text; $('message').dataset.kind = kind; }
function storageMessage(channel, text, kind = '') { model.storage[channel] = text; model.storageKind[channel] = kind; }
function fillInputs(channel, released = '', pulled = '') {
  $(`released-input-${channel}`).value = released;
  $(`pulled-input-${channel}`).value = pulled;
  model.dirty[channel] = false;
}
function clearReadings() {
  clock.reset(); model.frame = null; model.fault = ''; model.windows = [[], []];
}
function resetState(mode) {
  model.mode = mode; clearReadings();
  model.calibrations = [null, null]; model.releases = [null, null]; model.releaseProvisional = [false, false];
  for (const i of [0, 1]) {
    fillInputs(i);
    storageMessage(i, mode === 'demo' ? 'Demo only. Endpoints stay in memory and are never saved for a Bluetooth device.' : 'Connect a device to load or save its endpoints.');
  }
}
function cleanupTransport() {
  if (model.demoTimer !== null) window.clearInterval(model.demoTimer);
  model.demoTimer = null;
  if (model.characteristic) model.characteristic.removeEventListener('characteristicvaluechanged', onNotification);
  model.characteristic = null;
  if (model.device) {
    model.device.removeEventListener('gattserverdisconnected', onDisconnected);
    if (model.device.gatt?.connected) model.device.gatt.disconnect();
  }
}
function disconnect(reason = 'Disconnected. Saved endpoints will load when this device reconnects.', kind = '') {
  ++model.generation; cleanupTransport(); model.device = null; resetState('idle');
  message(reason, kind); update();
}
function onDisconnected() {
  disconnect('Bluetooth disconnected. Live readings are unavailable; reconnect to load the saved endpoints.', 'fault');
}

async function connect() {
  if (!canBluetooth || ['connecting', 'live'].includes(model.mode)) return;
  ++model.generation; cleanupTransport(); model.device = null; resetState('connecting');
  const generation = model.generation;
  message('Choose MTB Brake Bench in the Bluetooth device picker.'); update();
  let chosen;
  try {
    chosen = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE_UUID] }] });
    if (generation !== model.generation) return;
    model.device = chosen; chosen.addEventListener('gattserverdisconnected', onDisconnected);
    message('Connecting to the bench and subscribing to sensor readings…'); update();
    const server = await chosen.gatt.connect();
    if (generation !== model.generation) { if (chosen.gatt.connected) chosen.gatt.disconnect(); return; }
    const service = await server.getPrimaryService(SERVICE_UUID);
    const characteristic = await service.getCharacteristic(TELEMETRY_UUID);
    if (generation !== model.generation) { if (chosen.gatt.connected) chosen.gatt.disconnect(); return; }
    model.characteristic = characteristic;
    characteristic.addEventListener('characteristicvaluechanged', onNotification);
    await characteristic.startNotifications();
    if (generation !== model.generation) { characteristic.removeEventListener('characteristicvaluechanged', onNotification); return; }
    model.mode = 'live'; loadCalibration();
    message('Bluetooth linked. Capture each endpoint or enter raw values and save. Magnetic warnings allow provisional bench calibration.');
    // Notifications may precede this initial read; FrameClock rejects older data.
    const value = await characteristic.readValue();
    if (generation === model.generation) receive(value);
  } catch (error) {
    if (generation !== model.generation) return;
    cleanupTransport(); model.device = null; resetState('idle');
    const text = error.name === 'NotFoundError' ? 'No device selected. Make sure the firmware is running and advertising, then try again.' : `Bluetooth connection failed: ${error.message}`;
    message(text, error.name === 'NotFoundError' ? '' : 'fault');
  }
  update();
}
function onNotification(event) { if (event.target === model.characteristic) receive(event.target.value); }
function receive(value) {
  if (!['live', 'demo', 'connecting'].includes(model.mode)) return;
  let frame;
  try { frame = decodeFrame(value); } catch (error) {
    model.fault = `Telemetry format error: ${error.message}`; model.frame = null; model.windows = [[], []];
    message(model.fault, 'fault'); update(); return;
  }
  const now = performance.now();
  const accepted = clock.accept(frame, now);
  if (!accepted.accepted) return;
  if (accepted.restarted) {
    model.windows = [[], []];
    message('Controller restarted. Check the physical endpoints before continuing.', 'warn');
  }
  model.frame = frame; model.fault = '';
  frame.channels.forEach((value, i) => {
    const state = channelState(frame, i);
    model.windows[i].push({ time: now, raw: value.raw, healthy: state.healthy, usable: state.usable });
    model.windows[i] = model.windows[i].filter(sample => now - sample.time <= 800);
  });
  update();
}

function startDemo() {
  ++model.generation; cleanupTransport(); model.device = null; resetState('demo');
  model.demoSequence = 0; model.demoStartedAt = performance.now();
  $('demo-left').value = '0'; $('demo-right').value = '0'; $('demo-fault').value = 'healthy';
  ['left', 'right'].forEach(side => { $(`demo-${side}-value`).textContent = '0%'; });
  message('Demo: all readings below are generated. No Bluetooth device is connected.', 'warn');
  model.demoTimer = window.setInterval(tickDemo, 50); tickDemo(); update();
}
function tickDemo() {
  const condition = $('demo-fault').value;
  if (condition === 'stale') return;
  const v = new DataView(new ArrayBuffer(20));
  v.setUint8(0, 1); v.setUint8(1, condition === 'mux' ? 0 : condition === 'read' ? 3 : 7);
  v.setUint16(2, model.demoSequence++ & 65535, true); v.setUint32(4, Math.floor(performance.now() - model.demoStartedAt), true);
  v.setUint16(8, condition === 'mux' ? 65535 : (4050 + Math.round(Number($('demo-left').value) * 2.5)) % 4096, true);
  v.setUint16(10, ['mux', 'read'].includes(condition) ? 65535 : 1200 - Math.round(Number($('demo-right').value) * 2.5), true);
  v.setUint8(12, condition === 'mux' ? 255 : condition === 'weak' ? 0x30 : condition === 'strong' ? 0x28 : condition === 'missing' ? 0 : 0x20);
  v.setUint8(13, ['mux', 'read'].includes(condition) ? 255 : 0x20);
  v.setUint8(14, condition === 'mux' ? 255 : condition === 'weak' ? 128 : condition === 'strong' ? 0 : 64);
  v.setUint8(15, ['mux', 'read'].includes(condition) ? 255 : 65);
  receive(v);
}

function capture(channel, endpoint) {
  const now = performance.now(); const state = currentState(channel, now);
  if (!active() || !clock.fresh(now) || !state.usable) return message('Fresh usable readings with a detected magnet are required for capture.', 'fault');
  try {
    const raw = stableCapture(model.windows[channel], now);
    const provisional = model.windows[channel].some(sample => now - sample.time <= 650 && !sample.healthy);
    if (endpoint === 'release') {
      model.releases[channel] = raw; model.releaseProvisional[channel] = provisional; model.calibrations[channel] = null;
      fillInputs(channel, raw); saveCalibration();
      message(`${sideName(channel)} release captured at ${raw}. Hold a comfortable full pull steady, then capture it.`, provisional ? 'warn' : '');
    } else {
      const calibration = buildCalibration(model.releases[channel], raw);
      model.calibrations[channel] = { ...calibration, provisional: provisional || model.releaseProvisional[channel] };
      fillInputs(channel, calibration.released, calibration.pulled); saveCalibration();
      message(`${sideName(channel)} endpoints applied. Release and pull several times to check repeatability.`, model.calibrations[channel].provisional ? 'warn' : '');
    }
  } catch (error) { message(error.message, 'warn'); }
  update();
}
function applyInputs(channel) {
  if (!active()) return message('Connect the bench or start the demo before applying endpoints.', 'warn');
  try {
    const inputs = ['released', 'pulled'].map(name => $(`${name}-input-${channel}`).value.trim());
    if (inputs.some(value => !/^\d+$/.test(value))) throw new Error('Enter both endpoints as whole raw counts from 0 to 4095.');
    const calibration = buildCalibration(...inputs.map(Number));
    const state = currentState(channel, performance.now());
    const provisional = !clock.fresh(performance.now()) || !state.healthy;
    model.calibrations[channel] = { ...calibration, provisional };
    model.releases[channel] = calibration.released; model.releaseProvisional[channel] = provisional;
    fillInputs(channel, calibration.released, calibration.pulled); saveCalibration();
    message(`${sideName(channel)} endpoints applied${provisional ? ' provisionally; verify magnet alignment and repeatability' : '; check release and full pull'}.`, provisional ? 'warn' : '');
  } catch (error) { message(error.message, 'warn'); }
  update();
}
function clearCalibration(channel) {
  if (!active()) return;
  model.releases[channel] = null; model.releaseProvisional[channel] = false; model.calibrations[channel] = null;
  fillInputs(channel); saveCalibration();
  message(`${sideName(channel)} endpoints cleared from this session. Check the card for local storage status.`); update();
}
function loadCalibration() {
  if (model.mode !== 'live' || !model.device?.id) return;
  try {
    const saved = localStorage.getItem(storageKey(model.device.id));
    if (saved) model.calibrations = parseCalibration(saved, model.device.id);
    for (const i of [0, 1]) {
      const cal = model.calibrations[i]; model.releases[i] = cal?.released ?? null; model.releaseProvisional[i] = Boolean(cal?.provisional);
      fillInputs(i, cal?.released ?? '', cal?.pulled ?? '');
      storageMessage(i, cal ? 'Saved endpoints loaded for this Bluetooth device. Recalibrate if the mechanics moved.' : 'No saved endpoints for this channel. Completed endpoints are saved automatically.');
    }
  } catch {
    for (const i of [0, 1]) storageMessage(i, 'Saved endpoints could not be loaded. Capture or enter new endpoints; the stored profile was not changed.', 'warn');
  }
}
function saveCalibration() {
  if (model.mode === 'demo') {
    for (const i of [0, 1]) storageMessage(i, 'Demo only. Endpoints stay in memory and are never saved for a Bluetooth device.');
    return;
  }
  if (model.mode !== 'live' || !model.device?.id) {
    for (const i of [0, 1]) storageMessage(i, 'Not saved. A connected Bluetooth device ID is required; endpoints remain in this session.', 'warn');
    return;
  }
  try {
    const key = storageKey(model.device.id);
    if (model.calibrations.some(Boolean)) localStorage.setItem(key, JSON.stringify({ version: PROTOCOL_VERSION, deviceId: model.device.id, savedAt: new Date().toISOString(), channels: model.calibrations }));
    else localStorage.removeItem(key);
    for (const i of [0, 1]) storageMessage(i, model.calibrations[i] ? 'Saved automatically in this browser for this Bluetooth device.' : model.releases[i] !== null ? 'Release captured. Previous saved endpoints removed; capture full pull to finish.' : 'No saved endpoints for this channel.');
  } catch {
    for (const i of [0, 1]) storageMessage(i, 'Not saved: browser storage is unavailable. Session changes work, but previous saved endpoints may return after reconnecting.', 'warn');
  }
}

function currentState(i, now) {
  if (model.fault) return { healthy: false, usable: false, kind: 'fault', text: 'Invalid telemetry' };
  if (model.frame && !clock.fresh(now)) return { healthy: false, usable: false, kind: 'fault', text: 'Telemetry stale' };
  return channelState(model.frame, i);
}
function update() {
  const now = performance.now(); const fresh = clock.fresh(now); const isActive = active();
  $('connect').disabled = !canBluetooth || model.mode === 'connecting' || model.mode === 'live';
  $('demo').disabled = model.mode === 'connecting' || model.mode === 'demo';
  $('disconnect').hidden = model.mode === 'idle'; $('disconnect').textContent = model.mode === 'demo' ? 'Stop demo' : model.mode === 'connecting' ? 'Cancel' : 'Disconnect';
  $('demo-panel').hidden = model.mode !== 'demo';
  const states = [0, 1].map(i => currentState(i, now));
  let connection = 'Not connected', kind = '';
  if (model.mode === 'connecting') { connection = 'Connecting…'; kind = 'connecting'; }
  if (model.mode === 'demo') { connection = fresh ? 'Demo · simulated readings' : 'Demo · telemetry paused'; kind = fresh ? 'demo' : 'fault'; }
  if (model.mode === 'live') {
    connection = !model.frame ? 'Bluetooth linked · waiting for telemetry' : !fresh ? 'Bluetooth linked · telemetry stale' : states.every(s => s.healthy) ? 'Bluetooth linked · sensors healthy' : states.every(s => s.usable) ? 'Bluetooth linked · magnetic warning' : 'Bluetooth linked · check sensors';
    kind = fresh && states.every(s => s.healthy) ? 'good' : fresh && states.every(s => s.usable) ? 'warn' : 'fault';
  }
  if (connection !== lastConnectionText) { $('connection-state').textContent = connection; lastConnectionText = connection; }
  $('connection-indicator').dataset.kind = kind;
  $('device-name').textContent = model.mode === 'demo' ? 'No hardware connected' : model.device?.name ?? 'No device selected';
  states.forEach((state, i) => {
    const sample = model.frame?.channels[i]; const cal = model.calibrations[i];
    const norm = isActive && fresh && state.usable ? normalize(sample.raw, cal) : null;
    const outOfRange = state.usable && fresh && cal && norm === null;
    const provisional = Boolean(cal?.provisional || state.kind === 'warn');
    // Always show actual sensor health; travel warnings belong in calibration text.
    $(`health-${i}`).textContent = state.text; $(`health-${i}`).dataset.kind = state.kind;
    $(`percent-${i}`).textContent = norm === null ? '—' : Math.round(norm * 100);
    const meter = $(`meter-${i}`); meter.firstElementChild.style.width = `${norm === null ? 0 : norm * 100}%`;
    meter.setAttribute('aria-valuetext', norm === null ? 'No valid calibrated reading' : `${Math.round(norm * 100)} percent travel${provisional ? ' · provisional calibration' : ''}`);
    if (norm === null) meter.removeAttribute('aria-valuenow'); else meter.setAttribute('aria-valuenow', Math.round(norm * 100));
    $(`raw-${i}`).textContent = fresh && sample && sample.raw < 4096 && !model.fault ? sample.raw : '—';
    $(`angle-${i}`).textContent = fresh && state.usable ? `${(sample.raw * 360 / 4096).toFixed(1)}°` : '—';
    $(`status-${i}`).textContent = fresh && sample && sample.status !== 255 && !model.fault ? `MD ${+Boolean(sample.status & 32)} · ML ${+Boolean(sample.status & 16)} · MH ${+Boolean(sample.status & 8)}` : '—';
    $(`agc-${i}`).textContent = fresh && sample && sample.agc <= 128 && !model.fault ? `${sample.agc} / 128` : '—';
    $(`release-${i}`).disabled = !isActive || !fresh || !state.usable;
    $(`pull-${i}`).disabled = !isActive || !fresh || !state.usable || model.releases[i] === null;
    $(`clear-${i}`).disabled = !isActive || (model.releases[i] === null && !model.dirty[i]);
    $(`apply-${i}`).disabled = !isActive;
    $(`released-input-${i}`).disabled = !isActive; $(`pulled-input-${i}`).disabled = !isActive;
    $(`calibration-${i}`).textContent = outOfRange ? `${provisional ? 'Provisional calibration. ' : ''}Reading is outside the endpoint range. Check the setup or recalibrate.` : cal ? `${provisional ? 'Provisional bench calibration' : 'Calibrated lever travel'} · not a force measurement.${provisional ? ' Improve magnetic alignment and check repeatability.' : ''}` : model.releases[i] !== null ? `${model.releaseProvisional[i] ? 'Provisional release' : 'Release'} captured. Now set a comfortable full pull.` : 'Capture release and full pull, or enter raw endpoints and save.';
    $(`calibration-${i}`).dataset.kind = provisional || outOfRange ? 'warn' : '';
    $(`endpoint-${i}`).textContent = cal ? `Released ${cal.released} · pulled ${cal.pulled} · ${Math.abs(cal.span * 360 / 4096).toFixed(1)}° travel` : model.releases[i] !== null ? `Released ${model.releases[i]} · hold full pull steady for 0.5 s.` : 'Hold the lever still for 0.5 s before each capture.';
    $(`storage-${i}`).textContent = model.dirty[i] ? 'Unsaved input edits. Choose Save endpoints to apply them; the current calibration is unchanged.' : model.storage[i];
    $(`storage-${i}`).dataset.kind = model.dirty[i] ? 'warn' : model.storageKind[i];
  });
  $('packet-state').textContent = model.frame ? `v${model.frame.version} · sequence ${model.frame.sequence} · uptime ${(model.frame.uptime / 1000).toFixed(1)} s` : 'Waiting for telemetry';
  $('packet-age').textContent = clock.received === null ? '—' : `Last sample ${Math.floor(now - clock.received)} ms ago${fresh ? '' : ' · STALE'}`;
  $('packet-loss').textContent = `≥ ${clock.dropped} skipped samples`;
}

$('connect').addEventListener('click', connect);
$('disconnect').addEventListener('click', () => disconnect(model.mode === 'demo' ? 'Demo stopped. No hardware was connected.' : undefined));
$('demo').addEventListener('click', startDemo);
for (const i of [0, 1]) {
  $(`release-${i}`).addEventListener('click', () => capture(i, 'release'));
  $(`pull-${i}`).addEventListener('click', () => capture(i, 'pull'));
  $(`clear-${i}`).addEventListener('click', () => clearCalibration(i));
  $(`endpoints-${i}`).addEventListener('submit', event => { event.preventDefault(); applyInputs(i); });
  for (const name of ['released', 'pulled']) $(`${name}-input-${i}`).addEventListener('input', () => { model.dirty[i] = true; update(); });
}
for (const side of ['left', 'right']) $(`demo-${side}`).addEventListener('input', () => { $(`demo-${side}-value`).textContent = `${$(`demo-${side}`).value}%`; });
window.addEventListener('pagehide', () => { ++model.generation; cleanupTransport(); });
if (!canBluetooth) $('compatibility').textContent = !window.isSecureContext ? 'Bluetooth needs HTTPS or localhost. Open the hosted tester or serve this folder locally; the demo still works.' : 'Web Bluetooth is unavailable in this browser. Use a current Chrome or Edge desktop browser; the demo still works.';
setInterval(update, 100);
resetState('idle'); update();
if (new URLSearchParams(location.search).get('demo') === '1') startDemo();
