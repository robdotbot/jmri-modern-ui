// Checks the app degrades gracefully when JMRI runs WITHOUT the add-on jar.
// Start JMRI on the fixture profile without addon/dist/jmri-modern-ui-addon.jar on its classpath first.
import { chromium } from 'playwright'

const BASE = process.env.JMRI_URL ?? 'http://localhost:12080'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`)
  if (!ok) failures++
}

check((await fetch(`${BASE}/json/modernUiAddon`)).status === 404, 'JMRI is running without the add-on')
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1360, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`${BASE}/web/modern/#/programming`)
await page.getByText('Connected').waitFor()
await sleep(1500)
check(await page.getByText('CV programming needs the JMRI add-on').isVisible(), 'Programming explains the add-on is needed')
await page.evaluate(() => (location.hash = '#/logic'))
await sleep(500)
check(await page.getByText('Logix and LogixNG needs the JMRI add-on').isVisible(), 'Logic explains the add-on is needed')
await page.evaluate(() => (location.hash = '#/signals'))
await sleep(800)
await page.getByRole('button', { name: /^Left-EB:/ }).click()
await page.locator('.aspect', { hasText: 'Approach' }).waitFor({ timeout: 8000 }).catch(() => {})
const aspects = await page.locator('.aspect').allInnerTexts()
check(aspects.includes('Approach') && aspects.includes('Stop'), `mast aspects from appearance file fallback: ${JSON.stringify(aspects)}`)
await page.locator('.aspect', { hasText: 'Approach' }).click()
await sleep(800)
const m = (await (await fetch(`${BASE}/json/signalMast/${encodeURIComponent('IF$vsm:basic:one-low($0001)')}`)).json()).data
check(m.aspect === 'Approach', 'aspect set without add-on')
await page.locator('.overlay').click({ position: { x: 5, y: 5 } })
await page.evaluate(() => (location.hash = '#/operations'))
await sleep(800)
check(await page.getByRole('region', { name: 'Train BB' }).getByRole('button', { name: 'Build' }).isDisabled(), 'train Build disabled without add-on')
check(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
await b.close()
console.log(`\n${failures} failure(s)`)
process.exit(failures ? 1 : 0)
