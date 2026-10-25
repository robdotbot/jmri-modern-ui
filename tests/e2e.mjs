// End-to-end test against a running JMRI that has the web server started and the
// DCC++ Simulator connection (see tests/fixtures/TestRailroad.jmri and the README).
// Every UI action is verified independently, via a second throttle client or JMRI's REST API.
import { chromium } from 'playwright'
const BASE = process.env.JMRI_URL ?? 'http://localhost:12080'
const APP = BASE + '/web/modern/'
const out = (m) => console.log(m)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const rest = async (p) => (await fetch(BASE + '/json/' + p)).json()
let failures = 0
const check = (ok, msg) => { out(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++ }

// Independent observer sharing loco 844 to see what the UI really sends to JMRI
// Seed layout objects (idempotent)
const seed = [['turnout','IT1','Yard Lead'],['turnout','IT2','Main Crossover East'],['turnout','IT3','Main Crossover West'],['turnout','IT4','Engine House'],
  ['sensor','IS1','East Siding Occupied'],['sensor','IS2','West Siding Occupied'],['sensor','IS3','Station Block'],
  ['light','IL1','Station Lights'],['light','IL2','Street Lamps'],['memory','IM1','Dispatcher Note']]
for (const [t, n, u] of seed) await fetch(`${BASE}/json/${t}/${n}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userName: u }) })

const obs = new WebSocket(BASE.replace(/^http/, 'ws') + '/json/')
const seen = {}
obs.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'throttle') Object.assign(seen, m.data) }
await new Promise(r => obs.onopen = r)
obs.send(JSON.stringify({ type: 'throttle', data: { name: 'obs', address: 844, isLongAddress: true } }))
setInterval(() => obs.send(JSON.stringify({ type: 'ping' })), 10000)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => m.type() === 'error' && errors.push(m.text()))
await page.goto(APP)
await page.getByText('Connected').waitFor({ timeout: 8000 })
check(true, 'UI connects to JMRI over WebSocket')
check((await page.locator('.brand').innerText()).includes('Modern UI Test Railroad'), 'railroad name from hello shown')
await page.screenshot({ path: (process.env.SHOTS_DIR ?? '.') + '/shot-empty.png' })

// Roster -> Drive
await page.getByRole('button', { name: /Roster/ }).first().click()
await page.locator('.loco').first().waitFor()
check(await page.locator('.loco').count() === 4, 'roster shows 4 entries')
await page.getByRole('button', { name: /Steam/ }).click()
check(await page.locator('.loco').count() === 2, 'roster group filter Steam -> 2')
await page.screenshot({ path: (process.env.SHOTS_DIR ?? '.') + '/shot-roster.png' })
await page.locator('.loco', { hasText: 'UP 844' }).getByRole('button', { name: /Drive/ }).click()
await page.locator('.throttle', { hasText: 'UP 844' }).waitFor()
await page.locator('.throttle .pill.warn').waitFor({ state: 'detached', timeout: 5000 })
check(true, 'throttle acquired for UP 844')
const thr = page.locator('.throttle', { hasText: 'UP 844' })
check(await thr.getByText('Whistle').count() === 1, 'roster function labels shown (Whistle)')

await thr.getByRole('button', { name: '50%' }).click(); await sleep(400)
check(Math.abs(seen.speed - 0.5) < 0.01, `50% button -> JMRI speed ${seen.speed}`)
// drag slider to ~top
const sl = thr.getByRole('slider'); const b = await sl.boundingBox()
await page.mouse.move(b.x + b.width/2, b.y + b.height*0.8); await page.mouse.down()
await page.mouse.move(b.x + b.width/2, b.y + b.height*0.25, { steps: 10 }); await page.mouse.up(); await sleep(400)
check(seen.speed > 0.7 && seen.speed < 0.8, `slider drag -> JMRI speed ${seen.speed?.toFixed(3)}`)
await sl.focus(); await page.keyboard.press('Home'); await sleep(300)
check(seen.speed === 0, `keyboard Home -> speed ${seen.speed}`)
await thr.getByRole('button', { name: /Rev/ }).click(); await sleep(300)
check(seen.forward === false, 'Rev -> forward=false in JMRI')
const f0 = !!seen.F1
await thr.getByRole('button', { name: /Bell/ }).click(); await sleep(300)
check(seen.F1 === !f0, `Bell (F1, latching) toggled ${f0} -> ${seen.F1}`)
await thr.getByRole('button', { name: /Bell/ }).click(); await sleep(300)
check(seen.F1 === f0, `Bell toggled back -> ${seen.F1}`)
// momentary whistle F2: held only while pressed
const wb = await thr.getByRole('button', { name: /Whistle/ }).first().boundingBox()
await page.mouse.move(wb.x + 5, wb.y + 5); await page.mouse.down(); await sleep(300)
const during = seen.F2
await page.mouse.up(); await sleep(300)
check(during === true && seen.F2 === false, `Whistle (F2, momentary) true while held, false after (${during}/${seen.F2})`)
await thr.getByRole('button', { name: '75%' }).click(); await sleep(300)
await thr.getByRole('button', { name: 'E-Stop' }).click(); await sleep(400)
check(seen.speed < 0 || seen.speed === 0, `E-Stop -> speed ${seen.speed}`)
await page.screenshot({ path: (process.env.SHOTS_DIR ?? '.') + '/shot-throttle.png' })

// Reload: throttle restored
await page.reload(); await page.getByText('Connected').waitFor()
await page.locator('.throttle', { hasText: 'UP 844' }).waitFor({ timeout: 5000 })
await page.locator('.throttle .pill.warn').waitFor({ state: 'detached', timeout: 5000 })
check(true, 'throttle re-acquired after reload')

// A throttle whose commands JMRI stops confirming must be flagged: a JMRI bug can leave a shared throttle
// dead after another client vanishes, and then its Stop doesn't work. Simulate that by dropping JMRI's
// throttle pushes to this page.
{
  const p2 = await ctx.newPage()
  let drop = false
  await p2.routeWebSocket(/\/json\/$/, (ws) => {
    const server = ws.connectToServer()
    server.onMessage((m) => {
      if (!(drop && /"type":"throttle"/.test(m))) ws.send(m)
    })
    ws.onMessage((m) => server.send(m))
  })
  await p2.goto(APP + '#/throttles')
  await p2.getByText('Connected').waitFor()
  await p2.getByRole('button', { name: 'Add throttle' }).first().click()
  await p2.getByLabel('Or a DCC address').fill('21')
  await p2.getByRole('button', { name: 'Acquire' }).click()
  const card = p2.locator('.throttle', { hasText: 'Address 21' })
  await card.locator('.pill.warn').waitFor({ state: 'detached', timeout: 8000 })
  await card.getByRole('button', { name: '25%' }).click()
  await sleep(3500)
  check((await card.getByRole('alert').count()) === 0, 'no warning while JMRI confirms commands')
  drop = true
  await card.getByRole('button', { name: '50%' }).click()
  check(await card.getByRole('alert').waitFor({ timeout: 5000 }).then(() => true, () => false), 'throttle flagged when JMRI stops confirming its commands')
  await card.getByRole('button', { name: 'Turn track power off' }).click()
  check(await (async () => { for (let i = 0; i < 20; i++) { if ((await rest('power'))[0].data.state === 4) return true; await sleep(150) } return false })(), 'warning offers track power off, and it works')
  // JMRI still silent: the replacement can't be acquired either, and the card must say so.
  await card.getByRole('button', { name: 'Get a fresh throttle' }).click()
  const waiting = p2.locator('.throttle', { hasText: 'Address 21' })
  check(await waiting.getByText(/JMRI hasn't handed over this loco yet/).waitFor({ timeout: 9000 }).then(() => true, () => false), 'stalled acquisition explained after a few seconds')
  await waiting.getByRole('button', { name: /Release/ }).click()
  drop = false
  await p2.getByRole('button', { name: 'Add throttle' }).first().click()
  await p2.getByLabel('Or a DCC address').fill('21')
  await p2.getByRole('button', { name: 'Acquire' }).click()
  const fresh = p2.locator('.throttle', { hasText: 'Address 21' })
  await fresh.locator('.pill.warn').waitFor({ state: 'detached', timeout: 8000 })
  check((await fresh.getByRole('alert').count()) === 0 && (await fresh.getByText(/hasn't handed over/).count()) === 0, 'loco acquired normally once JMRI answers again')
  await fresh.getByRole('button', { name: /Release/ }).click()
  await p2.close()
}

// Turnouts
await page.getByRole('button', { name: /Turnouts/ }).click()
const before = (await rest('turnout/IT3')).data.state
await page.getByRole('button', { name: /Main Crossover West/ }).click(); await sleep(400)
const after = (await rest('turnout/IT3')).data.state
check(before !== after && (after === 2 || after === 4), `turnout IT3 toggled ${before} -> ${after}`)
// external change appears in UI
await fetch(BASE + '/json/turnout/IT4', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 4 }) })
await sleep(400)
check((await page.getByRole('button', { name: /Engine House/ }).innerText()).includes('Thrown'), 'external turnout change pushed to UI')
await page.screenshot({ path: (process.env.SHOTS_DIR ?? '.') + '/shot-turnouts.png' })

// Sensors: system objects hidden by default
await page.getByRole('button', { name: /Sensors/ }).click()
check(await page.getByText('ISCLOCKRUNNING').count() === 0, 'internal clock sensor hidden')
const s0 = (await rest('sensor/IS3')).data.state
await page.getByRole('button', { name: /Station Block/ }).click(); await sleep(300)
const s1 = (await rest('sensor/IS3')).data.state
check(s0 !== s1 && (s1 === 2 || s1 === 4), `sensor IS3 toggled ${s0} -> ${s1}`)

// Lights
await page.getByRole('button', { name: /Lights/ }).click()
const l0 = (await rest('light/IL1')).data.state
await page.getByRole('button', { name: /Station Lights/ }).click(); await sleep(300)
const l1 = (await rest('light/IL1')).data.state
check(l0 !== l1 && (l1 === 2 || l1 === 4), `light IL1 toggled ${l0} -> ${l1}`)

// Memories edit
await page.getByRole('button', { name: /Memories/ }).click()
const mem = page.getByRole('row', { name: /Dispatcher Note/ }).getByRole('textbox')
await mem.fill('Hold at West'); await mem.press('Enter'); await sleep(400)
check((await rest('memory/IM1')).data.value === 'Hold at West', 'memory value edited')

// Create a turnout
await page.getByRole('button', { name: /Turnouts/ }).click()
await page.getByRole('button', { name: 'New', exact: true }).click()
await page.getByLabel('System name').fill('IT20'); await page.getByLabel(/User name/).fill('Interchange')
await page.getByRole('button', { name: 'Create' }).click(); await sleep(600)
check(await page.getByRole('button', { name: /Interchange/ }).count() >= 1, 'new turnout created and listed')

// Power
const p0 = (await rest('power'))[0].data.state
await page.locator('button.power').click(); await sleep(500)
const p1 = (await rest('power'))[0].data.state
check(p0 !== p1, `track power toggled ${p0} -> ${p1}`)

// Mobile + light theme screenshots
await page.setViewportSize({ width: 390, height: 844 })
await page.getByRole('button', { name: /Throttles/ }).click(); await sleep(300)
await page.screenshot({ path: (process.env.SHOTS_DIR ?? '.') + '/shot-mobile-dark.png' })
await page.emulateMedia({ colorScheme: 'light' }); await sleep(200)
await page.screenshot({ path: (process.env.SHOTS_DIR ?? '.') + '/shot-mobile-light.png' })
for (const r of ['throttles','roster','turnouts','memories','settings','programming','logic','signals','consists','operations','panels']) {
  await page.evaluate((r) => location.hash = '#/' + r, r); await sleep(250)
  const w = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.querySelector('.main').scrollWidth))
  check(w <= 390, `no horizontal overflow on phone: ${r} (${w}px)`)
}
await page.evaluate(() => location.hash = '#/throttles'); await sleep(250)
await page.screenshot({ path: (process.env.SHOTS_DIR ?? '.') + '/shot-mobile-light.png' })
await page.setViewportSize({ width: 1360, height: 900 })
await page.getByRole('button', { name: /Settings/ }).click(); await sleep(300)
await page.screenshot({ path: (process.env.SHOTS_DIR ?? '.') + '/shot-settings-light.png' })

check(errors.length === 0, `no console/page errors ${errors.length ? JSON.stringify(errors) : ''}`)
// cleanup
await page.getByRole('button', { name: /Throttles/ }).click()
await page.getByRole('button', { name: /Release UP 844/ }).click()
await fetch(BASE + '/json/turnout/IT20', { method: 'DELETE' })
await browser.close(); obs.close()
out(`\n${failures} failure(s)`)
process.exit(failures ? 1 : 0)
