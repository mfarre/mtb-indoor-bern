# Track Lab

[Data acquisition](data-acquisition.md) · [Project overview](../README.md)

A local video and FIT viewer for studying a route before recreating it in 3D. Track Lab is separate from the simulator: it does not connect to or control sensors. The interface and the controls described below are in English.

## Using the viewer

1. Select **Import FIT and videos**: choose a FIT file, or a ZIP containing a single FIT file, and the video folder. Specify whether the new videos need a 180° rotation.
2. The importer copies all originals into a new session and verifies each copy with SHA-256. It extracts the FIT file and creates preview videos and one thumbnail per minute. Short clips are supported too.
3. Select a thumbnail or move the video timeline. The map shows the GPS point nearest the video time, including the clock offset.
4. Adjust **FIT time = camera time + seconds**. Find a stop or a recognisable location. Positions are not interpolated across long gaps in the FIT recording.
5. Select **Mark**, then enter the segment end, surface, estimated width and observations. **Save observation** writes `annotations.json` into the session.
6. **Extract frame** saves a correctly oriented JPEG in `details/`. When a matching LRF exists, extraction uses the full-resolution original MP4.
7. **Export JSON** makes the annotations available when preparing a course's appearance. Exporting does not automatically modify the game.

Video rotation happens in the viewer without changing the originals; extracted JPEGs contain the rotated pixels. MP4 files in `preview/` are working files whose orientation is applied during playback. H.264 LRF files are remuxed without re-encoding. Other codecs are converted to 720p H.264 when necessary.

## Reference course and limitations

`config.json` can point to a simulator `route.json`. The decoder compares position, direction and continuity against that route. The viewer associates a point with the course only when its spatial error is 12 m or less; other points are shown as a variant. Annotation distances refer to the reference course. Without a reference course, FIT distances are used instead.

GPS proximity does not validate clock synchronisation. For the 14 November 2026 session, the long stop supported an estimated offset of **−226 seconds, with approximately 10 seconds of uncertainty**. The central section follows a different variant from the earlier course. Widths and surfaces are visual estimates, not a topographic survey.

Videos must contain a `creation_time` date and time. This version's importer is designed for FIT files and DJI LRF/MP4 recordings. It does not import GPX files or automatically generate a 3D course. The [separate GPX tools](../tools/course-import/README.md) prepare map-based courses.

## Build

Requirements: .NET 10 SDK, WebView2 Runtime, Python 3 with Pillow, Node.js, FFmpeg and FFprobe in the same directory, and the Garmin FIT SDK for JavaScript. The viewer does not require an external server.

```powershell
python -m pip install Pillow
npm install --prefix artifacts/track-lab-deps --ignore-scripts @garmin/fitsdk@21.221.0
.\tools\track-lab\build.ps1 -FitSdkPath .\artifacts\track-lab-deps\node_modules\@garmin\fitsdk -FfmpegPath C:\Tools\ffmpeg\bin\ffmpeg.exe
.\artifacts\track-lab\TrackLab.exe
```

FFmpeg is available through the Windows links on its [official download page](https://ffmpeg.org/download.html). The build script accepts `-PythonPath`, `-NodePath`, `-DotnetPath`, `-SessionsRoot`, `-DefaultSession` and `-Course`. These paths are written into `config.json` and must match the local PC. An empty initial session displays the open and import buttons.

The source and example screenshots are included in this repository. Full videos, working sessions, Bluetooth pairings and original FIT files remain local. See the [hardware and acquisition workflow](data-acquisition.md) for device references and planned support for additional sensor streams.
