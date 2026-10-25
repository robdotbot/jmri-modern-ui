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
await page.route((u) => u.pathname.startsWith('/panel/Layout/'), (r) =>
  r.fulfill({ contentType: 'application/json', body: readFileSync(`${FIX}Layout-${decodeURIComponent(new URL(r.request().url()).pathname.slice('/panel/Layout/'.length))}.xml`) }),
)
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

// Decoder settings: DecoderPro's panes for the roster loco's decoder definition.
await page.getByRole('button', { name: 'Decoder settings' }).click()
await page.getByLabel('Roster loco').selectOption('UP 844')
const panes = page.getByRole('tablist', { name: 'Panes' })
await panes.waitFor({ timeout: 30000 })
const paneNames = await panes.getByRole('tab').allInnerTexts()
check(paneNames.includes('Basic') && paneNames.includes('Function Map') && !paneNames.includes('Sound'), `programmer panes shown, empty ones hidden (${paneNames.join(', ')})`)
r = await wsProgram({ op: 'write', cv: '29', value: 34 }) // long address, 28/128 steps, normal direction
await page.getByRole('button', { name: 'Read pane' }).click()
check(await until(async () => (await page.getByLabel('Active address').inputValue()) === '1234', 30000), 'Basic pane read: active address 1234 from CV17/18/29')
await until(async () => page.getByRole('button', { name: 'Read pane' }).isEnabled(), 60000)
const dir = page.getByLabel('Locomotive Direction', { exact: true })
await dir.selectOption({ index: 1 })
await page.getByRole('button', { name: /^Write changes/ }).click()
check(await until(async () => ((await wsProgram({ op: 'read', cv: '29' }))?.data?.value & 1) === 1, 20000), 'named setting "Locomotive Direction" written: CV29 bit 0 set (independent read)')
await page.getByRole('button', { name: 'Save to roster' }).click()
const wsRequest = async (type, data) => {
  const id = ++wsId
  ws.send(JSON.stringify({ type, data, id }))
  return until(async () => inbox.find((m) => m.id === id), 10000)
}
check(await until(async () => (await wsRequest('rosterCvs', { name: 'UP 844' }))?.data?.values?.['29']?.value === 35), 'Save to roster stores CV29 = 35 in the roster entry')
await page.getByRole('button', { name: 'Quick setup' }).click()
// Indexed CVs go through the facades the decoder definition declares (ESU: CV31/32 pages), as in DecoderPro.
r = await wsProgram({ op: 'write', cv: '16.0.259', value: 5, decoderFile: 'ESU_LokSound5.xml' })
const idx = await wsProgram({ op: 'read', cv: '16.0.259', decoderFile: 'ESU_LokSound5.xml' })
check(r?.data?.ok && idx?.data?.value === 5 && (await wsProgram({ op: 'read', cv: '31' }))?.data?.value === 16, 'indexed CV 16.0.259 programmed through the ESU definition\'s facades')

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

// Editing logic. Fresh beans, so the fixture's own Logix don't interfere.
for (const [t, n] of [['sensor', 'ISE2E1'], ['turnout', 'ITE2E1'], ['sensor', 'ISE2E2'], ['turnout', 'ITE2E2']]) {
  await fetch(`${BASE}/json/${t}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) })
  await post(`${t}/${n}`, { state: t === 'sensor' ? 4 : 2 })
}
// LogixNG: If ISE2E1 is active then throw ITE2E1, built from nothing.
await page.getByRole('button', { name: 'New LogixNG' }).click()
await page.getByLabel('New LogixNG name').fill('E2E NG')
await page.getByRole('button', { name: 'Create' }).click()
const ngCard = page.getByRole('region', { name: 'LogixNG E2E NG' })
await ngCard.getByRole('button', { name: 'Show logic' }).click()
await ngCard.getByRole('button', { name: 'Add ConditionalNG' }).click()
await ngCard.getByLabel('ConditionalNG name').fill('E2E CNG')
await ngCard.getByRole('button', { name: 'Add', exact: true }).click()
const cng = ngCard.getByRole('group', { name: 'ConditionalNG E2E CNG' })
await cng.getByLabel('Add to A').selectOption('IfThenElse')
await cng.getByLabel('Add to If').selectOption('ExpressionSensor')
const ifSocket = cng.locator('[data-socket="If"]')
await ifSocket.getByLabel('Sensor', { exact: true }).fill('ISE2E1')
await ifSocket.getByLabel('Sensor', { exact: true }).press('Enter')
await until(async () => (await ifSocket.getByLabel('Sensor', { exact: true }).inputValue()) === 'ISE2E1' && (await ifSocket.locator('.ng-desc').first().innerText()).includes('ISE2E1'))
await ifSocket.getByLabel('State', { exact: true }).selectOption('Active')
await cng.getByLabel('Add to Then').selectOption('ActionTurnout')
const thenSocket = cng.locator('[data-socket="Then"]')
await thenSocket.getByLabel('Turnout', { exact: true }).fill('ITE2E1')
await thenSocket.getByLabel('Turnout', { exact: true }).press('Enter')
await until(async () => (await thenSocket.locator('.ng-desc').first().innerText()).includes('ITE2E1'))
await thenSocket.getByLabel('State', { exact: true }).selectOption('Thrown')
await until(async () => (await thenSocket.locator('.ng-desc').first().innerText()).includes('Thrown'))
await post('sensor/ISE2E1', { state: 2 })
check(await until(async () => (await rest('turnout/ITE2E1')).data.state === 4), 'LogixNG built in the UI throws ITE2E1 when ISE2E1 goes active')
await ifSocket.getByRole('button', { name: /^Remove/ }).click()
check(await until(async () => (await cng.getByLabel('Add to If').count()) === 1), 'removing the expression empties the If socket')

// Classic Logix: a conditional "ISE2E2 active → throw ITE2E2".
await page.getByRole('button', { name: /^Logix \(/ }).click()
await page.getByRole('button', { name: 'New Logix' }).click()
await page.getByLabel('New Logix name').fill('E2E Logix')
await page.getByRole('button', { name: 'Create' }).click()
const lxCard = page.getByRole('region', { name: 'Logix E2E Logix' })
await lxCard.getByRole('button', { name: 'Show logic' }).click()
await lxCard.getByRole('button', { name: 'Add conditional' }).click()
const editor = lxCard.getByRole('group', { name: /^Edit conditional/ })
await editor.getByLabel('Conditional name').fill('When E2E2')
await editor.getByRole('button', { name: 'Add condition' }).click()
await editor.getByRole('group', { name: 'Condition R1' }).getByLabel('Name').fill('ISE2E2')
await editor.getByRole('button', { name: 'Add action' }).click()
await editor.getByRole('group', { name: 'Action 1' }).getByLabel('Name').fill('ITE2E2')
await editor.getByRole('button', { name: 'Save conditional' }).click()
await lxCard.getByRole('group', { name: 'Conditional When E2E2' }).waitFor()
check((await lxCard.getByRole('group', { name: 'Conditional When E2E2' }).innerText()).includes('ITE2E2'), 'conditional saved and described by JMRI')
await post('sensor/ISE2E2', { state: 2 })
check(await until(async () => (await rest('turnout/ITE2E2')).data.state === 4), 'Logix conditional made in the UI throws ITE2E2 when ISE2E2 goes active')

// Store, then check the file JMRI wrote.
check(await page.getByText('Not stored yet').isVisible(), 'unstored changes are flagged')
await page.getByRole('button', { name: 'Store…' }).click()
const storeTo = await page.getByLabel('File to store to').inputValue()
await page.getByRole('dialog', { name: 'Store configuration' }).getByRole('button', { name: 'Store' }).click()
check(await until(async () => !(await page.getByText('Not stored yet').isVisible())), 'Store clears the unstored flag')
const stored = readFileSync(storeTo, 'utf8')
check(stored.includes('E2E Logix') && stored.includes('E2E NG'), `stored file ${storeTo.split('/').pop()} contains the new Logix and LogixNG`)

page.once('dialog', (d) => d.accept())
await lxCard.getByRole('button', { name: 'Delete', exact: true }).first().click()
check(await until(async () => (await rest('logix')).every((l) => l.data.userName !== 'E2E Logix')), 'Logix deleted from the UI')
await page.getByRole('button', { name: /^LogixNG \(/ }).click()
await ngCard.getByRole('button', { name: 'Show logic' }).click()
page.once('dialog', (d) => d.accept())
await ngCard.getByRole('button', { name: 'Delete', exact: true }).first().click()
check(await until(async () => (await rest('logixng')).every((l) => l.data.userName !== 'E2E NG')), 'LogixNG deleted from the UI')

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
await page.getByRole('button', { name: /^cars \(/i }).click()
await page.getByPlaceholder(/Search cars/).fill('ATSF 10407')
await page.getByRole('row', { name: /ATSF 10407/ }).getByRole('button', { name: 'Move' }).click()
await page.getByLabel('Location', { exact: true }).selectOption({ label: 'Port Arthur' })
await page.getByRole('button', { name: 'Save' }).click()
check(await until(async () => (await rest('car/ATSF10407')).data.location?.userName === 'Port Arthur'), 'car ATSF 10407 moved to Port Arthur')

// Switch lists: build train SL (id 11) and compare one stop's work with its manifest, read independently.
if (![0x10, 0x14].includes((await rest('train/11')).data.statusCode)) {
  await post('trainAction/11', { action: 'reset' })
  await post('trainAction/11', { action: 'build' })
}
const slManifest = await (await fetch(`${BASE}/operations/manifest/11?format=json`)).json()
const slStop = slManifest.locations.find((l, i) => i > 0 && l.cars.add.length + l.cars.remove.length > 0)
const slCars = [...slStop.cars.add, ...slStop.cars.remove].map((c) => `${c.road} ${c.number}`)
await page.getByRole('button', { name: 'Switch lists' }).click()
await page.getByLabel('Location', { exact: true }).selectOption({ value: slStop.location.name })
const visit = page.getByRole('region', { name: `Train SL at ${slStop.userName}` })
await visit.getByRole('row').nth(1).waitFor()
const visitText = await visit.innerText()
check(
  slCars.every((c) => visitText.includes(c)) && (await visit.getByRole('row').count()) === slCars.length + 1,
  `switch list for ${slStop.userName} lists SL's ${slCars.length} car moves from its manifest`,
)
await post('trainAction/11', { action: 'reset' })
check(await until(async () => (await page.getByRole('region', { name: 'Also scheduled' }).innerText()).includes('SL')), 'reset train SL moves to "Also scheduled"')

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
// Slips and turntable (Yard Throat fixture). Start from known states: double slip SL2 on A-C, turntable on no ray.
const tstate = async (n) => (await rest(`turnout/${n}`)).data.state
for (const n of ['IT201', 'IT202', 'IT203', 'IT204', 'IT211', 'IT212', 'IT213', 'IT214']) {
  await fetch(`${BASE}/json/turnout`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) })
  await post(`turnout/${n}`, { state: 2 })
}
await page.getByRole('button', { name: 'Yard Throat' }).click()
await page.locator('[data-slip="SL2"][data-route="AC"]').waitFor()
check(true, 'double slip SL2 drawn on route A-C from its turnouts')
await page.getByRole('button', { name: /^Slip SL2 right side/ }).click()
check(await until(async () => (await tstate('IT203')) === 2 && (await tstate('IT204')) === 4), 'slip right side: A-C → A-D sets IT203 closed, IT204 thrown')
await page.locator('[data-slip="SL2"][data-route="AD"]').waitFor()
await page.getByRole('button', { name: /^Slip SL2 left side/ }).click()
check(await until(async () => (await tstate('IT203')) === 4 && (await tstate('IT204')) === 4), 'slip left side: A-D → B-D throws both turnouts')
await page.getByRole('button', { name: /^Slip SL2 right side/ }).click()
check(await until(async () => (await tstate('IT203')) === 4 && (await tstate('IT204')) === 2), 'double slip right side: B-D → B-C')
await page.getByRole('button', { name: /^Slip SL1 left side/ }).click()
check(await until(async () => (await tstate('IT201')) === 4 && (await tstate('IT202')) === 4), 'single slip left side: A-C → B-D')
check((await page.locator('[data-turntable="TUR1"]').getAttribute('data-position')) === '-1', 'turntable shows no bridge while no ray is lined up')
await page.getByRole('button', { name: /^Turntable TUR1 ray 52/ }).click()
check(await until(async () => (await tstate('IT213')) === 4), 'tapping turntable ray 52 throws its turnout IT213')
check(await until(async () => (await page.locator('[data-turntable="TUR1"]').getAttribute('data-position')) === '52'), 'turntable bridge points at ray 52')
await post('turnout/IT213', { state: 2 })
await post('turnout/IT211', { state: 4 })
check(await until(async () => (await page.locator('[data-turntable="TUR1"]').getAttribute('data-position')) === '50'), 'turntable follows a change made elsewhere (ray 50)')

await page.getByRole('button', { name: 'Operations Demo Panel' }).click()
await page.getByText('Susanville').waitFor()
check(true, 'Panel Editor panel renders')

check(errors.length === 0, `no console/page errors ${errors.length ? JSON.stringify(errors) : ''}`)
await browser.close()
ws.close()
console.log(`\n${failures} failure(s)`)
process.exit(failures ? 1 : 0)
