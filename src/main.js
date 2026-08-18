// ---------------------------------------------------------------------------
// Point d'entree — sequence de demarrage.
//
//   1. enregistrer nos composants A-Frame   (imports ci-dessous)
//   2. attendre `xrloaded`                  (window.XR8 disponible)
//   3. monter la scene depuis son <template>
//   4. brancher le HUD
//
// L'ordre n'est pas cosmetique, voir le long commentaire dans index.html :
// inverser 1 et 3 fait ignorer nos composants, inverser 2 et 3 fait planter
// `coaching-overlay` sur un "XR8 is not defined".
//
// L'etape 2 est aussi la plus LENTE : `xrloaded` n'est emis qu'apres le
// telechargement de xr.js + xr-slam.js (~6,5 Mo). D'ou l'ecran de demarrage,
// qui rend cette attente lisible au lieu de la laisser passer pour un plantage.
// ---------------------------------------------------------------------------

import './components/real-scale-figure.js'
import './components/contact-shadow.js'
import './components/ar-director.js'

import {createBootScreen} from './ui/boot-screen.js'
import {initHud} from './ui/hud.js'

// Genereux a dessein : 6,5 Mo sur un Wi-Fi mediocre, ou une 4G partagee,
// depassent facilement 30 s au premier chargement. Un delai trop court
// transformait un telechargement lent en faux message d'echec.
const ENGINE_TIMEOUT_MS = 120000

// Message dedie au cas le plus frequent en production : `dist/` servi ailleurs
// qu'a la racine, ce qui fait renvoyer 404 a toutes les ressources absolues.
const VENDOR_404 =
  'Les fichiers du moteur AR sont introuvables (404). Servez le dossier `dist` ' +
  'a la racine du site — par exemple avec `npm run preview` — et non depuis un ' +
  'sous-dossier ni par double-clic sur index.html.'

const whenEngineReady = (boot) =>
  new Promise((resolve, reject) => {
    if (window.XR8) return resolve()

    // Les balises <script> vendeur portent un onerror qui renseigne cette
    // variable. Sans cette verification, un simple 404 se traduisait par deux
    // minutes d'attente muette avant un message d'echec generique.
    const failFast = () => {
      if (!window.__vendorLoadError) return false
      clearTimeout(timer)
      clearInterval(poll)
      window.removeEventListener('xrloaded', onLoaded)
      boot.log(`echec de chargement : ${window.__vendorLoadError}`)
      reject(new Error(VENDOR_404))
      return true
    }
    const poll = setInterval(failFast, 250)

    const onLoaded = () => {
      clearTimeout(timer)
      clearInterval(poll)
      resolve()
    }
    const timer = setTimeout(() => {
      clearInterval(poll)
      window.removeEventListener('xrloaded', onLoaded)
      reject(
        new Error(
          'Le moteur AR n’a pas fini de se charger. Verifiez que le telephone ' +
            'et l’ordinateur sont sur le meme reseau, puis rechargez la page.'
        )
      )
    }, ENGINE_TIMEOUT_MS)

    window.addEventListener('xrloaded', onLoaded, {once: true})
    boot.log(`base : ${import.meta.env.BASE_URL} · page : ${location.pathname}`)
    boot.log('attente de xrloaded (xr.js + xr-slam.js)')

    // A-Frame est charge en synchrone : son absence signale immediatement un
    // probleme de chemin, avant meme le premier onerror asynchrone.
    if (!window.AFRAME) {
      boot.log('AFRAME absent : les scripts vendeur n’ont pas ete charges')
      window.__vendorLoadError = window.__vendorLoadError || 'aframe'
    }
    failFast()
  })

const mountScene = (boot) => {
  const tpl = document.getElementById('ar-scene-template')
  if (!tpl) throw new Error('Template de scene introuvable.')

  const fragment = tpl.content.cloneNode(true)

  // Echappatoire de developpement : `?desktop` autorise le moteur a demarrer
  // sur un ordinateur (emulation souris/clavier de 8th Wall). Pratique pour
  // iterer sur la mise en page sans telephone.
  // ATTENTION : sans centrale inertielle il n'y a ni SLAM ni echelle metrique.
  // Ne jamais valider une taille reelle depuis ce mode.
  if (new URLSearchParams(location.search).has('desktop')) {
    fragment
      .querySelector('a-scene')
      .setAttribute('xrweb', 'scale: absolute; disableWorldTracking: false; allowedDevices: any')
    boot.log('mode bureau : echelle absolue NON representative')
  }

  // Insere avant le HUD pour que le canvas reste sous l'interface.
  document.body.insertBefore(fragment, document.body.firstChild)
  const scene = document.querySelector('a-scene')
  if (!scene) throw new Error('La scene AR n’a pas pu etre creee.')
  return scene
}

// A-Frame emet `loaded` sur la scene une fois tous ses composants initialises.
// Le garde-fou temporel evite l'attente infinie si un composant tiers echoue
// pendant son init : mieux vaut un message clair qu'un ecran fige.
const whenSceneLoaded = (scene) =>
  new Promise((resolve, reject) => {
    if (scene.hasLoaded) return resolve(scene)
    const timer = setTimeout(
      () => reject(new Error('La scene AR ne s’est pas initialisee. Rechargez la page.')),
      20000
    )
    scene.addEventListener(
      'loaded',
      () => {
        clearTimeout(timer)
        resolve(scene)
      },
      {once: true}
    )
  })

// Traduction des codes de XR8.XrDevice.incompatibleReasons() en texte lisible.
// L'enumeration reelle du binaire est :
//   0 UNSPECIFIED · 1 UNSUPPORTED_OS · 2 UNSUPPORTED_BROWSER
//   3 MISSING_DEVICE_ORIENTATION · 4 MISSING_USER_MEDIA · 5 MISSING_WEB_ASSEMBLY
const REASON_TEXT = {
  0: 'raison non precisee',
  1: 'systeme non supporte (ordinateur, ou version d’OS trop ancienne)',
  2: 'navigateur non supporte (souvent un navigateur integre : Instagram, Facebook, Messenger, LinkedIn...)',
  3: 'capteurs de mouvement inaccessibles (permission refusee, ou page non servie en HTTPS)',
  4: 'acces camera indisponible (permission refusee, ou page non servie en HTTPS)',
  5: 'WebAssembly indisponible (mode restreint du navigateur)',
}

const describeDevice = (boot) => {
  const dev = window.XR8 && window.XR8.XrDevice
  if (!dev) return {compatible: false, reasons: []}

  try {
    const compatible = dev.isDeviceBrowserCompatible()
    const reasons = compatible ? [] : dev.incompatibleReasons() || []
    const est = dev.deviceEstimate ? dev.deviceEstimate() : null

    boot.log(`appareil compatible : ${compatible}`)
    reasons.forEach((r) => boot.log(`  · ${REASON_TEXT[r] || `code ${r}`}`))
    if (est) boot.log(`appareil : ${est.osVersion || '?'} / ${(est.browser || {}).name || '?'}`)
    boot.log(`chunk slam : ${window.XR8.XrController ? 'charge' : 'ABSENT'}`)
    boot.log(`contexte sur : ${window.isSecureContext}`)

    return {compatible, reasons}
  } catch (e) {
    boot.log(`diagnostic appareil indisponible : ${e.message}`)
    return {compatible: true, reasons: []} // on laisse le moteur decider
  }
}

// Elements que le moteur cree A LA DEMANDE quand il lui manque un geste
// utilisateur : la boite "Continue" des permissions capteurs (iOS) et le bouton
// "Enter AR" du mode immersif. Leur presence signifie « en attente d'une tape »,
// pas « en panne ». (Les ecrans d'erreur de XRExtras, eux, sont dans le DOM en
// permanence : on ne peut pas les tester par simple presence.)
const EIGHTHWALL_PROMPTS = '.prompt-box-8w, .immersive-enter-button-8w'

const wireSceneEvents = (scene, boot) => {
  let cameraSeen = false
  // Passe a true des que 8th Wall prend la main sur l'ecran avec un diagnostic
  // meilleur que le notre (page "ouvrez sur mobile", ecran de permission
  // refusee illustre). On cesse alors de le recouvrir.
  let engineOwnsScreen = false
  scene.addEventListener('camerastatuschange', (e) => {
    const status = (e.detail || {}).status
    cameraSeen = true
    boot.log(`camera : ${status}`)
    if (status === 'hasVideo') {
      boot.step('camera', 'done')
      boot.reach('scale')
      boot.hide()
    }
  })

  // Filet de securite : si la camera ne donne aucun signe de vie, c'est presque
  // toujours une permission bloquee au niveau du site (le navigateur ne
  // redemande pas apres un refus).
  setTimeout(() => {
    if (cameraSeen || engineOwnsScreen) return

    // ... SAUF si le moteur attend encore un geste de l'utilisateur. Sur iOS,
    // `DeviceMotionEvent.requestPermission()` exige un clic : le moteur affiche
    // sa propre boite ("Continue") et ne demande la camera qu'apres. Rien n'est
    // casse, il manque juste une tape — recouvrir cette boite par notre ecran
    // d'erreur rendrait justement le demarrage impossible.
    if (document.querySelector(EIGHTHWALL_PROMPTS)) {
      boot.log('en attente de la validation des permissions (boite 8th Wall)')
      return
    }

    boot.fail(
      'La camera n’a pas demarre. Autorisez la camera pour ce site, puis ' +
        'rechargez la page. Sur iPhone : bouton « aA » dans la barre d’adresse ' +
        '→ Reglages du site web → Camera → Autoriser (ou Reglages → Safari → ' +
        'Camera). Verifiez aussi qu’aucune autre application n’utilise la camera.'
    )
  }, 30000)

  scene.addEventListener('ar-scale-ready', () => boot.step('scale', 'done'))

  scene.addEventListener('realityerror', (e) => {
    const detail = e.detail || {}
    if (detail.isDeviceBrowserSupported === false) {
      // 8th Wall affiche sa propre page "ouvrez sur mobile" : on s'efface.
      boot.log('appareil non supporte, affichage de la page d’accueil 8th Wall')
      engineOwnsScreen = true
      boot.hide()
      return
    }

    // Permission refusee : le moteur ne jette pas une Error mais un objet nu
    // {type: 'permission', permission, status} — `message` y est indefini, on
    // afficherait donc "Erreur du moteur AR." par-dessus l'ecran ILLUSTRE de
    // XRExtras (#cameraPermissionsErrorApple / #motionPermissionsErrorApple),
    // qui donne la marche a suivre exacte pour l'appareil. On lui laisse la
    // place et on se contente de tracer.
    const err = detail.error || {}
    if (err.type === 'permission') {
      boot.log(`permission refusee : ${err.permission || '?'} (${err.status || '?'})`)
      engineOwnsScreen = true
      boot.hide()
      return
    }

    boot.fail(err.message || 'Erreur du moteur AR.')
  })
}

const boot = async () => {
  // Desarme le chien de garde inline d'index.html : notre code s'execute bien.
  window.__kayfoBooted = true
  const screen = createBootScreen()

  try {
    screen.reach('engine')
    await whenEngineReady(screen)
    screen.step('engine', 'done')
    const device = describeDevice(screen)

    screen.reach('scene')
    const scene = await whenSceneLoaded(mountScene(screen))
    screen.step('scene', 'done')

    // Appareil non supporte : le composant `landing-page` de 8th Wall affiche
    // sa propre page (QR code, "ouvrez sur mobile"). On s'efface pour la
    // laisser visible — notre ecran de demarrage est au-dessus d'elle.
    // Sans ce retrait, l'utilisateur restait bloque sur "Camera" indefiniment,
    // car sur un appareil incompatible xrweb n'emet plus AUCUN evenement.
    if (!device.compatible) {
      document.getElementById('hud').hidden = true
      screen.hide()
      return
    }

    screen.reach('camera')
    wireSceneEvents(scene, screen)
    initHud(scene)

    // -------------------------------------------------------------------
    // Passage de relais OBLIGATOIRE (bug camera iOS).
    //
    // A partir d'ici, la scene est montee et `xrweb` demarre le moteur : c'est
    // 8th Wall qui possede l'ecran (son ecran de chargement, ses demandes de
    // permission, ses pages d'erreur). Notre overlay est opaque et en z-index
    // 2000, au-dessus de tout ce qu'il affiche.
    //
    // Sur iOS c'est bloquant, pas seulement genant : `requestPermission()` des
    // capteurs de mouvement exige un geste utilisateur, donc le moteur echoue
    // une premiere fois puis affiche une boite "Continue" (z-index 888) dont le
    // clic declenche la seconde tentative — et seulement ensuite getUserMedia.
    // Ecran de demarrage laisse en place = boite invisible = clic impossible =
    // camera qui ne demarre jamais, sans le moindre evenement pour le dire.
    // (Sur Android le probleme ne se voit pas : `requestPermission` n'y existe
    // pas, la permission est accordee d'office et la demande camera est une
    // popup native du navigateur, qui passe au-dessus de la page.)
    //
    // screen.fail() peut toujours faire revenir l'ecran si la suite echoue.
    // -------------------------------------------------------------------
    screen.release()
  } catch (err) {
    console.error('[kayfo-ar]', err)
    screen.fail(err.message || String(err))
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, {once: true})
} else {
  boot()
}
