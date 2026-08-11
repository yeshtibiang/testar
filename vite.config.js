import {defineConfig} from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import {viteStaticCopy} from 'vite-plugin-static-copy'
import compression from 'compression'

// ---------------------------------------------------------------------------
// Les bundles 8th Wall NE PEUVENT PAS etre importes comme des modules ES.
// Ils s'installent en <script>, exposent des globals (window.XR8, XRExtras,
// LandingPage, CoachingOverlay) et resolvent leurs ressources (.tflite, .svg,
// les chunks xr-slam.js / xr-face.js) RELATIVEMENT au fichier .js charge.
//
// => On recopie donc les dossiers `dist` complets tels quels dans /external.
//
// ATTENTION : le moteur retrouve sa propre balise script via la regex
//   /(xrweb|xr\.js)(\?.*)?$/
// Le fichier DOIT donc rester nomme exactement `xr.js`, sans hash de build.
// C'est pour ca qu'on passe par viteStaticCopy et pas par le pipeline d'assets.
// ---------------------------------------------------------------------------
const vendor = [
  {src: 'node_modules/@8thwall/engine-binary/dist/*', dest: 'external/xr'},
  {src: 'node_modules/@8thwall/xrextras/dist/*', dest: 'external/xrextras'},
  {src: 'node_modules/@8thwall/landing-page/dist/*', dest: 'external/landing-page'},
  {src: 'node_modules/@8thwall/coaching-overlay/dist/*', dest: 'external/coaching-overlay'},
  {src: 'node_modules/aframe/dist/aframe-master.min.js', dest: 'external/aframe', rename: 'aframe.min.js'},
]

// ---------------------------------------------------------------------------
// Compression a la volee.
//
// Le moteur pese 6,5 Mo non compresse (xr.js 1 Mo + xr-slam.js 5,5 Mo), et rien
// ne s'affiche tant qu'il n'est pas entierement telecharge : c'est `xrloaded`
// qui declenche le montage de la scene, et il n'est emis qu'apres les chunks.
// Ni `vite dev` ni `vite preview` ne compressent les fichiers statiques par
// defaut — le premier chargement sur telephone en devenait interminable.
//
// Enregistre dans configureServer(), donc AVANT les middlewares internes de
// Vite : la compression s'applique bien aux reponses statiques.
// ---------------------------------------------------------------------------
// Note : ces hooks ne doivent RIEN renvoyer. Une valeur de retour est
// interpretee par Vite comme un post-hook a appeler, et `.use()` renvoie
// l'application connect — ce qui fait planter le serveur au demarrage.
const gzipEngine = () => ({
  name: 'kayfo-gzip-engine',
  configureServer(server) {
    server.middlewares.use(compression())
  },
  configurePreviewServer(server) {
    server.middlewares.use(compression())
  },
})

export default defineConfig({
  // Chemins RELATIFS dans le build.
  //
  // Par defaut Vite ecrit `/assets/...` et `/external/...` : le dossier `dist/`
  // ne fonctionne alors QUE s'il est servi a la racine du domaine. Ouvert
  // depuis un sous-dossier (Live Server sur la racine du projet, deploiement
  // dans /monapp/, double-clic sur dist/index.html), toutes les ressources
  // renvoient 404 — moteur, CSS et JS compris.
  //
  // `base: './'` rend le build deplacable. En developpement, Vite ramene
  // automatiquement `import.meta.env.BASE_URL` a '/', donc rien ne change.
  base: './',

  // HTTPS obligatoire : getUserMedia + DeviceMotion ne fonctionnent pas en http://
  // sur un telephone. `npm run dev` sert donc en https sur l'IP du LAN.
  //
  // `proxy: {}` n'est pas decoratif : quand une configuration de proxy est
  // presente, Vite cree le serveur HTTPS en HTTP/1.1 au lieu de HTTP/2. Or le
  // middleware `compression` est ecrit pour l'API HTTP/1 et plante sur une
  // reponse HTTP/2 ("this._implicitHeader is not a function").
  // HTTP/1.1 + gzip reste tres largement gagnant face a HTTP/2 sans gzip pour
  // servir les 6,5 Mo du moteur.
  server: {host: true, port: 5173, proxy: {}},
  preview: {host: true, port: 4173, proxy: {}},
  plugins: [gzipEngine(), basicSsl(), viteStaticCopy({targets: vendor})],
  build: {
    target: 'es2019',
    assetsInlineLimit: 0,
  },
})
