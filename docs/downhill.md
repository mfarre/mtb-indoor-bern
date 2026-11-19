# Frens i baixada del Dentenberg

Mantén **A del Zwift Click 2 dret** per frenar; deixa'l anar per tornar a rodar. També pots mantenir **Espai**, la tecla **A** o el botó de fre en pantalla. `+` puja marxa i `B` baixa marxa, com abans. La lectura de pulsació i alliberament de l'A s'ha comprovat amb el comandament real.

El fre redueix la velocitat de la bicicleta virtual. **No aplica un fre físic ni augmenta la càrrega del KICKR.** En baixada, la gravetat fa avançar la bicicleta encara que la potència sigui zero. Els petits replans i contrapendents de la ruta poden requerir pedalar en una sessió real.

## Què guanyes frenant

El cartell central mostra el sentit del proper revolt, els metres fins a l'entrada i la velocitat objectiu del joc. El càlcul utilitza la curvatura del traçat, la superfície i l'amplada estimada. També hi ha senyals dins l'escena. Aquests valors són una calibració de jugabilitat, no un mesurament de l'adherència real ni una recomanació per circular a l'exterior.

Entrar una mica massa ràpid provoca una derrapada, una desviació visible i pèrdua de velocitat. Si mantens un excés important, surts de la traçada: la bicicleta virtual s'atura durant **3 segons**, el cronòmetre continua i després recuperes el control. No hi ha sortides aleatòries. La frenada anticipada permet conservar velocitat a la sortida del revolt i evitar aquesta penalització.

A les pujades es destaca el **pendent en percentatge**; a les baixades, la **velocitat**, el pendent i si estàs frenant o rodant. L'indicador d'adherència avisa de la derrapada abans de perdre el control.

## Pràctica i rècords

**Practica la baixada · Dentenberg**, a la portada, et situa 55 m abans de la sortida del tram. No necessita sensors i no controla el KICKR. Té la mateixa frenada i adherència que una sessió real; aporta un impuls automàtic als replans i contrapendents per poder completar-la amb les mans als controls. La demo de visita continua disponible amb velocitats ×1, ×2, ×4 i ×8; aquesta visita automàtica no puntua ni aplica sortides de pista.

El tram cronometrat **Dentenberg · baixada del bosc** correspon als **km 4,480–6,980 del circuit Al Dente existent**. No és un segon track importat. `handling.json` defineix els límits del tram i permet preparar-ne un per a altres circuits.

En una sessió real, el temps comença en creuar la sortida i acaba a la meta. Inclou aturades i recuperacions. La millor marca es desa a `records.json`, al costat de l'executable, i reapareix en tornar a obrir l'app. Pausar durant el tram invalida la marca; la pràctica i la demo tampoc poden establir rècords. Un canvi en el traçat o en el model d'adherència separa les marques anteriors.

Si es perd un Click que estava connectat durant una sessió real, la ruta es pausa per recuperar els controls. El fre de teclat o pantalla s'allibera en perdre el focus; la comunicació té caducitat per evitar que quedi premut si s'interromp la vista.

## Verificació

Les proves integrades comproven la descodificació d'A, alliberament, A+B, frenada en pendent del −20%, arrencada per gravetat amb 0 W, estabilitat temporal, conseqüències de passar els revolts massa ràpid, cronòmetre, pausa i persistència de les marques. Executa `build.ps1 -SelfTest` per repetir-les amb les dades locals del circuit.

La prova automàtica del descens amb la seva aproximació dura **384,3 s amb 4 sortides** sense frenar, davant de **365,1 s i cap sortida** amb frenada anticipada. És una comparació de la simulació amb impuls de pràctica, no una prova feta pedalant ni un rècord personal.

S'ha corregit també la geometria del terra als revolts on la ruta passa dues vegades pel mateix camí amb petites diferències d'altitud GPS/baromètrica. Una malla contínua evita franges de terreny superposades, i la superfície del pas distant s'oculta immediatament al voltant del ciclista. Les altituds de la ruta i la física es conserven.

Protocol del Click 2: els paquets `0x23` tenen una màscara de botons de lògica invertida; A correspon a `0x10`. Referència de la comunitat: [documentació del protocol a zwiftplay](https://github.com/ajchellew/zwiftplay/issues/5).
