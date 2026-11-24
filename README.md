# MTB Indoor - Bern

**Ride Swiss trails indoors. Record the outdoors. Explore better controls.**

A Windows MTB simulator with real elevation data, aerial imagery, direct Bluetooth trainer control and configurable MTB gearing. Alongside the simulator, this repository contains **Track Lab** for trail data collection and a **Bluetooth brake research** section.

[Simulator](docs/simulator.md) · [Data acquisition](docs/data-acquisition.md) · [Bluetooth brakes](docs/bluetooth-brakes.md) · [Development log](DEVELOPMENT_LOG.md) · [Documentation index](docs/README.md)

![Animated ride through the Gurtentrail, featuring the El Tony jump and signage](docs/images/gurten-trail.gif)

*Gurten: Il Brunello → Gurten → Gurtentrail. Real map and elevation data, recreated vegetation and approximate jump geometry.*

## Three parts of the project

| [01 · Simulator](docs/simulator.md) | [02 · Data acquisition](docs/data-acquisition.md) | [03 · Bluetooth brakes](docs/bluetooth-brakes.md) |
| --- | --- | --- |
| **The main application.** Ride local trails with a KICKR, MTB gears, heart rate and downhill braking. Explore without sensors in demo mode. | **Track Lab and import tools.** Align action-camera footage with FIT data, annotate trail surfaces and extract reference frames. | **Printable levers and a Bluetooth bench.** Assemble AS5600 controls, wire a TCA9548A and T-Beam Supreme, then inspect both sensors in a browser. Click button braking remains the implemented simulator input. |
| [Setup and controls →](docs/simulator.md#build-and-run) | [Workflow and hardware →](docs/data-acquisition.md) | [Current support and hardware →](docs/bluetooth-brakes.md) |

## Ride now

**Uetliberg, Gurten and Eiger Bike Challenge 20 km are included in the public repository.** Dentenberg / Al Dente is available in the local installation; its personal route and recording assets are not distributed.

| Course | Distance | Experience |
| --- | ---: | --- |
| [Gurten](docs/GURTEN.md) | 6.53 km | Climb from Kehrsatz, then descend the Gurtentrail to Wabern |
| [Uetliberg](docs/simulator.md#courses-and-data) | 25.75 km | Zurich, Triemli, Uto Kulm and Ringlikon |
| [Eiger Bike Challenge 20 km](docs/EIGER.md) | 19.48 km | Alpine summer around Grindelwald, race scenery and three selectable starting sectors |
| Dentenberg / Al Dente | 12.24 km | Local woodland loop, informed by a recorded ride |

On Windows with the [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) and [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) installed:

```powershell
.\build.ps1 -SelfTest
.\artifacts\publish\win-x64\MTBIndoorBern.exe
```

Select a course and choose **Explore in demo**. Pause, click the elevation profile to seek, resume, or accelerate up to ×8. On Gurten, **El Tony ↗** jumps directly to the featured section. Demo does not control the trainer.

On **Eiger Bike Challenge 20 km**, choose the whole course or start from any of its three sectors before riding or exploring in demo. [Eiger route and sector guide](docs/EIGER.md).

[Full setup and controls](docs/simulator.md) · [Bike profile and calibration](docs/bike-calibration.md) · [Downhill braking and records](docs/downhill.md)

## From trail recording to new controls

| Track Lab · working tool | Bluetooth brake prototype · Maneta v01 |
| --- | --- |
| [![Track Lab aligns the ride video and FIT route](docs/images/track-lab.png)](docs/data-acquisition.md) | [![Maneta v01 prototype rendered directly from its printable STL parts](docs/images/bluetooth-brake-v01-cad.png)](docs/bluetooth-brakes.md#maneta-v01) |
| [Camera/FIT alignment, annotations and hardware links](docs/data-acquisition.md) | [Prototype assembly, wiring, firmware and hardware references](docs/bluetooth-brakes.md#maneta-v01) |

The brake view above uses the printable Maneta v01 meshes. It illustrates the prototype geometry; physical validation remains pending.

[![Maneta v01 brake lever pulling and returning, rendered from the supplied STL design](docs/images/bluetooth-brake-v01-motion.gif)](docs/bluetooth-brakes.md#maneta-v01)

**Maneta v01: the actual mechanical design in motion.** A looping Blender render of the lever pulling and returning, based on the supplied STL files and assembly drawings. [Animation, original still and CAD reference](docs/brake-v01-render.md). Physical electronics testing and proportional simulator integration are still pending.

**[Read the Maneta v01 assembly guide →](docs/bluetooth-brakes.md#maneta-v01)**

The illustrated guide is part of the Bluetooth brakes document, directly below **Maneta v01**. It covers assembly, wiring, firmware installation and Bluetooth diagnostics in GitHub Markdown. Download the [printable parts](hardware/maneta-v01/), build the [T-Beam Supreme firmware](firmware/brake-bench/), and open the **[Bluetooth bench tester](https://mfarre.github.io/mtb-indoor-bern/workshop/tester/)** in desktop Chrome or Edge. The tester includes a clearly labelled demo, raw angle and magnetic-health readings, endpoint calibration and local CSV export. Physical electronics verification and proportional-brake integration with the simulator remain separate steps.

The simulator, Track Lab, documentation and current screenshots are in English.

## Follow development

The **[development log](DEVELOPMENT_LOG.md)** contains the full milestone history, screenshots, before/after GIFs, verification results and known limitations. It is updated when a milestone is complete, with planning work identified separately.

Start with the [documentation index](docs/README.md) for guides, developer tools and verification reports. Geodata, images and third-party libraries are documented in [Third-party notices](THIRD_PARTY_NOTICES.md).

Built and tested with a **Wahoo KICKR CORE**, **right Zwift Click 2** and **Garmin HRM-Dual**. Other trainers and the left Click have not been validated. This is an independent project; it is not an official Wahoo, Zwift or Garmin integration.
