# Maneta v01 render provenance

[Bluetooth brakes](bluetooth-brakes.md) · [Development log](../DEVELOPMENT_LOG.md) · [Documentation index](README.md)

The Maneta v01 views are based on the owner's **Maneta-MTB-v01.zip** design package, supplied on 22 November 2026. Both pages of `planol.pdf`, `MUNTATGE.md`, the OpenSCAD assembly and the STL meshes were inspected before rendering.

## Published images

- [Animated Maneta v01 pull and release](images/bluetooth-brake-v01-motion.gif): direct Blender animation of the supplied STL assembly, with the spring following its anchors.
- [Realistic Maneta v01 render](images/bluetooth-brake-v01-realistic.png): built-in ImageGen surface and lighting treatment using the direct CAD render as its image reference.
- [Direct CAD reference](images/bluetooth-brake-v01-cad.png): Blender Cycles rendering of the supplied meshes, before the ImageGen treatment.

![Direct rendering of the supplied right-hand STL assembly](images/bluetooth-brake-v01-cad.png)

The original conceptual illustration remains above the animated assembly in the brake guide and on the repository landing page. It records the earlier design exploration; it is not the geometry reference for this rendering. The realistic still remains available above.

## Pull-and-release animation

The GIF is rendered from the editable 3D assembly, with a fixed rider-side camera. The lever rotates around its original pivot, its moving spring anchor follows the rotation, and the illustrated spring stretches between its anchors. The grip, cover, clamp and handlebar stay fixed. The trigger continues to point outward toward the right grip.

The **800×512 loop lasts 3.15 seconds at 20 fps**, covering the nominal **0–22°** lever travel with short pauses at each end. Twenty-four distinct poses form the 63-frame sequence. It uses Blender 4.5 LTS, Cycles with 32 samples and fixed sampling noise, and a shared GIF palette. [Animation parameters and asset hash](brake-v01-animation.json).

The loop illustrates the design's nominal travel; it does not model measured force, spring stiffness, stop deformation or sensor output. It uses native Blender materials and lighting rather than animated pixels from the ImageGen still. [Reproducible animation tool](../tools/brake-render/README.md).

## Source and assembly

The package contains the five printable shapes for each hand, `maneta.scad`, `planol.pdf` and `MUNTATGE.md`. Each assembled lever uses six printed PETG pieces because the clamp half is printed twice. The [printable meshes and editable CAD](../hardware/maneta-v01/README.md) are now included in the repository. The original archive and historical assembly documents remain local; the [online workshop](https://mfarre.github.io/mtb-indoor-bern/workshop/) provides current English assembly and bench-test instructions.

[Design-attachment conversation](https://chatgpt.com/s/t_6b02aac7f4a8819189ca3bd0214c126f) · [Initial planning discussion](https://chatgpt.com/share/6b02a20d-5db8-83eb-93a7-cbb479549aaa)

**Archive SHA-256:** `5e63dc93afddf633b9277a3e9b5ed62c21faf550c1b60a05819cefd13b896ba8`. The [source and asset manifest](brake-v01-sources.json) records individual file hashes, triangle counts and output dimensions.

The right-hand assembly follows the OpenSCAD transforms. Coordinates below are in millimetres; `(x,y,z)` is a point in the print-oriented STL.

| Part | Transform into the displayed assembly |
| --- | --- |
| Base | Unchanged |
| Lever | Rotate around Z by -8 degrees, then add 4.85 to Z |
| Upper guide | Add 12.15 to Z |
| Sensor cover | `(x, -y, 24.55-z)` |
| Upper clamp half | `(8-z, y-45, x-15.5)` |
| Lower clamp half | `(8-z, y-45, -x-15.5)` |

The contextual handlebar runs along X through Y=-45, Z=-15.5, with a 22.2 mm diameter. In the rider-side view, +X is outward toward the right grip/bar end. The pivot remains inboard; the trigger stays ahead of the handlebar. The visible stem on the left and bar-end plug on the right clarify the mounting orientation without changing the source assembly. The CAD reference uses the original printed-part surfaces without smoothing modifiers, subdivision, bevels or remeshing. Duplicate triangle vertices are merged and normals recalculated. [Blender renderer and usage](../tools/brake-render/README.md).

## What is accurate, and what is illustrative

The reference fixes the six printed parts, their proportions and their assembled positions. The exposed spring anchors, rubber stop, magnet seat, cover hole and sensor arrangement follow the assembly notes and drawings. The realistic image was checked against this reference for meaningful changes in shape or missing components.

PETG colours and surface finish, the detailed spring coils, fastener recesses, sensor-board details, wire routing and the handlebar/grip/stem appearance are visualization choices. ImageGen can interpret small details; use the original CAD and PDF for dimensions. The AS5600 PCB is under the cover. The four-wire lead goes to an external controller: the design does not specify a local Bluetooth pod or LED on the lever.

This is a rendering of a proposed mechanical prototype, not a photograph of a built device or evidence of fit, strength or sensor accuracy. The package defines lever-angle sensing; it does not measure hydraulic pressure or finger force. The [hardware guide](bluetooth-brakes.md#maneta-v01-bench-hardware) links the components, bench firmware and pending physical validation.

## Generation method and prompt

The direct reference was rendered in **Blender 4.5.16 LTS, Cycles, 24 samples**, with a right-hand lever angle of 8 degrees. The camera is at `(15,-190,280)`, looking at `(15,-20,-8)`, with an orthographic scale of 255. This revised view makes the outward trigger direction explicit. The built-in **ImageGen** tool then processed that single local reference image with an opaque background. No API/CLI fallback was used. The generated file was copied into `docs/images/`; the original output was retained locally.

```text
Use case: precise-object-edit. Asset type: realistic product rendering for MTB Indoor - Bern brake hardware documentation. Edit the supplied CAD render into a photorealistic studio visualization with the SAME GEOMETRY AND CAMERA. The input is the corrected rider-side view of the owner's right-hand Maneta v01 STL assembly. Orientation is critical: the black right grip and its outer bar-end plug are on SCREEN RIGHT; the handlebar centre and partial stem are on SCREEN LEFT. The orange trigger projects OUTWARD toward the RIGHT grip/bar end, with its pivot and blue sensor cover INBOARD to its LEFT. The trigger is on the forward side of the handlebar, as on a normal bicycle brake. Do not mirror, rotate, relocate or redesign the trigger or assembly, and do not swap the grip and stem. Preserve every printed-part silhouette, original proportions, eight-degree lever pose, spring between its two existing anchors, black rubber stop, blue sensor cover with centre hole and two screws, four thin coloured wires, and the two-piece rectangular clamp. Change only surface realism and lighting: subtle realistic 0.2 mm FDM layer lines on graphite, blue and orange PETG, matte polymer finish, plausible steel washers and recessed socket screws, realistic textured black rubber grip, anodized black bar and contextual stem, soft clean studio shadows on a dark charcoal ground. Keep the entire outboard grip end visible. Keep the camera, framing and object placement exactly as supplied. No LED, battery, Bluetooth pod, hydraulic hose or additional electronics. These are printed plastic parts, not metal. No hands, people, labels, words, logos, arrows, watermarks, or graphic overlays. Opaque background. The stem and grip provide mounting context; this is a visualization of a proposed mechanical prototype, not a photograph of a manufactured device.
```
