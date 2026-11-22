# Eiger Bike Challenge 20 km course importer

This imports the organiser's downloadable GPX and the public Swiss terrain, aerial imagery and OpenStreetMap features used by the simulator. It needs Python 3 with Pillow and Node.js. Downloads are cached; use a new working directory when the organiser changes the GPX.

```powershell
python tools/eiger-import/prepare.py `
  --work artifacts/import/eiger-20 `
  --output src/MTBIndoorBern/Scene/courses/eiger-20
```

Use `--node C:/path/to/node.exe` when Node is not on PATH. `--reuse-built` skips the generic GPX/imagery importer when that step has already finished in the same work directory. It still regenerates the Eiger-specific files from the cached base route.

The script calls the shared [course importer](../course-import/README.md), then:

- Preserves interior GPX corner vertices where a five-metre sample interval would create an artificially short chord across a hairpin. Altitude still follows the same smoothed GPX profile; all road gradients are recomputed from the resulting geometry, rather than clipped independently.
- Adds zoom-12 swisstopo terrain covering the Eiger, Mönch, Jungfrau, Wetterhorn and surrounding Alps. These distant mountains use real coordinates and elevations; the near route retains the zoom-14 terrain and 3072×3072 SWISSIMAGE orthophoto.
- Selects summer appearance and an illustrative conifer/broadleaf mix within the mapped forest footprints.
- Writes three app-defined training sectors, a descent handling section and the data provenance. The sectors are not official race timing splits.

`course-verification.json` in the work directory records distance, ascent, grades, corner corrections and far-terrain statistics. The GPX's finish/start gap is retained; the importer does not invent a connecting road. Race furniture and spectators belong to the rendering module and are not surveyed course features.

The source GPX and profile PDF linked by the organiser were both updated on 30 June 2026 when this course was prepared on 22 November 2026. The file measures 19.48 km, with approximately 874 m of climbing after smoothing; the event advertises the category as 20 km / 900 m.

Sources: [organiser's profiles](https://www.eigerbike.ch/en/race/profiles/), [20 km GPX](https://www.eigerbike.ch/wp-content/uploads/gpx/ebc20km.gpx), [20 km map](https://www.eigerbike.ch/wp-content/uploads/profile/Track-20-EBC.pdf), [swisstopo terrain](https://docs.geo.admin.ch/visualize-data/terrain-service.html), [SWISSIMAGE service](https://docs.geo.admin.ch/visualize-data/xyz.html), [swisstopo open-data terms](https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices), and [OpenStreetMap attribution / ODbL](https://www.openstreetmap.org/copyright).

Some sections are marked by the organiser as race-day-only. This dataset is for indoor training and does not establish outdoor cycling permission.
