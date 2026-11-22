# Prepare a Swiss GPX course

[Data acquisition](../../docs/data-acquisition.md) · [Simulator](../../docs/simulator.md)

These tools were used to add **Uetliberg · Triemli · Uto Kulm · Ringlikon**. They require Python 3 with Pillow, Node.js and an internet connection for the initial download. The resulting game loads all assets locally.

```powershell
python -m pip install Pillow
python tools/course-import/fetch_gpx.py route.gpx --work artifacts/import/uetliberg --output src/MTBIndoorBern/Scene/courses/uetliberg --name Uetliberg
node tools/course-import/build_course.mjs artifacts/import/uetliberg
node tools/course-import/verify-profile.mjs
node tools/downhill/verify-ground.mjs uetliberg
```

Use a new working directory for each GPX. The importer accepts one continuous segment with elevations and no gaps greater than 500 m. It is configured for Switzerland. It downloads SWISSIMAGE at zoom 16, quantized-mesh terrain and an OpenStreetMap extract, with caching and four concurrent downloads. Uetliberg required 410 tiles and a 4352×5120-pixel orthophoto. Very long routes require a lower resolution or a smaller area before import.

The builder resamples every 5 m, smooths altitude over an approximately 40 m window and uses **the same elevation for the road, profile and physics**. It adapts nearby terrain, estimates widths and surfaces from OSM, and adds buildings and recreated vegetation. It writes `route.json`, `world.json`, `appearance.json` and `provenance.json`. If it finds the Ringlikon waypoint after the summit, it also prepares the Uetliberg–Ringlikon downhill sector; other sectors are defined manually in `handling.json`.

Then add an entry to `Scene/courses.json` with the folder, length, ascent and preview distance from `report.json`. Review `elevation-validation.json`, build with `build.ps1 -SelfTest`, and inspect intersections, grades and surfaces in demo mode. Map estimates are not a field survey. [Track Lab](../../docs/track-lab.md) can complement them with video observations.

**Sources and attribution:** [SWISSIMAGE / swisstopo](https://docs.geo.admin.ch/visualize-data/xyz.html), [swisstopo terrain](https://docs.geo.admin.ch/visualize-data/terrain-service.html), [open-data terms](https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices), and [OpenStreetMap, ODbL](https://www.openstreetmap.org/copyright). Retain attribution in the game and any redistribution. Map geometry derived from OSM is distributed under ODbL; the code's licence does not replace the data licences.
