// End-to-end test for editing panels. Unlike the other tests it needs panels JMRI really has open, which takes a
// JMRI with a screen (see README "Testing"). Every change made in the UI is checked in the XML JMRI's own /panel
// servlet produces from the live panel.
import { chromium } from 'playwright'

const BASE = process.env.JMRI_URL ?? 'http://localhost:12080'
const APP = `${BASE}/web/modern/`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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
const panelXml = async (name) => (await fetch(`${BASE}/panel/${name}?format=xml`)).text()
const attr = (xml, re) => re.exec(xml)

const list = await (await fetch(`${BASE}/panel/?format=json`)).json()
if (!list.some((p) => p.data.userName === 'My Layout')) {
  console.log('SKIP  JMRI has no open panels (it needs a screen); nothing to test')
  process.exit(0)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`${APP}#/panels`)
await page.getByText('Connected').waitFor()
await page.getByRole('button', { name: 'My Layout' }).click()
await page.getByTestId('panel-canvas').waitFor()
await page.getByRole('button', { name: '100%' }).click()
await page.getByRole('button', { name: 'Edit', exact: true }).click()

// Add a label, drag it, change its text, delete it.
await page.getByLabel('Add', { exact: true }).selectOption('label')
await page.getByLabel('Text', { exact: true }).fill('E2E label')
await page.getByRole('button', { name: 'Add', exact: true }).click()
let x = await until(async () => {
  const m = attr(await panelXml('Layout/My%20Layout'), /<positionablelabel [^>]*x="(\d+)" y="(\d+)"[^>]*text="E2E label"/)
  return m && [Number(m[1]), Number(m[2])]
})
check(!!x, `added label is on the live panel at ${x}`)
const label = page.getByRole('button', { name: 'Move label E2E label' })
await label.locator('.panel-item').waitFor()
const box = await label.locator('.panel-item').boundingBox()
await page.mouse.move(box.x + 5, box.y + 5)
await page.mouse.down()
await page.mouse.move(box.x + 25, box.y + 20, { steps: 5 })
await page.mouse.move(box.x + 45, box.y + 35, { steps: 5 })
await page.mouse.up()
const moved = await until(async () => {
  const m = attr(await panelXml('Layout/My%20Layout'), /<positionablelabel [^>]*x="(\d+)" y="(\d+)"[^>]*text="E2E label"/)
  return m && Number(m[1]) === x[0] + 40 && Number(m[2]) === x[1] + 30 && m
})
check(!!moved, `dragging the label 40,30 moved it on the live panel (${x} → ${moved?.[1]},${moved?.[2]})`)
await page.getByRole('button', { name: 'Move label E2E label' }).locator('.panel-item').click()
await page.getByRole('button', { name: 'Change text' }).click()
await page.getByLabel('Label text').fill('E2E renamed')
await page.getByRole('button', { name: 'Save' }).click()
check(await until(async () => (await panelXml('Layout/My%20Layout')).includes('text="E2E renamed"')), 'label text changed on the live panel')
await page.getByRole('button', { name: 'Move label E2E renamed' }).locator('.panel-item').click()
await page.getByRole('button', { name: 'Delete', exact: true }).click()
check(await until(async () => !(await panelXml('Layout/My%20Layout')).includes('E2E renamed')), 'label deleted from the live panel')

// Add a sensor icon, then delete it.
await page.getByLabel('Add', { exact: true }).selectOption('sensor')
await page.getByLabel('Name', { exact: true }).fill('IS102')
await page.getByRole('button', { name: 'Add', exact: true }).click()
check(await until(async () => /<sensoricon [^>]*sensor="IS102"[^>]*x="40" y="40"|<sensoricon [^>]*x="40" y="40"[^>]*sensor="IS102"/.test(await panelXml('Layout/My%20Layout'))), 'sensor icon for IS102 added to the live panel')
await page.getByRole('button', { name: 'Move sensor IS102' }).last().locator('.panel-item').click()
await page.getByRole('button', { name: 'Delete', exact: true }).click()
check(await until(async () => !/<sensoricon [^>]*x="40" y="40"/.test(await panelXml('Layout/My%20Layout'))), 'sensor icon deleted')

// Drag a Layout Editor turnout by its handle; its legs and connected track follow in JMRI.
await page.getByText(/^Drag items/).waitFor()
await sleep(500)
const before = attr(await panelXml('Layout/My%20Layout'), /<layoutturnout ident="(\w+)"[^>]*xcen="([\d.]+)" ycen="([\d.]+)"/)
const handle = page.getByRole('button', { name: `Move turnout ${before[1]}` })
const hb = await handle.boundingBox()
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
await page.mouse.down()
await page.mouse.move(hb.x + hb.width / 2 + 15, hb.y + hb.height / 2 + 10, { steps: 5 })
await page.mouse.move(hb.x + hb.width / 2 + 30, hb.y + hb.height / 2 + 20, { steps: 5 })
await page.mouse.up()
const after = await until(async () => {
  const m = attr(await panelXml('Layout/My%20Layout'), new RegExp(`<layoutturnout ident="${before[1]}"[^>]*xcen="([\\d.]+)" ycen="([\\d.]+)"`))
  return m && Number(m[1]) === Number(before[2]) + 30 && m
})
check(!!after, `turnout ${before[1]} dragged 30,20 on the live panel (${before[2]},${before[3]} → ${after?.[1]},${after?.[2]})`)
check((await page.getByText('Not stored yet').count()) > 0, 'edits are flagged as not stored')

// Panel Editor panel: move an icon.
await page.getByRole('button', { name: 'Done editing' }).click()
await page.getByRole('button', { name: 'Operations Demo Panel' }).click()
await page.getByTestId('panel-canvas').waitFor()
await page.getByRole('button', { name: 'Edit', exact: true }).click()
const first = page.locator('.panel-drag').first()
const fb = await first.locator('.panel-item').boundingBox()
const pBefore = await panelXml('Panel/Operations%20Demo%20Panel')
await page.mouse.move(fb.x + 3, fb.y + 3)
await page.mouse.down()
await page.mouse.move(fb.x + 13, fb.y + 3, { steps: 4 })
await page.mouse.move(fb.x + 23, fb.y + 3, { steps: 4 })
await page.mouse.up()
check(await until(async () => (await panelXml('Panel/Operations%20Demo%20Panel')) !== pBefore), 'dragging an icon on a Panel Editor panel changes the live panel')

check(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ''}`)
await browser.close()
console.log(`\n${failures} failure(s)`)
process.exit(failures ? 1 : 0)
