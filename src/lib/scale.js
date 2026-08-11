import {CONFIG} from '../config.js'

// ---------------------------------------------------------------------------
// Conversion metres reels <-> unites de scene.
//
// D'OU VIENT `correction`, ET POURQUOI ON NE LA CALCULE PLUS
// ---------------------------------------------------------------------------
// Deux methodes numeriques ont ete essayees pour deriver ce multiplicateur a
// partir du debug "camera : X m", et abandonnees dans cet ordre :
//
//  1. correction = affiche / reel, sur UNE lecture.
//  2. correction = (affiche_haut - affiche_bas) / (reel_haut - reel_bas), sur
//     DEUX lectures a deux hauteurs — l'idee etant qu'une relation affine
//     (affiche = k x reel + offset, l'offset venant d'un plan de sol mal
//     positionne) s'annulerait par soustraction.
//
// La 2e s'est effondree sur mesure reelle : en levant le telephone de 0,19 m
// a 1,92 m (+1,73 m reels), la valeur AFFICHEE a BAISSE (0,50 -> 0,20 m).
// Aucun modele (proportionnel, affine, avec ou sans offset) ne peut produire
// une lecture qui diminue quand la hauteur reelle augmente : l'estimation
// verticale du SLAM n'est simplement pas assez stable ici pour servir de
// signal de calcul.
//
// `correction` est donc desormais purement EMPIRIQUE : ajustee a la main via
// les boutons ± du panneau ?calibrate, par comparaison visuelle du repere
// 1,80 m avec un objet reel connu — la seule methode qui a produit un
// resultat correct sur le terrain dans ce projet.
// ---------------------------------------------------------------------------

let correction = CONFIG.slamScaleCorrection

export const getCorrection = () => correction

export function setCorrection(k) {
  correction = Math.max(0.05, Number.isFinite(k) ? k : 1)
  return correction
}

/**
 * Convertit une distance exprimee en METRES REELS vers les unites de scene.
 *
 * A utiliser pour TOUT seuil de distance issu de la config. Sans ca, un moteur
 * qui sous-estime l'echelle d'un facteur 2 rend `minDropBelowCamera: 0.6`
 * equivalent a 1,2 m reels : des hits de sol parfaitement valides sont alors
 * rejetes, et l'utilisateur voit "aucune surface detectee" sans comprendre.
 */
export const m = (realMeters) => realMeters * correction

// Hauteur du personnage repere ("Repere 1,80 m", voir src/players.js) pour
// laquelle le reticule vaut exactement son diametre de base. Les autres
// joueurs recoivent un reticule mis a l'echelle proportionnellement a leur
// propre taille reelle : un joueur de 1,50 m n'a pas le meme encombrement au
// sol qu'un joueur de 2,00 m, le reticule doit rester un repere honnete pour
// chacun, pas une taille unique pensee pour le repere.
const REFERENCE_HEIGHT = 1.8
const BASE_RETICLE_DIAMETER = 0.45 // doit rester synchronise avec le defaut du schema ground-reticle.js

/**
 * Diametre du reticule (en metres, avant `correction`) pour un joueur d'une
 * hauteur reelle donnee.
 */
export function reticleDiameterFor(heightMeters) {
  if (!Number.isFinite(heightMeters) || heightMeters <= 0) return BASE_RETICLE_DIAMETER
  return BASE_RETICLE_DIAMETER * (heightMeters / REFERENCE_HEIGHT)
}
