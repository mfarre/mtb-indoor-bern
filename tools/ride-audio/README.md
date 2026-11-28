# Ride audio verification

Run `node tools/ride-audio/test.mjs`. The test imports the actual browser modules and needs no packages, audio device or Bluetooth connection.

The audio uses original, deterministic procedural buffers with a version 4 playback adapter. These are synthesized textures, **not recordings from Gurtentrail**. No external samples are bundled. Four rolling layers (earth, gravel, asphalt and leaves), wind, brake friction and tyre scrub/skid are persistent sources; speed and surface change their gains and playback rate smoothly. A brief gear-change click plays only for a confirmed successful shift. The freehub and chain buzz remain removed: there is no continuous drivetrain source or freehub synthesis. Version 4 keeps the same seven loop buffers and uses the host's `frontSlip` and `rearSlip` to make a wheel skid clearer than ordinary corner scrub. Pressure alone does not invent a wheel lock, and a stopped wheel is silent.

`RideSession` publishes the surface under the bike rather than the next corner's surface. Sound uses speed, surface and braking information; cadence, power and coasting do not produce a drivetrain layer. The host's `physicalSpeedKmh` keeps accelerated preview travel separate from wheel speed. Older snapshots fall back to dividing preview speed by the demo multiplier. Practice uses its simulated speed. Presentation never feeds values back into physics, trainer load, Bluetooth or calibration.

The host also publishes applied `frontBrake` and `rearBrake` values. These can increase brake friction, while normalized wheel-slip values drive the skid layer and its filter. All use the existing mute, lifecycle, stale-stream and failure containment paths. No additional recurring or one-shot drivetrain sounds are introduced.

The graph starts only after `unlock()` in a user gesture. Call it without awaiting before the ride action. Audio errors and rejected resume promises are contained. A paused, stopped or hidden view fades out; every fresh host snapshot also schedules a fade on the audio timeline after 0.9 seconds, so a blocked rendering thread cannot leave sound running indefinitely. Seek/start/reset epochs reject retired snapshots. Defaults are 35% volume and sound enabled after the gesture; mute and volume are saved separately from bike calibration.

## Confirmed shift feedback

The host publishes a monotonic `shiftSequence` counter, incremented only when `RideSession.Shift` actually changes the clamped gear. Pressing a button at the cassette limit does not increment it. Profile restoration, seeking and resume do not generate shift events. Audio never treats a pointer press or a changed displayed gear number as proof of a shift.

A greater counter in a fresh, ordered snapshot during continuous riding produces one 95 ms synthesized clack. If several successful shifts occur between host snapshots, their packet produces one click rather than a delayed burst. Repeated packets, old counters and retired session epochs cannot replay the sound. The first packet, a new session, seeking, resume and recovery from a stale host stream establish a silent baseline. Muted, zero-volume, hidden or suspended playback consumes confirmed events without queuing them for later.

The one-shot source is stopped and disconnected after playback, and active clicks are stopped on lifecycle discontinuities. Its errors stay inside the optional audio subsystem. Tests cover host-confirmed shifts, cassette-limit and profile changes, repeated and malformed counters, lifecycle/mute behaviour and the continued absence of a freehub loop.

## Rendering the real graph offline

Run this in a browser served from the app's `Scene` directory, using snapshots recorded from the matching visual run. `atSeconds` is an ascending audio-context time, not the host timestamp. Include a state at least every 0.1 seconds and a final paused state for a smooth ending.

```js
const { createRideAudio } = await import('./ride-audio.js');
const sampleRate = 48000;
const context = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
const audio = createRideAudio({ context, watch: false });
await audio.unlock();
for (const { atSeconds, snapshot } of snapshots) audio.update(snapshot, atSeconds);
const buffer = await context.startRendering();
// Encode buffer.getChannelData(0/1) as a stereo PCM WAV for the comparison video.
audio.dispose();
```

This uses the same sources, filtering, level smoothing, watchdog and state adapter as live playback. It does not substitute an unrelated soundtrack. Injected contexts remain owned by the caller. A future recording-based sound pack can replace the versioned synthesis while preserving this API and the fail-safe presentation boundary.
