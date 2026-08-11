import {CONFIG} from '../config.js'
import {findGroundHit, createFloorEstimator, getCameraWorldY, hitTestReady} from '../lib/hit-test.js'

// ---------------------------------------------------------------------------
// Chef d'orchestre de l'experience, pose sur <a-scene>.
//
// Responsabilites :
//  - suivre l'etat du tracking ;
//  - transformer un tap ecran en position monde au sol ;
//  - poser / deplacer le personnage et gerer son orientation.
//
// Il ne touche pas au DOM du HUD : il emet des evenements `ar-state` que
// src/ui/hud.js consomme.
//
// METHODE DE CALIBRATION : L'APPROCHE OFFICIELLE 8TH WALL
// ---------------------------------------------------------------------------
// Revenu a la demande a la methode standard, utilisee par la majorite des
// projets 8th Wall : `xrweb="scale: absolute"` + le coaching-overlay integre
// au moteur gerent entierement l'acquisition de l'echelle metrique. Le seul
// signal qu'on consulte est `reality.trackingstatus` (evenement
// `xrtrackingstatus` sur la scene) : le placement est autorise des que le
// statut vaut `'NORMAL'`.
//
// Cette session a experimente un garde-fou maison supplementaire (distance
// totale parcourue par la camera, `CONFIG.minCalibrationTravel`) pour pallier
// des cas ou `trackingstatus` passait a NORMAL avant que l'echelle ait
// pleinement converge. Retire a la demande : il ajoutait de la complexite
// sans regler le probleme de fond (le biais d'echelle du SLAM monoculaire
// varie par session, voir CONFIG.slamScaleCorrection) et s'ecartait du
// fonctionnement documente/attendu par la plupart des integrations 8th Wall.
// ---------------------------------------------------------------------------

const STATES = {
  BOOTING: 'booting',
  CALIBRATING: 'calibrating',
  READY: 'ready',
  PLACED: 'placed',
}

AFRAME.registerComponent('ar-director', {
  schema: {
    figure: {type: 'selector'},
    reticle: {type: 'selector'},
  },

  init() {
    const THREE = AFRAME.THREE

    this.state = STATES.BOOTING
    this.floor = createFloorEstimator()
    this.placed = false
    this.trackingNormal = false

    this._camWorld = new THREE.Vector3()
    this._pointer = null
    this._targetYaw = 0

    this.onTrackingStatus = this.onTrackingStatus.bind(this)
    this.onPointerDown = this.onPointerDown.bind(this)
    this.onPointerUp = this.onPointerUp.bind(this)

    // 8th Wall convertit "reality.trackingstatus" en "xrtrackingstatus" sur la scene.
    this.el.addEventListener('xrtrackingstatus', this.onTrackingStatus)
    this.el.addEventListener('realityerror', () => this.setState(STATES.BOOTING))

    // pointerup couvre tactile ET souris (utile pour l'emulation desktop 8th Wall).
    window.addEventListener('pointerdown', this.onPointerDown, {passive: true})
    window.addEventListener('pointerup', this.onPointerUp, {passive: true})

    this.setState(STATES.BOOTING)
  },

  remove() {
    this.el.removeEventListener('xrtrackingstatus', this.onTrackingStatus)
    window.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointerup', this.onPointerUp)
  },

  // -- etat ----------------------------------------------------------------

  setState(next) {
    if (this.state === next) return
    this.state = next
    this.el.emit('ar-state', {state: next, placed: this.placed}, false)
  },

  onTrackingStatus(e) {
    const {status} = e.detail || {}
    // Sequence observee : LIMITED/INITIALIZING (l'echelle metrique n'est pas
    // encore estimee) -> NORMAL. Le coaching-overlay affiche automatiquement
    // un message pendant la premiere phase.
    this.trackingNormal = status === 'NORMAL'
    this.setState(this.trackingNormal ? (this.placed ? STATES.PLACED : STATES.READY) : STATES.CALIBRATING)
  },

  // -- interaction ---------------------------------------------------------

  onPointerDown(e) {
    this._pointer = {x: e.clientX, y: e.clientY, t: performance.now()}
  },

  onPointerUp(e) {
    const down = this._pointer
    this._pointer = null
    if (!down) return

    // Ignore les interactions avec l'interface HTML.
    if (e.target && e.target.closest && e.target.closest('.hud, .share-fallback, .prompt-box-8w')) return

    // Un vrai tap : pas un glissement, pas un appui long.
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
    if (moved > 14 || performance.now() - down.t > 700) return

    this.tryPlaceAt(e.clientX, e.clientY)
  },

  /**
   * Tape -> hitTest -> pose ou deplace le joueur.
   * Renvoie true si le placement a reussi.
   */
  tryPlaceAt(clientX, clientY) {
    if (!hitTestReady()) return false
    if (!this.trackingNormal) {
      this.el.emit('ar-place-rejected', {reason: 'tracking'}, false)
      return false
    }

    const cameraY = getCameraWorldY(this.el.sceneEl)
    const nx = clientX / window.innerWidth
    const ny = clientY / window.innerHeight

    // findGroundHit elargit deja la recherche a un petit voisinage autour du
    // tap (voir sa doc dans hit-test.js) — indispensable car les points de
    // feature du SLAM sont epars, pas une carte de profondeur dense.
    let hit = findGroundHit(nx, ny, cameraY, this.floor.level)

    // Dernier repli : si meme le voisinage ne trouve rien (zone tres peu
    // texturee), on reutilise le dernier point valide sous le reticule plutot
    // que de ne rien faire.
    if (!hit && this.data.reticle) {
      const reticle = this.data.reticle.components['ground-reticle']
      if (reticle) hit = reticle.getLastHit()
    }

    if (!hit) {
      this.el.emit('ar-place-rejected', {reason: 'no-surface'}, false)
      return false
    }

    this.place(hit)
    return true
  },

  place(hit) {
    const root = this.data.figure
    if (!root) return

    const y = this.floor.snap(hit.position.y)
    root.object3D.position.set(hit.position.x, y, hit.position.z)
    root.object3D.visible = true

    this.faceCamera(true)

    this.placed = true
    this.setState(STATES.PLACED)
    this.el.emit('ar-placed', {position: {...hit.position, y}, hit}, false)
  },

  clear() {
    const root = this.data.figure
    if (root) root.object3D.visible = false
    this.placed = false
    this.floor.reset()
    this.setState(this.trackingNormal ? STATES.READY : STATES.CALIBRATING)
    this.el.emit('ar-cleared', {}, false)
  },

  // -- orientation ---------------------------------------------------------

  /** Yaw pour que le plan regarde la camera. `snap` = application immediate. */
  faceCamera(snap) {
    const root = this.data.figure
    const cam = this.el.sceneEl.camera
    if (!root || !cam) return

    cam.getWorldPosition(this._camWorld)
    const dx = this._camWorld.x - root.object3D.position.x
    const dz = this._camWorld.z - root.object3D.position.z
    if (dx === 0 && dz === 0) return

    this._targetYaw = Math.atan2(dx, dz)
    if (snap) root.object3D.rotation.y = this._targetYaw
  },

  tick(time, delta) {
    if (!this.placed || CONFIG.orientationMode === 'fixed') return

    const root = this.data.figure
    if (!root) return

    this.faceCamera(false)

    const current = root.object3D.rotation.y
    let diff = this._targetYaw - current
    // Ramene l'ecart dans [-PI, PI] pour toujours tourner par le chemin court.
    diff = Math.atan2(Math.sin(diff), Math.cos(diff))

    if (CONFIG.orientationMode === 'yaw') {
      root.object3D.rotation.y = this._targetYaw
      return
    }

    // Mode 'soft' : on ne bouge que si le decoupage devient illisible de profil.
    const maxRad = AFRAME.THREE.MathUtils.degToRad(CONFIG.softBillboardMaxDeg)
    if (Math.abs(diff) <= maxRad) return

    const step = Math.sign(diff) * CONFIG.softBillboardSpeed * (delta / 1000)
    root.object3D.rotation.y += Math.abs(step) > Math.abs(diff) ? diff : step
  },
})

export {STATES}
