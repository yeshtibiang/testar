// ---------------------------------------------------------------------------
// Catalogue des personnages.
//
// `heightMeters` = taille REELLE du joueur, en metres, des pieds au sommet du
// crane. C'est la seule valeur qui determine l'echelle a l'ecran : l'app
// recadre automatiquement le PNG sur sa zone opaque (voir lib/texture.js), donc
// les marges transparentes de l'image n'ont AUCUNE influence.
//
// `calibration` (optionnel, defaut 1) : correcteur si le sujet n'occupe pas
// toute la hauteur utile de l'image. Cas typiques :
//   - le joueur est photographie legerement de trois-quarts / jambes flechies
//     -> il "mesure" moins que sa taille reelle sur la photo -> calibration < 1
//   - une ombre portee ou un socle est inclus dans le decoupage sous les pieds
//     -> calibration < 1 aussi.
// Reglez-le une seule fois en comparant avec une personne reelle a cote.
//
// `feetInset` (optionnel, defaut 0) : fraction de la hauteur du decoupage qui,
// tout en bas, n'est PAS le joueur (ombre au sol conservee dans le PNG...).
// Le personnage est remonte d'autant pour que ses semelles touchent le sol.
// ---------------------------------------------------------------------------

// Les chemins d'images passent par BASE_URL, pas par un `/` en dur : le build
// utilise `base: './'` pour rester deplacable (voir vite.config.js), donc une
// URL absolue casserait des que l'app n'est pas servie a la racine du domaine.
// En developpement, Vite ramene BASE_URL a '/' : le comportement est identique.
const asset = (path) => `${import.meta.env.BASE_URL}${path}`

export const PLAYERS = [
  // Silhouette de controle graduee tous les 50 cm. Gardez-la : c'est le moyen
  // le plus rapide de verifier que l'echelle absolue est bien calibree
  // (comparez-la a une porte, ~2,04 m, ou a une personne dont vous savez la taille).
  {
    id: 'reference',
    name: 'Repere 1,80 m',
    src: asset('players/placeholder.png'),
    heightMeters: 1.8,
    calibration: 1,
    feetInset: 0,
  },

  // Vos joueurs : deposez le PNG detoure dans public/players/ et renseignez
  // sa taille reelle. Rien d'autre a faire, le recadrage est automatique.
  {
    id: 'springbok-01',
    name: 'Joueur 1',
    src: asset('players/springbok-01.png'),
    heightMeters: 1.90,
    calibration: 1,
    feetInset: 0,
  },
]

export const DEFAULT_PLAYER_ID = PLAYERS[1].id

export const getPlayer = (id) => PLAYERS.find((p) => p.id === id) || PLAYERS[0]
