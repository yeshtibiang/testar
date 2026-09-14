// ---------------------------------------------------------------------------
// Redemarrage complet du moteur XR8 (camera + tracking), en place (pas de
// rechargement de page).
//
// POURQUOI CE MODULE EXISTE (verifie dans le binaire 8th Wall : xr.js /
// xr-slam.js sous dist/external/xr/) :
//
//  - `XR8.XrController.recenter()` (voir hit-test.js) ne fait que re-zeroter
//    la pose/l'origine rapportee (appel natif `_c8EmAsm_recenter()`). Il NE
//    reinitialise NI la carte de features du SLAM NI le biais d'estimation
//    d'echelle monoculaire — ce n'est pas ce qui corrige "le SLAM ne
//    fonctionne plus correctement apres Recenter".
//
//  - Doc officielle 8th Wall : `XR8.stop()` "closes the camera feed and
//    stops device motion tracking; you must call XR8.run() to restart".
//    Verifie dans xr-slam.js : le module pipeline interne "reality" repond a
//    l'arret via un hook `onSessionDetach` qui appelle
//    `_c8EmAsm_engineCleanup()` (nettoyage natif du moteur SLAM) et remet a
//    zero la carte de features, la position/rotation internes, etc. C'est ce
//    nettoyage complet qui manque a `recenter()`.
//
//  - PIEGE DECOUVERT EN AUDITANT xr.js : le composant `xrweb` expose bien des
//    evenements de scene internes `stopxr` / `runxr` (respectivement
//    `XR8.stop()` et `XR8.run(g.runConfig)`, `g.runConfig` etant mis en cache
//    dans la closure du composant) — mais ce MEME composant met
//    `g.runConfig = null` dans son PROPRE gestionnaire `onSessionDetach`, qui
//    se declenche de facon SYNCHRONE a l'interieur de `XR8.stop()` lui-meme
//    (aucune Promise, aucun delai). Emettre `stopxr` puis `runxr` revient
//    donc, quel que soit le delai entre les deux, a executer `XR8.run(null)`
//    — ce n'est pas un probleme de timing, la config est deja perdue.
//
//    On evite ce piege en ne s'appuyant PAS sur `runxr`. A la place, on
//    retire puis on remet l'attribut HTML `xrweb` sur la scene :
//    `removeAttribute` detruit proprement l'instance du composant existante
//    (son `remove()` appelle deja `XR8.stop()`), et `setAttribute` en cree
//    une TOUTE NOUVELLE instance, qui reconstruit sa config depuis ses
//    attributs — exactement la meme logique que celle executee au tout
//    premier montage de la scene (y compris le mode `?desktop`, voir
//    src/main.js mountScene()), sans qu'on ait besoin de la reconstruire
//    nous-memes a la main. C'est toujours, fondamentalement, un cycle
//    `XR8.stop()` -> `XR8.run()` en place : seule la maniere de le
//    declencher change.
//
//  - Aucune garantie documentee sur le delai necessaire entre la coupure
//    reelle de la camera et un nouvel appel a `XR8.run()`. `XR8.stop()` est
//    synchrone cote JS, mais la liberation materielle de la camera par le
//    navigateur/l'OS peut trainer de quelques centaines de ms sur certains
//    Android bas de gamme (probleme connu, independant de 8th Wall, des
//    cycles rapproches `MediaStreamTrack.stop()` + nouvelle capture). D'ou le
//    delai fixe ci-dessous : une precaution defensive, PAS une garantie —
//    aucune erreur catchable n'est exposee par le moteur sur ce chemin, donc
//    impossible de detecter/retenter automatiquement un echec silencieux ici.
//    A confirmer sur le terrain.
// ---------------------------------------------------------------------------

const RESTART_DELAY_MS = 300

/**
 * Redemarre completement le moteur XR8 (camera + tracking SLAM) sur la scene
 * donnee, sans recharger la page. La promesse se resout une fois le nouveau
 * cycle `XR8.run()` declenche (pas une fois le suivi redevenu NORMAL : ca,
 * `ar-director` le detecte lui-meme via `xrtrackingstatus`).
 *
 * @param {HTMLElement} sceneEl <a-scene> portant l'attribut `xrweb`.
 * @returns {Promise<void>}
 */
export function restartXrEngine(sceneEl) {
  return new Promise((resolve) => {
    const xrwebValue = sceneEl.getAttribute('xrweb')
    if (!xrwebValue) {
      // Ne devrait pas arriver en usage normal (voir index.html), mais on
      // evite de planter silencieusement si xrweb est absent.
      console.warn('[kayfo-ar] restartXrEngine: attribut xrweb introuvable sur la scene')
      resolve()
      return
    }

    // removeAttribute -> remove() de l'instance xrweb existante -> appelle
    // deja XR8.stop() (voir dist/external/xr/xr.js, remove:function()).
    sceneEl.removeAttribute('xrweb')

    setTimeout(() => {
      // setAttribute recree une instance neuve du composant xrweb : son
      // init() reconstruit sa config depuis ses attributs et appelle
      // lui-meme XR8.run() avec cette config fraiche (sauf `delayRun`,
      // jamais utilise ici).
      sceneEl.setAttribute('xrweb', xrwebValue)
      resolve()
    }, RESTART_DELAY_MS)
  })
}
