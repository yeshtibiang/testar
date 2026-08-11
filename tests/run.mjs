// Lance tests/scale.spec.html dans Chromium via le serveur de dev Vite.
// Usage : npm run test
import {chromium} from 'playwright'
import {createServer} from 'vite'

const server = await createServer({server: {port: 5199, host: '127.0.0.1'}, logLevel: 'error'})
await server.listen()

// CHROMIUM_PATH permet d'utiliser un Chromium deja present (CI, conteneur)
// plutot que d'exiger `npx playwright install`.
const launchOpts = {args: ['--no-sandbox']}
if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH

const browser = await chromium.launch(launchOpts)
// Le serveur de dev tourne en HTTPS (certificat auto-signe de basicSsl).
const page = await browser.newPage({ignoreHTTPSErrors: true})

const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.goto('https://127.0.0.1:5199/tests/scale.spec.html', {waitUntil: 'load'})
await page.waitForFunction(() => window.__RESULTS__, null, {timeout: 30000})
const results = await page.evaluate(() => window.__RESULTS__)

let failed = 0
for (const r of results) {
  const got = r.got === undefined ? '' : `  (${typeof r.got === 'number' ? r.got.toFixed(5) : r.got})`
  console.log(`${r.ok ? 'OK  ' : 'ECHEC'}  ${r.name}${got}`)
  if (!r.ok) failed++
}

// A-Frame journalise des avertissements benins ; on ne retient que les vraies erreurs.
const realErrors = errors.filter((e) => !/THREE\.|deprecated|Multiple instances/i.test(e))
if (realErrors.length) {
  console.log('\nErreurs console :')
  realErrors.forEach((e) => console.log('  ' + e))
}

console.log(`\n${results.length - failed}/${results.length} tests reussis`)

await browser.close()
await server.close()
process.exit(failed || realErrors.length ? 1 : 0)
