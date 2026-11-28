# Dentenberg woodland verification

Run the public CPU-only suite from the repository root:

```sh
node tools/dentenberg/verify-woodland.mjs
```

The default fixture is an invented route with adjoining forest surfaces, open sections, slopes and deterministic trees. It needs no personal recordings, route files, browser, graphics device or Bluetooth equipment.

Optionally check a locally available Dentenberg course:

```sh
node tools/dentenberg/verify-woodland.mjs --course "/path/to/local/al-dente"
```

That directory must contain `route.json`, `world.json` and `appearance.json`. The script reads those files in place and prints only aggregate checks and counts. It does not copy geodata, photographs or video frames into the repository and does not write or modify the supplied files. Keep personal course data outside the public checkout.

The suite checks:

- The source route, terrain, survey and road centreline/elevations remain unchanged.
- New tree and understory centres stay in forest sections; replaced legacy trees are not duplicated.
- Nearby tree, shrub, fern and leaf pools remain within their limits during forward travel, backwards seeking and view changes, without accumulating meshes or chunks.
- Distant silhouettes remain available in aerial view, with the appropriate fog range restored.
- Missing optional ground/foliage maps and shader prewarming failures have usable fallbacks; available local video texture retains precedence over stock imagery.
- Gurten, El Tony, Eiger, Uetliberg and explicitly disabled Dentenberg retain their existing paths.

Also run the existing Gurten geometry regression after changes to the shared renderer:

```sh
node tools/gurten/verify-pilot.mjs
```

These tests use real Three.js geometry and instance transforms with a minimal canvas stub. They verify geometry and state boundaries, not image quality, GPU frame rate, audio playback or trainer behavior. Native application captures and measured performance remain separate checks.
