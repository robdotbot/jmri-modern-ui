// Takes the README screenshots (docs/screenshots/) against a running JMRI on the test profile
// (tests/fixtures/TestRailroad.jmri, with the add-on), set up as in the README's "Testing" section.
//   node scripts/screenshots.mjs
// Like the panel tests, it serves the captured panel XML in place of /panel; everything else is live JMRI.
import { mkdirSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.env.JMRI_URL ?? 'http://localhost:12080'
const APP = `${BASE}/web/modern/`
const FIX = new URL('../tests/fixtures/panels/', import.meta.url).pathname
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const put = (p, body) => fetch(`${BASE}/json/${p}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const dropConsist = () => fetch(`${BASE}/json/consist/12`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: 12, isLongAddress: false }) })
const post = (p, body) => fetch(`${BASE}/json/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
mkdirSync(OUT, { recursive: true })

// The same layout objects the e2e tests create, in a mix of states
const seed = [['turnout', 'IT1', 'Yard Lead'], ['turnout', 'IT2', 'Main Crossover East'], ['turnout', 'IT3', 'Main Crossover West'], ['turnout', 'IT4', 'Engine House'],
  ['sensor', 'IS1', 'East Siding Occupied'], ['sensor', 'IS2', 'West Siding Occupied'], ['sensor', 'IS3', 'Station Block'],
  ['light', 'IL1', 'Station Lights'], ['light', 'IL2', 'Street Lamps'], ['memory', 'IM1', 'Dispatcher Note']]
for (const [t, n, u] of seed) await put(`${t}/${n}`, { userName: u })
await post('turnout/IT2', { state: 4 })
await post('sensor/IS1', { state: 2 })
await post('light/IL1', { state: 2 })
await post('memory/IM1', { value: 'Extra 844 East holds at Susanville' })
await post('power', { state: 2 })
// Drop the consist a previous run may have left (JMRI 5.6 wants a JSON body on this DELETE)
await dropConsist()

// Give the simulated decoder on the programming track an identity and an address
const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/json/')
const replies = []
ws.onmessage = (e) => replies.push(JSON.parse(e.data))
await new Promise((r) => (ws.onopen = r))
let id = 1000
for (const [cv, value] of [[8, 151], [7, 255], [1, 3], [29, 6]]) {
  const mine = ++id
  ws.send(JSON.stringify({ type: 'programmer', method: 'post', data: { op: 'write', cv: String(cv), value }, id: mine }))
  for (let t = 0; t < 100 && !replies.some((m) => m.id === mine); t++) await sleep(150)
}
ws.close()

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
const shoot = async (page, name) => {
  await sleep(600)
  await page.screenshot({ path: `${OUT}${name}.png` })
  console.log(`docs/screenshots/${name}.png`)
}
const open = async (viewport) => {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 })
  await page.route((u) => u.pathname === '/panel/' && u.search.includes('format=json'), (r) => r.fulfill({ contentType: 'application/json', body: readFileSync(`${FIX}index.json`) }))
  await page.route((u) => u.pathname.startsWith('/panel/Layout/'), (r) => r.fulfill({ contentType: 'application/json', body: readFileSync(`${FIX}Layout-My Layout.xml`) }))
  await page.route((u) => u.pathname.startsWith('/panel/Panel/'), (r) => r.fulfill({ contentType: 'application/json', body: readFileSync(`${FIX}Panel-Operations Demo Panel.xml`) }))
  await page.goto(APP)
  await page.getByText('Connected').waitFor()
  await sleep(1000)
  return page
}
const go = async (page, r) => {
  await page.evaluate((r) => (location.hash = '#/' + r), r)
  await sleep(700)
}

const page = await open({ width: 1360, height: 860 })

// Roster
await go(page, 'roster')
await page.locator('.loco').first().waitFor()
await shoot(page, 'roster')

// Throttles: two locos, one running with a few functions on
for (const loco of ['UP 844', 'SP 4449']) {
  await go(page, 'roster')
  await page.locator('.loco', { hasText: loco }).getByRole('button', { name: /Drive/ }).click()
  await page.locator('.throttle', { hasText: loco }).waitFor()
}
await page.locator('.throttle .pill.warn').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
const thr = page.locator('.throttle', { hasText: 'UP 844' })
await thr.getByRole('button', { name: '50%' }).click()
await thr.getByRole('button', { name: /Bell/ }).click()
await thr.getByRole('button', { name: /Headlight|Light/ }).first().click().catch(() => {})
await page.locator('.throttle', { hasText: 'SP 4449' }).getByRole('button', { name: '25%' }).click()
await shoot(page, 'throttles')

// Consists
await go(page, 'consists')
await page.getByRole('button', { name: 'New consist' }).click()
await page.getByLabel('Consist address (1–127)').fill('12')
await page.getByLabel('Name (optional)').fill('Daylight pair')
await page.getByRole('dialog', { name: 'New consist' }).getByRole('button', { name: 'Add loco' }).click()
await page.getByRole('dialog', { name: 'Add loco to consist' }).getByRole('button', { name: /UP 844/ }).click()
await page.getByRole('dialog', { name: 'New consist' }).getByRole('button', { name: 'Add loco' }).click()
await page.getByRole('button', { name: 'Facing backward' }).click()
await page.getByRole('dialog', { name: 'Add loco to consist' }).getByRole('button', { name: /SP 4449/ }).click()
await page.getByRole('button', { name: 'Create' }).click()
await page.getByRole('dialog', { name: 'New consist' }).waitFor({ state: 'detached', timeout: 60000 })
await page.getByRole('region', { name: 'Consist Daylight pair' }).waitFor()
await sleep(4000)
await shoot(page, 'consists')

// Panels: Layout Editor, then Panel Editor
await go(page, 'panels')
await page.getByTestId('panel-canvas').waitFor()
await sleep(1000)
await shoot(page, 'panel-layout-editor')
await page.getByRole('button', { name: 'Operations Demo Panel' }).click()
await page.getByText('Susanville').waitFor()
await sleep(1000)
await shoot(page, 'panel-editor')

// Device tables
await go(page, 'turnouts')
await shoot(page, 'turnouts')
await go(page, 'sensors')
await shoot(page, 'sensors')

// Signals, with the aspect picker open
await go(page, 'signals')
await shoot(page, 'signals')
await page.getByRole('button', { name: /^Left-EB:/ }).click()
await page.locator('.aspect').first().waitFor()
await shoot(page, 'signal-aspects')
await page.locator('.overlay').click({ position: { x: 5, y: 5 } })

// Memories
await go(page, 'memories')
await shoot(page, 'memories')

// Operations: a built train with its manifest, then cars
await go(page, 'operations')
const train = page.getByRole('region', { name: 'Train BB' })
await train.getByRole('button', { name: 'Build' }).click()
await train.getByRole('button', { name: 'Manifest' }).waitFor({ timeout: 20000 })
await sleep(1000)
await shoot(page, 'operations-trains')
await train.getByRole('button', { name: 'Manifest' }).click()
await page.getByRole('dialog', { name: 'Manifest BB' }).getByText('Pick up').first().waitFor()
await shoot(page, 'operations-manifest')
await page.getByRole('dialog', { name: 'Manifest BB' }).getByRole('button', { name: 'Close' }).click()
await page.getByRole('button', { name: /^cars \(/ }).click()
await shoot(page, 'operations-cars')

// Programming: read the decoder on the programming track
await go(page, 'programming')
await page.getByRole('button', { name: 'Read decoder' }).click()
await sleep(8000)
await page.evaluate(() => document.querySelectorAll('*').forEach((e) => e.scrollTop && (e.scrollTop = 0)))
await shoot(page, 'programming')

// Logic: a LogixNG tree
await go(page, 'logic')
await shoot(page, 'logic')
await page.getByRole('button', { name: /LogixNG \(/ }).click()
await page.getByRole('button', { name: 'Show logic' }).first().click()
await sleep(800)
await shoot(page, 'logic-logixng')

// Settings
await go(page, 'settings')
await shoot(page, 'settings')

// Dark theme
await go(page, 'throttles')
await page.getByRole('button', { name: 'Toggle theme' }).click()
await shoot(page, 'throttles-dark')
await page.getByRole('button', { name: 'Toggle theme' }).click()

// Phone
const phone = await open({ width: 390, height: 844 })
await go(phone, 'roster')
await phone.locator('.loco', { hasText: 'UP 844' }).getByRole('button', { name: /Drive/ }).click()
await phone.locator('.throttle', { hasText: 'UP 844' }).waitFor()
await sleep(1500)
await shoot(phone, 'phone-throttle')
await go(phone, 'panels')
await phone.getByTestId('panel-canvas').waitFor()
await sleep(1000)
await shoot(phone, 'phone-panel')
await go(phone, 'turnouts')
await phone.getByRole('button', { name: /More/ }).click()
await shoot(phone, 'phone-more')

// Clean up what this script changed in JMRI
await page.getByRole('button', { name: /Release/ }).first().click().catch(() => {})
await go(page, 'operations')
await train.getByRole('button', { name: 'Reset' }).click().catch(() => {})
await browser.close()
await dropConsist()
