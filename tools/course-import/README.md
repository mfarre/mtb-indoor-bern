# Preparar un circuit GPX de Suïssa

Eines utilitzades per afegir **Uetliberg · Triemli · Uto Kulm · Ringlikon**. Cal Python 3 amb Pillow, Node.js i connexió a Internet per a la primera descàrrega. El joc resultant carrega tots els recursos localment.

```powershell
python -m pip install Pillow
python tools/course-import/fetch_gpx.py ruta.gpx --work artifacts/import/uetliberg --output src/MTBIndoorBern/Scene/courses/uetliberg --name Uetliberg
node tools/course-import/build_course.mjs artifacts/import/uetliberg
node tools/course-import/verify-profile.mjs
node tools/downhill/verify-ground.mjs uetliberg
```

Utilitza una carpeta de treball nova per a cada GPX. L'importador admet un segment continu, amb elevacions i sense salts de més de 500 m. Està configurat per a Suïssa. Descarrega SWISSIMAGE a zoom 16, terreny quantized mesh i un extracte OpenStreetMap, amb memòria cau i quatre descàrregues simultànies. Per a l'Uetliberg són 410 tessel·les i una ortofoto de 4352×5120 píxels. Les rutes molt extenses requereixen reduir la resolució o dividir l'àrea abans d'importar.

El constructor remostra cada 5 m, suavitza l'altitud en una finestra d'uns 40 m i fa servir **la mateixa elevació per al camí, el perfil i la física**. Adapta el terreny proper, estima amplades/superfícies amb OSM i afegeix edificis i vegetació recreada. Escriu `route.json`, `world.json`, `appearance.json` i `provenance.json`. Si troba el waypoint Ringlikon després del cim, prepara també el sector de baixada Uetliberg–Ringlikon; altres sectors es defineixen manualment a `handling.json`.

Afegeix després una entrada a `Scene/courses.json`, amb la carpeta, longitud, ascens i distància de portada de `report.json`. Revisa `elevation-validation.json`, compila amb `build.ps1 -SelfTest` i comprova en demo les cruïlles, els pendents i les superfícies. Les estimacions del mapa no equivalen a una inspecció de camp. Track Lab permet complementar-les amb vídeo.

**Fonts i atribució:** [SWISSIMAGE / swisstopo](https://docs.geo.admin.ch/visualize-data/xyz.html), [terreny swisstopo](https://docs.geo.admin.ch/visualize-data/terrain-service.html), [condicions de les dades obertes](https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices), [OpenStreetMap, ODbL](https://www.openstreetmap.org/copyright). Conserva l'atribució al joc i en qualsevol redistribució. La geometria de mapa derivada d'OSM es distribueix sota ODbL; la llicència del codi no substitueix les de les dades.
