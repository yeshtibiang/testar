import {loadTrimmedTexture} from '../lib/texture.js'

// ---------------------------------------------------------------------------
// <a-entity real-scale-figure="src: ...; height: 1.88">
//
// Construit un plan texture dont la HAUTEUR DU SUJET vaut exactement `height`
// metres. L'origine de l'entite est au sol, sous les pieds : il suffit donc de
// poser cette entite sur le point renvoye par le hitTest.
//
// Combine a `xrweb="scale: absolute"` (qui met la scene en metres reels), c'est
// ce qui donne un joueur a la bonne taille a cote de l'utilisateur.
// ---------------------------------------------------------------------------

AFRAME.registerComponent('real-scale-figure', {
  schema: {
    src: {type: 'string', default: ''},
    height: {type: 'number', default: 1.8}, // metres, sujet reel
    calibration: {type: 'number', default: 1},
    feetInset: {type: 'number', default: 0}, // fraction basse du decoupage qui n'est pas le sujet
    // Correction du biais d'echelle absolue du SLAM (voir CONFIG.slamScaleCorrection
    // dans src/config.js pour la methode de mesure). Separe de `calibration` :
    // `calibration` corrige un defaut du PNG (sujet qui ne remplit pas tout le
    // decoupage), `correction` corrige un defaut du MOTEUR/de l'ENVIRONNEMENT
    // (l'unite "metre" du SLAM n'est pas exactement un metre reel). Expose en
    // schema (plutot que lu directement depuis CONFIG) pour que le panneau de
    // calibration ?calibrate puisse l'ajuster en direct sans recharger la page.
    correction: {type: 'number', default: 1},
  },

  init() {
    this.mesh = null
    this.token = 0
    this.dimensions = null
  },

  update(oldData) {
    if (this.data.src !== oldData.src) {
      this.build()
    } else if (this.mesh) {
      this.applyDimensions()
    }
  },

  remove() {
    this.disposeMesh()
  },

  disposeMesh() {
    if (!this.mesh) return
    this.el.removeObject3D('mesh')
    this.mesh.geometry.dispose()
    if (this.mesh.material.map) this.mesh.material.map.dispose()
    this.mesh.material.dispose()
    this.mesh = null
  },

  async build() {
    const {src} = this.data
    if (!src) return

    const token = ++this.token
    this.el.emit('figure-loading', {src}, false)

    let loaded
    try {
      loaded = await loadTrimmedTexture(src)
    } catch (err) {
      console.error('[kayfo-ar]', err)
      this.el.emit('figure-error', {src, error: err}, true)
      return
    }
    if (token !== this.token) {
      loaded.texture.dispose()
      return // une autre image a ete demandee entre-temps
    }

    this.disposeMesh()

    const THREE = AFRAME.THREE
    const geometry = new THREE.PlaneGeometry(1, 1)
    const material = new THREE.MeshBasicMaterial({
      map: loaded.texture,
      transparent: true,
      // alphaTest bas : garde des bords doux tout en ecrivant le depth buffer,
      // ce qui evite les artefacts de tri avec l'ombre de contact.
      alphaTest: 0.02,
      depthWrite: true,
      // Un decoupage photo a deja son eclairage cuit : pas de tone mapping,
      // sinon les couleurs derivent par rapport au flux camera.
      toneMapped: false,
      side: THREE.DoubleSide,
    })

    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.frustumCulled = false
    this.loaded = loaded
    this.el.setObject3D('mesh', this.mesh)

    this.applyDimensions()
  },

  applyDimensions() {
    if (!this.mesh || !this.loaded) return
    const {height, calibration, feetInset, correction} = this.data
    const {aspect, paddingRatioX, paddingRatioY} = this.loaded

    // Hauteur du sujet, corrigee. `correction` compense un biais d'echelle du
    // SLAM (voir CONFIG.slamScaleCorrection) : sans lui, `height` est traite
    // comme si une unite de scene valait exactement un metre reel, ce qui est
    // une estimation du moteur et peut etre fausse.
    const subjectHeight = Math.max(0.05, height * calibration * correction)

    // Hauteur du decoupage complet (le sujet peut n'en occuper qu'une partie).
    const cropHeight = subjectHeight / Math.max(0.05, 1 - feetInset)
    const cropWidth = cropHeight * aspect

    // Le plan inclut la petite marge transparente ajoutee au recadrage.
    const planeHeight = cropHeight * paddingRatioY
    const planeWidth = cropWidth * paddingRatioX
    const padBelow = (planeHeight - cropHeight) / 2

    this.mesh.scale.set(planeWidth, planeHeight, 1)
    // Bas du decoupage exactement a y = 0 -> semelles au sol.
    this.mesh.position.set(0, planeHeight / 2 - padBelow, 0)

    const renderer = this.el.sceneEl.renderer
    if (renderer && this.mesh.material.map) {
      this.mesh.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy()
      this.mesh.material.map.needsUpdate = true
    }

    this.dimensions = {width: cropWidth, height: subjectHeight}
    this.el.emit('figure-ready', {...this.dimensions, src: this.data.src}, true)
  },
})
