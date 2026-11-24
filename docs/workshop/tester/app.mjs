import { SERVICE_UUID, TELEMETRY_UUID, PROTOCOL_VERSION, STALE_MS, decodeFrame, channelState, buildCalibration, normalize, stableCapture, storageKey, parseCalibration, FrameClock, csvEscape } from './core.mjs';

const $ = id => document.getElementById(id);
const clock = new FrameClock();
const MAX_RECORDS = 12000;
const model = {
  mode: 'idle', device: null, characteristic: null, generation: 0, frame: null, fault: '',
  calibrations: [null, null], releases: [null, null], windows: [[], []], history: [], records: [],
  sessionStart: 0, sessionTotal: 0, demoTimer: null, demoSequence: 0,
};
let lastPlot = 0;
let lastConnectionText = '';
const canBluetooth = Boolean(window.isSecureContext && navigator.bluetooth);

function message(text, kind = '') { $('message').textContent = text; $('message').dataset.kind = kind; }
function clearReadings() {
  clock.reset(); model.frame = null; model.fault = ''; model.windows = [[], []];
}
function resetSession(mode) {
  model.mode = mode; clearReadings(); model.history = []; model.records = [];
  model.calibrations = [null, null]; model.releases = [null, null];
  model.sessionStart = performance.now(); model.sessionTotal = 0;
  $('storage-status').textContent = mode === 'demo' ? 'Demo endpoints exist only in memory. They are never saved for a real device.' : 'Calibration is not saved unless you choose to remember it.';
  $('session-status').textContent = 'A new connection or demo starts a fresh session. Export before switching.';
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
function disconnect(reason = 'Disconnected. Connect again when the bench is ready.', kind = '') {
  ++model.generation; cleanupTransport(); model.mode = 'idle'; clearReadings();
  model.device = null; model.calibrations = [null, null]; model.releases = [null, null];
  message(reason, kind); update(); drawPlot();
}
function onDisconnected() {
  disconnect('Bluetooth disconnected. Readings and travel are unavailable; reconnect to resume.', 'fault');
}

async function connect() {
  if (!canBluetooth) return;
  cleanupTransport(); model.device = null; resetSession('connecting');
  const generation = ++model.generation;
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
    message('Bluetooth linked. Wait for healthy readings, then capture released and full-pull positions.');
    // The first notification may have arrived before startNotifications resolved.
    const value = await characteristic.readValue();
    if (generation === model.generation) receive(value);
  } catch (error) {
    if (generation !== model.generation) return;
    cleanupTransport(); model.device = null; model.mode = 'idle'; clearReadings();
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
    model.windows = [[], []]; model.history.push({ time: now, channels: [null, null] });
    message('Controller restarted. New telemetry is arriving; check the physical endpoints before continuing.', 'warn');
  }
  model.frame = frame; model.fault = '';
  const states = frame.channels.map((_, i) => channelState(frame, i));
  states.forEach((state, i) => {
    model.windows[i].push({ time: now, raw: frame.channels[i].raw, healthy: state.healthy });
    model.windows[i] = model.windows[i].filter(s => now - s.time <= 800);
  });
  model.history.push({ time: now, channels: frame.channels.map((v, i) => states[i].healthy ? v.raw : null) });
  model.history = model.history.filter(p => now - p.time <= 12000);
  const row = [model.mode === 'demo' ? 'DEMO' : 'BLUETOOTH', model.mode === 'demo' ? 'Simulated bench' : (model.device?.name ?? 'Unnamed bench'), new Date().toISOString(), Math.round(now - model.sessionStart), PROTOCOL_VERSION, frame.sequence, frame.uptime, frame.flags];
  frame.channels.forEach((v, i) => {
    const norm = states[i].healthy ? normalize(v.raw, model.calibrations[i]) : null;
    row.push(v.raw === 65535 ? '' : v.raw, states[i].healthy ? (v.raw * 360 / 4096).toFixed(3) : '', v.status, v.status !== 255 ? Number(Boolean(v.status & 32)) : '', v.status !== 255 ? Number(Boolean(v.status & 16)) : '', v.status !== 255 ? Number(Boolean(v.status & 8)) : '', v.agc === 255 ? '' : v.agc, states[i].healthy ? 1 : 0, norm === null ? '' : (norm * 100).toFixed(2), model.calibrations[i]?.released ?? '', model.calibrations[i]?.pulled ?? '');
  });
  model.records.push(row); model.sessionTotal++;
  if (model.records.length > MAX_RECORDS) model.records.shift();
  update();
}

function startDemo() {
  ++model.generation; cleanupTransport(); model.device = null; resetSession('demo'); model.demoSequence = 0;
  $('demo-left').value = '0'; $('demo-right').value = '0'; $('demo-fault').value = 'healthy';
  ['left', 'right'].forEach(side => { $(`demo-${side}-value`).textContent = '0%'; });
  message('Demo: all readings below are generated. No Bluetooth device is connected.', 'warn');
  model.demoTimer = window.setInterval(tickDemo, 50); tickDemo(); update();
}
function tickDemo() {
  const condition = $('demo-fault').value;
  if (condition === 'stale') return;
  const buffer = new ArrayBuffer(20); const v = new DataView(buffer);
  v.setUint8(0, 1); v.setUint8(1, condition === 'mux' ? 0 : condition === 'read' ? 3 : 7);
  v.setUint16(2, model.demoSequence++ & 65535, true); v.setUint32(4, Math.floor(performance.now() - model.sessionStart), true);
  v.setUint16(8, condition === 'mux' ? 65535 : (4050 + Math.round(Number($('demo-left').value) * 2.5)) % 4096, true);
  v.setUint16(10, ['mux', 'read'].includes(condition) ? 65535 : 1200 - Math.round(Number($('demo-right').value) * 2.5), true);
  v.setUint8(12, condition === 'mux' ? 255 : condition === 'weak' ? 0x30 : condition === 'missing' ? 0 : 0x20); v.setUint8(13, ['mux', 'read'].includes(condition) ? 255 : 0x20);
  v.setUint8(14, condition === 'mux' ? 255 : condition === 'weak' ? 128 : 64); v.setUint8(15, ['mux', 'read'].includes(condition) ? 255 : 65);
  receive(v);
}

function capture(channel, endpoint) {
  if (!clock.fresh(performance.now()) || model.fault) return message('Fresh, healthy telemetry is required before calibration.', 'fault');
  try {
    const raw = stableCapture(model.windows[channel], performance.now());
    if (endpoint === 'release') {
      model.releases[channel] = raw; model.calibrations[channel] = null;
      message(`${channel ? 'Right' : 'Left'} release captured at ${raw}. Pull to the comfortable stop, hold still, then set full pull.`);
    } else {
      const calibration = buildCalibration(model.releases[channel], raw);
      model.calibrations[channel] = calibration;
      message(`${channel ? 'Right' : 'Left'} endpoints set: ${Math.abs(calibration.span * 360 / 4096).toFixed(1)}° travel. Release and pull several times to check repeatability.`);
    }
    $('storage-status').textContent = model.mode === 'demo' ? 'Demo calibration remains in memory only.' : 'Endpoints changed in memory. Choose “Remember calibration” to keep them for this device.';
  } catch (error) { message(error.message, 'warn'); }
  update(); drawPlot();
}
function clearCalibration(channel) {
  model.releases[channel] = null; model.calibrations[channel] = null;
  message(`${channel ? 'Right' : 'Left'} calibration cleared for this session.`);
  $('storage-status').textContent = 'Session endpoints changed. Remember them to update a saved profile, or forget the saved profile below.';
  update(); drawPlot();
}
function loadCalibration() {
  if (!model.device?.id) return;
  try {
    const saved = localStorage.getItem(storageKey(model.device.id));
    if (!saved) return;
    model.calibrations = parseCalibration(saved, model.device.id);
    model.releases = model.calibrations.map(c => c?.released ?? null);
    $('storage-status').textContent = 'Saved endpoints loaded for this Bluetooth device and protocol. Recalibrate if the magnet or mechanics moved.';
  } catch { $('storage-status').textContent = 'Saved endpoints could not be loaded. Capture fresh endpoints; the device was not changed.'; }
}
function saveCalibration() {
  if (model.mode !== 'live' || !model.device?.id) return;
  try {
    localStorage.setItem(storageKey(model.device.id), JSON.stringify({ version: PROTOCOL_VERSION, deviceId: model.device.id, savedAt: new Date().toISOString(), channels: model.calibrations }));
    $('storage-status').textContent = 'Calibration saved locally for this Bluetooth device. Nothing was sent to a server or written to the encoder.';
  } catch { message('Browser storage is unavailable. Session calibration still works; export the CSV to keep endpoint values.', 'warn'); }
}
function forgetCalibration() {
  if (model.mode !== 'live' || !model.device?.id) return;
  try { localStorage.removeItem(storageKey(model.device.id)); $('storage-status').textContent = 'Saved calibration removed for this device. Current session endpoints remain until you clear or disconnect.'; }
  catch { message('Browser storage is unavailable; the saved profile could not be removed.', 'warn'); }
}

function currentState(i, now) {
  if (model.fault) return { healthy: false, kind: 'fault', text: 'Invalid telemetry' };
  if (model.frame && !clock.fresh(now)) return { healthy: false, kind: 'fault', text: 'Telemetry stale' };
  return channelState(model.frame, i);
}
function update() {
  const now = performance.now(); const fresh = clock.fresh(now); const active = ['live', 'demo'].includes(model.mode);
  $('connect').disabled = !canBluetooth || model.mode === 'connecting' || model.mode === 'live';
  $('demo').disabled = model.mode === 'connecting' || model.mode === 'demo';
  $('disconnect').hidden = model.mode === 'idle'; $('disconnect').textContent = model.mode === 'demo' ? 'Stop demo' : model.mode === 'connecting' ? 'Cancel' : 'Disconnect';
  $('demo-panel').hidden = model.mode !== 'demo';
  const states = [0, 1].map(i => currentState(i, now));
  let connection = 'Not connected', kind = '';
  if (model.mode === 'connecting') { connection = 'Connecting…'; kind = 'connecting'; }
  if (model.mode === 'demo') { connection = fresh ? 'Demo · simulated readings' : 'Demo · telemetry paused'; kind = fresh ? 'demo' : 'fault'; }
  if (model.mode === 'live') { connection = !model.frame ? 'Bluetooth linked · waiting for telemetry' : !fresh ? 'Bluetooth linked · telemetry stale' : states.every(s => s.healthy) ? 'Bluetooth linked · sensors healthy' : 'Bluetooth linked · check sensors'; kind = fresh && states.every(s => s.healthy) ? 'good' : 'fault'; }
  if (connection !== lastConnectionText) { $('connection-state').textContent = connection; lastConnectionText = connection; }
  $('connection-indicator').dataset.kind = kind;
  $('device-name').textContent = model.mode === 'demo' ? 'No hardware connected' : model.device?.name ?? 'No device selected';
  states.forEach((state, i) => {
    const sample = model.frame?.channels[i]; const cal = model.calibrations[i];
    const norm = active && fresh && state.healthy ? normalize(sample.raw, cal) : null;
    const outOfRange = state.healthy && fresh && cal && norm === null;
    $(`health-${i}`).textContent = outOfRange ? 'Outside calibrated travel' : state.text;
    $(`health-${i}`).dataset.kind = outOfRange ? 'warn' : state.kind;
    $(`percent-${i}`).textContent = norm === null ? '—' : Math.round(norm * 100);
    const meter = $(`meter-${i}`); meter.firstElementChild.style.width = `${norm === null ? 0 : norm * 100}%`;
    meter.setAttribute('aria-valuetext', norm === null ? 'No valid calibrated reading' : `${Math.round(norm * 100)} percent travel`);
    if (norm === null) meter.removeAttribute('aria-valuenow'); else meter.setAttribute('aria-valuenow', Math.round(norm * 100));
    $(`raw-${i}`).textContent = fresh && sample && sample.raw < 4096 && !model.fault ? sample.raw : '—';
    $(`angle-${i}`).textContent = fresh && state.healthy ? `${(sample.raw * 360 / 4096).toFixed(1)}°` : '—';
    $(`status-${i}`).textContent = fresh && sample && sample.status !== 255 && !model.fault ? `MD ${+Boolean(sample.status & 32)} · ML ${+Boolean(sample.status & 16)} · MH ${+Boolean(sample.status & 8)}` : '—';
    $(`agc-${i}`).textContent = fresh && sample && sample.agc <= 128 && !model.fault ? `${sample.agc} / 128` : '—';
    $(`release-${i}`).disabled = !active || !fresh || !state.healthy;
    $(`pull-${i}`).disabled = !active || !fresh || !state.healthy || model.releases[i] === null;
    $(`clear-${i}`).disabled = model.releases[i] === null;
    $(`calibration-${i}`).textContent = outOfRange ? 'Reading is outside the endpoint range. Check the setup or recalibrate.' : cal ? 'Calibrated lever travel · not a force measurement.' : model.releases[i] !== null ? 'Release captured. Now set a comfortable full pull.' : 'Capture release and full pull to measure travel.';
    $(`endpoint-${i}`).textContent = cal ? `Released ${cal.released} · pulled ${cal.pulled} · ${Math.abs(cal.span * 360 / 4096).toFixed(1)}° travel` : model.releases[i] !== null ? `Released ${model.releases[i]} · hold full pull steady for 0.5 s.` : 'Hold the lever still for 0.5 s before each capture.';
  });
  $('save').disabled = model.mode !== 'live' || !model.calibrations.some(Boolean);
  $('forget').disabled = model.mode !== 'live'; $('export').disabled = model.records.length === 0;
  $('packet-state').textContent = model.frame ? `v${model.frame.version} · sequence ${model.frame.sequence} · uptime ${(model.frame.uptime / 1000).toFixed(1)} s` : 'Waiting for telemetry';
  $('packet-age').textContent = clock.received === null ? '—' : `Last sample ${Math.floor(now - clock.received)} ms ago${fresh ? '' : ' · STALE'}`;
  $('packet-loss').textContent = `≥ ${clock.dropped} skipped samples`;
  if (model.sessionTotal) $('session-status').textContent = `${model.records[0]?.[0] === 'DEMO' ? 'DEMO' : 'BLUETOOTH'} · ${model.records.length.toLocaleString('en-US')} samples available${model.sessionTotal > MAX_RECORDS ? ` (latest ${MAX_RECORDS.toLocaleString('en-US')} of ${model.sessionTotal.toLocaleString('en-US')})` : ''}. Export before starting a new connection or demo.`;
}

function drawPlot() {
  const canvas = $('plot'); const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(100, canvas.clientWidth), height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  const calibrated = model.calibrations.every(Boolean); const maximum = calibrated ? 100 : 360;
  $('plot-mode').textContent = calibrated ? 'Calibrated travel (%)' : 'Raw angle (°)';
  const left = 35, right = width - 8, top = 12, bottom = height - 25;
  ctx.font = '10px system-ui'; ctx.textAlign = 'right'; ctx.fillStyle = '#64746b'; ctx.strokeStyle = '#e6eae1'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const y = bottom - (bottom - top) * i / 4; ctx.fillText(Math.round(maximum * i / 4), left - 9, y + 3); ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); }
  ctx.textAlign = 'left'; ctx.fillText('−12 s', left, height - 4); ctx.textAlign = 'right'; ctx.fillText('now', right, height - 4);
  const now = performance.now();
  [0, 1].forEach(channel => {
    ctx.strokeStyle = channel ? '#b94c18' : '#173b34'; ctx.lineWidth = 2; ctx.beginPath(); let previous = null;
    for (const p of model.history) {
      if (now - p.time > 12000) continue;
      const raw = p.channels[channel];
      const normalized = raw === null ? null : calibrated ? normalize(raw, model.calibrations[channel]) : raw / 4096;
      if (normalized === null) { previous = null; continue; }
      const x = left + (1 - (now - p.time) / 12000) * (right - left), y = bottom - normalized * (bottom - top);
      if (!previous || p.time - previous.time > STALE_MS || (!calibrated && Math.abs(normalized - previous.value) > .5)) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      previous = { time: p.time, value: normalized };
    }
    ctx.stroke();
  });
}

function exportCsv() {
  if (!model.records.length) return;
  const header = ['source', 'device_name', 'received_at_utc', 'elapsed_ms', 'protocol_version', 'sequence', 'device_uptime_ms', 'frame_flags'];
  for (const side of ['left', 'right']) for (const field of ['raw', 'angle_degrees', 'status_byte', 'MD', 'ML', 'MH', 'AGC', 'magnetic_healthy', 'travel_percent', 'released_endpoint', 'pulled_endpoint']) header.push(`${side}_${field}`);
  const csv = '\ufeff' + [header, ...model.records].map(row => row.map(csvEscape).join(',')).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; const source = model.records[0][0].toLowerCase();
  a.download = `mtb-brake-bench-${source}-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.csv`; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  message(`Exported ${model.records.length.toLocaleString('en-US')} ${source === 'demo' ? 'simulated' : 'Bluetooth'} samples. CSV includes endpoint values as they were recorded.`);
}

$('connect').addEventListener('click', connect);
$('disconnect').addEventListener('click', () => disconnect(model.mode === 'demo' ? 'Demo stopped. No hardware was connected.' : undefined));
$('demo').addEventListener('click', startDemo);
$('save').addEventListener('click', saveCalibration); $('forget').addEventListener('click', forgetCalibration); $('export').addEventListener('click', exportCsv);
for (const i of [0, 1]) { $(`release-${i}`).addEventListener('click', () => capture(i, 'release')); $(`pull-${i}`).addEventListener('click', () => capture(i, 'pull')); $(`clear-${i}`).addEventListener('click', () => clearCalibration(i)); }
for (const side of ['left', 'right']) $(`demo-${side}`).addEventListener('input', () => { $(`demo-${side}-value`).textContent = `${$(`demo-${side}`).value}%`; });
window.addEventListener('resize', drawPlot);
window.addEventListener('pagehide', cleanupTransport);
if (!canBluetooth) $('compatibility').textContent = !window.isSecureContext ? 'Bluetooth needs HTTPS or localhost. Open the hosted tester or serve this folder locally; the demo still works.' : 'Web Bluetooth is unavailable in this browser. Use a current Chrome or Edge desktop browser; the demo still works.';
setInterval(() => { update(); const now = performance.now(); if (now - lastPlot >= 90) { drawPlot(); lastPlot = now; } }, 100);
update(); drawPlot();
if (new URLSearchParams(location.search).get('demo') === '1') startDemo();
