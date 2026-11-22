# Animated renderer comparisons

[Simulator](../../docs/simulator.md) · [Development log](../../DEVELOPMENT_LOG.md)

`RenderCapture` loads the `ForestRenderer` from any local copy of `Scene`. It captures frames at exact positions without sensors or Bluetooth connections. Both sequences use the same camera, route, resolution and speed. Each frame is rendered by its corresponding engine; this is not an animated duplicate of a still image.

Requirements: Windows, .NET 10 SDK, WebView2, Python with Pillow and FFmpeg. Both complete `Scene` directories must be available, including local course data. Originals are preserved; a working `_scene` copy is created inside each output folder.

From the repository root:

```powershell
dotnet publish tools/render-comparison/RenderCapture.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o artifacts/render-capture
```

Create two JSON files with the following schema, changing `SceneFolder` and `OutputFolder` for each version. Use absolute paths. The output must be outside `SceneFolder`.

```json
{
  "SceneFolder": "C:/MTB/previous-version/Scene",
  "OutputFolder": "C:/MTB/captures/before",
  "StartMeters": 4300,
  "SpeedMps": 6.2,
  "Seconds": 10,
  "Fps": 12,
  "CourseId": "al-dente"
}
```

Run the captures one after another, waiting for each window to finish and close:

```powershell
Start-Process -Wait artifacts/render-capture/RenderCapture.exe -ArgumentList 'C:/MTB/before.json'
Start-Process -Wait artifacts/render-capture/RenderCapture.exe -ArgumentList 'C:/MTB/after.json'
python tools/render-comparison/compose.py C:/MTB/captures/before C:/MTB/captures/after docs/images/al-dente-before-after.gif --ffmpeg C:/Tools/ffmpeg/bin/ffmpeg.exe
```

Without arguments, the executable reads `capture.json` beside itself. Each capture generates numbered PNGs and `capture-report.json`; failures produce `error.txt`. Use a new folder when repeating a capture to avoid mixing results. The compositor checks that both sequences contain every frame and have matching parameters, then creates a looping GIF and an intermediate PNG.

The historical GIF in the development log compares the engine before the autumn update with the updated local installation. The section is an observed forest singletrack between km 4.30 and 4.35. Capture uses 960×540 per version at 12 fps; the compositor limits the GIF to the first eight seconds, 10 fps and 800 pixels of total width, with a 128-colour palette to limit file size. Course data, `_scene` copies and reports containing local paths are not published. New captures use English overlay labels. Historical captures retain the interface shown at the time; use the current screenshots in the main guides to see the English application.
