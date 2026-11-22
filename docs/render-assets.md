# Autumn textures

[Project overview](../README.md) · [Simulator](simulator.md) · [Data acquisition](data-acquisition.md) · [Development log](../DEVELOPMENT_LOG.md)

The local installation contains `src/MTBIndoorBern/Scene/courses/al-dente/textures/forest-floor.jpg`, a sample extracted from the owner's recording after rotating it 180°. This asset remains private and is excluded from the public repository. The renderer corrects broad lighting bands in the crop and tiles it across the ground. If the file is absent, it generates an earth-and-leaf texture in code without using video pixels. The local asset's origin and crop are recorded in `appearance.json`.

`src/MTBIndoorBern/Scene/courses/al-dente/textures/beech-branch.png` is an RGBA texture generated with the integrated ImageGen tool for the recreated trees and shrubs. It is neither a photograph nor a measurement of the route's exact vegetation. The alpha channel is preserved. The elevation profile and trail position do not depend on this texture.

Prompt used:

> Use case: photorealistic-natural. Asset type: transparent alpha foliage card texture for a real-time mountain biking game set in Bern woodland in late autumn. Generate ONE botanically plausible natural irregular spray of thin beech twigs with many small crisp individual ochre, muted golden yellow, tan and brown beech leaves, a few desaturated olive leaves, loosely branching in all directions from a fine central woody branch. Front orthographic view; flat soft overcast illumination, no baked directional cast shadow; realistic leaf veins, fine serrated edges and variation, photographic natural detail. An irregular airy silhouette, visible transparent gaps between groups and individual leaves; no circular blob outline. The spray occupies 85% of a square image with generous transparent margins. No trunk, no full tree, no scenery, no ground, no objects, no text or labels. Truly transparent background, preserve alpha. Avoid luminous saturation, illustration, cartoon, repeated identical leaves.

The remaining vegetation, asphalt and gravel textures are generated in code. Estimated widths, season and sections can be adjusted in `appearance.json`. Individual obstacles seen on a section that does not match the course have not been transferred as though their positions were surveyed.
