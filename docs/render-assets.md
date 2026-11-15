# Textures de tardor

La instal·lació local té `src/MTBIndoorBern/Scene/courses/al-dente/textures/forest-floor.jpg`, una mostra extreta de la gravació pròpia després de girar-la 180°. Aquest recurs es manté privat i està exclòs del repositori públic. El motor corregeix les bandes de llum del retall i el repeteix sobre el sòl. Si el fitxer no hi és, genera una textura de terra i fulles amb codi, sense utilitzar píxels del vídeo. L'origen del recurs local i el retall consten a `appearance.json`.

`src/MTBIndoorBern/Scene/courses/al-dente/textures/beech-branch.png` és una textura RGBA generada amb l'eina integrada ImageGen per als arbres i arbustos recreats. No és una fotografia ni una mesura de la vegetació exacta del recorregut. El canal alfa es conserva. El perfil d'altitud i la posició del camí no depenen d'aquesta textura.

Prompt utilitzat:

> Use case: photorealistic-natural. Asset type: transparent alpha foliage card texture for a real-time mountain biking game set in Bern woodland in late autumn. Generate ONE botanically plausible natural irregular spray of thin beech twigs with many small crisp individual ochre, muted golden yellow, tan and brown beech leaves, a few desaturated olive leaves, loosely branching in all directions from a fine central woody branch. Front orthographic view; flat soft overcast illumination, no baked directional cast shadow; realistic leaf veins, fine serrated edges and variation, photographic natural detail. An irregular airy silhouette, visible transparent gaps between groups and individual leaves; no circular blob outline. The spray occupies 85% of a square image with generous transparent margins. No trunk, no full tree, no scenery, no ground, no objects, no text or labels. Truly transparent background, preserve alpha. Avoid luminous saturation, illustration, cartoon, repeated identical leaves.

La resta de textures vegetals i d'asfalt/grava es generen amb codi. Les amplades estimades, la temporada i els trams es poden ajustar a `appearance.json`; els obstacles puntuals del tram que no coincideix amb el circuit no s'han traslladat com si fossin ubicacions mesurades.
