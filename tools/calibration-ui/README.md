# Proves de la pantalla de bicicleta i calibratge

Banc de proves del DOM que importa directament `src/MTBIndoorBern/Scene/bike-settings.js` i els estils de l’aplicació. No és una còpia de la pantalla ni necessita dependències de JavaScript.

Des de l’arrel del repositori:

```sh
python -m http.server 8766 --bind 127.0.0.1
```

Obre [el banc de proves](http://127.0.0.1:8766/tools/calibration-ui/). Les comprovacions s’executen automàticament i escriuen el resultat a la pàgina i a la consola. El botó **Executa les comprovacions** permet repetir-les. `window.bikeUiHarness.getSummary()` retorna el recompte i `window.bikeUiHarness.results` conté els detalls.

Per inspeccionar l’aspecte després de les proves:

- [Perfil de la bici](http://127.0.0.1:8766/tools/calibration-ui/?preview=profile).
- [Prova guiada](http://127.0.0.1:8766/tools/calibration-ui/?preview=guide).

Comprova almenys les mides de finestra de 1440 × 852 i 1100 × 772. La comprovació de dimensions usa la mida actual del navegador; no substitueix una inspecció visual.

## Què es comprova

La càrrega inicial, la previsualització de marxes, la validació de dades, la conversió de mm a metres, la conservació dels esborranys davant les actualitzacions periòdiques, la confirmació de desament, els errors persistents, les dificultats existents com 60% i 0%, l’inici explícit de la prova, la cancel·lació, els estats de calibratge, la navegació amb teclat, el focus i el tancament del diàleg.

El pont és simulat i no importa el joc, el pont nadiu ni el codi Bluetooth. **No envia cap ordre a un rodillo i no modifica la configuració de l’aplicació.** Els watts i els resultats de calibratge dels casos de prova són dades sintètiques; no demostren la resposta física del KICKR. La previsualització manual sempre comença amb el rodillo desconnectat.
