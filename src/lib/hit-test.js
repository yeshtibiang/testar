import {CONFIG} from '../config.js'
import {m} from './scale.js'

// ---------------------------------------------------------------------------
// Couche mince au-dessus de XR8.XrController.hitTest().
//
// Rappels sur l'API (verifie dans le binaire 8th Wall 1.0.0) :
//  - hitTest(x, y, includedTypes) attend x et y NORMALISES 0..1, y du HAUT vers
//    le bas de l'ecran.
//  - le seul type accepte en ENTREE est 'FEATURE_POINT' ; en SORTIE on peut
//    recevoir 'DETECTED_SURFACE', 'ESTIMATED_SURFACE', 'FEATURE_POINT' ou
//    'UNSPECIFIED'.
//  - la fonction vit dans le chunk `xr-slam.js` : XR8.XrController vaut null
//    tant que le chunk n'est pas charge. D'ou le garde-fou ci-dessous.
//  - elle renvoie [] (et non null) si le moteur n'est pas encore demarre.
//
// En mode `scale: 'absolute'`, toutes les positions renvoyees sont en METRES.
// ---------------------------------------------------------------------------

/**
 * Hauteur de la camera dans la scene, en metres (echelle absolue).
 *
 * On passe par getWorldPosition() et non par `camera.parent.position` : xrweb
 * reparente librement la camera (session WebXR casque, emulation desktop...),
 * seule la position monde est fiable.
 */
const _camPos = {v: null}
export function getCameraWorldY(sceneEl) {
  const cam = sceneEl && sceneEl.camera
  if (!cam) return null
  if (!_camPos.v) _camPos.v = new AFRAME.THREE.Vector3()
  cam.getWorldPosition(_camPos.v)
  return _camPos.v.y
}

// Plus le type est fiable, plus le rang est eleve.
const TYPE_RANK = {
  DETECTED_SURFACE: 3,
  ESTIMATED_SURFACE: 2,
  FEATURE_POINT: 1,
  UNSPECIFIED: 0,
}

export const hitTestReady = () =>
  !!(window.XR8 && window.XR8.XrController && typeof window.XR8.XrController.hitTest === 'function')

/** hitTest brut en coordonnees normalisees. Renvoie toujours un tableau. */
export function rawHitTest(nx, ny) {
  if (!hitTestReady()) return []
  try {
    return window.XR8.XrController.hitTest(nx, ny, ['FEATURE_POINT']) || []
  } catch (e) {
    console.warn('[kayfo-ar] hitTest a echoue', e)
    return []
  }
}

/**
 * Choisit le meilleur candidat "sol" parmi les resultats d'un hitTest.
 *
 * Deux filtres, dans cet ordre :
 *  1. plausibilite  : pas trop loin, et suffisamment SOUS la camera. Sans ca on
 *     colle regulierement le joueur sur un mur, une table ou un buisson.
 *     Des qu'un niveau de sol est connu, on exige en plus que le hit reste dans
 *     sa bande : c'est ce qui empeche de poser le joueur sur une table apres
 *     l'avoir pose au sol.
 *  2. qualite       : surface detectee > surface estimee > point de feature,
 *     puis le plus proche.
 *
 * Si aucun candidat ne passe le filtre de plausibilite on ne retombe PAS sur
 * les rebuts : mieux vaut ne rien poser que poser a un endroit absurde.
 *
 * @param {Array} results resultat de rawHitTest
 * @param {number|null} cameraY hauteur camera en metres (echelle absolue)
 * @param {number|null} [floorY] niveau de sol deja estime, si connu
 */
export function pickGroundHit(results, cameraY, floorY = null) {
  if (!results || !results.length) return null

  // Tous les seuils sont convertis metres reels -> unites de scene via m().
  // Les comparaisons de hauteur portent sur des DIFFERENCES, donc l'offset du
  // plan de sol se simplifie : seule l'echelle doit etre corrigee ici.
  const plausible = results.filter((hit) => {
    if (!hit || !hit.position) return false
    if (Number.isFinite(hit.distance) && hit.distance > m(CONFIG.maxPlacementDistance)) return false
    if (Number.isFinite(cameraY) && hit.position.y > cameraY - m(CONFIG.minDropBelowCamera)) return false
    if (Number.isFinite(floorY) && hit.position.y > floorY + m(CONFIG.floorBandTolerance)) return false
    return true
  })

  if (!plausible.length) return null

  plausible.sort((a, b) => {
    const rank = (TYPE_RANK[b.type] ?? 0) - (TYPE_RANK[a.type] ?? 0)
    if (rank !== 0) return rank
    return (a.distance ?? Infinity) - (b.distance ?? Infinity)
  })

  return plausible[0]
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

// Anneaux de points a essayer autour de la cible si le point exact ne rend
// rien. Coordonnees normalisees (0..1), donc independantes de la resolution.
const NEIGHBOR_OFFSETS = (() => {
  const offsets = [{dx: 0, dy: 0}]
  for (const r of [0.03, 0.06]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      offsets.push({dx: Math.cos(a) * r, dy: Math.sin(a) * r})
    }
  }
  return offsets
})()

/**
 * Comme pickGroundHit(rawHitTest(nx, ny), ...), mais elargit la recherche a un
 * petit voisinage autour du point vise si celui-ci ne rend rien.
 *
 * POURQUOI : les points de feature du SLAM sont EPARS, pas une carte de
 * profondeur dense. Un sol reel a presque toujours des zones de quelques
 * pixels sans aucun point matche, meme quand la zone voisine en a plein —
 * carrelage lisse, reflet, zone sur-exposee, grain de l'image a cet endroit
 * precis. Sans cette marge, viser (ou taper) a quelques pixels d'un point
 * valide echoue systematiquement avec "aucune surface detectee", alors que le
 * sol EST bien suivi juste a cote. On essaie donc 17 points au total (le
 * centre, puis deux anneaux) et on s'arrete au premier hit plausible — pas
 * la peine de tous les tirer si le deuxieme point suffit.
 */
export function findGroundHit(nx, ny, cameraY, floorY = null) {
  for (const {dx, dy} of NEIGHBOR_OFFSETS) {
    const hit = pickGroundHit(rawHitTest(clamp01(nx + dx), clamp01(ny + dy)), cameraY, floorY)
    if (hit) return hit
  }
  return null
}

// Grille fixe (pas centree sur un tap) balayant la zone de l'ecran ou le sol
// se trouve generalement. Utilisee uniquement pour DECOUVRIR la hauteur du
// sol une fois par session (voir scanFloorLevel) : peu importe ou exactement
// dans cette zone le hit atterrit, seule sa hauteur nous interesse.
const SCAN_GRID = (() => {
  const xs = [0.2, 0.35, 0.5, 0.65, 0.8]
  const ys = [0.55, 0.68, 0.8, 0.92]
  const points = []
  for (const y of ys) for (const x of xs) points.push({x, y})
  return points
})()

/**
 * Balaye toute la zone basse de l'ecran a la recherche de N'IMPORTE QUEL hit
 * de sol plausible, sans se soucier de sa position exacte.
 *
 * POURQUOI (different de findGroundHit) : findGroundHit cherche un hit PRECIS
 * sous un point tape, avec une toute petite marge (voisinage de quelques %).
 * Ici, tant qu'on n'a jamais etabli la hauteur du sol, on n'a pas besoin de
 * precision de position — seulement de LA HAUTEUR. Sur un sol tres peu
 * texture (carrelage uni), la zone tapee peut n'avoir aucun point de feature
 * alors qu'un coin de tapis, un pied de meuble ou un seuil de porte ailleurs
 * a l'ecran en a. Une fois qu'un seul hit reussit ici, floor.level est connu
 * et tous les taps suivants passent par intersectFloorPlane (pure geometrie,
 * plus besoin du tout de hitTest).
 */
export function scanFloorLevel(cameraY) {
  for (const {x, y} of SCAN_GRID) {
    const hit = pickGroundHit(rawHitTest(x, y), cameraY, null)
    if (hit) return hit
  }
  return null
}

// Reutilise entre deux appels : eviter une allocation par tap.
const _raycaster = {v: null}

/**
 * Intersection du rayon camera -> point ecran (nx, ny normalises 0..1, y du
 * haut vers le bas) avec le plan horizontal `y = floorY`.
 *
 * Remplace le hitTest SLAM une fois que la hauteur du sol est connue : ce
 * calcul ne depend que de la pose 6DoF de la camera (fiable en continu, tant
 * que le tracking est NORMAL) et pas du tout de la texture visible au sol a
 * l'endroit tape. C'est ce qui rend le placement fiable sur un carrelage uni.
 *
 * @param {number} nx coordonnee ecran normalisee (0..1)
 * @param {number} ny coordonnee ecran normalisee (0..1), 0 = haut
 * @param {THREE.Camera} camera camera de la scene (`sceneEl.camera`)
 * @param {number} floorY hauteur du sol connue, en unites de scene
 * @returns {{position: {x:number,y:number,z:number}, type: string, distance: number}|null}
 */
export function intersectFloorPlane(nx, ny, camera, floorY) {
  if (!camera || !Number.isFinite(floorY)) return null
  if (!_raycaster.v) _raycaster.v = new AFRAME.THREE.Raycaster()
  const raycaster = _raycaster.v

  const ndcX = clamp01(nx) * 2 - 1
  const ndcY = -(clamp01(ny) * 2 - 1)
  raycaster.setFromCamera({x: ndcX, y: ndcY}, camera)

  const dirY = raycaster.ray.direction.y
  // Rayon horizontal ou pointant vers le haut : aucune intersection devant
  // soi avec un plan de sol situe sous la camera (viser au-dessus de
  // l'horizon).
  if (dirY >= -1e-6) return null

  const t = (floorY - raycaster.ray.origin.y) / dirY
  if (!Number.isFinite(t) || t <= 0) return null
  if (t > m(CONFIG.maxPlacementDistance)) return null

  const point = raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, t)
  return {position: {x: point.x, y: point.y, z: point.z}, type: 'FLOOR_PLANE', distance: t}
}

/**
 * Estimateur du niveau du sol.
 *
 * Le hitTest renvoie un y legerement different a chaque tir. Sans lissage, le
 * joueur "saute" verticalement de quelques centimetres a chaque deplacement, ce
 * qui casse immediatement l'illusion de taille reelle. On maintient donc une
 * moyenne glissante et on y aligne les nouveaux hits proches.
 */
export function createFloorEstimator() {
  let level = null

  return {
    get level() {
      return level
    },
    reset() {
      level = null
    },
    /** @param {number} y hauteur brute du hit -> renvoie la hauteur a utiliser */
    snap(y) {
      if (!Number.isFinite(y)) return level ?? 0
      if (level === null) {
        level = y
        return level
      }
      if (Math.abs(y - level) <= m(CONFIG.floorSnapTolerance)) {
        // Meme sol : on affine doucement l'estimation et on aligne.
        level += (y - level) * CONFIG.floorSmoothing
        return level
      }
      // Ecart important : l'utilisateur vise un autre niveau (marche, estrade).
      level = y
      return level
    },
  }
}
