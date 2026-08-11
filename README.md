# Kayfo AR — joueur en taille réelle

Application web de réalité augmentée : on tape sur le sol pour poser un joueur
**à sa taille réelle**, on se place à côté de lui, et on prend une photo qu'on
partage via la feuille de partage native du téléphone.

Construit sur le **binaire 8th Wall** (`@8thwall/engine-binary`) en mode
**absolute scale**, avec **A-Frame** pour la scène et **Vite** pour le build.

---

## Démarrer

```bash
npm install
npm run dev      # sert en HTTPS sur toutes les interfaces (https://<ip-lan>:5173)
```

Puis ouvrez l'URL réseau sur votre téléphone. Le certificat est auto-signé :
acceptez l'avertissement une fois.

> **HTTPS obligatoire.** `getUserMedia` et `DeviceMotionEvent` sont bloqués en
> `http://` sur mobile. C'est pour ça que `@vitejs/plugin-basic-ssl` est câblé
> dans `vite.config.js` — ne le retirez pas pour tester sur téléphone.

Autres commandes :

```bash
npm run build    # bundle de production dans dist/
npm run preview  # sert dist/ en HTTPS — la bonne façon de tester un build
npm test         # vérifie les invariants d'échelle et le filtrage des hitTest
```

> **Ne testez jamais un build en ouvrant `dist/index.html` directement**, ni en
> le servant depuis un serveur dont la racine est le dossier du projet. La
> caméra exige un contexte sécurisé, et `dist/` attend d'être servi comme une
> racine de site. `npm run preview` fait exactement ça.

Pour itérer sur la mise en page depuis un ordinateur : `https://localhost:5173/?desktop`.
Le moteur démarre en émulation clavier/souris — **mais sans centrale inertielle
il n'y a ni SLAM ni échelle métrique.** Ne jamais valider une taille depuis ce mode.

---

## Ajouter un joueur

1. Déposez le PNG détouré (fond transparent) dans `public/players/`.
2. Ajoutez une entrée dans `src/players.js` :

```js
{
  id: 'mon-joueur',
  name: 'Mon joueur',
  src: '/players/mon-joueur.png',
  heightMeters: 1.88,   // ← la seule valeur qui compte
  calibration: 1,
  feetInset: 0,
}
```

Rien d'autre. Le recadrage est automatique — voir ci-dessous.

---

## Interface (UI)

Tout le texte **visible par l'utilisateur** (boutons, statuts, hints, écran de
démarrage) est en **anglais**. Les commentaires de code restent en français,
conformément au style déjà établi dans ce projet.

Plusieurs éléments ont été **commentés** (masqués, pas supprimés) de l'écran
grand public, sur demande :

| Élément | Comment le réafficher |
|---|---|
| Readout de debug « camera : X m » | `CONFIG.debugScale = true` (`src/config.js`) |
| Puces de sélection de joueur (« Repère 1,80 m » / « Joueur 1 ») | `CONFIG.showPlayerSelector = true` (`src/config.js`) |
| Panneau d'ajustement visuel de l'échelle | déjà caché derrière `?calibrate` (voir plus haut) — inchangé |
| Badge « VR » d'A-Frame | forcé en `display: none` dans `src/styles.css` ; retirer ce bloc CSS pour le remontrer |

**Sans sélecteur visible, un joueur par défaut doit être choisi.** L'app
affiche désormais directement `CONFIG.kioskDefaultPlayerId` (par défaut
`'springbok-01'`, le vrai joueur) plutôt que `Repère 1,80 m`. C'est une
**hypothèse**, pas une demande explicite — changez `kioskDefaultPlayerId` dans
`src/config.js` si un autre joueur doit être le défaut.

**Mention d'attribution 8th Wall.** Le pied de HUD (« XR engine by Niantic
Spatial, Inc. ») a été **conservé visible**, seulement traduit en anglais, et
n'a **pas** été masqué malgré la demande « si possible » : la licence du
binaire 8th Wall (XR Engine License Agreement, §1.3) exige que cette
attribution reste visible dans l'application. La retirer entièrement
exposerait le projet à un risque de non-conformité avec cette licence — voir
aussi le commentaire HTML au-dessus dans `index.html` et l'en-tête de copyright
dans `external/xr/xr.js` (à ne jamais supprimer au minify).

---

## Comment la taille réelle est garantie

Quatre mécanismes se combinent. C'est leur empilement qui donne un résultat
crédible, pas un seul d'entre eux.

### 1. La scène est en mètres

```html
<a-scene xrweb="scale: absolute">
```

Le paramètre `scale` du composant `xrweb` bascule le moteur de `responsive`
(unités arbitraires, défaut) à `absolute` : caméra, hit tests et cibles image
sont alors exprimés **en mètres réels**. Une entité de 1,88 unité mesure
1,88 m à l'écran, point.

Trois contraintes du moteur, vérifiées dans le binaire :

| Contrainte | Conséquence |
|---|---|
| `scale` doit être fixé **avant** `XR8.run()` | Impossible de basculer à chaud (`Error: Scale can only be changed before calling XR8.run()`) |
| Incompatible avec `disableWorldTracking: true` | Lève une exception |
| Incompatible avec VPS / Area Targets | Repasse silencieusement en `responsive` |

### 2. L'échelle n'est utilisable qu'après calibration

L'estimation métrique est **monoculaire** : le moteur a besoin de parallaxe pour
la résoudre. Tant qu'elle n'est pas convergée, l'événement `xrtrackingstatus`
rapporte `status: 'LIMITED', reason: 'INITIALIZING'`.

`@8thwall/coaching-overlay` affiche automatiquement « Avancez et reculez le
téléphone » pendant cette phase, et `src/components/ar-director.js` **refuse tout
placement** tant que `status` n'est pas passé à `'NORMAL'`. Sans ce verrou, un
joueur posé trop tôt apparaît à une taille aléatoire — c'est le piège n°1 de
l'absolute scale.

### 3. Le PNG est recadré sur ses pixels opaques

C'est le point que la plupart des implémentations ratent.

Un détourage laisse toujours des marges transparentes, et elles diffèrent d'une
image à l'autre. Dimensionner le plan sur la hauteur du **fichier** fait donc
varier la taille perçue de ±15 % selon le détourage.

`src/lib/texture.js` mesure la bounding box des pixels dont `alpha > 10`,
recadre dessus, et `real-scale-figure` dimensionne le plan sur **cette** hauteur.
`heightMeters` correspond alors exactement au sujet — semelles au sol, sommet du
crâne à `heightMeters`.

L'origine de l'entité `#figure-root` est **au sol**, pas au centre du plan : le
placement se réduit à recopier la position du hit test.

`npm test` verrouille cet invariant :

```
OK    hauteur du sujet = 1.80 m
OK    semelles a y = 0
OK    sommet a y = 1.80 m
OK    calibration 0.9 -> 1.62 m
```

### 4. Le point d'ancrage est filtré, pas pris tel quel

`XR8.XrController.hitTest(x, y, ['FEATURE_POINT'])` renvoie **plusieurs**
estimations de qualité inégale. `src/lib/hit-test.js` applique :

- **plausibilité** — un hit à plus de 12 m est rejeté ; un hit à moins de 60 cm
  sous la caméra n'est pas du sol ; et une fois le niveau du sol connu, tout hit
  situé plus de 50 cm au-dessus est refusé (c'est ce qui empêche de reposer le
  joueur sur une table après l'avoir posé par terre) ;
- **qualité** — `DETECTED_SURFACE` > `ESTIMATED_SURFACE` > `FEATURE_POINT`, puis
  le plus proche ;
- **stabilisation** — une moyenne glissante du niveau du sol aligne les
  placements successifs. Sans elle le joueur saute de quelques centimètres à
  chaque déplacement, ce qui casse immédiatement l'illusion.

Si aucun candidat ne passe, **rien n'est posé** et le HUD affiche « Aucune
surface détectée ici ». Poser au mauvais endroit coûte plus cher que ne rien
faire.

**`findGroundHit` élargit la recherche autour du point visé.** Les points de
feature du SLAM sont **épars** — ce n'est pas une carte de profondeur dense.
Un sol réel a presque toujours des zones de quelques pixels sans aucun point
matché, même quand la zone juste à côté en a plein (carrelage lisse, reflet,
zone surexposée). Sans marge, taper à quelques pixels d'un point valide
échouait systématiquement, alors que le sol était pourtant bien suivi juste
à côté — c'était la cause de « je vise le sol, je tape, ça refuse toujours ».
`findGroundHit` (dans `src/lib/hit-test.js`) essaie donc le point exact, puis
16 points voisins répartis sur deux anneaux (rayons 3 % et 6 % de l'écran),
et s'arrête au premier qui rend un hit plausible. Utilisé à la fois par le
réticule et par le tap de placement.

### Vérifier sur le terrain

`CONFIG.debugScale` affiche « camera : X m » en direct — mais il ne sert plus
qu'à **une seule chose : confirmer qu'un sol est détecté** (une valeur qui ne
bouge jamais, quel que soit le mouvement du téléphone, indique un suivi qui
n'accroche pas). Il ne doit **plus jamais** servir à calculer une correction —
voir l'avertissement détaillé juste après.

Le personnage `Repère 1,80 m` fourni est gradué tous les 50 cm : posez-le contre
une porte (≈ 2,04 m) pour valider d'un coup d'œil — c'est **la seule** méthode
fiable, voir ci-dessous.

> **« La calibration détruit la hauteur caméra »** — observé sur le terrain :
> ~0,9 m (plausible) avant calibration, qui s'effondre à ~0,20 m juste après le
> déplacement de calibration. Ce n'est pas une destruction : **avant** que
> `xrtrackingstatus` soit `'NORMAL'`, 8th Wall n'a pas encore convergé sur une
> estimation métrique, donc la valeur retournée n'a aucune raison de
> représenter quoi que ce soit de réel — même si elle y ressemble par
> coïncidence. La calibration ne
> casse rien, elle révèle pour la première fois l'estimation *réelle* du
> moteur (convergée, mais ici visiblement très biaisée). Le HUD étiquette
> maintenant ces lectures d'avant convergence « (pas encore calibré) » pour ne
> plus s'y laisser piéger. C'est très probablement ce qui a fait dérailler la
> tentative de calibration à deux points plus haut dans l'historique de ce
> fichier : les deux lectures mélangeaient un régime d'avant convergence avec
> un régime d'après — pas deux points sur une même droite.

### Le joueur apparaît trop grand (ou trop petit)

`reality.trackingstatus === 'NORMAL'` signifie que le suivi 6 degrés de liberté
est stable — **pas** que l'estimation métrique de l'échelle a fini de
converger. Sur certains appareils ou environnements (peu de texture au sol,
sol répétitif, mouvement de calibration trop bref), l'erreur peut être
importante alors même que le suivi fonctionne parfaitement.

**1. Méthode officielle 8th Wall, telle qu'utilisée par la plupart des
projets** : `src/components/ar-director.js` autorise le placement dès que
`reality.trackingstatus` (`xrtrackingstatus`) passe à `'NORMAL'`, point. Un
garde-fou maison à déplacement mesuré (`minCalibrationTravel` /
`maxTravelPerFrame`) a été essayé cette session puis **retiré à la demande** :
il ajoutait de la complexité sans résoudre le problème de fond (le biais varie
par session, voir plus bas), et s'écartait du fonctionnement standard/attendu.

**2. L'app fait confiance à `xrweb="scale: absolute"` par défaut** (pas de
correction manuelle sur l'écran normal — voir l'audit ci-dessous) — avec un
recours caché si besoin.

> **Pourquoi ne pas exposer un réglage manuel en permanence ?** Ça a été essayé
> et retiré. Lectures « camera : X m » observées sur le terrain, pour des
> hauteurs réelles de téléphone comparables (poitrine, ~1,4-1,6 m), sur des
> sessions différentes : 0,65 / 0,76 / 0,20-0,50 / 0,90 / 0,20 / 0,42 m. Plus
> parlant encore : le **même** `slamScaleCorrection` figé (× 0,270, validé
> visuellement une fois) a ensuite donné un résultat correct dans une session
> et un joueur trop grand dans la suivante. Le biais d'échelle du SLAM
> monoculaire de 8th Wall varie donc **par session de tracking**, pas
> seulement par lieu ou appareil — une constante fixe ne peut pas compenser une
> erreur qui change à chaque session, et un panneau de réglage visible en
> permanence sur l'écran final n'est pas non plus la bonne réponse pour un
> produit fini. Deux tentatives de formule automatique basée sur cette lecture
> (une lecture, puis deux lectures à deux hauteurs) ont par ailleurs échoué
> avant même d'en arriver à cette conclusion — voir l'historique juste
> au-dessus.

**Audit du pipeline de dimensionnement** (fait suite à une demande de
vérification explicite) : chaque étape a été relue à la recherche d'un bug
d'unité qui expliquerait des écarts aussi importants — `real-scale-figure.js`
(hauteur du sujet = `height × calibration × correction`, en unités de scène),
`lib/texture.js` (recadrage alpha, aucun ne dépend de l'échelle), `players.js`
(`heightMeters` en mètres réels, pas de conversion cachée), `ar-director.js`
(position du hit test recopiée telle quelle). **Aucune conversion d'unité
erronée trouvée** : le code traite fidèlement 1 unité de scène = 1 mètre réel,
comme le contrat documenté de `scale: absolute` l'exige. Le résiduel observé
vient donc de la qualité de convergence du moteur, pas de ce projet. Limite de
vérification à noter : la recherche web n'était pas disponible au moment de cet
audit pour croiser avec la documentation 8th Wall la plus récente ; l'analyse
s'appuie sur le comportement documenté déjà établi dans ce projet (voir
`src/lib/scale.js` et les sections précédentes).

**Recours si un écart réapparaît** : `?calibrate` réaffiche un panneau
d'ajustement visuel (cette fois caché, pas sur l'écran normal) :

```
https://<domaine>/?calibrate
```

Après une vraie calibration par déplacement, comparez le repère 1,80 m (ou le
joueur) à un objet réel connu et ajustez avec les boutons ± jusqu'à ce que la
taille corresponde. Ne reportez le chiffre obtenu dans
`CONFIG.slamScaleCorrection` (`src/config.js`) que s'il se retrouve de façon
reproductible sur plusieurs sessions distinctes — sinon laissez `1` (défaut
neutre).

La correction s'applique, via `src/lib/scale.js`, à trois endroits — quand elle
est utilisée :

- la **taille du personnage** ;
- le **diamètre du réticule** — qui suit maintenant aussi la taille du **joueur
  sélectionné** (`reticleDiameterFor`, dans `src/lib/scale.js`) : le repère
  1,80 m donne le diamètre de base (0,45 m), un joueur plus grand ou plus petit
  reçoit un réticule mis à l'échelle proportionnellement, plutôt qu'une taille
  unique pensée pour un seul personnage ;
- **tous les seuils de distance** du placement (`minDropBelowCamera`,
  `maxPlacementDistance`, `floorBandTolerance`…). Sans cette conversion, un
  moteur à `k = 0,5` rendrait `minDropBelowCamera: 0.6` équivalent à 1,2 m
  réels et rejetterait des hits de sol valides — une cause supplémentaire de
  « aucune surface détectée ».

Elle est **globale** (tous les joueurs), contrairement au `calibration` par
joueur de `src/players.js`, qui corrige un défaut du *PNG* (sujet qui ne remplit
pas tout le détourage).

---

## Bloqué au démarrage ?

L'écran de démarrage indique l'étape atteinte — **Moteur AR → Scène 3D → Caméra
→ Échelle** — et un journal détaillé s'ouvre avec `?debug` :

```
https://<ip-lan>:5173/?debug
```

Ce journal donne la compatibilité de l'appareil, les raisons d'incompatibilité en
clair, la présence du chunk SLAM et toute erreur JS capturée. C'est ce qu'il faut
lire en premier.

| Symptôme | Cause probable |
|---|---|
| **404 sur `xr.js`, `assets/index-*.js`, `xrextras.js`…** | Le dossier `dist` n'est pas servi à la racine du site. Utilisez `npm run preview`, ou déployez le **contenu** de `dist/` à la racine — pas le dossier `dist` lui-même dans un sous-répertoire, et jamais par double-clic sur `index.html`. Le build utilise désormais des chemins relatifs (`base: './'`), donc un sous-répertoire fonctionne aussi tant que la page et ses ressources restent au même niveau. |
| Page QR « Scan or visit… » | Vous êtes sur un ordinateur. L'AR exige un téléphone — scannez le QR, ou utilisez `?desktop` pour la mise en page seulement. |
| Bloqué longtemps sur **Moteur AR** | Le moteur pèse 6,5 Mo. Le serveur les sert désormais en gzip ; vérifiez que le téléphone et le PC sont sur le même réseau et que le pare-feu Windows autorise le port 5173. |
| Bloqué sur **Caméra** | Autorisation caméra refusée pour ce site. Le navigateur ne redemande pas après un refus : réautorisez dans les réglages du site. |
| « navigateur non supporté » | Vous avez ouvert le lien depuis un navigateur intégré (Instagram, Messenger, LinkedIn). Ouvrez-le dans Safari ou Chrome. |
| « capteurs de mouvement inaccessibles » | Page servie en `http://`, ou permission de mouvement refusée sur iOS. |
| Bloqué sur **Échelle** | Normal les premières secondes : avancez et reculez le téléphone jusqu'à la disparition de l'overlay. |

---

## Ce qui se passe au démarrage

L'ordre d'initialisation n'est pas cosmétique — deux courses ont été trouvées en
test automatisé et corrigées :

1. **A-Frame instancie les composants d'un `<a-scene>` dès l'analyse du HTML.**
   Notre code étant chargé en `type="module"` (donc différé), nos composants
   n'étaient pas encore enregistrés et étaient **silencieusement ignorés**.
2. **Le composant `coaching-overlay` lit la globale `XR8` dans son `init()`.**
   Comme `xr.js` est chargé en `async`, une scène initialisée trop tôt
   produisait un `ReferenceError: XR8 is not defined` bloquant.

D'où la séquence de `src/main.js` : enregistrer nos composants → attendre
`xrloaded` → **monter la scène depuis un `<template>`** → brancher le HUD.
C'est pourquoi `<a-scene>` vit dans un `<template>` et non directement dans le
corps du document.

Cette séquence a une conséquence qu'il faut gérer explicitement. En lisant le
binaire :

```js
yield Promise.all((chunks || []).map((c) => XR8.loadChunk(c)))
window.XR8 = engine
setTimeout(() => window.dispatchEvent(new CustomEvent('xrloaded')), 1)
```

`xrloaded` n'est émis **qu'après** le téléchargement de `xr.js` (1 Mo) *et* de
`xr-slam.js` (5,5 Mo). Pendant toute cette phase — la plus longue du démarrage —
aucun composant 8th Wall n'est actif : ni l'écran de chargement XRExtras, ni la
page « appareil non supporté ». Sans écran de démarrage propre, la page reste
figée et un échec réel est indiscernable d'un téléchargement lent.

D'où trois mesures :

- **`src/ui/boot-screen.js`** est dans le HTML dès le premier octet, affiche
  l'étape en cours, le temps écoulé, et capture les erreurs non interceptées ;
- le serveur de dev **compresse en gzip** (`vite.config.js`) — sans quoi les
  6,5 Mo partent bruts. Cela impose `proxy: {}`, qui force Vite en HTTP/1.1,
  car `compression` ne sait pas répondre en HTTP/2 ;
- sur un appareil incompatible, `xrweb` n'émet **plus aucun événement** : on
  détecte le cas via `XR8.XrDevice.isDeviceBrowserCompatible()` et on retire
  notre écran pour laisser apparaître la page QR de 8th Wall (z-index 815, elle
  était sinon masquée par nos overlays).

---

## Photo et partage

Le composant `xrweb` installe lui-même `XR8.CanvasScreenshot.pipelineModule()` et
câble `screenshotrequest` → `screenshotready` (JPEG en base64).

La capture porte sur le **canvas WebGL** : flux caméra + 3D. Le HUD est du HTML
posé au-dessus, il n'apparaît donc pas sur la photo — inutile de le masquer.
Seul le réticule, qui est dans la scène 3D, est retiré le temps du déclenchement.

**Le piège du partage natif :** `navigator.share()` exige une activation
transitoire, or la capture est asynchrone. Safari iOS invalide souvent
l'activation entre-temps. La stratégie est donc en deux temps : partage direct,
et si le navigateur refuse (`NotAllowedError`), affichage d'un panneau avec un
bouton « Partager » qui repart d'un geste neuf — plus un lien de téléchargement
pour les navigateurs sans Web Share (desktop, Firefox).

---

## Réglages utiles

| Fichier | Réglage |
|---|---|
| `src/config.js` | `orientationMode` : `'fixed'` (actuel), `'yaw'` (billboard), `'soft'` (fixe mais pivote au-delà de 55°) |
| `src/config.js` | `maxPlacementDistance`, `minDropBelowCamera`, `floorBandTolerance` — filtres de placement |
| `src/config.js` | `screenshot.maxDimension` / `jpgCompression` — qualité photo |
| `src/config.js` | `debugScale` — passez à `false` avant mise en production |
| `src/players.js` | catalogue, tailles réelles, `calibration`, `feetInset` |

**Sur `orientationMode`** — le mode actuel est `'fixed'` : le joueur garde
l'orientation qu'il avait au moment du placement. C'est le comportement demandé,
mais un découpage plat vu de profil devient invisible. Si vos utilisateurs
tournent beaucoup autour du personnage, `'soft'` est un bon compromis : il reste
fixe tant que l'angle reste lisible, et ne pivote qu'au-delà.

---

## Architecture

```
index.html                      scripts vendeurs + <template> de scène + HUD
vite.config.js                  copie des dist 8th Wall, HTTPS de dev
src/
  main.js                       séquence de démarrage
  config.js                     réglages globaux
  players.js                    catalogue des personnages
  lib/
    texture.js                  recadrage alpha, texture d'ombre
    hit-test.js                 hitTest, filtrage, estimateur de sol
    scale.js                    mètres réels <-> unités de scène, taille du réticule par joueur
  components/
    real-scale-figure.js        plan dimensionné en mètres réels
    contact-shadow.js           ombre de contact au sol
    ground-reticle.js           réticule de visée
    ar-director.js              états, taps, placement, orientation
  ui/
    photo.js                    capture + partage natif
    hud.js                      interface HTML
public/players/                 PNG détourés
tests/                          banc de test hors AR (Playwright)
```

---

## Licence du moteur

Le binaire 8th Wall est distribué sous **XR Engine License Agreement**
(Niantic Spatial, Inc.) — ce n'est **pas** de l'open source.

- L'en-tête de copyright en tête de `external/xr/xr.js` doit être **conservé**
  (ne le supprimez pas au minify). L'attribution est aussi rappelée en
  commentaire dans `index.html` et en pied de HUD.
- Usage commercial autorisé **sauf** si votre produit est payant *et* que sa
  valeur dérive entièrement ou substantiellement du moteur.
- Licence révocable, pas de rétro-ingénierie, pas de sous-licence.
- VPS, Area Targets, Lightship Maps et le hand tracking ne sont **pas** inclus
  dans ce binaire.

Texte complet : <https://github.com/8thwall/engine/blob/main/LICENSE>

Aucune clé d'application n'est nécessaire : le binaire ne fait aucun appel
d'autorisation. Gardez en revanche le fichier nommé exactement `xr.js` — le
moteur retrouve sa propre balise script via la regex `/(xrweb|xr\.js)(\?.*)?$/`.

---

## Limites connues

- **Pas d'occlusion.** Le joueur s'affiche par-dessus les objets réels ; si
  quelqu'un passe devant lui, l'illusion se rompt. L'occlusion par profondeur
  n'est pas exposée par ce binaire.
- **Découpage plat.** En mode `'fixed'`, vu de côté, le personnage disparaît.
- **Sols peu texturés ou répétitifs** (moquette unie, béton lisse, carrelage) :
  peu de points de feature, donc peu ou pas de hits exactement là où l'on vise.
  `findGroundHit` élargit déjà la recherche à un petit voisinage (voir plus
  haut) pour absorber ça, mais un sol vraiment uniforme reste une limite
  physique du SLAM monoculaire, pas un bug applicatif. Si « Aucune surface
  détectée ici » persiste malgré plusieurs essais : visez un point contrasté
  (un joint de carrelage, le bord d'un tapis, une tache, un pied de meuble)
  plutôt que le centre d'une dalle unie, et évitez le carrelage brillant sous
  un éclairage direct (le reflet spéculaire bouge avec la caméra et empêche
  tout matching).
- **Support de l'absolute scale par appareil** : non documenté par 8th Wall, et
  `XR8.XrDevice` n'expose aucun indicateur de capacité. Le verrou sur
  `xrtrackingstatus` est le seul garde-fou fiable.
