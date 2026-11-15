# Track Lab

Visor local de vídeo i FIT per estudiar un recorregut abans de recrear-lo en 3D. És una eina independent del simulador: no connecta ni controla sensors.

## Ús

1. **Importa FIT i vídeos**: tria un FIT o un ZIP amb un únic FIT i la carpeta dels vídeos. Indica si els nous vídeos necessiten un gir de 180°.
2. La importació copia tots els originals a una sessió nova i verifica cada còpia amb SHA-256. Extreu el FIT i crea vídeos de previsualització i un fotograma cada minut. També admet clips curts.
3. Tria una miniatura o mou la barra del vídeo. El mapa mostra el punt GPS pròxim a l'hora del vídeo, tenint en compte l'ajust del rellotge.
4. Ajusta **Hora FIT = hora càmera + segons**. Busca una aturada o un punt recognoscible. No s'interpolen posicions a través de pauses llargues del FIT.
5. Prem **Marca**, indica el final del tram, la superfície, l'amplada estimada i les observacions. **Desa observació** escriu `annotations.json` a la sessió.
6. **Extreu fotograma** desa un JPEG corregit a `details/`. S'utilitza el MP4 original de màxima resolució quan hi ha un LRF equivalent.
7. **Exporta JSON** permet reutilitzar les anotacions en preparar l'aspecte d'un circuit. Aquesta exportació no modifica automàticament el joc.

La rotació del vídeo es fa al visor, sense alterar els originals; els JPEG extrets ja contenen els píxels girats. Els MP4 de `preview/` són fitxers de treball que el visor orienta en reproduir-los. Els LRF H.264 es remultiplexen sense recodificació. Si cal, altres còdecs es converteixen a H.264 de 720p.

## Circuit de referència i límits

`config.json` pot apuntar a un `route.json` del simulador. El descodificador compara posició, direcció i continuïtat amb el traçat. El visor només associa un punt al circuit si l'error espacial és de 12 m o menys; la resta es mostra com a variant. Les distàncies anotades corresponen al circuit de referència. Sense circuit de referència, es fan servir les distàncies del FIT.

La proximitat GPS no valida el rellotge. Per a la sessió del 14 de novembre s'ha estimat **−226 s, amb una incertesa aproximada de 10 s**, a partir de l'aturada llarga. El tram central segueix una variant diferent del circuit anterior. Les amplades i les superfícies són estimacions visuals, no un aixecament topogràfic.

Cal que el vídeo contingui `creation_time` amb data i hora. La importació d'aquesta versió està orientada a FIT i vídeos DJI LRF/MP4; no importa GPX ni genera automàticament un circuit 3D.

## Compilació

Requisits: .NET 10 SDK, WebView2 Runtime, Python 3 amb Pillow, Node.js, FFmpeg i FFprobe a la mateixa carpeta, i Garmin FIT SDK per a JavaScript. El visor no necessita cap servidor extern.

```powershell
python -m pip install Pillow
npm install --prefix artifacts/track-lab-deps --ignore-scripts @garmin/fitsdk@21.221.0
.\tools\track-lab\build.ps1 -FitSdkPath .\artifacts\track-lab-deps\node_modules\@garmin\fitsdk -FfmpegPath C:\eines\ffmpeg\bin\ffmpeg.exe
.\artifacts\track-lab\TrackLab.exe
```

FFmpeg es pot obtenir des dels enllaços de Windows de [la pàgina oficial](https://ffmpeg.org/download.html). El constructor admet `-PythonPath`, `-NodePath`, `-DotnetPath`, `-SessionsRoot`, `-DefaultSession` i `-Course`. Les rutes queden a `config.json`; cal adaptar-les al PC. Una sessió inicial buida mostra els botons d'obertura i importació.

El codi i les captures d'exemple formen part del repositori. Els vídeos complets, les sessions de treball, les vinculacions Bluetooth i els FIT originals es mantenen locals.
