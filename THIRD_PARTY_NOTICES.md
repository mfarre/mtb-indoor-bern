# Recursos de tercers

Els recursos inclosos conserven les seves llicències i atribucions originals.

| Recurs | Procedència | Condicions |
| --- | --- | --- |
| `Scene/vendor/three.module.js`, `three.core.js` | Three.js 0.187.0 | MIT; text complet a `Scene/vendor/LICENSE` |
| `Scene/courses/al-dente/aerial.jpg` | SWISSIMAGE, © swisstopo; mosaic del servei WMTS `ch.swisstopo.swissimage`, nivell 17 | Condicions d’Open Government Data de swisstopo, amb atribució |
| Relleu a `world.json` | Dades d’elevació de swisstopo | Condicions d’Open Government Data de swisstopo, amb atribució |
| Boscos, edificis i cartografia derivada a `world.json` | © OpenStreetMap contributors | Open Database License (ODbL) 1.0 per a les dades derivades d’OpenStreetMap |
| WebView2 | Microsoft.Web.WebView2 1.0.4314.35 | Condicions de Microsoft; es restaura des de NuGet |

Referències:

- [swisstopo: dades gratuïtes i condicions d’ús](https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices)
- [OpenStreetMap: copyright i llicència](https://www.openstreetmap.org/copyright)
- [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- [Three.js](https://github.com/mrdoob/three.js)
- [WebView2 a NuGet](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4314.35)

La publicació d’aquest repositori no concedeix drets addicionals sobre marques de tercers.
## Track Lab i nous recursos visuals

Track Lab utilitza FFmpeg/FFprobe com a eines externes i el Garmin FIT SDK per a JavaScript. No s'inclouen els binaris de FFmpeg ni el SDK al repositori; cal obtenir-los separadament i conservar les seves llicències. La instal·lació local de treball utilitza FFmpeg 9.0.2 i Garmin FIT SDK 21.221.0. Python/Pillow s'utilitza per preparar els fulls de contacte.

La textura fotogràfica de fulles del terra es manté a la instal·lació local i no es publica. El motor públic inclou una alternativa generada amb codi. La textura RGBA de branquillons de faig s'ha generat amb l'eina integrada ImageGen. Vegeu [textures i procedència](docs/render-assets.md) per a les rutes i el prompt. Les captures de Track Lab mostren un fragment de bosc; els vídeos originals complets es mantenen locals.
