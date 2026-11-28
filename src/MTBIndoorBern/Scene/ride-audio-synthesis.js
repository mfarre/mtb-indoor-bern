// Original deterministic procedural sound design. These are not field recordings.
// The v4 graph uses the existing skid buffer for host-reported wheel slip.
// Confirmed-shift clicks remain brief; freehub/chain buzz stays absent.
// Buffers are generated once; persistent looping voices are crossfaded by ride-audio.js.
export function synthesizeRideBuffer(kind, sampleRate = 48000) {
  const durations = { earth: 7.13, gravel: 6.71, asphalt: 5.83, leaves: 7.79, wind: 8.37, brake: 4.53, skid: 5.37, gear: .095 };
  const seconds = durations[kind];
  if (!seconds || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Invalid ride buffer');
  const count = Math.round(seconds * sampleRate), data = new Float32Array(count);
  let seed = [...kind].reduce((s, ch) => Math.imul(s, 31) + ch.charCodeAt(0), 20261128) >>> 0;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  let low = 0, slow = 0, grain = 0;
  const lowAlpha = 1 - Math.exp(-2 * Math.PI * 1200 / sampleRate), slowAlpha = 1 - Math.exp(-2 * Math.PI * 120 / sampleRate);
  const grainDecay = Math.exp(-1 / (sampleRate * (kind === 'leaves' ? .024 : .004)));
  const grainRate = { earth: 29, gravel: 110, asphalt: 0, leaves: 40, wind: 0, brake: 0, skid: 48, gear: 0 }[kind];
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate, white = random() * 2 - 1;
    low += (white - low) * lowAlpha;
    slow += (white - slow) * slowAlpha;
    if (random() < grainRate / sampleRate) grain += .3 + random() * .8;
    grain *= grainDecay;
    const undulate = .78 + .14 * Math.sin(t * 2.17) + .08 * Math.sin(t * 5.43 + 2);
    let value;
    switch (kind) {
      case 'wind': value = slow * (1.4 + .35 * Math.sin(t * 1.73) + .2 * Math.sin(t * 3.29)); break;
      case 'asphalt': value = .6 * low + .35 * slow; break;
      case 'earth': value = (.55 * low + .8 * slow + white * grain * .18) * undulate; break;
      case 'gravel': value = (.6 * low + white * grain * .6 + slow * .45) * undulate; break;
      case 'leaves': value = (white - .6 * low) * (.11 + grain * .7) * undulate; break;
      case 'brake': value = (white - low) * (.35 + .1 * Math.sin(t * 67)) + low * .15; break;
      case 'skid': value = (white - slow) * (.2 + grain * .3) * undulate; break;
      case 'gear': {
        const envelope = Math.exp(-t * 115) + (t > .024 ? .45 * Math.exp(-(t - .024) * 190) : 0);
        value = (white * .5 + Math.sin(t * 2 * Math.PI * 1250) * .35 + low * .2) * envelope; break;
      }
    }
    data[i] = value;
  }
  // Remove DC, standardise level, and taper loop seams. No random work runs in the animation frame.
  let mean = 0, energy = 0; for (const v of data) mean += v; mean /= count;
  for (const v of data) energy += (v - mean) ** 2;
  const scale = .22 / Math.max(.001, Math.sqrt(energy / count));
  const seam = Math.round(sampleRate * (kind === 'gear' ? .001 : .012));
  for (let i = 0; i < count; i++) {
    const fade = Math.min(1, i / seam, (count - i - 1) / seam);
    data[i] = Math.tanh((data[i] - mean) * scale) * fade;
  }
  return data;
}
