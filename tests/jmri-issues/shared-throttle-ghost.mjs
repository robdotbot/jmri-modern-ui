// Reproduces a JMRI JSON-server issue (seen on JMRI 5.6): two clients share a throttle, one disappears
// without closing its WebSocket (like a phone going to sleep), and the other keeps driving the loco.
//
// Expected: the survivor keeps control and new clients can acquire the loco.
// Seen:     after a couple of commands JMRI stops applying the survivor's commands for that loco (its
//           Stop included) and stops pushing to it; sometimes new clients can never acquire the loco.
//           Other locos are unaffected. Not fixed by guarding JsonThrottle.release() against a second
//           release of the same client, so the cause is elsewhere.
//
//   node tests/jmri-issues/shared-throttle-ghost.mjs [address]     (JMRI web server on localhost:12080)
//
// Run it a few times with different addresses; it doesn't happen every time.
import net from 'node:net'
import crypto from 'node:crypto'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const HOST = 'localhost', PORT = 12080, ADDR = Number(process.argv[2] ?? 3)

// Minimal raw WebSocket client so we can drop the TCP connection without a close handshake,
// like a phone that goes to sleep or leaves Wi-Fi.
function rawClient() {
  return new Promise((resolve) => {
    const s = net.connect(PORT, HOST)
    const key = crypto.randomBytes(16).toString('base64')
    s.write(`GET /json/ HTTP/1.1\r\nHost: ${HOST}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`)
    s.once('data', () => {
      const send = (obj) => {
        const payload = Buffer.from(JSON.stringify(obj))
        const mask = crypto.randomBytes(4)
        const header = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length]) : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 255])
        const body = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]))
        s.write(Buffer.concat([header, mask, body]))
      }
      resolve({ send, kill: () => s.destroy() })
    })
  })
}
const wsClient = async () => {
  const ws = new WebSocket(`ws://${HOST}:${PORT}/json/`)
  const seen = { msgs: 0 }
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'throttle') { seen.msgs++; Object.assign(seen, m.data) } }
  ws.onclose = (e) => console.log(`  [${new Date().toISOString().slice(17, 23)}] a WebSocket client was closed by JMRI: code ${e.code} ${e.reason}`)
  await new Promise((r) => (ws.onopen = r))
  return { ws, seen }
}

const survivor = await wsClient()
survivor.ws.send(JSON.stringify({ type: 'throttle', data: { name: 's', address: ADDR } }))
const ghost = await rawClient()
ghost.send({ type: 'throttle', data: { name: 'g', address: ADDR } })
await sleep(1500)
console.log(`shared: survivor sees clients=${survivor.seen.clients}`)
ghost.kill() // vanish without releasing or closing the WebSocket
for (let i = 1; i <= 10; i++) {
  survivor.ws.send(JSON.stringify({ type: 'throttle', data: { name: 's', speed: i / 20 } }))
  await sleep(150)
}
await sleep(1500)
const before = survivor.seen.speed
const t0 = Date.now()
survivor.ws.send(JSON.stringify({ type: 'throttle', data: { name: 's', speed: 0.9 } }))
const fresh = await wsClient()
fresh.ws.send(JSON.stringify({ type: 'throttle', data: { name: 'f', address: ADDR } }))
while (Date.now() - t0 < 40000 && !(survivor.seen.speed === 0.9 && fresh.seen.address != null)) await sleep(100)
console.log(`survivor's 0.9 command after ghost vanished: ${survivor.seen.speed === 0.9 ? `applied after ${Date.now() - t0} ms` : `NOT applied (speed ${before} -> ${survivor.seen.speed})`}`)
console.log(`new client acquiring ${ADDR}: ${fresh.seen.address != null ? `acquired (speed ${fresh.seen.speed})` : 'STUCK after 40 s'}`)
process.exit(0)
