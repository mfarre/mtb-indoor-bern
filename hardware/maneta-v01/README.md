# Maneta v01 printable parts

[Online assembly and wiring guide](https://mfarre.github.io/mtb-indoor-bern/workshop/) · [Bluetooth brake project](../../docs/bluetooth-brakes.md)

An indoor simulator lever with a rotating diametric magnet, fixed AS5600 angle sensor, extension spring and rubber end stop. The files describe a prototype; printed fit, clamp performance and return behaviour need a physical check.

## Print one hand

Use one folder: `STL/dreta` for the right hand, or `STL/esquerra` for the left. Dimensions are in millimetres and meshes are in print orientation. The original filenames are retained so they remain compatible with the CAD and rendering tools.

| Filename | Part | Copies per lever |
| --- | --- | ---: |
| `base.stl` | Fixed base | 1 |
| `palanca.stl` | Moving lever | 1 |
| `guia.stl` | Upper guide | 1 |
| `tapa.stl` | Sensor cover | 1 |
| `mordassa.stl` | Handlebar clamp half | 2 |

Start with PETG, 0.2 mm layers, four perimeters and 35–45% infill. Inspect holes and bearing surfaces before assembly. These are starting print settings, not a strength rating. The original clamp is designed around a bare 22.2 mm round tube.

## Adjust before exporting

Open `maneta.scad` in OpenSCAD 2021.01 or newer. Select `peca` (part) and `costat` (hand), render with F6 and export STL. Existing selector values retain their original names: `conjunt` = assembly, `dreta` = right, `esquerra` = left.

Key parameters: `diam_manillar` (bar diameter), `diam_imant` / `gruix_imant` (magnet diameter/thickness), `radi_dit` (finger radius), `joc_radial` (pivot clearance per side), and `altura_espai_sensor` (space under the cover). Measure the actual magnet and electronics before committing to a print.

Nominal magnet is a diametrically magnetized Ø6 × 2.5 mm disc. The top seat is Ø6.18 mm. The separate flat-side blind bore takes the Ø4 mm pivot pin; its nominal bore is Ø4.30 mm. Refer to the illustrated guide for the assembly direction and sensor alignment.

The ten STL files are unchanged from the original v01 design. Only comments in the OpenSCAD source have been translated; its executable geometry is unchanged. [File hashes and source manifest](source-manifest.json).

The shared controller and BLE bench firmware are in [firmware/brake-bench](../../firmware/brake-bench/). The browser tester is a diagnostics tool; it does not yet integrate these proportional levers with the simulator.
