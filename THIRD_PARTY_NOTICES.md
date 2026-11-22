# Third-party resources

[Project overview](README.md) · [Development log](DEVELOPMENT_LOG.md)

Included resources retain their original licences and attribution. The Dentenberg map and photographic ground assets listed below remain local rather than being distributed in this repository.

| Resource | Source | Terms |
| --- | --- | --- |
| `Scene/vendor/three.module.js`, `three.core.js` | Three.js 0.187.0 | MIT; full text in `Scene/vendor/LICENSE` |
| `Scene/courses/al-dente/aerial.jpg` | SWISSIMAGE, © swisstopo; mosaic from the `ch.swisstopo.swissimage` WMTS service, level 17 | swisstopo Open Government Data terms, with attribution; local asset |
| `Scene/courses/uetliberg/aerial.jpg` | SWISSIMAGE, © swisstopo; level 16 WMTS mosaic | swisstopo Open Government Data terms, with attribution |
| `Scene/courses/gurten/aerial.jpg` | SWISSIMAGE, © swisstopo; level 17 WMTS mosaic | swisstopo Open Government Data terms, with attribution |
| `Scene/courses/gurten/textures/el-tony-logo.png` | [Official El Tony Mate logo](https://www.eltonymate.com/site/templates/images/El-Tony-Mate-Logo.png) | El Tony Mate trademark and design; not relicensed with the code. Used to depict the trail's signage, without affiliation or app sponsorship |
| Terrain in `world.json` | swisstopo elevation data | swisstopo Open Government Data terms, with attribution |
| Forests, buildings and derived mapping in `world.json` | © OpenStreetMap contributors | Open Database License (ODbL) 1.0 for data derived from OpenStreetMap |
| WebView2 | Microsoft.Web.WebView2 1.0.4314.35 | Microsoft terms; restored from NuGet |

References:

- [swisstopo: free geodata and terms of use](https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices)
- [OpenStreetMap: copyright and licence](https://www.openstreetmap.org/copyright)
- [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- [Three.js](https://github.com/mrdoob/three.js)
- [WebView2 on NuGet](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4314.35)

Publishing this repository grants no additional rights to third-party trademarks.

The Gurten course is derived from public OpenStreetMap and swisstopo mapping. Photographs by trailnet and TRIEBHAUS informed the obstacle and signage design; those photographs are not included in the repository. See the [Gurten sources](docs/GURTEN.md).

## Track Lab and additional visual resources

Track Lab uses FFmpeg/FFprobe as external tools and the Garmin FIT SDK for JavaScript. Neither FFmpeg binaries nor the SDK are included in the repository; obtain them separately and retain their licences. The local working installation uses FFmpeg 9.0.2 and Garmin FIT SDK 21.221.0. Python/Pillow is used to prepare contact sheets.

The photographic leaf-litter texture remains in the local installation and is not published. The public renderer includes a code-generated alternative. The RGBA beech-twig texture was generated with the integrated ImageGen tool. See [textures and provenance](docs/render-assets.md) for paths and the prompt. Track Lab screenshots show a woodland excerpt; the complete original videos remain local.

The public `Scene/courses/uetliberg/` folder includes the course data and a `provenance.json` file containing sources, date and a GPX hash. The planned GPX and mapping derived from OpenStreetMap are distributed under ODbL. The Dentenberg mapping assets in the table above remain local.

The [Bluetooth brake concept image](docs/images/bluetooth-brake-concept.png) was generated with the built-in ImageGen tool. It is an illustrative design study, not a manufacturer photograph, a tested device or a reproduction of a selected bill of materials. Its [generation prompt and provenance](docs/brake-concept-render.md) are included.

The [Maneta v01 realistic render](docs/images/bluetooth-brake-v01-realistic.png) is based on the owner's supplied mechanical design package. The six printed parts in its Blender reference use the supplied STL geometry; ImageGen provided the final surface and lighting treatment. The original package and Blender binaries are not redistributed here. The [source manifest, limitations and prompt](docs/brake-v01-render.md) distinguish source geometry from illustrative hardware details.
