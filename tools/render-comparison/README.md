# Comparacions animades del motor 3D

`RenderCapture` carrega el `ForestRenderer` de qualsevol còpia local de `Scene`. Captura fotogrames a posicions exactes, sense sensors ni connexions Bluetooth. Les dues seqüències tenen la mateixa càmera, recorregut, resolució i velocitat. No es duplica una imatge estàtica: cada fotograma es torna a renderitzar amb el motor corresponent.

Requisits: Windows, .NET 10 SDK, WebView2, Python amb Pillow i FFmpeg. Cal disposar dels dos directoris `Scene` complets, amb les dades locals del circuit. Els originals es conserven; es crea una còpia de treball `_scene` dins de cada carpeta de sortida.

Des de l'arrel del repositori:

```powershell
dotnet publish tools/render-comparison/RenderCapture.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o artifacts/render-capture
```

Crea dos fitxers JSON amb aquest esquema, canviant `SceneFolder` i `OutputFolder` per a cada versió. Fes servir rutes absolutes. La sortida ha de ser fora de `SceneFolder`.

```json
{
  "SceneFolder": "C:/MTB/versio-anterior/Scene",
  "OutputFolder": "C:/MTB/captures/abans",
  "StartMeters": 4300,
  "SpeedMps": 6.2,
  "Seconds": 10,
  "Fps": 12,
  "CourseId": "al-dente"
}
```

Executa les captures successivament, esperant que cada finestra acabi i es tanqui:

```powershell
Start-Process -Wait artifacts/render-capture/RenderCapture.exe -ArgumentList 'C:/MTB/abans.json'
Start-Process -Wait artifacts/render-capture/RenderCapture.exe -ArgumentList 'C:/MTB/despres.json'
python tools/render-comparison/compose.py C:/MTB/captures/abans C:/MTB/captures/despres docs/images/al-dente-before-after.gif --ffmpeg C:/Tools/ffmpeg/bin/ffmpeg.exe
```

Sense arguments, l'executable llegeix `capture.json` al costat seu. Cada captura genera PNGs numerats i `capture-report.json`; qualsevol error genera `error.txt`. Si es repeteix una captura, convé triar una carpeta nova per evitar barrejar resultats. El compositor comprova que ambdues seqüències tinguin tots els fotogrames i els mateixos paràmetres, i genera un GIF en bucle i una imatge PNG intermèdia.

El GIF del README compara la còpia del motor anterior al canvi de tardor amb la instal·lació local nova. El tram és un corriol observat entre els km 4,30 i 4,35. La captura utilitza 960×540 per versió a 12 fps; el compositor limita el GIF als primers 8 segons, a 10 fps i 800 píxels d'amplada total, amb una paleta de 128 colors per limitar el pes. Les dades del circuit, les còpies `_scene` i els informes amb rutes locals no es publiquen.
