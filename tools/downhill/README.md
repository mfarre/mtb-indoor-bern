# Reproduir les proves visuals de baixada

Aquestes eines utilitzen el codi de l'app i les dades locals d'Al Dente. No obren connexions Bluetooth ni controlen el KICKR.

`node tools/downhill/verify-ground.mjs` comprova que el terreny no tapi el ciclista i que el camí coincideixi amb l'altitud física als punts de control. Necessita els fitxers locals `route.json` i `world.json`.

Per generar una còpia de prova de l'app:

```powershell
python tools/downhill/prepare-capture.py brake
dotnet publish artifacts/downhill/brake/source/MTBIndoorBern.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o artifacts/downhill/brake/app
```

Obre `artifacts/downhill/brake/app/MTBIndoorBern.exe` des de l'escriptori de Windows. Es tanca en acabar. La còpia recorre l'aproximació en pràctica, anticipa la frenada i captura 110 fotogrames a intervals de 0,1 s de simulació. Espera que la vista i la captura acabin abans d'avançar la física: el cost de capturar no accelera el vídeo. Els PNG, els estats i el resum es desen a `artifacts/downhill/brake/capture/`.

Escenaris disponibles: `brake` (frenada anticipada), `runout` (mateix inici sense frenar), `climb` (pendent destacat) i `welcome` (portada). Les posicions de captura estan preparades per a Al Dente. La còpia de prova incorpora el mode de captura a `Program.cs` i `RidePanel.cs`; no modifica la font original ni la instal·lació habitual.

Amb FFmpeg instal·lat, el GIF de vuit segons es pot generar així:

```powershell
ffmpeg -framerate 10 -start_number 20 -i artifacts/downhill/brake/capture/frame-%04d.png -t 8 -filter_complex "fps=8,scale=800:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none" -loop 0 artifacts/downhill/braking.gif
```

Els fitxers a `artifacts/` són locals i estan exclosos de Git.
