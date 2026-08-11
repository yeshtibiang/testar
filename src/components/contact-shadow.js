import {getContactShadowTexture} from '../lib/texture.js'

// ---------------------------------------------------------------------------
// Ombre de contact au sol.
//
// Un decoupage plat pose sur le sol "flotte" visuellement si rien ne l'ancre.
// Plutot que d'activer les shadow maps (couteuses en mobile, et sans geometrie
// a projeter de toute facon), on pose une ellipse en degrade sous les pieds.
// C'est le seul indice dont le cerveau a besoin pour lire le contact.
//
// La taille suit automatiquement l'evenement `figure-ready` emis par
// real-scale-figure : l'ombre reste proportionnee quel que soit le joueur.
// ---------------------------------------------------------------------------

AFRAME.registerComponent('contact-shadow', {
  schema: {
    widthRatio: {type: 'number', default: 0.62}, // fraction de la largeur du sujet
    depthRatio: {type: 'number', default: 0.26}, // ellipse : moins profonde que large
    opacity: {type: 'number', default: 0.8},
    lift: {type: 'number', default: 0.004}, // anti z-fighting avec le sol reel
  },

  init() {
    const THREE = AFRAME.THREE

    const geometry = new THREE.PlaneGeometry(1, 1)
    const material = new THREE.MeshBasicMaterial({
      map: getContactShadowTexture(),
      transparent: true,
      opacity: this.data.opacity,
      depthWrite: false,
      toneMapped: false,
      // NormalBlending volontairement : MultiplyBlending ignore le canal alpha
      // dans three.js (blendFunc ZERO/SRC_COLOR), ce qui peindrait un carre
      // noir opaque autour du degrade au lieu de disparaitre sur les bords.
      blending: THREE.NormalBlending,
    })

    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.rotation.x = -Math.PI / 2
    this.mesh.position.y = this.data.lift
    this.mesh.renderOrder = -1
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    this.el.setObject3D('mesh', this.mesh)

    this.onFigureReady = (e) => this.resize(e.detail)
    this.el.sceneEl.addEventListener('figure-ready', this.onFigureReady)
  },

  remove() {
    this.el.sceneEl.removeEventListener('figure-ready', this.onFigureReady)
    if (!this.mesh) return
    this.el.removeObject3D('mesh')
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  },

  resize({width}) {
    if (!this.mesh || !Number.isFinite(width)) return
    this.mesh.scale.set(width * this.data.widthRatio * 2.2, width * this.data.depthRatio * 2.2, 1)
    this.mesh.visible = true
  },
})
