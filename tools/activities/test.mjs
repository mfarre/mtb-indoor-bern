import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scene = new URL('../../src/MTBIndoorBern/Scene/', import.meta.url);
const source = await readFile(new URL('activities-ui.js', scene), 'utf8');
const { setupActivities, activityDuration, calorieDisplay } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const html = await readFile(new URL('index.html', scene), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);

// Same small event/focus stubs as the presentation-controls tests, extended with
// children and disabled-button behaviour. No browser, filesystem export or URL opening.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.listeners = new Map(); this.attributes = new Map();
    this.children = []; this.disabled = false; this.hidden = false; this.textContent = ''; this.open = false;
  }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  focus() { document.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  click() { if (!this.disabled) this.onclick?.(); }
  emit(name, props = {}) {
    const event = { preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...props };
    this.listeners.get(name)?.(event); return event;
  }
  set innerHTML(_) { throw new Error('Activity content must use text nodes, not HTML interpolation'); }
}

const activity = (id, overrides = {}) => ({ id, courseName: 'Dentenberg', startedUtc: '2026-11-28T10:00:00Z',
  activeSeconds: 3661, distanceMeters: 1234, calories: 123.4, workKj: 124, averagePower: 150,
  isComplete: true, canExport: true, truncated: false, ...overrides });
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';

function fixture() {
  const original = globalThis.document, elements = new Map(ids.map(id => [id, new Element()]));
  const get = id => { const element = elements.get(id); assert.ok(element, `index.html contains #${id}`); return element; };
  globalThis.document = { getElementById: id => elements.get(id) ?? null, createElement: tag => new Element(tag), activeElement: null };
  const sent = [], order = [];
  const ui = setupActivities((action, extra = {}) => { order.push(action); sent.push({ action, ...extra }); }, () => order.push('clear-brake'));
  const open = () => { get('activities-open').focus(); get('activities-open').click(); };
  const lastRequest = actions => sent.findLast(message => actions.includes(message.action));
  const list = (entries = [activity(A), activity(B)], extra = {}) => ui.receive({ type: 'activities', activities: entries,
    requestId: lastRequest(['activities-open', 'activities-list'])?.requestId, ...extra });
  return { get, ui, sent, order, open, list,
    result: extra => ui.receive({ type: 'activity-result', requestId: lastRequest(['activity-export', 'activity-strava'])?.requestId, ...extra }),
    lastRequest,
    close: () => get('activities-close').click(),
    export: () => get('activity-export').click(),
    restore: () => { if (original === undefined) delete globalThis.document; else globalThis.document = original; } };
}
function uiTest(name, body) { test(name, () => { const f = fixture(); try { body(f); } finally { f.restore(); } }); }

test('duration formatting and real/demo calorie boundaries', () => {
  for (const [seconds, expected] of [[0, '0:00'], [59.9, '0:59'], [60, '1:00'], [3599, '59:59'], [3661, '1:01:01'], [-9, '0:00'], [NaN, '0:00']])
    assert.equal(activityDuration(seconds), expected);
  assert.equal(calorieDisplay({ mode: 'ride', calories: 123.4 }).text, '123');
  assert.equal(calorieDisplay({ mode: 'ride', calories: 0 }).text, '0');
  assert.equal(calorieDisplay({ mode: 'paused', calories: 123.4, watts: null }).text, '123', 'missing current watts does not erase accumulated measured work');
  for (const value of [undefined, null, NaN, Infinity, -1, '123']) assert.equal(calorieDisplay({ calories: value }).text, '—');
  for (const state of [{ mode: 'demo', demo: true }, { mode: 'paused', demo: true }, { mode: 'demo', practice: true }]) {
    const result = calorieDisplay({ calories: 999, ...state });
    assert.equal(result.text, '—', 'stale real totals cannot appear as demo exercise');
    assert.match(result.note, /do not count as exercise/);
  }
  assert.match(calorieDisplay({ calories: 120 }).note, /24%/);
});

uiTest('opening clears input, requests host pause/list, and closing never resumes the ride', f => {
  f.open(); assert.deepEqual(f.order, ['clear-brake', 'activities-open']);
  assert.equal(f.ui.isOpen, true); assert.equal(f.get('activities-dialog').open, true);
  assert.equal(document.activeElement, f.get('activities-close'));
  assert.equal(f.get('activities-refresh').disabled, true); assert.equal(f.get('activity-export').disabled, true);
  f.list(); f.close();
  assert.equal(f.ui.isOpen, false); assert.equal(document.activeElement, f.get('activities-open'));
  assert.equal(f.sent.at(-1).action, 'activities-close');
  assert.ok(!f.sent.some(message => ['resume', 'start', 'demo'].includes(message.action)), 'the user must explicitly resume later');
});

uiTest('Escape dismisses the panel and modal keys stay separate from ride controls', f => {
  f.open(); const dialog = f.get('activities-dialog');
  assert.equal(dialog.emit('keydown', { key: ' ' }).stopped, true);
  assert.equal(dialog.emit('keyup', { key: 'a' }).stopped, true);
  assert.equal(dialog.emit('cancel').prevented, true); assert.equal(dialog.open, false);
  assert.equal(f.sent.at(-1).action, 'activities-close'); assert.equal(f.sent.length, 2);
});

uiTest('listing and selecting rides formats measured summaries using text nodes', f => {
  f.open(); f.list([activity(A, { courseName: '<img src=x onerror=alert(1)>' }), activity(B, { courseName: 'Gurten', isComplete: false })]);
  const rows = f.get('activity-list').children;
  assert.equal(rows.length, 2); assert.equal(rows[0].children[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(f.get('activity-duration').textContent, '1:01:01'); assert.equal(f.get('activity-distance').textContent, '1.23');
  assert.equal(f.get('activity-calories').textContent, '123'); assert.equal(f.get('activity-average-power').textContent, '150');
  assert.equal(f.get('activity-strava').disabled, true);
  rows[1].click(); assert.equal(f.get('activity-course').textContent, 'Gurten');
  assert.match(f.get('activity-status').textContent, /PARTIAL/); assert.match(f.get('activity-recording-note').textContent, /Resume/);
});

uiTest('export requires a success acknowledgement and never uploads from the UI', f => {
  f.open(); f.list(); f.get('activity-strava').click(); assert.equal(f.sent.length, 1);
  f.export(); assert.equal(f.sent.at(-1).action, 'activity-export'); assert.equal(f.sent.at(-1).id, A); assert.equal(typeof f.sent.at(-1).requestId, 'string');
  assert.equal(f.get('activity-export').disabled, true); assert.equal(f.get('activity-strava').disabled, true);
  assert.equal(f.get('activities-refresh').disabled, true); assert.ok(f.get('activity-list').children.every(row => row.disabled));
  f.export(); assert.equal(f.sent.filter(message => message.action === 'activity-export').length, 1, 'double click cannot duplicate export');
  f.result({ id: A, notice: 'Export cancelled.' });
  assert.equal(f.get('activity-export').disabled, false); assert.equal(f.get('activity-strava').disabled, true);
  f.export(); f.result({ id: A, error: 'Disk full' });
  assert.equal(f.get('activity-export').disabled, false); assert.equal(f.get('activity-strava').disabled, true);
  assert.equal(f.get('activity-notice').textContent, 'Disk full');
  f.export(); f.result({ id: A, exported: true, notice: 'Saved ride.tcx' });
  assert.equal(f.get('activity-strava').disabled, false);
  f.get('activity-strava').click(); assert.equal(f.sent.at(-1).action, 'activity-strava'); assert.equal(f.sent.at(-1).id, A);
  assert.equal(typeof f.sent.at(-1).requestId, 'string');
  assert.ok(f.sent.every(message => Object.keys(message).every(key => ['action', 'id', 'requestId'].includes(key))), 'UI sends intent, correlation and identity, never workout content or credentials');
});

uiTest('selection, refresh and a new export attempt invalidate previous acknowledgements', f => {
  f.open(); f.list(); f.export(); f.result({ id: A, exported: true });
  f.get('activity-list').children[1].click(); assert.equal(f.get('activity-strava').disabled, true);
  f.export(); f.result({ id: B, exported: true }); assert.equal(f.get('activity-strava').disabled, false);
  f.get('activities-refresh').click(); f.list();
  assert.equal(f.get('activity-strava').disabled, true, 'refreshed summary needs a new matching file');
  f.export(); f.result({ id: B, exported: true });
  f.export(); f.result({ id: B, notice: 'Export cancelled.' });
  assert.equal(f.get('activity-strava').disabled, true, 'cancelled replacement cannot silently use an earlier file acknowledgement');
});

uiTest('closing, reopening and late results cannot revive an old partial export', f => {
  f.open(); f.list(); f.export(); f.result({ id: A, exported: true }); f.close();
  f.result({ id: A, exported: true, notice: 'Late export' });
  f.open(); f.list([activity(A, { activeSeconds: 3900, calories: 140 })]);
  assert.equal(f.get('activity-strava').disabled, true, 'same activity ID may have newer samples after resume');
  assert.notEqual(f.get('activity-notice').textContent, 'Late export');
  f.export(); f.close(); f.result({ id: A, exported: true });
  f.open(); f.list([activity(A)]); assert.equal(f.get('activity-strava').disabled, true, 'closed-dialog acknowledgement stays ignored');
});

uiTest('out-of-order list replies cannot replace a reopened dialog or interrupt an export', f => {
  f.open(); const oldList = f.sent.at(-1).requestId; f.close(); f.open();
  const currentList = f.sent.at(-1).requestId;
  assert.notEqual(currentList, oldList, 'each open has a unique request even within the same millisecond');
  f.list([activity(B, { courseName: 'Old history' })], { requestId: oldList });
  assert.equal(f.get('activities-refresh').disabled, true); assert.equal(f.get('activity-details').hidden, true);
  f.list([activity(A)]); assert.equal(f.get('activity-course').textContent, 'Dentenberg');
  f.export();
  f.list([activity(B, { courseName: 'Late replacement' })], { requestId: currentList });
  assert.equal(f.get('activity-course').textContent, 'Dentenberg');
  assert.equal(f.get('activity-export').disabled, true, 'late history cannot release an export in progress');
  f.result({ id: A, exported: true }); assert.equal(f.get('activity-strava').disabled, false);
  f.list([activity(B)], { requestId: currentList });
  assert.equal(f.get('activity-strava').disabled, false, 'duplicate old history cannot clear a current acknowledgement');
  f.close(); f.list([], { requestId: currentList });
  assert.equal(f.ui.isOpen, false); assert.equal(f.get('activity-course').textContent, 'Dentenberg');
});

uiTest('only the current export request and selected activity can unlock Strava', f => {
  f.open(); f.list(); f.export(); const oldExport = f.sent.at(-1).requestId;
  f.close(); f.open(); f.list([activity(A, { activeSeconds: 4000 })]); f.export();
  const currentExport = f.sent.at(-1).requestId;
  assert.notEqual(oldExport, currentExport);
  for (const reply of [
    { id: A, requestId: oldExport, exported: true },
    { id: B, requestId: currentExport, exported: true },
    { id: A, requestId: undefined, exported: true }
  ]) {
    f.result(reply);
    assert.equal(f.get('activity-export').disabled, true);
    assert.equal(f.get('activity-strava').disabled, true);
  }
  f.result({ id: A, requestId: currentExport, exported: true });
  assert.equal(f.get('activity-export').disabled, false); assert.equal(f.get('activity-strava').disabled, false);
  f.get('activities-refresh').click(); f.list([activity(A, { activeSeconds: 4100 })]);
  f.result({ id: A, requestId: currentExport, exported: true });
  assert.equal(f.get('activity-strava').disabled, true, 'duplicate export acknowledgement cannot authorize a refreshed summary');
});

uiTest('Strava launch waits for its own reply and recovers from a launch failure', f => {
  f.open(); f.list(); f.export(); const exportRequest = f.sent.at(-1).requestId;
  f.result({ id: A, exported: true }); f.get('activity-strava').click();
  const stravaRequest = f.sent.at(-1).requestId;
  assert.notEqual(stravaRequest, exportRequest); assert.equal(f.get('activities-refresh').disabled, true);
  f.get('activity-strava').click();
  assert.equal(f.sent.filter(message => message.action === 'activity-strava').length, 1, 'disabled button prevents duplicate browser requests');
  f.result({ id: A, requestId: exportRequest, exported: true });
  assert.equal(f.get('activity-strava').disabled, true, 'late export cannot finish the pending browser request');
  f.result({ id: A, requestId: stravaRequest, error: 'Could not open browser.' });
  assert.equal(f.get('activity-strava').disabled, false, 'valid saved export remains retryable');
  assert.equal(f.get('activities-refresh').disabled, false);
  assert.equal(f.get('activity-notice').textContent, 'Could not open browser.');
  f.get('activity-strava').click(); f.result({ id: A, notice: 'Strava upload page opened.' });
  assert.equal(f.get('activity-strava').disabled, false); assert.equal(f.ui.isOpen, true);
});

uiTest('empty, short and sample-limited activities never become exportable', f => {
  f.open(); f.list([]); assert.equal(f.get('activities-empty').hidden, false); assert.equal(f.get('activity-details').hidden, true);
  assert.equal(f.get('activity-export').disabled, true); assert.equal(f.get('activity-strava').disabled, true);
  f.get('activities-refresh').click(); f.list([activity(A, { canExport: false, activeSeconds: 0 })]); assert.equal(f.get('activity-export').disabled, true);
  assert.match(f.get('activity-recording-note').textContent, /few seconds/);
  f.get('activities-refresh').click(); f.list([activity(A, { canExport: false, truncated: true })]); assert.match(f.get('activity-recording-note').textContent, /limit/);
  f.export(); assert.equal(f.sent.filter(message => message.action === 'activity-export').length, 0);
});

uiTest('storage warnings retain an exportable in-memory ride and recoverable errors clear pending UI', f => {
  f.open(); f.list([activity(A, { isComplete: false })], { warning: 'Checkpoint could not be saved. Export before closing.', error: 'Saved history unavailable' });
  assert.equal(f.get('activity-export').disabled, false, 'host-supplied current ride remains usable despite storage failure');
  assert.match(f.get('activities-warning').textContent, /Checkpoint/); assert.equal(f.get('activity-notice').textContent, 'Saved history unavailable');
  f.get('activities-refresh').click(); f.list([], { error: 'Could not read saved rides.' });
  assert.equal(f.get('activities-refresh').disabled, false); assert.equal(f.get('activity-export').disabled, true);
  f.get('activities-refresh').click(); f.list([activity(A)]); assert.equal(f.get('activities-warning').textContent, '');
  assert.equal(f.get('activity-export').disabled, false); f.ui.receive(null); f.ui.receive({ type: 'heartbeat' });
});
