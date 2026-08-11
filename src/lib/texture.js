// ---------------------------------------------------------------------------
// Chargement + recadrage automatique sur la zone opaque du PNG.
//
// POURQUOI C'EST LE COEUR DE L'ECHELLE REELLE
// -------------------------------------------
// Un PNG detoure a presque toujours des marges transparentes, et elles varient
// d'une image a l'autre. Si on dimensionne le plan sur la hauteur du FICHIER,
// un joueur de 1,88 m se retrouve affiche a 1,70 m ou 2,05 m selon le detourage.
//
// On mesure donc la bounding box des pixels reellement opaques, on recadre
// dessus, et on dimensionne le plan sur CETTE hauteur. La hauteur en metres
// declaree dans players.js correspond alors exactement au sujet, pieds inclus.
// ---------------------------------------------------------------------------

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Image introuvable : ${src}`))
    img.src = src
  })

/**
 * Bounding box des pixels dont alpha > threshold.
 * Balayage en deux passes (lignes puis colonnes) pour eviter de garder
 * l'ImageData entier en memoire plus longtemps que necessaire.
 */
const opaqueBounds = (data, width, height, threshold) => {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (data[(row + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        maxY = y // les lignes sont parcourues dans l'ordre
      }
    }
  }

  if (maxX < 0) return null // image entierement transparente
  return {minX, minY, maxX, maxY}
}

/**
 * @param {string} src
 * @param {object} [opts]
 * @param {number} [opts.alphaThreshold=10] seuil alpha (0-255) du recadrage
 * @param {number} [opts.padding=2] marge transparente conservee, en px, pour
 *        eviter que le filtrage bilineaire ne "bave" sur les bords du plan
 * @returns {Promise<{texture: THREE.CanvasTexture, aspect: number,
 *                    cropWidth: number, cropHeight: number,
 *                    paddingRatioX: number, paddingRatioY: number}>}
 */
export async function loadTrimmedTexture(src, opts = {}) {
  const {alphaThreshold = 10, padding = 2} = opts
  const THREE = AFRAME.THREE

  const img = await loadImage(src)
  const w = img.naturalWidth
  const h = img.naturalHeight

  const probe = document.createElement('canvas')
  probe.width = w
  probe.height = h
  const pctx = probe.getContext('2d', {willReadFrequently: true})
  pctx.drawImage(img, 0, 0)

  const bounds = opaqueBounds(pctx.getImageData(0, 0, w, h).data, w, h, alphaThreshold) || {
    minX: 0,
    minY: 0,
    maxX: w - 1,
    maxY: h - 1,
  }

  const cropWidth = bounds.maxX - bounds.minX + 1
  const cropHeight = bounds.maxY - bounds.minY + 1

  const out = document.createElement('canvas')
  out.width = cropWidth + padding * 2
  out.height = cropHeight + padding * 2
  const octx = out.getContext('2d')
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(
    img,
    bounds.minX, bounds.minY, cropWidth, cropHeight,
    padding, padding, cropWidth, cropHeight
  )

  const texture = new THREE.CanvasTexture(out)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true

  return {
    texture,
    // Rapport largeur/hauteur du SUJET (padding exclu).
    aspect: cropWidth / cropHeight,
    cropWidth,
    cropHeight,
    // Le plan inclut le padding : ces ratios servent a le compenser pour que
    // la hauteur du SUJET reste exactement la hauteur demandee.
    paddingRatioX: (cropWidth + padding * 2) / cropWidth,
    paddingRatioY: (cropHeight + padding * 2) / cropHeight,
  }
}

/**
 * Texture d'ombre de contact : degrade radial doux, genere une seule fois.
 * Evite d'avoir a activer les shadow maps (couteuses) pour un simple decoupage.
 */
let shadowTexture = null
export function getContactShadowTexture() {
  if (shadowTexture) return shadowTexture
  const THREE = AFRAME.THREE

  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0.0, 'rgba(0,0,0,0.55)')
  g.addColorStop(0.35, 'rgba(0,0,0,0.34)')
  g.addColorStop(0.7, 'rgba(0,0,0,0.10)')
  g.addColorStop(1.0, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  shadowTexture = new THREE.CanvasTexture(canvas)
  shadowTexture.colorSpace = THREE.SRGBColorSpace
  shadowTexture.needsUpdate = true
  return shadowTexture
}
