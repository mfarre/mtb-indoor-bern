# MTB Indoor - Bern

Simulador de MTB indoor per a Windows, amb circuits 3D de Suïssa, connexió Bluetooth al Wahoo KICKR, canvi virtual MTB i pulsòmetre. Circuits disponibles a la instal·lació local: **Dentenberg (Al Dente)**, 12,24 km, i **Uetliberg**, 25,75 km, sobre fotografia aèria i relleu reals.

Projecte en desenvolupament, provat amb un KICKR CORE, un Zwift Click 2 dret i un Garmin HRM-Dual.

## Evolució del projecte

### 19 de novembre de 2026 · Nou track Uetliberg i exploració del perfil

**Ja es pot triar entre Uetliberg i Dentenberg a l'inici.** El nou recorregut del GPX passa per Zuric, Triemli, Uto Kulm i Ringlikon: **25,75 km i 581 m d'ascens** després de suavitzar el perfil. La selecció del circuit es recorda en tornar a obrir l'app. Dentenberg conserva el circuit Al Dente, els ajustos i els rècords anteriors.

L'Uetliberg incorpora una ortofoto **SWISSIMAGE © swisstopo de 4352×5120 píxels**, relleu real i edificis/superfícies estimats amb OpenStreetMap. La vegetació és recreada. El GPX és una ruta planificada, sense vídeo de reconeixement; el mapa guia l'aspecte dels camins. El perfil suavitzat comparteix exactament les elevacions amb el camí 3D i la física. El GPX original suma uns 614 m d'ascens abans del suavitzat.

| Demo pausada al bosc | Fotografia aèria d'Uto Kulm |
| --- | --- |
| ![Uetliberg: demo pausada, perfil seleccionable i botó Reprèn demo](docs/images/uetliberg-demo.png) | ![Ortofoto SWISSIMAGE i relleu d'Uto Kulm](docs/images/uetliberg-aerial.png) |

**Explora en demo → Pausa → Reprèn demo** continua des del mateix punt i conserva el multiplicador ×1–×8. Clica qualsevol punt del perfil per saltar-hi: si estaves pausat, continues pausat; si avançaves, continues avançant. Amb el perfil enfocat, les fletxes mouen 100 m, Majúscules + fletxa mouen 1 km i Inici/Fi van als extrems. Es pot tornar enrere després d'arribar al final. Els salts són exclusius de la demo i no generen rècords ni activen el KICKR.

El nou circuit inclou també **Practica la baixada · Uetliberg · Ringlikon**, amb sector entre els km **11,355 i 14,565**, els mateixos frens i les regles de traçada del Dentenberg.

**Verificat:** compilació local i pública, proves de física i demo als dos tracks, 140 punts de l'Uetliberg sense terreny damunt del ciclista i error de pendent inferior a 0,00005 punts percentuals. Les captures comprovades mantenen **30 FPS a 1440×852**, amb resolució adaptativa. La còpia pública funciona amb l'Uetliberg inclòs, sense necessitar els recursos privats del Dentenberg.

[Eines reutilitzables d'importació GPX](tools/course-import/README.md) · [Procedència de les dades](src/MTBIndoorBern/Scene/courses/uetliberg/provenance.json) · [Verificació d'aquesta entrega](docs/verification-uetliberg-2026-11-19.json).

### 19 de novembre de 2026 · Frens i repte de baixada al Dentenberg

**Ara frenar té conseqüències en el temps de baixada.** Mantén l'**A del Click dret**, **Espai** o el botó en pantalla per reduir la velocitat virtual. La pulsació i l'alliberament de l'A s'han validat amb el comandament real. `+` i `B` conserven el canvi MTB.

Els revolts mostren direcció, distància i velocitat objectiu del joc segons la geometria, la superfície i l'amplada estimada. Un excés de velocitat provoca derrapada; si es manté, una sortida de traçada atura la bicicleta virtual **3 segons** mentre el cronòmetre continua. La frenada anticipada evita aquesta penalització. No augmenta la càrrega física del KICKR.

**Frenada al corriol:** vuit segons del mode pràctica, capturats amb la física real del joc i un control de fre automàtic per fer la demostració reproduïble. El KICKR està inactiu.

![Dentenberg: avís de revolt, fre actiu i entrada controlada al corriol](docs/images/dentenberg-braking.gif)

**Dades més visibles:** pendent en gran quan puges; velocitat, pendent, frenada i adherència quan baixes.

| Pendent de pujada | Sortida de traçada per excés de velocitat |
| --- | --- |
| ![Pujada amb un pendent del 12,2% destacat](docs/images/dentenberg-climb.png) | ![Recuperació de tres segons després d'entrar massa ràpid al revolt](docs/images/dentenberg-runout.png) |

El botó **Practica la baixada · Dentenberg** permet començar directament abans del tram, sense sensors. El repte cronometrat ocupa els **km 4,480–6,980 d'Al Dente**, amb sortida, meta i rècord personal local. La pràctica incorpora impuls automàtic als replans; les marques només es desen en sessions reals que completen el tram sense pauses. La visita en demo ×1–×8 continua disponible.

En la prova automàtica del descens amb aproximació, no frenar produeix **4 sortides i 384,3 s**; anticipar els revolts acaba amb **0 sortides i 365,1 s**. S'han comprovat també la frenada amb pendent del −20%, la roda lliure amb 0 W, la persistència dels rècords i l'exclusió de pauses i demos. Les captures de pujada i baixada mantenen **30 FPS a 1440×852** amb resolució adaptativa.

S'ha eliminat una superposició del terreny en els revolts on el track torna a passar pel mateix camí. Es conserven les altituds originals i la coherència entre el pendent dibuixat i la física.

[Guia de frens, pràctica i rècords](docs/downhill.md) · [Eines de captura reproduïble](tools/downhill/README.md) · [Resultats de verificació](docs/verification-downhill-2026-11-19.json).

### 15 de novembre de 2026 · Al Dente de tardor i Track Lab

La gravació d'una sortida real ha servit per revisar l'aspecte del circuit: asfalt, grava i corriol estret amb fulles, arbres de tardor, sotabosc i marges. La instal·lació local utilitza una mostra del terra extreta del vídeo; aquest recurs es manté privat i el motor disposa d'una textura alternativa generada amb codi. La vegetació es recrea amb geometria i textures; no és una reconstrucció fotogramètrica. Les captures següents mostren la instal·lació local.

**Comparació en moviment · corriol del bosc, km 4,30–4,35.** Vuit segons, les dues versions en paral·lel amb la mateixa posició, càmera i velocitat. El GIF mostra el motor anterior i el nou estil de la instal·lació local.

![Al Dente: corriol en moviment, versió anterior i nou estil de tardor](docs/images/al-dente-before-after.gif)

**Demo accelerada:** el botó **⏩ Demo ×1**, al costat de Pausa, alterna **×1 → ×2 → ×4 → ×8 → ×1**. La velocitat es conserva en pausar i reprendre; Atura / reinicia torna a ×1. Només modifica el desplaçament de la demo; el temps mostra segons reals i el KICKR continua inactiu. A ×8 pots revisar la volta completa en aproximadament quatre minuts. S'han comprovat les quatre velocitats, la pausa, la represa, l'arribada al final i la compilació amb tots els recursos gràfics.

Les [eines de captura i muntatge](tools/render-comparison/README.md) permeten repetir la comparació amb altres versions o trams. [Verificació de la demo i del GIF](docs/verification-demo-2026-11-15.json).

**Abans i després**, al mateix sector del bosc, aproximadament al km 4,37:

| Versió anterior | Nou estil de tardor |
| --- | --- |
| ![Abans: camí ample i vegetació uniforme](docs/images/circuit-3d.png) | ![Després: corriol, fulles, sotabosc i arbres de tardor](docs/images/autumn-forest.png) |

El terreny proper al camí ara té una malla més fina perquè els marges no tapin l'asfalt en pendents fortes. Es conserven les altituds del traçat que fa servir la física. Les superfícies, amplades estimades, trams de bosc i grau de confiança es defineixen a `appearance.json`.

![Asfalt en pujada amb marges adaptats al camí](docs/images/asphalt-climb.png)

**Track Lab** és el nou visor independent per preparar futurs circuits. Copia i verifica els originals amb SHA-256, descodifica el FIT, mostra el vídeo girat 180°, permet ajustar el rellotge, veure la posició al mapa, extreure fotogrames del MP4 a màxima resolució i desar/exportar observacions dels trams.

![Track Lab: vídeo corregit, posició GPS, ajust horari i anotacions](docs/images/track-lab.png)

La sessió de treball conté 28,5 GB d'originals, 64 minuts de vídeo i 65 fotogrames inicials. S'ha estimat un desfasament de −226 s entre la càmera i el FIT; és ajustable i té una incertesa aproximada de 10 s. El tram central del vídeo segueix una variant diferent de la ruta anterior: es marca com a variant, i el seu aspecte s'extrapola sense situar-hi obstacles com si s'haguessin mesurat.

Validació d'aquesta entrega: còpies verificades, compilació del visor, reproducció H.264 corregida, extracció de detall a **2688×1512**, persistència de la captura, importació de prova amb un FIT i un vídeo curt, i proves de física/FTMS superades. Les escenes comprovades de bosc i asfalt mantenen **30 FPS** en una vista de **1440×852**, amb resolució adaptativa. L'error màxim entre pendent visual i físic és inferior a **0,00005 punts percentuals** en els 2.448 segments. Les proves visuals s'han fet en demo, sense controlar el KICKR.

Guies: [Track Lab: ús i compilació](docs/track-lab.md) · [Textures i procedència](docs/render-assets.md) · [Resultats de verificació](docs/verification-2026-11-15.json).

### 12 de novembre de 2026 · Primera versió funcional

Circuit 3D amb fotografia aèria, connexió directa al KICKR CORE, Click 2 dret i HRM-Dual, canvi MTB 1×12, ajustos persistents i reconnexió dels dispositius. La reducció de càrrega en passar de marxa 3 a marxa 1 es va comprovar pedalant.

## Captures de la primera versió

### Primera persona

![Circuit Al Dente en primera persona, amb transmissió MTB i dades de la ruta](docs/images/circuit-3d.png)

### Vista aèria

![Fotografia aèria SWISSIMAGE sobre el relleu 3D del circuit](docs/images/aerial-view.png)

Les captures són del mode demo. La fotografia del terreny és real; els arbres i els detalls de primera persona són recreats.

## Funcions

- Circuit 3D amb fotografia aèria SWISSIMAGE, terreny, edificis, vegetació, ombres, camí texturat i manillar.
- Pendent coherent: el camí dibuixat, la física i el control del rodillo parteixen del mateix perfil d’altitud.
- Potència, cadència, pulsacions, velocitat, distància, altitud i perfil de la ruta en directe.
- Transmissió MTB **1×12, cassette 10–51**, amb plat de 30, 32 o 34 dents.
- Connexió directa al Click 2 dret: no cal BikeControl.
- Fre virtual amb A / Espai, avisos de revolt, adherència i sortides de traçada.
- Pràctica del Dentenberg, cronòmetre de baixada i rècords personals persistents.
- Dispositius recordats, indicadors d’estat a la pantalla principal i cerca automàtica cada 5 segons.
- Pes, dificultat del pendent, plat i circuit desats automàticament.
- Primera persona, vista aèria i demo accelerable ×1 / ×2 / ×4 / ×8 sense controlar el KICKR.
- Catàleg de circuits separat de l’app, preparat per incorporar altres rutes.
- Superfícies i ambient de tardor basats en referències de vídeo, amb perfil d'aspecte editable per circuit.
- [Track Lab](docs/track-lab.md) per importar, alinear, revisar i anotar FIT i vídeos locals.

## Requisits

- Windows 10, versió 2004 o posterior, o Windows 11, de 64 bits.
- Bluetooth LE per als sensors i targeta gràfica amb WebGL 2.
- [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/), normalment ja present a Windows.
- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) per compilar. La publicació resultant inclou el runtime .NET.

La prova gràfica en un i5-6500 amb una GTX 660 de 2 GB ha mantingut **30 FPS a 1440×852** en les vistes comprovades. El motor ajusta la resolució si el rendiment baixa.

## Compilar i executar

Des de PowerShell, a l’arrel del repositori:

```powershell
.\build.ps1 -SelfTest
.\artifacts\publish\win-x64\MTBIndoorBern.exe
```

O directament amb el SDK:

```powershell
dotnet publish src/MTBIndoorBern/MTBIndoorBern.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o artifacts/publish/win-x64
```

Mantén la carpeta `Scene` al costat de l’executable. Les imatges, el terreny i Three.js són locals: el circuit es pot carregar sense una API de mapes ni un compte de Google. Per compilar per primera vegada cal accés a NuGet.

## Primera connexió

1. Encén el KICKR, posa’t el pulsòmetre i prem un botó del Click per despertar-lo.
2. Obre **Dispositius**, selecciona cada sensor i prem **Connecta**.
3. Ajusta el pes, el percentatge de pendent al KICKR i el plat.
4. Pedala uns segons perquè arribin potència i cadència i prem **Inicia la ruta**.

El repositori comença sense sensors vinculats. Un cop connectats, es recorden a `settings.json`, al costat de l’executable; aquest fitxer està exclòs de Git. Desconnectar manualment pausa la reconnexió fins a prémer Connecta o tornar a obrir l’app. **Oblida** elimina la vinculació desada.

| Control | Acció |
| --- | --- |
| Click dret `+` / tecla `+` | Pujar marxa |
| Click dret `B` / tecla `B` o `−` | Baixar marxa |
| Click dret `A` / tecla `A` o Espai / botó Fre | Mantenir per frenar; alliberar per rodar |
| Practica la baixada | Saltar a l’aproximació del sector del circuit triat sense KICKR ni rècord |
| Escape / Pausa | Pausar i alliberar la càrrega |
| Reprèn demo | Continuar la demo pausada des del mateix punt |
| Clic al perfil / fletxes | Saltar a una posició en demo, també en pausa |
| Atura / reinicia | Tornar al principi |
| F11 | Alternar la finestra maximitzada |
| Vista aèria | Canviar de càmera |
| Explora en demo | Recórrer el circuit sense controlar el rodillo |

## Com funciona el canvi MTB

La marxa 1 és la més curta: **32×51** amb el plat predeterminat. La marxa 12 és **32×10**. El model utilitza un desenvolupament estimat de roda de 2,30 m, corresponent a una MTB de 29 polzades.

El pendent, el pes, la relació de canvi i la cadència determinen una potència objectiu que s’actualitza per Bluetooth FTMS. És un control de càrrega dinàmic; no utilitza el protocol propietari de canvi virtual de Zwift.

Amb 75 kg, 70 rpm, plat de 32 i una pujada del 12% al 100%, el model calcula aproximadament **199 W en 32×51** i **435 W en 32×24**. Un plat de 30 escurça encara més el desenvolupament.

La càrrega té un límit de 600 W, augmenta gradualment i es redueix amb cadències baixes. A 30 rpm o menys, l’objectiu és 0 W. Pausar o tancar envia càrrega zero i aturada; perdre dades o control pausa la ruta. Una reconnexió no reactiva automàticament l’esforç. El rodillo conserva la seva resistència mecànica mínima i necessita uns segons per estabilitzar els canvis.

El percentatge de pendent seleccionat modifica l’esforç al KICKR. La geometria i la velocitat virtual continuen fent servir el pendent complet del circuit.

## Circuit i dades

`Scene/courses.json` defineix el catàleg. Cada circuit té una carpeta pròpia amb `route.json`, `world.json` i `aerial.jpg`. Al Dente s’ha preparat a partir d’un FIT: s’han interpolat les altituds absents, suavitzat el soroll i adaptat el terreny proper al mateix perfil que fa servir la simulació. El FIT original no està inclòs.

**Uetliberg inclòs:** el repositori incorpora la ruta, el terreny, l’ortofoto, el perfil d’aspecte i la procedència a `Scene/courses/uetliberg/`; es pot compilar i explorar directament. Les dades derivades d’OSM conserven la llicència ODbL i les dades swisstopo, la seva atribució.

**Dades locals del Dentenberg:** `route.json`, `world.json`, `aerial.jpg` i la textura extreta del vídeo es mantenen a la instal·lació local. Cal aportar-los a `Scene/courses/al-dente/` per activar aquest circuit. El selector només mostra circuits amb els recursos essencials instal·lats. Els FIT, els vídeos complets, les sessions i els identificadors dels sensors no es publiquen.

La portada mostra un tram de bosc; la ruta comença al km 0. Track Lab importa FIT i vídeo per analitzar-los. Les [eines d'importació GPX](tools/course-import/README.md) preparen circuits suïssos des de la línia d'ordres; afegir-los al catàleg i revisar-ne l'aspecte continua sent un pas manual.

## Estructura

```text
src/MTBIndoorBern/
  BluetoothDevices.cs  Descoberta i dades dels sensors
  Equipment.cs         Vinculació i reconnexió
  Preferences.cs       Ajustos locals persistents
  TrainerControl.cs    Ordres i confirmacions FTMS
  RideSession.cs       Física, canvi i estat de la ruta
  RidePanel.cs          Connexió entre WinForms i la vista 3D
  Scene/               Interfície, motor Three.js i circuits
docs/images/           Captures de l’app
src/TrackLab/           Visor i editor d'observacions de vídeo/FIT
tools/track-lab/        Importació verificada, descodificació i extracció
build.ps1              Compilació i proves bàsiques
```

## Verificació i límits actuals

Les proves comproven paquets BLE/FTMS, totes les pendents dels circuits instal·lats, arrencada en pujada, sentit de les marxes, reducció a baixa cadència, límit de càrrega, pausa, persistència i identitat dels sensors. Una prova real pedalant ha verificat la reducció de càrrega en passar de marxa 3 a marxa 1 i el retorn al pla, amb confirmació de totes les ordres del KICKR.

El maquinari comprovat és **KICKR CORE**, **Zwift Click 2 dret** i **Garmin HRM-Dual**. El Click esquerre i altres rodillos encara no s’han validat. El projecte no és una reconstrucció fotogramètrica completa ni una integració oficial de Wahoo, Zwift o Garmin.

## Fonts i crèdits

- Fotografia aèria i relleu: **© swisstopo**, [SWISSIMAGE](https://www.swisstopo.admin.ch/en/orthoimage-swissimage-10) i [serveis cartogràfics](https://docs.geo.admin.ch/visualize-data/xyz.html). Dentenberg local: nivell WMTS 17, 4864×3840 píxels. Uetliberg inclòs: nivell WMTS 16, 4352×5120 píxels. Els mosaics no tenen la resolució original completa de 10 cm.
- Cartografia de boscos i edificis: **© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)**.
- Three.js: llicència MIT inclosa a `src/MTBIndoorBern/Scene/vendor/LICENSE`.
- Microsoft WebView2: dependència NuGet amb les condicions de Microsoft.
- Referències del model: [transmissions Shimano 12 velocitats](https://productinfo.shimano.com/pdfs/product/archive/2020-2021_Compatibility_v035_en.pdf) i [comportament del control de potència Wahoo](https://support.wahoofitness.com/hc/en-us/articles/4402565516946-A-Guide-to-using-ERG-mode).

Vegeu [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) per als recursos de tercers.

