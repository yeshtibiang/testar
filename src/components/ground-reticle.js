import {CONFIG} from '../config.js'
import {findGroundHit, getCameraWorldY} from '../lib/hit-test.js'

// ---------------------------------------------------------------------------
// Reticule de visee.
//
// Tire un hitTest en continu legerement sous le centre de l'ecran et vient s'y
// poser. Deux roles :
//  1. UX : l'utilisateur sait ou le joueur va atterrir avant de taper.
//  2. Diagnostic : si le reticule n'apparait pas, c'est que le SLAM n'a pas
//     encore de surface -> il faut balayer le sol, pas taper au hasard.
//
// Il sert aussi de reference d'echelle : son diametre est fixe en METRES
// (0,45 m) donc s'il parait absurde a l'ecran, l'echelle absolue n'est pas
// encore calibree.
// ---------------------------------------------------------------------------

AFRAME.registerComponent('ground-reticle', {
  schema: {
    diameter: {type: 'number', default: 0.45}, // metres
    // Meme correction de biais d'echelle que le personnage
    // (CONFIG.slamScaleCorrection). Sans elle, le reticule afficherait 0,45
    // unite moteur — donc une taille reelle fausse des que le moteur se
    // trompe d'echelle — et mentirait au moment meme ou on s'en sert comme
    // repere pour juger la taille du personnage.
    correction: {type: 'number', default: 1},
    active: {type: 'boolean', default: true},
  },

  init() {
    const THREE = AFRAME.THREE
    const group = new THREE.Group()

    const ringGeo = new THREE.RingGeometry(0.5, 0.58, 48)
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x8ef5b5,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
    this.ring = new THREE.Mesh(ringGeo, ringMat)

    const dotGeo = new THREE.CircleGeometry(0.09, 24)
    const dotMat = ringMat.clone()
    dotMat.opacity = 0.7
    this.dot = new THREE.Mesh(dotGeo, dotMat)

    group.add(this.ring, this.dot)
    group.rotation.x = -Math.PI / 2
    group.renderOrder = 2
    this.group = group
    this.el.setObject3D('mesh', group)

    this.targetPos = new THREE.Vector3()
    this.hasTarget = false
    this.lastHit = null

    this.applyDiameter()
    this.tick = AFRAME.utils.throttleTick(this.tick.bind(this), 1000 / CONFIG.reticleHitTestHz, this)
  },

  update() {
    this.applyDiameter()
  },

  applyDiameter() {
    if (this.group) this.group.scale.setScalar(this.data.diameter * this.data.correction)
  },

  remove() {
    this.el.removeObject3D('mesh')
    ;[this.ring, this.dot].forEach((m) => {
      if (!m) return
      m.geometry.dispose()
      m.material.dispose()
    })
  },

  /** Dernier hit valide sous le reticule (utilise comme repli au tap). */
  getLastHit() {
    return this.lastHit
  },

  tick(time, delta) {
    if (!this.data.active) {
      this.el.object3D.visible = false
      return
    }

    const cameraY = getCameraWorldY(this.el.sceneEl)
    // Le reticule applique le meme filtre de sol (et le meme elargissement de
    // recherche, voir findGroundHit) que le placement, sinon il proposerait
    // des cibles que le tap refuserait ensuite.
    const director = this.el.sceneEl.components['ar-director']
    const floorY = director ? director.floor.level : null
    const hit = findGroundHit(CONFIG.reticleScreenX, CONFIG.reticleScreenY, cameraY, floorY)

    if (hit) {
      this.lastHit = hit
      this.targetPos.set(hit.position.x, hit.position.y, hit.position.z)
      this.hasTarget = true
    }

    if (!this.hasTarget) {
      this.el.object3D.visible = false
      return
    }

    // Amortissement : sans lissage le reticule vibre a chaque tir de hitTest.
    const k = Math.min(1, (delta / 1000) * 12)
    this.el.object3D.position.lerp(this.targetPos, k)
    this.el.object3D.visible = true
  },
})
