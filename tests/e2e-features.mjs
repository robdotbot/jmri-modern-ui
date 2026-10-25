// End-to-end test for programming, logic, signals, consists, operations and panels.
// Needs a running JMRI on the fixture profile (tests/fixtures/TestRailroad.jmri) with the add-on jar on its
// classpath (see README "Testing"). Every UI action is verified independently, through JMRI's REST API or a
// separate WebSocket client, never through the UI under test.
//
// Panels only exist while PanelPro runs with a screen, so the panel XML captured from PanelPro
// (tests/fixtures/panels) is served in place of /panel; all bean state is still live JMRI.
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.env.JMRI_URL ?? 'http://localhost:12080'
const APP = `${BASE}/web/modern/`
const FIX = new URL('./fixtures/panels/', import.meta.url).pathname
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rest = async (p) => (await fetch(`${BASE}/json/${p}`)).json()
const post = (p, body) => fetch(`${BASE}/json/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const until = async (fn, ms = 8000) => {
  const t = Date.now()
  for (;;) {
    const v = await fn().catch(() => undefined)
    if (v) return v
    if (Date.now() - t > ms) return v
    await sleep(150)
  }
}
let failures = 0
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`)
  if (!ok) failures++
}

// Independent WebSocket client for programmer checks.
const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/json/')
const inbox = []
ws.onmessage = (e) => inbox.push(JSON.parse(e.data))
await new Promise((r) => (ws.onopen = r))
let wsId = 1000
const wsProgram = async (data) => {
  const id = ++wsId
  ws.send(JSON.stringify({ type: 'programmer', method: 'post', data, id }))
  return until(async () => inbox.find((m) => m.id === id), 20000)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
await page.route((u) => u.pathname === '/panel/' && u.search.includes('format=json'), (r) => r.fulfill({ contentType: 'application/json', body: readFileSync(`${FIX}index.json`) }))
await page.route((u) => u.pathname.startsWith('/panel/Layout/'), (r) => r.fulfill({ contentType: 'application/json', body: readFileSync(`${FIX}Layout-My Layout.xml`) }))
await page.route((u) => u.pathname.startsWith('/panel/Panel/'), (r) => r.fulfill({ contentType: 'application/json', body: readFileSync(`${FIX}Panel-Operations Demo Panel.xml`) }))
const go = async (r) => {
  await page.evaluate((r) => (location.hash = '#/' + r), r)
  await sleep(500)
}

await page.goto(APP)
await page.getByText('Connected').waitFor()
await sleep(1000)

// ---------- programming ----------
await go('programming')
let r = await wsProgram({ op: 'write', cv: '3', value: 77 })
check(r?.data?.ok, 'independent client wrote CV3 = 77')
await page.getByLabel('CV number').fill('3')
await page.locator('section', { hasText: 'Any CV' }).getByRole('button', { name: 'Read' }).click()
check((await until(async () => (await page.getByLabel('CV value').inputValue()) === '77' && true, 15000)) === true, 'UI reads CV3 = 77 from the programming track')
await page.getByLabel('CV number').fill('4')
await page.getByLabel('CV value').fill('55')
await page.locator('section', { hasText: 'Any CV' }).getByRole('button', { name: 'Write' }).click()
await page.getByText('Wrote CV4 = 55').waitFor({ timeout: 15000 })
r = await wsProgram({ op: 'read', cv: '4' })
check(r?.data?.value === 55, `UI write CV4 = 55 confirmed by independent read (${r?.data?.value})`)
await page.getByLabel('New address').fill('1234')
await page.getByRole('button', { name: 'Write address' }).click()
await page.getByText('Address set to 1234').waitFor({ timeout: 30000 })
const cv17 = (await wsProgram({ op: 'read', cv: '17' }))?.data?.value
const cv18 = (await wsProgram({ op: 'read', cv: '18' }))?.data?.value
const cv29 = (await wsProgram({ op: 'read', cv: '29' }))?.data?.value
check(((cv17 - 192) << 8) + cv18 === 1234 && (cv29 & 32) === 32, `long address 1234 written: CV17=${cv17} CV18=${cv18} CV29=${cv29}`)
await page.getByRole('button', { name: 'Read decoder' }).click()
await page.getByText(/long, CV17\/18/).waitFor({ timeout: 30000 })
check((await page.locator('td', { hasText: 'long, CV17/18' }).innerText()).startsWith('1234'), 'Read decoder shows active long address 1234')

// ---------- logic ----------
await go('logic')
await page.getByRole('switch', { name: /Enable IQ:AUTO:0001/ }).click()
check(await until(async () => (await rest('logixng/IQ:AUTO:0001')).data.enabled === false), 'LogixNG disabled from UI (REST confirms)')
await page.getByRole('switch', { name: /Enable IQ:AUTO:0001/ }).click()
check(await until(async () => (await rest('logixng/IQ:AUTO:0001')).data.enabled === true), 'LogixNG re-enabled')
await page.getByRole('button', { name: /Logix \(/ }).click()
await page.getByRole('switch', { name: 'Enable Trigger Route' }).click()
check(await until(async () => (await rest('logix/IX:AUTO:0004')).data.enabled === false), 'Logix "Trigger Route" disabled (REST confirms)')
await page.getByRole('switch', { name: 'Enable Trigger Route' }).click()
check(await until(async () => (await rest('logix/IX:AUTO:0004')).data.enabled === true), 'Logix re-enabled')
await page.getByRole('button', { name: /LogixNG \(/ }).click()
await page.getByRole('button', { name: 'Show logic' }).first().click()
// JMRI prints the turnout's user name when it has one, so don't depend on IT3 being unnamed.
check(await page.getByText(/Set turnout .+ to state Toggle/).first().waitFor({ timeout: 5000 }).then(() => true, () => false), 'LogixNG tree shown')

// ---------- signals ----------
await go('signals')
const mast = 'IF$vsm:basic:one-low($0001)'
await page.getByRole('button', { name: /^Left-EB:/ }).click()
await page.locator('.aspect', { hasText: 'Approach' }).click()
check(await until(async () => (await rest(`signalMast/${encodeURIComponent(mast)}`)).data.aspect === 'Approach'), 'mast Left-EB set to Approach')
await page.getByLabel('Held', { exact: true }).click()
check(await until(async () => (await rest(`signalMast/${encodeURIComponent(mast)}`)).data.held === true), 'mast held from UI')
await page.getByLabel('Held', { exact: true }).click()
check(await until(async () => (await rest(`signalMast/${encodeURIComponent(mast)}`)).data.held === false), 'mast released')
await page.locator('.overlay').click({ position: { x: 5, y: 5 } })

// ---------- consists ----------
await go('consists')
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
const consist = await until(async () => (await rest('consist')).find((c) => c.data.address === 12 && c.data.engines.length === 2)?.data, 30000)
check(consist?.engines.length === 2 && consist.engines.find((e) => e.address === 4449)?.forward === false, `consist 12 created with 844 + 4449 reversed (${JSON.stringify(consist?.engines.map((e) => [e.address, e.forward]))})`)
await page.getByRole('group', { name: 'Direction of SP 4449 Daylight' }).getByRole('button', { name: 'Forward' }).click()
check(await until(async () => (await rest('consist')).find((c) => c.data.address === 12)?.data.engines.find((e) => e.address === 4449)?.forward === true, 30000), '4449 flipped to forward')
await page.getByRole('button', { name: 'Remove UP 844' }).click()
check(await until(async () => (await rest('consist')).find((c) => c.data.address === 12)?.data.engines.length === 1, 30000), '844 removed from consist')
await page.getByRole('region', { name: 'Consist Daylight pair' }).getByRole('button', { name: 'Drive' }).click()
await page.locator('.throttle', { hasText: 'Address 12' }).waitFor()
check(true, 'Drive opens a throttle on consist address 12')
await page.getByRole('button', { name: 'Release Address 12' }).click()
await go('consists')
page.once('dialog', (d) => d.accept())
await page.getByRole('region', { name: 'Consist Daylight pair' }).getByRole('button', { name: 'Delete' }).click()
check(await until(async () => !(await rest('consist')).some((c) => c.data.address === 12), 30000), 'consist deleted')
await sleep(3000)
check(!(await rest('consist')).some((c) => c.data.address === 12), 'deleted consist stays deleted')

// ---------- operations ----------
await go('operations')
const train = page.getByRole('region', { name: 'Train BB' })
if ((await rest('train/3')).data.statusCode !== 0) {
  await post('trainAction/3', { action: 'terminate' })
  await post('trainAction/3', { action: 'reset' })
  await sleep(500)
}
await train.getByRole('button', { name: 'Build' }).click()
// Built (0x10) or partially built (0x14, e.g. when an earlier run moved one of its cars).
check(await until(async () => [0x10, 0x14].includes((await rest('train/3')).data.statusCode), 30000), `train BB built from UI (${(await rest('train/3')).data.status})`)
const before = (await rest('train/3')).data.location
await train.getByRole('button', { name: /^Move to / }).click()
check(await until(async () => (await rest('train/3')).data.location !== before), `train moved: ${before} → ${(await rest('train/3')).data.location}`)
await train.getByRole('button', { name: 'Manifest' }).click()
await page.getByRole('dialog', { name: 'Manifest BB' }).getByText('Pick up').first().waitFor()
check(true, 'manifest shows pick-ups')
await page.getByRole('dialog', { name: 'Manifest BB' }).getByRole('button', { name: 'Close' }).click()
await train.getByRole('button', { name: 'Terminate' }).click()
check(await until(async () => (await rest('train/3')).data.statusCode === 0x80), 'train terminated')
await page.getByRole('button', { name: /^cars \(/ }).click()
await page.getByPlaceholder(/Search cars/).fill('ATSF 10407')
await page.getByRole('row', { name: /ATSF 10407/ }).getByRole('button', { name: 'Move' }).click()
await page.getByLabel('Location', { exact: true }).selectOption({ label: 'Port Arthur' })
await page.getByRole('button', { name: 'Save' }).click()
check(await until(async () => (await rest('car/ATSF10407')).data.location?.userName === 'Port Arthur'), 'car ATSF 10407 moved to Port Arthur')

// ---------- panels ----------
await go('panels')
await page.getByTestId('panel-canvas').waitFor()
const t0 = (await rest('turnout/IT102')).data.state
await page.getByRole('button', { name: /^Turnout IT102/ }).click()
check(await until(async () => (await rest('turnout/IT102')).data.state !== t0 && (await rest('turnout/IT102')).data.state !== 0), 'layout turnout circle throws IT102')
const s0 = (await rest('sensor/IS101')).data.state
await page.getByRole('button', { name: /^sensor IS101/ }).click()
check(await until(async () => (await rest('sensor/IS101')).data.state !== s0), 'sensor icon toggles IS101')
await post('sensor/IS101', { state: 2 })
check(
  await until(async () => (await page.locator('path[data-block="ILB1"]').getAttribute('stroke')) === '#ff0000'),
  'block ILB1 drawn red when its occupancy sensor goes active',
)
await post('sensor/IS101', { state: 4 })
const a0 = (await rest(`signalMast/${encodeURIComponent(mast)}`)).data.aspect
await page.getByRole('button', { name: /^Signal IF\$vsm:basic:one-low\(\$0001\)/ }).click()
check(await until(async () => (await rest(`signalMast/${encodeURIComponent(mast)}`)).data.aspect !== a0), 'clicking a mast icon cycles its aspect')
await page.getByRole('button', { name: 'Operations Demo Panel' }).click()
await page.getByText('Susanville').waitFor()
check(true, 'Panel Editor panel renders')

check(errors.length === 0, `no console/page errors ${errors.length ? JSON.stringify(errors) : ''}`)
await browser.close()
ws.close()
console.log(`\n${failures} failure(s)`)
process.exit(failures ? 1 : 0)
