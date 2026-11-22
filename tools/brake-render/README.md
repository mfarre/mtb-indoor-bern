# Brake CAD reference renderer

[Bluetooth brakes](../../docs/bluetooth-brakes.md) · [Render provenance](../../docs/brake-v01-render.md)

Build the right-hand Maneta v01 assembly directly from its five STL files. The clamp mesh is used twice. The script reverses the cover and clamp print orientations using the transforms in the supplied OpenSCAD source, then renders the assembled device and a view with the sensor cover removed.

## Inputs and running

Use Blender 4.5 LTS with Cycles. Extract the owner-supplied `Maneta-MTB-v01.zip` into a local directory; that package is not bundled with this tool. The directory must contain `STL/dreta/base.stl`, `palanca.stl`, `guia.stl`, `tapa.stl` and `mordassa.stl`.

```powershell
& 'C:/path/to/blender.exe' --background --factory-startup `
  --python tools/brake-render/render_cad.py -- `
  --source 'C:/path/to/extracted/Maneta-MTB-v01' `
  --output 'C:/path/to/render-output' --samples 48
```

Outputs are `maneta-v01-cad-assembly.png`, `maneta-v01-cad-open.png` and an editable `maneta-v01-assembly.blend`. Source coordinates are millimetres; the numerical scene coordinates preserve that scale. The displayed lever angle is 8 degrees within its nominal 22-degree travel.

The camera looks from the rider's side. The right grip and visible bar end are on the right, with a contextual stem on the left: the trigger points outward toward the grip, and the pivot stays inboard. This orientation comes from the camera and handlebar context; the source parts and spring/stop arrangement are preserved.

The six printed parts use the original mesh geometry without subdivision, bevels or remeshing. Duplicate STL vertices are merged for correct normals. Materials and studio lighting are visualization choices. Hardware, spring coils, sensor-board details, wires, tube, grip and stem are illustrative additions based on the assembly notes and mounting context, not newly supplied manufacturing models.

The script is an offline rendering tool. It does not generate print files, validate mechanical fit or supply brake firmware. It does not control the trainer or Bluetooth devices.

## Animated lever pull and release

After generating the scene above, render the same assembly through its nominal **0–22° travel**. The trigger remains outboard, rotates toward the grip when pulled, and returns smoothly. The moving spring anchor, washer and fastener follow the lever; the spring coils extend between the fixed and moving anchors. All source STL meshes retain their geometry.

```powershell
& 'C:/path/to/blender.exe' --background --factory-startup `
  --python tools/brake-render/animate_cad.py -- `
  --blend 'C:/path/to/render-output/maneta-v01-assembly.blend' `
  --output 'C:/path/to/motion-output' --steps 24 --width 800 --samples 32

& 'C:/path/to/ffmpeg.exe' -y -v error -framerate 20 `
  -i 'C:/path/to/motion-output/frames/%04d.png' `
  -filter_complex 'split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle' `
  -loop 0 'C:/path/to/motion-output/bluetooth-brake-v01-motion.gif'
```

The renderer writes 24 distinct PNG poses to `poses/`, a **63-frame, 20 fps** sequence to `frames/`, and parameters to `animation.json`. With these settings, the **800×512 GIF loops every 3.15 seconds**, including short pauses at rest and full pull. Add `--preview` to render only the two endpoint poses for inspection.

The animation uses Cycles with fixed noise sampling, denoising, darker studio lighting and PETG surface shading. It is a native CAD-based render, not an animation of the AI-enhanced still image. Spring force, rubber-stop compression, collisions and physical fit are not simulated or validated. The original still and the animated model are design illustrations, not footage of a working prototype.
