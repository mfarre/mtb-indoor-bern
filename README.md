# MTB Indoor - Bern

**Ride Swiss trails indoors. Record the outdoors. Explore better controls.**

A Windows MTB simulator with real elevation data, aerial imagery, direct Bluetooth trainer control and configurable MTB gearing. Alongside the simulator, this repository contains **Track Lab** for trail data collection and a **Bluetooth brake research** section.

[Simulator](docs/simulator.md) · [Data acquisition](docs/data-acquisition.md) · [Bluetooth brakes](docs/bluetooth-brakes.md) · [Development log](DEVELOPMENT_LOG.md) · [Documentation index](docs/README.md)

![Animated ride through the Gurtentrail, featuring the El Tony jump and signage](docs/images/gurten-trail.gif)

*Gurten: Il Brunello → Gurten → Gurtentrail. Real map and elevation data, recreated vegetation and approximate jump geometry.*

## Three parts of the project

| [01 · Simulator](docs/simulator.md) | [02 · Data acquisition](docs/data-acquisition.md) | [03 · Bluetooth brakes](docs/bluetooth-brakes.md) |
| --- | --- | --- |
| **The main application.** Ride local trails with a KICKR, MTB gears, heart rate and downhill braking. Explore without sensors in demo mode. | **Track Lab and import tools.** Align action-camera footage with FIT data, annotate trail surfaces and extract reference frames. | **Controls and hardware research.** The right Zwift Click 2 already provides button braking. A dedicated brake-lever accessory is being explored. |
| [Setup and controls →](docs/simulator.md#build-and-run) | [Workflow and hardware →](docs/data-acquisition.md) | [Current support and hardware →](docs/bluetooth-brakes.md) |

## Ride now

**Uetliberg and Gurten are included in the public repository.** Dentenberg / Al Dente is available in the local installation; its personal route and recording assets are not distributed.

| Course | Distance | Experience |
| --- | ---: | --- |
| [Gurten](docs/GURTEN.md) | 6.53 km | Climb from Kehrsatz, then descend the Gurtentrail to Wabern |
| [Uetliberg](docs/simulator.md#courses-and-data) | 25.75 km | Zurich, Triemli, Uto Kulm and Ringlikon |
| Dentenberg / Al Dente | 12.24 km | Local woodland loop, informed by a recorded ride |

On Windows with the [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) and [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) installed:

```powershell
.\build.ps1 -SelfTest
.\artifacts\publish\win-x64\MTBIndoorBern.exe
```

Select a course and choose **Explore in demo**. Pause, click the elevation profile to seek, resume, or accelerate up to ×8. On Gurten, **El Tony ↗** jumps directly to the featured section. Demo does not control the trainer.

[Full setup and controls](docs/simulator.md) · [Bike profile and calibration](docs/bike-calibration.md) · [Downhill braking and records](docs/downhill.md)

## From trail recording to new controls

| Track Lab · working tool | Bluetooth brake accessory · concept |
| --- | --- |
| [![Track Lab aligns the ride video and FIT route](docs/images/track-lab.png)](docs/data-acquisition.md) | [![Concept render of an unbuilt Bluetooth brake-lever accessory](docs/images/bluetooth-brake-concept.png)](docs/bluetooth-brakes.md) |
| [Camera/FIT alignment, annotations and hardware links](docs/data-acquisition.md) | [Existing Click support, design discussion and hardware references](docs/bluetooth-brakes.md) |

The brake image above is an AI-generated concept, not a photograph or a validated hardware design.

[![Maneta v01 brake lever pulling and returning, rendered from the supplied STL design](docs/images/bluetooth-brake-v01-motion.gif)](docs/bluetooth-brakes.md#maneta-v01-render-from-the-actual-design)

**Maneta v01: the actual mechanical design in motion.** A looping Blender render of the lever pulling and returning, based on the supplied STL files and assembly drawings. [Animation, original still and CAD reference](docs/brake-v01-render.md). Physical testing and custom BLE integration are still pending.

The simulator, Track Lab, documentation and current screenshots are in English.

## Follow development

The **[development log](DEVELOPMENT_LOG.md)** contains the full milestone history, screenshots, before/after GIFs, verification results and known limitations. It is updated when a milestone is complete, with planning work identified separately.

Start with the [documentation index](docs/README.md) for guides, developer tools and verification reports. Geodata, images and third-party libraries are documented in [Third-party notices](THIRD_PARTY_NOTICES.md).

Built and tested with a **Wahoo KICKR CORE**, **right Zwift Click 2** and **Garmin HRM-Dual**. Other trainers and the left Click have not been validated. This is an independent project; it is not an official Wahoo, Zwift or Garmin integration.
