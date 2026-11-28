# Ride audio verification

Run `node tools/ride-audio/test.mjs`. The test imports the actual browser modules and needs no packages, audio device or Bluetooth connection.

The audio uses original, deterministic procedural buffers, version 2. These are synthesized textures, **not recordings from Gurtentrail**. No external samples are bundled. Four rolling layers (earth, gravel, asphalt and leaves), wind, brake friction and corner scrub are persistent sources; speed and surface change their gains and playback rate smoothly. Version 2 removes the freehub buzz and gear-shift clacks at the rider's request. There is no drivetrain source or shift-event trigger, and changing gears or coasting cannot add one. The remaining sounds retain their previous levels and synthesis. There are no invented jump landings or wheel-lock telemetry.

`RideSession` publishes the surface under the bike rather than the next corner's surface. Sound uses speed, surface and braking information; cadence, power and coasting do not produce a drivetrain layer. Accelerated preview travel is divided by its demo multiplier for sound. Practice uses its simulated speed. Presentation never feeds values back into physics, trainer load, Bluetooth or calibration.

The graph starts only after `unlock()` in a user gesture. Call it without awaiting before the ride action. Audio errors and rejected resume promises are contained. A paused, stopped or hidden view fades out; every fresh host snapshot also schedules a fade on the audio timeline after 0.9 seconds, so a blocked rendering thread cannot leave sound running indefinitely. Seek/start/reset epochs reject retired snapshots. Defaults are 35% volume and sound enabled after the gesture; mute and volume are saved separately from bike calibration.

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
