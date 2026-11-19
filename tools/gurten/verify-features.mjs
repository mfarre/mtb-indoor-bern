#!/usr/bin/env node
// Run from any directory with Node >= 18. An optional argument selects a Scene
// directory, allowing the same check against the native app's development copy.
// No browser, canvas, trainer, network or hardware connection is needed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const scene = process.argv[2]
  ? pathToFileURL(resolve(process.argv[2]) + '/')
  : new URL('../../src/MTBIndoorBern/Scene/', import.meta.url);
const json = async name => JSON.parse(await readFile(new URL(`courses/gurten/${name}`, scene), 'utf8'));
const [features, route, appearance] = await Promise.all([json('features.json'), json('route.json'), json('appearance.json')]);
const { gurtenLiftAt, gurtenWidthAt, gurtenCrossSectionAt, gurtenVegetationClearanceAt } = await import(new URL('gurten-features.js', scene));
const hash = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const initialRouteHash = hash(route), initialFeaturesHash = hash(features);
const freeze = object => { if (object && typeof object === 'object') { Object.values(object).forEach(freeze); Object.freeze(object); } return object; };
freeze(route); freeze(features);
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
const baseWidthAt = distance => (appearance.segments.find(s => distance >= s.from && distance < s.to) ?? appearance.segments.at(-1)).width;
const jumps = [...features.jumps].sort((a, b) => a.distance - b.distance);
let samples = 0, maxRampSlope = 0, minJumpGap = Infinity, minCrossingGap = Infinity;

assert.equal(jumps.length, 40, 'The documented set must contain 40 visual tables/rollers');
assert.equal(new Set(jumps.map(j => j.id)).size, jumps.length, 'Jump IDs must be unique');
assert.ok(route.points.length > 2);
route.points.forEach((point, i) => {
  for (const key of ['d', 'x', 'y', 'z', 'grade']) assert.ok(Number.isFinite(point[key]), `Finite route ${key} at ${i}`);
  if (i) assert.ok(point.d > route.points[i - 1].d, 'Route stationing increases');
});

for (let i = 0; i < jumps.length; i++) {
  const jump = jumps[i], start = jump.distance, end = start + jump.length;
  assert.ok(start >= 0 && end <= route.length && jump.length > 0, `${jump.id}: within route`);
  assert.ok(jump.height > 0 && jump.height <= 3, `${jump.id}: plausible model height`);
  if (i) { const gap = start - jumps[i - 1].distance - jumps[i - 1].length; assert.ok(gap > 0, 'Jump footprints do not overlap'); minJumpGap = Math.min(minJumpGap, gap); }
  for (const crossing of features.provenance?.crossingAnchorsM ?? []) {
    const gap = Math.max(start - crossing, crossing - end);
    assert.ok(gap >= 8, `${jump.id}: keep the mapped crossing free of constructed ramps`);
    minCrossingGap = Math.min(minCrossingGap, gap);
  }
  for (const d of [start, end]) {
    const baseWidth = baseWidthAt(d), section = gurtenCrossSectionAt(d, jump, baseWidth);
    near(gurtenLiftAt(d, features), 0, 1e-10, `${jump.id}: lift returns to DEM`);
    near(gurtenWidthAt(d, features, baseWidth), baseWidth, 1e-10, `${jump.id}: ribbon joins ordinary trail`);
    near(section.edge, baseWidth / 2, 1e-10, `${jump.id}: shoulder footprint also joins trail (no rectangular patch)`);
    const slope = (gurtenLiftAt(d + .001, features) - gurtenLiftAt(d - .001, features)) / .002;
    assert.ok(Math.abs(slope) < .002, `${jump.id}: smooth endpoint tangent`);
  }
  let peak = 0, previousHeight = 0, previousEdge = baseWidthAt(start) / 2;
  const count = Math.ceil(jump.length / .02);
  for (let k = 0; k <= count; k++) {
    const d = start + jump.length * k / count, baseWidth = baseWidthAt(d);
    const height = gurtenLiftAt(d, features), width = gurtenWidthAt(d, features, baseWidth), section = gurtenCrossSectionAt(d, jump, baseWidth);
    assert.ok(Number.isFinite(height) && height >= 0 && height <= jump.height + 1e-9, `${jump.id}: bounded lift`);
    assert.ok(width >= baseWidth && width <= Math.max(baseWidth, jump.width) + 1e-9, `${jump.id}: bounded ribbon width`);
    near(section.halfWidth * 2, width, 1e-9, `${jump.id}: road and earth deck agree`);
    near(section.lift, height, 1e-9, `${jump.id}: road/camera and earth height agree`);
    assert.ok(section.edge >= section.halfWidth && section.shoulder >= 0, `${jump.id}: shoulder remains outside riding line`);
    if (k) {
      const step = jump.length / count, slope = Math.abs(height - previousHeight) / step;
      assert.ok(slope < .8, `${jump.id}: continuous, rollable modeled ramp`);
      assert.ok(Math.abs(section.edge - previousEdge) / step < 2, `${jump.id}: smooth footprint taper`);
      maxRampSlope = Math.max(maxRampSlope, slope);
    }
    previousHeight = height; previousEdge = section.edge; peak = Math.max(peak, height); samples++;
  }
  near(peak, jump.height, .001, `${jump.id}: reaches documented crest height`);
  if (jump.kind !== 'roller') {
    const crestMiddle = start + jump.length * ((jump.crestStart ?? .34) + (jump.crestEnd ?? .60)) / 2;
    near(gurtenLiftAt(crestMiddle, features), jump.height, 1e-9, `${jump.id}: table has a full-height deck`);
  }
}

assert.equal(gurtenLiftAt(NaN, features), 0, 'Invalid position cannot raise camera');
assert.equal(gurtenWidthAt(NaN, features), 2.8);
const zones = [{ x: 0, z: 0, radius: 1.9 }, { x: 0, z: 0, x2: 0, z2: 14, radius: .85 }];
assert.ok(gurtenVegetationClearanceAt(0, 0, zones) < 0, 'Board footprint is clear');
assert.ok(gurtenVegetationClearanceAt(.8, 7, zones) < 0, 'Narrow sightline is clear');
assert.ok(gurtenVegetationClearanceAt(2, 7, zones) > 0, 'Forest remains beside sightline');
assert.ok(gurtenVegetationClearanceAt(0, 16, zones) > 0, 'Sightline does not extend past endpoint');
assert.equal(gurtenVegetationClearanceAt(0, 0, []), Infinity);
assert.ok(jumps.some(j => j.id === features.branding?.featureId), 'Branding refers to an actual modeled jump');
const logo = await readFile(new URL(`courses/gurten/${features.branding.logo}`, scene));
assert.equal(logo.subarray(1, 4).toString(), 'PNG', 'Official logo asset is a PNG');
assert.ok(features.previewDistance < features.branding.distance, 'Preview approaches the board');
assert.equal(hash(route), initialRouteHash, 'Feature calculations must preserve DEM elevations and trainer grades');
assert.equal(hash(features), initialFeaturesHash, 'Feature calculations must preserve descriptors');

console.log(JSON.stringify({
  status: 'PASS', scene: fileURLToPath(scene), jumps: jumps.length, berms: features.berms.length,
  samples, maxRampSlope: +maxRampSlope.toFixed(4), minJumpGapM: +minJumpGap.toFixed(2),
  crossingAnchors: features.provenance?.crossingAnchorsM?.length ?? 0,
  minCrossingGapM: Number.isFinite(minCrossingGap) ? +minCrossingGap.toFixed(2) : null,
  routeSha256: initialRouteHash,
  checks: ['bounded continuous lift', 'smooth zero-lift joins', 'continuous shoulder footprint',
    'road/deck cross-section agreement', 'non-overlapping jumps', 'crossings clear',
    'narrow vegetation exclusion', 'official logo present', 'DEM/grade data unchanged']
}, null, 2));
