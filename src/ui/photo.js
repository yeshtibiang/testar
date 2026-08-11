import {CONFIG} from '../config.js'

// ---------------------------------------------------------------------------
// Capture photo + partage natif.
//
// COMMENT LA CAPTURE FONCTIONNE
// -----------------------------
// Le composant A-Frame `xrweb` installe automatiquement
// XR8.CanvasScreenshot.pipelineModule() et branche :
//     scene.emit('screenshotrequest')  ->  scene.emit('screenshotready', <base64 jpeg>)
//                                     ->  scene.emit('screenshoterror', <message>)
// La capture porte sur le canvas WebGL : flux camera + 3D. Le HUD HTML n'y est
// donc PAS present, inutile de le masquer avant de declencher.
//
// LE PIEGE DU PARTAGE NATIF
// -------------------------
// navigator.share() exige une "activation transitoire" : il doit etre appele
// pendant le geste utilisateur. Or la capture est asynchrone (une frame + la
// compression JPEG), et Safari iOS invalide souvent l'activation entre-temps.
// D'ou la strategie en deux temps : on tente le partage direct, et si le
// navigateur le refuse (NotAllowedError / InvalidStateError) on affiche un
// panneau avec un bouton "Partager" qui, lui, part d'un geste tout frais.
// ---------------------------------------------------------------------------

const SHOT_TIMEOUT_MS = 8000

/** Configure la qualite de sortie. A appeler une fois XR8 charge. */
export function configureScreenshots() {
  if (!window.XR8 || !window.XR8.CanvasScreenshot) return
  window.XR8.CanvasScreenshot.configure(CONFIG.screenshot)
}

/** Declenche une capture et resout avec le JPEG en base64. */
export function takeScreenshot(sceneEl) {
  return new Promise((resolve, reject) => {
    let done = false

    const cleanup = () => {
      sceneEl.removeEventListener('screenshotready', onReady)
      sceneEl.removeEventListener('screenshoterror', onError)
      clearTimeout(timer)
    }
    const onReady = (e) => {
      if (done) return
      // xrweb emet aussi screenshotready('') juste apres screenshoterror.
      if (!e.detail) return
      done = true
      cleanup()
      resolve(e.detail)
    }
    const onError = (e) => {
      if (done) return
      done = true
      cleanup()
      reject(new Error(typeof e.detail === 'string' ? e.detail : 'Capture failed'))
    }
    const timer = setTimeout(() => {
      if (done) return
      done = true
      cleanup()
      reject(new Error('Capture timed out'))
    }, SHOT_TIMEOUT_MS)

    sceneEl.addEventListener('screenshotready', onReady)
    sceneEl.addEventListener('screenshoterror', onError)
    sceneEl.emit('screenshotrequest', null, false)
  })
}

/** base64 -> File, sans passer par fetch(data:) (bloque par certaines CSP). */
export function base64ToFile(base64, filename) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], filename, {type: 'image/jpeg'})
}

export const canShareFile = (file) =>
  !!(navigator.canShare && navigator.share && navigator.canShare({files: [file]}))

/**
 * @returns {Promise<'shared'|'cancelled'|'unsupported'|'blocked'>}
 */
export async function shareFile(file) {
  if (!canShareFile(file)) return 'unsupported'
  try {
    await navigator.share({files: [file], title: CONFIG.shareTitle, text: CONFIG.shareText})
    return 'shared'
  } catch (err) {
    if (err && err.name === 'AbortError') return 'cancelled'
    // NotAllowedError / InvalidStateError = activation utilisateur perdue.
    return 'blocked'
  }
}

export const makeFilename = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `kayfo-ar-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}.jpg`
}
