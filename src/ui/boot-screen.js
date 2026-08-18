// ---------------------------------------------------------------------------
// Ecran de demarrage.
//
// POURQUOI IL EXISTE
// ------------------
// La scene AR n'est montee qu'apres l'evenement `xrloaded` (voir index.html).
// Or, en lisant le binaire, on constate que `xrloaded` n'est emis qu'APRES le
// chargement des chunks declares dans `data-preload-chunks` :
//
//     yield Promise.all((chunks || []).map((c) => XR8.loadChunk(c)))
//     window.XR8 = engine
//     setTimeout(() => window.dispatchEvent(new CustomEvent('xrloaded')), 1)
//
// Autrement dit, entre l'ouverture de la page et `xrloaded`, il faut avoir
// telecharge xr.js (1 Mo) ET xr-slam.js (5,5 Mo). Pendant toute cette phase —
// la plus longue du demarrage — aucun composant 8th Wall n'est encore actif :
// ni l'ecran de chargement XRExtras, ni la page "device non supporte". L'ecran
// restait donc fige sans le moindre retour, et un echec silencieux etait
// indiscernable d'un telechargement lent.
//
// Cet ecran comble exactement ce trou : il est present dans le HTML des le
// premier octet, affiche l'avancement etape par etape, le temps ecoule, et
// capture toute erreur JS pour la rendre lisible sans cable USB.
//
// ... ET IL DOIT S'EFFACER DES QUE LA SCENE EST MONTEE  (voir release())
// -----------------------------------------------------
// Il est opaque et en z-index 2000. Or, une fois `XR8.run()` lance, TOUTE
// l'interaction de demarrage appartient a 8th Wall, sous ce niveau :
//
//   .prompt-box-8w              z-index  888   <- bouton "Continue" (iOS)
//   #requestingCameraPermissions z-index 1200
//   #cameraPermissionsErrorApple z-index 1300
//
// Le premier est bloquant sur iOS : `DeviceMotionEvent.requestPermission()`
// exige un geste utilisateur, donc le moteur echoue une premiere fois (statut
// "retry"), affiche cette boite, et n'appelle getUserMedia qu'apres le clic sur
// "Continue". Tant que notre ecran la recouvre, ce clic est impossible : la
// camera ne demarre jamais et aucun evenement n'est emis.
// ---------------------------------------------------------------------------

const STEP_LABELS = ['engine', 'scene', 'camera', 'scale']

export function createBootScreen() {
  const root = document.getElementById('boot')
  const titleEl = document.getElementById('boot-title')
  const subEl = document.getElementById('boot-sub')
  const elapsedEl = document.getElementById('boot-elapsed')
  const logEl = document.getElementById('boot-log')
  const stepsEl = document.getElementById('boot-steps')

  const debug = new URLSearchParams(location.search).has('debug')
  const started = performance.now()
  const lines = []
  let failed = false
  let released = false

  const setStep = (name, status) => {
    const li = stepsEl && stepsEl.querySelector(`[data-step="${name}"]`)
    if (li) li.dataset.status = status
  }

  const log = (line) => {
    lines.push(`${((performance.now() - started) / 1000).toFixed(1)}s  ${line}`)
    if (logEl) {
      logEl.textContent = lines.join('\n')
      if (debug || failed) logEl.hidden = false
    }
    // Toujours dans la console aussi : utile en debogage distant.
    console.log('[kayfo-ar]', line)
  }

  const timer = setInterval(() => {
    if (!elapsedEl || failed || root.hidden) return
    const s = Math.round((performance.now() - started) / 1000)
    elapsedEl.textContent = s < 3 ? '' : `${s}s elapsed`
    // Au-dela de 15 s, on cesse de laisser croire que tout va bien.
    if (s === 15) {
      subEl.textContent =
        'This is taking longer than expected. Stay on this page, or check ' +
        'that your phone and computer are on the same network.'
    }
  }, 500)

  // Toute erreur non capturee devient visible a l'ecran : sur un telephone,
  // c'est souvent le seul moyen de savoir ce qui s'est reellement passe.
  const onError = (e) => log(`ERROR: ${e.message || e.reason || e}`)
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onError)

  if (debug && logEl) logEl.hidden = false

  return {
    log,
    step(name, status = 'done') {
      setStep(name, status)
      log(`${name} : ${status}`)
    },
    /** Marque l'etape courante active et toutes les precedentes terminees. */
    reach(name) {
      const idx = STEP_LABELS.indexOf(name)
      STEP_LABELS.forEach((s, i) => setStep(s, i < idx ? 'done' : i === idx ? 'active' : ''))
      log(`step: ${name}`)
    },
    /**
     * Rend la main aux ecrans 8th Wall : l'overlay disparait, mais le
     * journal et le rattrapage d'erreurs restent actifs (fail() peut donc le
     * faire revenir). A appeler des que la scene est montee — a partir de la,
     * c'est `xrextras-loading` qui occupe l'ecran, et la boite de permission
     * du moteur doit pouvoir etre touchee. Voir l'en-tete de ce fichier.
     */
    release() {
      released = true
      root.hidden = true
      log('ecran de demarrage efface : la main passe aux ecrans 8th Wall')
    },
    fail(message) {
      failed = true
      clearInterval(timer)
      root.dataset.state = 'error'
      titleEl.textContent = 'Unable to start'
      subEl.textContent = message
      elapsedEl.textContent = ''
      if (logEl) logEl.hidden = false
      // Un echec survenu APRES release() doit redevenir visible : c'est le seul
      // endroit ou l'utilisateur lira le diagnostic.
      root.hidden = false
      log(`FAILED: ${message}`)
    },
    hide() {
      clearInterval(timer)
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onError)
      root.hidden = true
    },
    get released() {
      return released
    },
  }
}
