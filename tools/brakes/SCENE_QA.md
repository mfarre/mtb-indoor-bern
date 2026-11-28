# Brake scene verification

Run the pure presentation and audio checks from the repository root:

```powershell
node tools/ride-presentation/brake-test.mjs
node tools/ride-audio/test.mjs
```

`scene-fixture.mjs` exports `brakeSceneFixture({ distance, length, epoch })`. The result is an array of `{ atMs, snapshot }` entries at 100 ms intervals. It can also print that array as JSON with `node tools/brakes/scene-fixture.mjs`. Set the starting distance to a forest section supported by the selected course.

An isolated scene host can send each `snapshot` using its ordinary WebView `PostWebMessageAsJson` bridge at the specified elapsed time. Use the real Scene modules and course assets. Do not attach the fixture to a running ride or route it through Bluetooth. Start with the first baseline packet so the confirmed-crash counter has a prior value. For audio, unlock the normal audio graph with the scene's sound button, or supply the same packets to its injected `OfflineAudioContext` API.

The fixture contains eight seconds of synthetic presentation data:

- 0–1 s: rolling normally; both pressures are zero.
- 1–2 s: rear pressure and host-reported rear skid. Check the rear bar, skid caution and audible tyre scrub.
- 2–2.4 s: hard front pressure and front-slip warning.
- 2.4–5.4 s: one front-lock crash, a three-second recovery and zero physical speed. At about 3.0 s the camera should be near the ground, tipped down and sideways, with the recovery banner visible. It stays above the terrain.
- 5.4–8 s: camera upright again and normal rolling resumes. There should be no repeated crash or delayed drivetrain sound.

Every packet is explicitly in demo mode, with a visible **SYNTHETIC BRAKE QA · no Bluetooth or trainer control** status. This verifies the scene/audio response to host state; it does not validate physical levers, braking dynamics or sensor calibration.

For lifecycle checks, stop sending packets for more than 500 ms: the camera effect and live pressure display must clear, while audio begins its scheduled fade after 0.9 s. Send a paused snapshot during recovery, or change `presentationEpoch` for a seek: neither should replay the crash on resume. `crashKind: 'corner'` retains the existing runout presentation rather than the front-lock fall. Repeat in Stable camera mode and with it disabled; the stable setting reduces tilt but keeps the fall visible.

`physicalSpeedKmh` drives audio intensity. An accelerated demo route speed must not amplify a skid or alter the host's crash thresholds. The fixture uses a speed multiplier of one for easy comparison. No chain/freehub loop is present; the short gear click still requires a separate confirmed `shiftSequence` event.
