# Bicicleta i calibratge

Obre **Bicicleta i calibratge** a la barra superior o a la portada. Obrir aquesta pantalla pausa la ruta i allibera la càrrega. El perfil funciona encara que no facis la prova guiada.

## Configura la bicicleta

- **Pes del ciclista i de la bicicleta:** la suma entra al càlcul de gravetat i rodament. Es conserven el pes i el percentatge de pendent que ja tenies desats.
- **Perímetre de la roda:** metres recorreguts per una volta completa de roda, introduïts en mil·límetres. El valor inicial és 2300 mm; es pot substituir pel perímetre mesurat.
- **Plat i cassette virtuals:** plat de 20–60 dents; presets MTB 10–51, 10–52 o 11–46, o una llista personalitzada de 4–24 pinyons. Escriu els pinyons del més gran al més petit: el primer és la marxa 1, la més curta. La pantalla mostra els metres per volta de pedals als dos extrems.
- **Pendent al KICKR:** 100% aplica el pendent complet al càlcul de càrrega. Els percentatges inferiors en redueixen l'efecte sobre el rodillo; el relleu i la velocitat del joc sempre utilitzen el pendent real.
- **Ajuda a cadència baixa:** activada, la càrrega es redueix progressivament entre 45 i 30 rpm i l'objectiu arriba a 0 W a 30 rpm. Desactivada, aquests llindars són 25 i 12 rpm; es conserva l'alliberament a cadència molt baixa.
- **Marxa física:** nota opcional per recordar la posició real de la cadena durant la prova. El canvi del Click modifica la transmissió virtual, no mou la cadena física.

Prem **Desa el perfil**. Els ajustos s'apliquen al joc i es recorden en reobrir l'app. Els canvis de pesos, roda, transmissió, assistència, pendent o nota de marxa física fan que el resultat de calibratge anterior deixi d'aplicar-se; canviar només el nom o el circuit no l'invalida.

![Perfil de bicicleta](images/bike-profile.png)

## Prova guiada de resposta

1. Connecta el KICKR, escalfa uns minuts i tria una marxa física còmoda. Mantén-la durant tota la prova.
2. Obre **Prova guiada**, marca **Soc a la bici i estic a punt per pedalar** i prem **Comença la prova**.
3. Pedala entre **65 i 75 rpm**. No s'envien ordres de càrrega fins a haver observat almenys cinc segons estables i cinc mostres noves.
4. Segueix les instruccions: **70 → 110 → 70 W** a uns 70 rpm, transició a **80–90 rpm**, i **110 → 70 W** a uns 85 rpm. La seqüència dura aproximadament dos minuts, més l'espera inicial.
5. Si totes les etapes tenen dades suficients i estables, i el KICKR confirma l'alliberament final, el resultat es desa automàticament. La pantalla passa a **Calibratge vigent** amb el mateix perfil i rodillo connectat.

La prova mesura el temps d'estabilització i el seguiment dels objectius de 70–110 W. Ajusta la velocitat d'augment del parell entre **3 i 6 Nm/s**, amb ordres com a mínim separades un segon. Sense resultat vàlid, el joc utilitza **5 Nm/s**. Les reduccions de càrrega no esperen aquesta rampa.

**Atura i allibera la càrrega**, Esc, tancar la pantalla o perdre el focus cancel·len la prova. També s'atura si falta telemetria recent, es desconnecta el rodillo o la cadència cau massa. Una prova cancel·lada o amb seguiment deficient no crea un resultat nou. Si existia un resultat anterior vàlid, es conserva. El botó d'esborrar permet tornar explícitament a la resposta estàndard.

![Prova guiada pendent, sense connexió al rodillo](images/calibration-guide.png)

## Què calcula el joc

El desenvolupament és `perímetre × dents del plat / dents del pinyó`. Per calcular la càrrega de la marxa es combina amb la cadència. La força resistent suma gravetat, rodament i aire:

```text
θ = atan(pendent / 100)
F = massa_total × g × (sin θ + Crr × cos θ) + ½ × ρ × CdA × velocitat²
parell als pedals = max(0, F) × desenvolupament / (2π × eficiència)
potència objectiu = parell × velocitat angular dels pedals
```

La velocitat de l'avatar evoluciona amb la **potència mesurada** i la força resistent del mateix model, incloent-hi la massa de la bici i la superfície. La gravetat permet baixar amb 0 W; no es força la velocitat del joc a ser igual a la cadència multiplicada pel desenvolupament.

Els coeficients són supòsits del simulador: eficiència 0,96; densitat de l'aire 1,225 kg/m³; CdA 0,51 m²; Crr 0,005 a l'asfalt, 0,009 a la grava i 0,012 a terra/fulles. No són mesures de cada tram. Es mantenen els límits del joc: 600 W de càrrega objectiu i 45 km/h de velocitat virtual.

**Límit del calibratge:** el KICKR proporciona tant la càrrega com els watts observats. Sense un potenciòmetre de referència independent, aquesta prova no certifica l'exactitud absoluta de la potència ni aplica un multiplicador als watts. Tampoc substitueix el procediment del fabricant. La resistència continua sent una aproximació amb ordres FTMS de potència dinàmica: no reprodueix exactament la inèrcia d'una roda real ni fa servir el protocol propietari de canvi virtual de Zwift.

El canvi del model de rodament inicia una nova versió dels rècords de baixada. Els registres antics es conserven al fitxer local, però no es comparen amb marques fetes amb aquesta física.

## Dades i verificació

El perfil i el resultat es desen exclusivament a `settings.json`, exclòs del repositori. El resultat queda associat a una signatura del perfil i a una identitat derivada del rodillo. No s'envia telemetria a GitHub.

`--self-test <fitxer>` executa proves de física, migració de perfils, marxes personalitzades i calibratge amb un rodillo simulat. Inclou resposta ràpida/lenta, cancel·lació durant una ordre pendent, mostres duplicades o antigues, cadència incorrecta, desconnexió, ordres rebutjades i fallada d'alliberament. Aquestes proves no envien ordres al KICKR real.

Les captures d'aquesta entrega mostren el perfil i la prova pendent. La validació física del nou assistent correspon a la primera prova guiada que faci l'usuari.

Referències: [modes de control de Wahoo](https://support.wahoofitness.com/hc/en-us/articles/28408412793490-Trainer-control-modes-for-KICKR-CORE-SNAP-or-BIKE-in-the-Wahoo-app), [comportament del mode ERG](https://support.wahoofitness.com/hc/en-us/articles/4402565516946-A-Guide-to-using-ERG-mode) i [model de potència de ciclisme de Martin et al.](https://pubmed.ncbi.nlm.nih.gov/28121252/).
