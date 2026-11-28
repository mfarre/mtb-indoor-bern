# Renderer comparisons, benchmarks and audio exports

[Simulator](../../docs/simulator.md) · [El Tony pilot](../../docs/el-tony-pilot.md) · [Audio implementation](../ride-audio/README.md) · [Development log](../../DEVELOPMENT_LOG.md)

`RenderCapture` loads the actual `ForestRenderer` from a local copy of `Scene`, without sensors or Bluetooth connections. It has three distinct modes:

| Mode | Output | Purpose |
| --- | --- | --- |
| `capture` | Numbered PNG frames and `capture-report.json` | Compare images at exact route positions and a fixed camera timestep. Export duration does not measure real-time performance. |
| `benchmark` | `benchmark-report.json` and one final `benchmark.png` | Measure a real-time renderer loop after warm-up. No screenshot work runs inside the measured loop. |
| `audio` | `ride-audio.wav` and `audio-report.json` | Render the application's sound graph offline on the matching coasting trajectory. This requires a Scene version containing `ride-audio.js`. |

Each frame comes from its corresponding renderer, rather than animating a still image. Keep route data, camera timing, resolution and speed identical when comparing versions.

## Build and configuration

Requirements: Windows, .NET 10 SDK, WebView2 Runtime, and complete `Scene` directories for both versions. Composition additionally uses Python with Pillow and FFmpeg. The published capture executable is self-contained. Run from the repository root:

```powershell
dotnet publish tools/render-comparison/RenderCapture.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o artifacts/render-capture
```

Create a JSON configuration file using absolute paths. Use a fresh output directory outside `SceneFolder` for every run. The tool preserves the source and creates a working `_scene` copy in the output directory.

```json
{
  "SceneFolder": "C:/MTB/previous-version/Scene",
  "OutputFolder": "C:/MTB/captures/el-tony-before",
  "Mode": "capture",
  "CourseId": "gurten",
  "StartMeters": 4970,
  "SpeedMps": 6.2,
  "Seconds": 45,
  "Fps": 12,
  "Width": 960,
  "Height": 540,
  "WarmupSeconds": 5
}
```

For the after configuration, change `SceneFolder` and `OutputFolder` only. The example covers km 4.97–5.25, inside the El Tony pilot's km 4.97–5.31 window. Keep the full trajectory within the course. Start the runs sequentially and wait for each window to close:

```powershell
Start-Process -Wait artifacts/render-capture/RenderCapture.exe -ArgumentList 'C:/MTB/el-tony-before.json'
Start-Process -Wait artifacts/render-capture/RenderCapture.exe -ArgumentList 'C:/MTB/el-tony-after.json'
```

Without an argument, the executable reads `capture.json` beside itself. A failed run writes `error.txt`; inspect it rather than using an incomplete sequence.

| Field | Meaning and limits |
| --- | --- |
| `Mode` | `capture`, `benchmark` or `audio`; defaults to `capture` |
| `CourseId` | Course identifier from the selected Scene's `courses.json` |
| `StartMeters` | Non-negative route position |
| `SpeedMps` | Positive travel speed, up to 50 m/s |
| `Seconds` | 1–60 seconds of output or measurement |
| `Fps` | 1–60; capture sampling rate or benchmark pacing target |
| `Width`, `Height` | Render window size; 320–2560 by 180–1440; defaults 960×540 |
| `WarmupSeconds` | 0–10; benchmark-only warm-up, default 5 seconds |

## Real-time benchmark

Use a new output folder, set `Mode` to `benchmark`, and choose the intended target, for example `Fps: 30`, `Seconds: 30` and `WarmupSeconds: 5`. Run both versions with the same settings, on the same PC, under comparable display and foreground-window conditions. The benchmark fixes pixel ratio to 1; it does not exercise the full application's adaptive quality changes.

The report includes delivered frame rate, frame-interval percentiles, synchronous CPU submission percentiles, stalls, canvas dimensions, available GPU identification and renderer statistics. **CPU submission duration is not GPU execution time or display latency.** The one final screenshot is taken after timing finishes.

This is a renderer-only benchmark: it excludes the app HUD, host snapshot interpolation, Bluetooth, trainer control and live audio. It therefore cannot establish the frame rate of an entire connected training session. Report the hardware, source revisions, resolution, pixel ratio, warm-up, duration and target alongside measured results. The capture GIF's playback frame rate and PNG export speed must never be presented as benchmark results. [Recorded El Tony results](../../docs/el-tony-pilot.md#verification-and-performance) include the remaining isolated hitch.

## Sound from the application's graph

Create an additional configuration using the **after** Scene, `Mode: "audio"`, a new output folder and the same `CourseId`, `StartMeters`, `SpeedMps` and `Seconds` as the image capture. Audio export renders at 48 kHz, stereo, 16-bit PCM; `Fps` is not its sampling rate.

The exporter supplies a snapshot every 0.1 seconds to `createRideAudio({context, watch:false})` with an `OfflineAudioContext`. It follows the same distance/time trajectory as the images, reads the actual under-wheel surface from the course renderer's metadata, and explicitly selects a synthetic coasting state. It pauses for the final 0.4 seconds to produce a gentle ending. The result uses the same sources, filters and gain transitions as the app, including default volume and stale-data behaviour.

This soundtrack is original procedural synthesis. It is not a microphone recording, live KICKR telemetry or evidence of a physical-device test. The comparison's coasting trajectory deliberately contains no gear changes, braking or invented jump impacts. `audio-report.json` records the method, duration, sample format, peak and RMS level. See [audio provenance and verification](../ride-audio/README.md).

## Compose the comparison

Use 960×540 source frames with the current compositor. It validates matching trajectory, frame counts and dimensions, then combines the versions side by side with **Previous version** and **El Tony pilot** labels. Pass the matching `ride-audio.wav` for the MP4 soundtrack:

```powershell
python tools/render-comparison/compose.py C:/MTB/captures/el-tony-before C:/MTB/captures/el-tony-after docs/images/el-tony-pilot-comparison.mp4 --ffmpeg C:/Tools/ffmpeg/bin/ffmpeg.exe --audio C:/MTB/captures/el-tony-audio/ride-audio.wav --gif-start 14 --gif-seconds 8
```

The output argument must end in `.mp4`. This example exports the complete 45-second sequence at its captured 12 fps, plus an 8-second silent GIF excerpt beginning at 14 seconds. The MP4 is 1120 pixels wide; the GIF is 800 pixels wide. The MP4 uses H.264 video and AAC audio; the GIF uses 10 fps and a 128-colour palette. The same output stem also produces a comparison PNG from the middle of the GIF excerpt and a JSON manifest with trajectory, timing, file sizes and method. `--audio` is optional; omit it for a silent MP4. `--font` selects an alternative TrueType font if Segoe UI is unavailable.

Before publishing, verify the output duration, inspect the image around the sign, and listen to the MP4 soundtrack. Published El Tony media:

- [Before still](../../docs/images/el-tony-pilot-before.png) and [after still](../../docs/images/el-tony-pilot-after.png), selected from the matching source frame pair.
- [Animated comparison](../../docs/images/el-tony-pilot-comparison.gif), an excerpt around the jump and sign.
- [Full comparison video](../../docs/images/el-tony-pilot-comparison.mp4), with the offline rendering of the app's sound graph.

Source `_scene` copies, working course data and reports containing local paths are not publication assets. The older Al Dente GIF in the development log remains a historical comparison of the autumn renderer; it is separate from this El Tony pilot.
