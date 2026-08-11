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
