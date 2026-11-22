# Downhill visual verification

[Downhill behaviour](../../docs/downhill.md) · [Simulator](../../docs/simulator.md)

These tools use the application's source and local Al Dente data. They do not open Bluetooth connections or control the KICKR.

`node tools/downhill/verify-ground.mjs` checks that terrain does not cover the rider and that the road matches the physical altitude at the sample points. It requires local `route.json` and `world.json` files.

## Historical capture harness

`prepare-capture.py` produced the 19 November downhill captures. **Its timer replacement predates the calibration integration and must be updated before relying on deterministic capture with the current source.** The script looks for the old `Ride.Tick(now - lastTick)` statement; the current `RidePanel.cs` uses a separate `dt` and calibration tick. Do not treat a successful build alone as validation of frame timing or automatic braking.

The original capture workflow is retained here for reference:

```powershell
python tools/downhill/prepare-capture.py brake
dotnet publish artifacts/downhill/brake/source/MTBIndoorBern.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o artifacts/downhill/brake/app
```

Open `artifacts/downhill/brake/app/MTBIndoorBern.exe` from the Windows desktop. The intended sequence rides the approach in practice mode, brakes ahead of corners, captures 110 frames at 0.1-second simulation intervals, then closes. It waits for the view and screenshot to finish before advancing physics so that capture cost does not speed up the video. PNGs, states and the summary are written to `artifacts/downhill/brake/capture/`. Recheck these behaviours after updating the timer injection.

Available scenarios are `brake` (early braking), `runout` (the same start without braking), `climb` (prominent grade display) and `welcome` (home screen). Capture positions are prepared for Al Dente. The test copy adds capture mode to `Program.cs` and `RidePanel.cs`; it does not modify the original source or regular installation.

After verifying a complete frame sequence, an eight-second GIF can be generated with FFmpeg:

```powershell
ffmpeg -framerate 10 -start_number 20 -i artifacts/downhill/brake/capture/frame-%04d.png -t 8 -filter_complex "fps=8,scale=800:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none" -loop 0 artifacts/downhill/braking.gif
```

Files in `artifacts/` are local and excluded from Git. The [renderer comparison tool](../render-comparison/README.md) provides a separate workflow for positional visual comparisons.
