import {CONFIG} from '../config.js'
import {PLAYERS, DEFAULT_PLAYER_ID, getPlayer} from '../players.js'
import {getCameraWorldY} from '../lib/hit-test.js'
import {setCorrection} from '../lib/scale.js'
import {
  configureScreenshots,
  takeScreenshot,
  base64ToFile,
  canShareFile,
  shareFile,
  makeFilename,
} from './photo.js'

// ---------------------------------------------------------------------------
// Interface HTML posee au-dessus du canvas AR.
// Aucune logique 3D ici : on ecoute les evenements `ar-*` emis par ar-director.
// UI en anglais a la demande ; les commentaires de code restent en francais.
// ---------------------------------------------------------------------------

const MESSAGES = {
  booting: {label: 'Starting camera...', hint: 'Allow camera access'},
  calibrating: {
    label: 'Getting ready',
    // Le coaching-overlay integre a 8th Wall invite deja au mouvement
    // avant/arriere necessaire ; ce hint reste generique expres (pas de
    // jargon "calibration"/"echelle" cote utilisateur, demande explicite).
    hint: 'Move your phone slowly forward and backward',
  },
  ready: {label: 'Ready', hint: 'Tap the floor to place the player'},
  placed: {label: 'Player placed', hint: 'Tap elsewhere to move it · step back to fit it in frame'},
}

export function initHud(sceneEl) {
  const el = {
    hud: document.getElementById('hud'),
    statusText: document.getElementById('status-text'),
    badge: document.getElementById('status-badge'),
    hint: document.getElementById('hint'),
    strip: document.getElementById('player-strip'),
    sizeAdjust: document.getElementById('size-adjust'),
    sizeMinus: document.getElementById('btn-size-minus'),
    sizePlus: document.getElementById('btn-size-plus'),
    shoot: document.getElementById('btn-shoot'),
    reset: document.getElementById('btn-reset'),
    recenter: document.getElementById('btn-recenter'),
    flash: document.getElementById('flash'),
    fallback: document.getElementById('share-fallback'),
    preview: document.getElementById('share-preview'),
    shareNow: document.getElementById('btn-share-now'),
    download: document.getElementById('btn-download'),
    shareClose: document.getElementById('btn-share-close'),
  }

  const figureEl = document.getElementById('figure')
  const director = () => sceneEl.components['ar-director']

  let state = 'booting'
  // Le selecteur de joueur est commente de l'ecran normal (voir
  // CONFIG.showPlayerSelector) : par defaut on affiche directement le vrai
  // joueur (CONFIG.kioskDefaultPlayerId) plutot que le repere 1,80 m, qui ne
  // sert qu'a verifier l'echelle en coulisses. HYPOTHESE non demandee
  // explicitement : a confirmer si un autre joueur par defaut est prefere.
  let currentPlayerId = CONFIG.showPlayerSelector
    ? DEFAULT_PLAYER_ID
    : getPlayer(CONFIG.kioskDefaultPlayerId).id
  let busy = false
  let pendingFile = null
  let pendingUrl = null

  // -- selection du joueur -------------------------------------------------

  // `correction` demarre a la valeur configuree, mais le panneau ?calibrate
  // (plus bas) peut l'ajuster en direct : on la garde en variable locale pour
  // que changer de joueur ne fasse pas perdre le reglage en cours de session.
  let scaleCorrection = CONFIG.slamScaleCorrection

  const applyCorrection = () => {
    setCorrection(scaleCorrection)
    figureEl.setAttribute('real-scale-figure', 'correction', scaleCorrection)
  }

  // Pas de la correction visible (boutons − / +, voir plus bas) : multiplicatif
  // pour rester coherent avec le panneau ?calibrate (un pas de 5% a un sens
  // constant que la correction courante soit 0,4 ou 2,5).
  const SIZE_STEP = 0.05
  const nudgeSize = (direction) => {
    scaleCorrection = Math.max(0.05, scaleCorrection * (1 + direction * SIZE_STEP))
    applyCorrection()
  }

  const applyPlayer = (id) => {
    const p = getPlayer(id)
    currentPlayerId = p.id
    figureEl.setAttribute('real-scale-figure', {
      src: p.src,
      height: p.heightMeters,
      calibration: p.calibration ?? 1,
      feetInset: p.feetInset ?? 0,
      correction: scaleCorrection,
    })
    if (el.strip) [...el.strip.children].forEach((b) => b.classList.toggle('is-active', b.dataset.id === p.id))
    applyCorrection()
  }

  // Puces "Repere 1,80 m" / "Joueur 1" commentees de l'ecran normal a la
  // demande : le mecanisme reste intact derriere CONFIG.showPlayerSelector,
  // il suffit de le repasser a true pour les reafficher.
  if (CONFIG.showPlayerSelector && el.strip) {
    PLAYERS.forEach((p) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'chip'
      btn.dataset.id = p.id
      btn.innerHTML = `<span class="chip__name">${p.name}</span><span class="chip__h">${p.heightMeters.toFixed(
        2
      )} m</span>`
      btn.addEventListener('click', () => applyPlayer(p.id))
      el.strip.appendChild(btn)
    })
  } else if (el.strip) {
    el.strip.hidden = true
  }
  applyPlayer(currentPlayerId)

  // -- etats ---------------------------------------------------------------

  const render = () => {
    const msg = MESSAGES[state] || MESSAGES.booting
    el.hud.dataset.state = state
    el.statusText.textContent = msg.label
    el.hint.textContent = msg.hint
    el.shoot.disabled = state !== 'placed' || busy
    el.reset.disabled = state !== 'placed'
    // Rien a corriger tant que le joueur n'est pas pose.
    if (el.sizeAdjust) el.sizeAdjust.hidden = state !== 'placed'
  }

  sceneEl.addEventListener('ar-state', (e) => {
    state = e.detail.state
    render()
  })

  const REJECT_REASONS = {
    tracking: 'Tracking not stable yet — move your phone',
    'no-surface': 'Still finding the floor — move around a little and try again',
    'above-horizon': 'Aim lower, toward the floor',
  }
  sceneEl.addEventListener('ar-place-rejected', (e) => {
    flashHint(REJECT_REASONS[e.detail.reason] || REJECT_REASONS['no-surface'])
  })

  sceneEl.addEventListener('figure-error', () => {
    flashHint('Player image not found — check public/players/')
  })

  let hintTimer = null
  function flashHint(text) {
    clearTimeout(hintTimer)
    el.hint.textContent = text
    el.hint.classList.add('hint--alert')
    hintTimer = setTimeout(() => {
      hintTimer = null
      el.hint.classList.remove('hint--alert')
      render()
    }, 2600)
  }

  // -- debug echelle --------------------------------------------------------
  //
  // Commente pour l'instant (CONFIG.debugScale = false) : ce readout
  // "camera : X m" reste utile en coulisses pour vérifier qu'un sol EST
  // detecte une fois le suivi stable (une valeur qui ne bouge jamais indique
  // un suivi qui n'accroche pas), mais n'a rien a faire sur l'ecran grand
  // public. Le mecanisme est intact ; repasser debugScale a true dans
  // config.js le reaffiche.
  if (CONFIG.debugScale) {
    const dbg = document.createElement('div')
    dbg.className = 'debug'
    el.hud.appendChild(dbg)
    setInterval(() => {
      const y = getCameraWorldY(sceneEl)
      const val = Number.isFinite(y) ? `${y.toFixed(2)} m` : '—'
      const notYetReady = state === 'booting' || state === 'calibrating'
      dbg.textContent = notYetReady ? `camera : ${val} (not ready yet)` : `camera : ${val}`
    }, 400)
  }

  // -- boutons --------------------------------------------------------------

  el.reset.addEventListener('click', () => director() && director().clear())

  el.recenter.addEventListener('click', () => {
    // recenter() relance l'estimation de pose sans redemarrer la camera.
    if (window.XR8 && window.XR8.XrController) window.XR8.XrController.recenter()
    const d = director()
    // Le repere monde change reellement ici : contrairement a Remove, la
    // hauteur de sol connue doit etre invalidee (voir ar-director.resetFloor).
    if (d) {
      d.resetFloor()
      d.clear()
    }
    flashHint('Tracking reset — move your phone to recalibrate')
  })

  el.sizeMinus.addEventListener('click', () => nudgeSize(-1))
  el.sizePlus.addEventListener('click', () => nudgeSize(1))

  el.shoot.addEventListener('click', async () => {
    if (busy) return
    busy = true
    render()
    triggerFlash()
    await nextFrame()

    try {
      const base64 = await takeScreenshot(sceneEl)
      const file = base64ToFile(base64, makeFilename())

      const result = canShareFile(file) ? await shareFile(file) : 'unsupported'
      if (result === 'shared' || result === 'cancelled') {
        releasePending()
      } else {
        // 'blocked' (activation perdue) ou 'unsupported' (desktop, Firefox...)
        openFallback(file)
      }
    } catch (err) {
      console.error('[kayfo-ar]', err)
      flashHint('Capture failed — try again')
    } finally {
      busy = false
      render()
    }
  })

  const nextFrame = () =>
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

  function triggerFlash() {
    if (navigator.vibrate) navigator.vibrate(12)
    el.flash.classList.remove('flash--on')
    void el.flash.offsetWidth // force le reflow pour rejouer l'animation
    el.flash.classList.add('flash--on')
  }

  // -- panneau de repli -----------------------------------------------------

  function releasePending() {
    if (pendingUrl) URL.revokeObjectURL(pendingUrl)
    pendingUrl = null
    pendingFile = null
  }

  function openFallback(file) {
    releasePending()
    pendingFile = file
    pendingUrl = URL.createObjectURL(file)
    el.preview.src = pendingUrl
    el.download.href = pendingUrl
    el.download.download = file.name
    el.shareNow.hidden = !canShareFile(file)
    el.fallback.hidden = false
  }

  el.shareNow.addEventListener('click', async () => {
    if (!pendingFile) return
    const r = await shareFile(pendingFile)
    if (r === 'shared') closeFallback()
  })

  el.shareClose.addEventListener('click', closeFallback)

  function closeFallback() {
    el.fallback.hidden = true
    el.preview.removeAttribute('src')
    releasePending()
  }

  // -- panneau d'ajustement de taille fin (?calibrate) -----------------------
  //
  // Outil de terrain/support, cache derriere ?calibrate — en complement des
  // boutons − / + toujours accessibles dans le HUD normal (voir nudgeSize
  // ci-dessus, pas 5% par tap). Celui-ci offre des pas plus fins (±2%/±10%)
  // et une valeur numerique affichee, utile en diagnostic.
  //
  // Par defaut (`CONFIG.slamScaleCorrection = 1`), l'app fait entierement
  // confiance a `xrweb="scale: absolute"` — le joueur est dimensionne
  // uniquement a partir de donnees reelles (heightMeters, voir
  // src/players.js), pas d'un fudge factor. MAIS on a mesure sur le terrain
  // que le biais d'echelle du SLAM monoculaire de 8th Wall varie reellement
  // d'une session a l'autre, meme dans des conditions similaires (lectures
  // "camera : X m" observees : 0,65 / 0,76 / 0,20-0,50 / 0,90 / 0,20 /
  // 0,42 m). C'est une limite du moteur, pas un bug de cette app (le
  // pipeline de dimensionnement a ete audite : aucune conversion d'unite
  // erronee trouvee, voir README) — d'ou la correction ajustable a la volee.
  if (new URLSearchParams(location.search).has('calibrate')) {
    const panel = document.createElement('div')
    panel.className = 'calib'
    panel.innerHTML = `
      <div class="calib__row">
        <span class="calib__label">Adjust size</span>
        <span class="calib__value" id="calib-value"></span>
      </div>
      <div class="calib__buttons">
        <button type="button" data-step="-0.1">−10%</button>
        <button type="button" data-step="-0.02">−2%</button>
        <button type="button" data-step="0.02">+2%</button>
        <button type="button" data-step="0.1">+10%</button>
      </div>
      <p class="calib__hint">
        Compare the 1.8 m reference figure (or the player) to a known
        real-world object and adjust until the size matches. Only copy the
        value into <code>CONFIG.slamScaleCorrection</code> (src/config.js) if
        it reproduces reliably across several separate sessions.
      </p>
    `
    document.body.appendChild(panel)

    const calibValueEl = panel.querySelector('#calib-value')
    const renderCalibValue = () => {
      calibValueEl.textContent = `× ${scaleCorrection.toFixed(3)}`
    }
    renderCalibValue()

    panel.querySelectorAll('button[data-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const step = Number(btn.dataset.step)
        // Multiplicatif plutot qu'additif : un pas de 10% a un sens constant
        // que la correction courante soit 0,4 ou 2,5.
        scaleCorrection = Math.max(0.05, scaleCorrection * (1 + step))
        renderCalibValue()
        applyCorrection()
      })
    })
  }

  // -- init -----------------------------------------------------------------

  const onXrReady = () => configureScreenshots()
  if (window.XR8) onXrReady()
  else window.addEventListener('xrloaded', onXrReady, {once: true})

  render()
}
