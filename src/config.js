// ---------------------------------------------------------------------------
// Reglages globaux de l'experience.
// ---------------------------------------------------------------------------

export const CONFIG = {
  // Orientation du personnage une fois pose.
  //   'fixed' : garde l'orientation du moment ou on l'a pose (choix actuel).
  //             L'utilisateur peut tourner autour ; vu de profil un decoupage
  //             plat disparait (c'est le comportement demande).
  //   'yaw'   : billboard sur l'axe Y, fait toujours face a la camera.
  //   'soft'  : fixe, mais pivote doucement pour rester lisible quand la camera
  //             depasse SOFT_BILLBOARD_MAX_DEG. Bon compromis pour un decoupage.
  orientationMode: 'fixed',

  // Utilise seulement en mode 'soft'.
  softBillboardMaxDeg: 55,
  softBillboardSpeed: 2.5, // rad/s

  // Placement --------------------------------------------------------------
  // Un hitTest au-dela de cette distance est ignore : au-dela de ~12 m, les
  // points de feature SLAM sont trop bruites pour un placement credible.
  maxPlacementDistance: 12,

  // Le point vise doit etre au moins X metres SOUS la camera pour etre
  // considere comme du sol (evite de coller le joueur sur un mur ou une table).
  // 0.6 m rejette une table basse tout en laissant passer un sol vise
  // telephone tenu bas.
  minDropBelowCamera: 0.6,

  // Une fois le niveau du sol connu, un hit situe plus de X metres AU-DESSUS de
  // ce niveau est refuse : impossible de reposer le joueur sur une table apres
  // l'avoir pose par terre. Genereux pour rester compatible avec une marche.
  floorBandTolerance: 0.5,

  // Stabilisation du niveau du sol : on lisse les hauteurs des hits successifs.
  // Si un nouveau hit est a moins de floorSnapTolerance du niveau estime, on
  // l'aligne dessus -> le joueur ne "flotte" plus d'un tap a l'autre.
  floorSnapTolerance: 0.35,
  floorSmoothing: 0.15, // 0 = fige, 1 = suit chaque mesure

  // Decouverte du sol --------------------------------------------------------
  // Frequence (Hz) du balayage de fond qui cherche la hauteur du sol tant
  // qu'elle n'est pas connue (voir scanFloorLevel dans src/lib/hit-test.js).
  // Devient un no-op des que floor.level est trouve : pas besoin d'aller tres
  // vite, juste de ne pas rater l'occasion pendant que l'utilisateur bouge
  // le telephone en phase "ready".
  floorScanHz: 5,

  // Photo ------------------------------------------------------------------
  screenshot: {
    maxDimension: 2048, // 8th Wall par defaut : 1280. 2048 = photo partageable.
    jpgCompression: 92,
  },
  shareTitle: 'Kayfo AR',
  shareText: 'Photo taken in augmented reality with Kayfo AR.',

  // Interface utilisateur ---------------------------------------------------
  //
  // Les deux options ci-dessous COMMENTENT (masquent, sans supprimer le code)
  // des elements demandes hors de l'ecran grand public :
  //   - le readout de debug "camera : X m" ;
  //   - le selecteur de joueur (puces "Repere 1,80 m" / "Joueur 1").
  // Les deux mecanismes restent intacts et se reactivent en repassant le
  // drapeau correspondant a `true`.

  // Affiche "camera : X m" dans le HUD, a cote du reglage de taille +/-.
  // Passe a `true` par defaut a la demande d'un testeur, qui veut pouvoir
  // comparer les deux d'un coup d'oeil. Reste aussi utile pour verifier
  // qu'un sol EST detecte une fois le suivi stable (une valeur qui ne bouge
  // jamais indique un suivi qui n'accroche pas) — pas pour juger ou calculer
  // une taille : voir l'historique dans src/lib/scale.js.
  debugScale: true,

  // Affiche la bande de selection de joueur (puces en bas d'ecran). Retiree
  // de l'ecran normal a la demande : l'app affiche directement
  // `kioskDefaultPlayerId` ci-dessous, sans selecteur visible.
  showPlayerSelector: false,

  // Joueur affiche par defaut quand `showPlayerSelector` est false. Choix du
  // vrai joueur (et non le repere 1,80 m utilise pour la calibration visuelle)
  // puisque sans selecteur visible, l'app doit montrer le produit reel.
  // HYPOTHESE : a confirmer/ajuster si un autre joueur doit etre le defaut.
  kioskDefaultPlayerId: 'springbok-01',

  // Debug --------------------------------------------------------------------
  //
  // NE PAS se servir de "camera : X m" (ci-dessus) pour CALCULER
  // `slamScaleCorrection` plus bas, sous aucune forme (ni `affiche / reel`, ni
  // une formule a deux points). Essaye et abandonne deux fois : sur le
  // terrain, en levant reellement le telephone de 0,19 m a 1,92 m, la valeur
  // affichee a BAISSE (0,50 -> 0,20) au lieu d'augmenter. Voir src/lib/scale.js
  // pour le detail des tentatives.
  //
  // Explication decouverte apres coup : une lecture prise AVANT que le suivi
  // (`xrtrackingstatus`) soit NORMAL n'a aucune raison de representer quoi que
  // ce soit de reel, meme si elle y ressemble par coincidence.

  // Calibration de l'echelle absolue -----------------------------------------
  //
  // METHODE OFFICIELLE (revenue a la demande, celle utilisee par la plupart
  // des projets 8th Wall) : `xrweb="scale: absolute"` + le coaching-overlay
  // integre au moteur gerent entierement la calibration. Le placement n'est
  // autorise que lorsque `reality.trackingstatus` (evenement
  // `xrtrackingstatus`) vaut `'NORMAL'` — voir src/components/ar-director.js.
  // Le garde-fou maison a deplacement mesure (`minCalibrationTravel` /
  // `maxTravelPerFrame`) a ete retire : il n'est pas necessaire avec cette
  // approche standard, et compliquait le diagnostic sans ameliorer la
  // fiabilite mesuree sur le terrain.
  //
  // Correction residuelle du biais d'echelle. Multiplicateur applique a la
  // hauteur du personnage ET a tous les seuils de distance ci-dessus (via
  // src/lib/scale.js) — sans quoi un moteur qui sous-estime l'echelle
  // rendrait `minDropBelowCamera: 0.6` equivalent a 1,2 m reels et
  // rejetterait des hits de sol parfaitement valides.
  //
  //    NEUTRE PAR DEFAUT (1) : l'app fait entierement confiance a
  //    `xrweb="scale: absolute"` — le personnage est dimensionne uniquement a
  //    partir de donnees reelles (heightMeters du joueur, voir
  //    src/players.js), pas d'un fudge factor. Ajustable en direct via les
  //    boutons − / + du HUD (visibles une fois le joueur pose, voir
  //    src/ui/hud.js) ou le panneau plus fin ?calibrate.
  //
  //    On a mesure sur le terrain que le biais du SLAM monoculaire de 8th Wall
  //    varie par SESSION (pas seulement par lieu/appareil) : ×0,270 mesure une
  //    fois par comparaison visuelle a ensuite donne un resultat correct une
  //    session, trop grand la suivante. Une constante figee ne peut donc pas
  //    generaliser de facon fiable — d'ou le retour a 1 par defaut plutot que
  //    de re-figer une valeur qui a deja ete invalidee par ce test.
  //
  //    Si un ecart de taille reapparait sur le terrain, ?calibrate (panneau
  //    cache, voir src/ui/hud.js) permet un ajustement visuel ponctuel :
  //    a. Attendez que l'app autorise le placement (suivi NORMAL).
  //    b. Posez le repere 1,80 m a cote d'un objet reel connu — porte
  //       (≈2,04-2,10 m), metre ruban, une personne de taille connue.
  //    c. Ajustez avec les boutons ± du panneau jusqu'a ce que la taille
  //       affichee corresponde.
  //    Ne reportez le chiffre obtenu ici que s'il se retrouve de facon
  //    reproductible sur plusieurs sessions distinctes — sinon laissez 1.
  slamScaleCorrection: 0.300,
}
