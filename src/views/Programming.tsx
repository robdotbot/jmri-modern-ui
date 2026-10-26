import { useEffect, useState } from 'react'
import type { ProgramOp, ProgramResult } from '../jmri/client.ts'
import { CV29_BITS, loadDecoderIndex, longAddressCVs, longAddressFromCVs, type DecoderMatch } from '../jmri/decoders.ts'
import { useClient, useJmri, useToast } from '../state.tsx'
import { AddonMissing } from './AddonMissing.tsx'
import { DecoderPanes } from './DecoderPanes.tsx'

interface ProgStatus {
  available: boolean
  modes?: string[]
  mode?: string
  canRead?: boolean
  canWrite?: boolean
  connection?: string
  opsAvailable: boolean
}

interface LogLine {
  at: number
  text: string
  ok: boolean
}

interface DecoderInfo {
  mfgId: number
  version: number
  manufacturer: string | null
  matches: DecoderMatch[]
  cv29: number
  shortAddress: number
  longAddress: number | null
}

const MODE_LABELS: Record<string, string> = {
  DIRECTBYTEMODE: 'Direct byte',
  DIRECTBITMODE: 'Direct bit',
  DIRECTMODE: 'Direct',
  PAGEMODE: 'Paged',
  REGISTERMODE: 'Register',
  ADDRESSMODE: 'Address only',
}

export function ProgrammingPage() {
  const client = useClient()
  const addon = useJmri((s) => s.addon)
  const conn = useJmri((s) => s.conn)
  const roster = useJmri((s) => s.roster)
  const toast = useToast()

  const [status, setStatus] = useState<ProgStatus | null>(null)
  const [target, setTarget] = useState<'track' | 'main'>('track')
  const [mode, setMode] = useState<string | undefined>(undefined)
  const [mainAddr, setMainAddr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [log, setLog] = useState<LogLine[]>([])
  const [info, setInfo] = useState<DecoderInfo | null>(null)
  const [view, setView] = useState<'quick' | 'decoder'>('quick')

  useEffect(() => {
    if (!addon || conn !== 'open') return
    client
      .request<ProgStatus>({ type: 'programmer' })
      .then((m) => {
        setStatus(m.data!)
        setMode(m.data!.mode)
      })
      .catch((e) => toast(`Programmer: ${e.message}`))
  }, [addon, conn, client, toast])

  if (addon === null) return <AddonMissing feature="CV programming" />

  const mainNumber = Number(mainAddr)
  const mainOk = target === 'track' || (Number.isInteger(mainNumber) && mainNumber > 0 && mainNumber <= 10239)
  const canRead = target === 'track' && (status?.canRead ?? false)

  const note = (text: string, ok = true) => setLog((l) => [{ at: Date.now(), text, ok }, ...l].slice(0, 200))

  /** One CV operation, logged. Throws on failure so sequences stop. */
  const op = async (o: Omit<ProgramOp, 'mode' | 'address' | 'isLongAddress'>): Promise<ProgramResult> => {
    const full: ProgramOp =
      target === 'main'
        ? { ...o, address: mainNumber, isLongAddress: mainNumber > 127 }
        : { ...o, ...(mode ? { mode } : {}) }
    let r: ProgramResult
    try {
      r = await client.program(full)
    } catch (e) {
      note(`${o.op === 'read' ? 'Read' : 'Write'} CV${o.cv}: ${(e as Error).message}`, false)
      throw e
    }
    note(
      r.ok
        ? `${o.op === 'read' ? 'Read' : 'Wrote'} CV${o.cv} = ${r.value}`
        : `${o.op === 'read' ? 'Read' : 'Write'} CV${o.cv} failed: ${r.message}`,
      r.ok,
    )
    if (!r.ok) throw new Error(r.message)
    return r
  }

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    try {
      await fn()
    } catch {
      /* already logged */
    } finally {
      setBusy(null)
    }
  }

  const readDecoder = () =>
    run('Reading decoder', async () => {
      const v = async (cv: number) => (await op({ op: 'read', cv: String(cv) })).value
      const mfgId = await v(8)
      const version = await v(7)
      const cv29 = await v(29)
      const shortAddress = await v(1)
      const cv17 = await v(17)
      const cv18 = await v(18)
      let manufacturer: string | null = null
      let matches: DecoderMatch[] = []
      try {
        const index = await loadDecoderIndex(client.url('/xml/decoderIndex.xml'))
        manufacturer = index.manufacturer(mfgId)
        matches = index.identify(mfgId, version)
      } catch (e) {
        note(`Couldn't load JMRI's decoder index: ${(e as Error).message}`, false)
      }
      setInfo({ mfgId, version, manufacturer, matches, cv29, shortAddress, longAddress: longAddressFromCVs(cv17, cv18) })
    })

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <h1>Programming</h1>
        {busy && <span className="pill warn">{busy}…</span>}
      </div>
      <div className="segmented" role="group" aria-label="Programming view" style={{ alignSelf: 'flex-start' }}>
        <button aria-pressed={view === 'quick'} onClick={() => setView('quick')}>
          Quick setup
        </button>
        <button aria-pressed={view === 'decoder'} onClick={() => setView('decoder')}>
          Decoder settings
        </button>
      </div>

      <section className="card pad">
        <div className="row-wrap">
          <div className="segmented" role="group" aria-label="Where to program">
            <button aria-pressed={target === 'track'} onClick={() => setTarget('track')}>
              Programming track
            </button>
            <button
              aria-pressed={target === 'main'}
              disabled={status ? !status.opsAvailable : false}
              onClick={() => setTarget('main')}
            >
              On the main
            </button>
          </div>
          {target === 'track' && status?.modes && status.modes.length > 1 && (
            <select className="input" aria-label="Programming mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              {status.modes.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m] ?? m}
                </option>
              ))}
            </select>
          )}
          {target === 'main' && (
            <>
              <input
                className="input"
                inputMode="numeric"
                placeholder="Loco address"
                aria-label="Loco address"
                value={mainAddr}
                onChange={(e) => setMainAddr(e.target.value.replace(/\D/g, ''))}
                style={{ width: 130 }}
              />
              <select
                className="input"
                aria-label="Pick from roster"
                value=""
                onChange={(e) => e.target.value && setMainAddr(roster[e.target.value]?.address ?? '')}
              >
                <option value="">From roster…</option>
                {Object.values(roster)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.name} (#{r.address})
                    </option>
                  ))}
              </select>
            </>
          )}
        </div>
        <p className="muted small">
          {status == null
            ? 'Checking programmer…'
            : !status.available
              ? 'This JMRI connection has no programmer.'
              : target === 'track'
                ? `Put one locomotive on the programming track. Using ${status.connection ?? 'the default connection'}.`
                : 'Programming on the main changes the loco at that address while it runs. Most systems can only write, not read, on the main.'}
        </p>
      </section>

      {view === 'decoder' && <DecoderPanes op={op} run={run} busy={!!busy || !mainOk} canRead={canRead} />}

      {view === 'quick' && target === 'track' && (
        <section className="card pad">
          <div className="row-wrap">
            <h2>Decoder</h2>
            <div className="spacer" />
            <button className="btn primary" disabled={!!busy || !canRead} onClick={readDecoder}>
              Read decoder
            </button>
          </div>
          {info ? (
            <table className="table">
              <tbody>
                <tr>
                  <th>Manufacturer</th>
                  <td>
                    {info.manufacturer ?? 'Unknown'} <span className="muted mono">(CV8 = {info.mfgId})</span>
                  </td>
                </tr>
                <tr>
                  <th>Version</th>
                  <td className="mono">CV7 = {info.version}</td>
                </tr>
                <tr>
                  <th>Possible models</th>
                  <td>
                    {info.matches.length === 0
                      ? '—'
                      : info.matches.slice(0, 6).map((m) => (
                          <div key={m.family + m.model}>
                            {m.model} <span className="muted">· {m.family}</span>
                          </div>
                        ))}
                    {info.matches.length > 6 && <div className="muted">and {info.matches.length - 6} more</div>}
                  </td>
                </tr>
                <tr>
                  <th>Active address</th>
                  <td>
                    <strong>{info.cv29 & 32 ? (info.longAddress ?? 'invalid CV17') : info.shortAddress}</strong>{' '}
                    <span className="muted">
                      ({info.cv29 & 32 ? 'long, CV17/18' : 'short, CV1'}; {info.cv29 & 32 ? `short is ${info.shortAddress}` : info.longAddress != null ? `long is ${info.longAddress}` : 'no long address set'})
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="muted small">Reads CV1, 7, 8, 17, 18 and 29 and looks the decoder up in JMRI's decoder index.</p>
          )}
        </section>
      )}

      {view === 'quick' && target === 'track' && (
        <AddressCard
          disabled={!!busy || !canRead}
          onWrite={(address) =>
            run('Writing address', async () => {
              const cv29 = (await op({ op: 'read', cv: '29' })).value
              if (address <= 127) {
                await op({ op: 'write', cv: '1', value: address })
                await op({ op: 'write', cv: '29', value: cv29 & ~32 })
              } else {
                const { cv17, cv18 } = longAddressCVs(address)
                await op({ op: 'write', cv: '17', value: cv17 })
                await op({ op: 'write', cv: '18', value: cv18 })
                await op({ op: 'write', cv: '29', value: cv29 | 32 })
              }
              note(`Address set to ${address}`)
              setInfo(null)
            })
          }
        />
      )}

      {view === 'quick' && (
      <Cv29Card
        disabled={!!busy || !mainOk}
        canRead={canRead}
        read={() => op({ op: 'read', cv: '29' }).then((r) => r.value)}
        write={(v) => run('Writing CV29', () => op({ op: 'write', cv: '29', value: v }).then(() => {}))}
      />
      )}

      {view === 'quick' && (
      <CvCard
        disabled={!!busy || !mainOk}
        canRead={canRead}
        read={(cv) => op({ op: 'read', cv }).then((r) => r.value)}
        write={(cv, v) => run(`Writing CV${cv}`, () => op({ op: 'write', cv, value: v }).then(() => {}))}
      />
      )}

      <section className="card pad">
        <h2>Log</h2>
        {log.length === 0 ? (
          <p className="muted small">Nothing yet.</p>
        ) : (
          <ol className="log">
            {log.map((l) => (
              <li key={l.at + l.text} className={l.ok ? '' : 'bad'}>
                <span className="muted mono">{new Date(l.at).toLocaleTimeString()}</span> {l.text}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function AddressCard({ disabled, onWrite }: { disabled: boolean; onWrite: (a: number) => void }) {
  const [addr, setAddr] = useState('')
  const n = Number(addr)
  const valid = Number.isInteger(n) && n > 0 && n <= 10239
  return (
    <section className="card pad">
      <h2>Change address</h2>
      <form
        className="row-wrap"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) onWrite(n)
        }}
      >
        <input
          className="input"
          inputMode="numeric"
          aria-label="New address"
          placeholder="New address"
          value={addr}
          onChange={(e) => setAddr(e.target.value.replace(/\D/g, ''))}
          style={{ width: 140 }}
        />
        <button className="btn primary" disabled={disabled || !valid}>
          Write address
        </button>
        {valid && (
          <span className="muted small">
            {n <= 127
              ? `Short address: CV1 = ${n}, CV29 bit 5 off`
              : `Long address: CV17 = ${longAddressCVs(n).cv17}, CV18 = ${longAddressCVs(n).cv18}, CV29 bit 5 on`}
          </span>
        )}
      </form>
    </section>
  )
}

function Bits({ value, onChange, labels }: { value: number; onChange: (v: number) => void; labels?: string[] }) {
  return (
    <div className="bits">
      {Array.from({ length: 8 }, (_, i) => 7 - i).map((b) => (
        <label key={b} className="bit" title={labels?.[b] ?? `Bit ${b}`}>
          <input type="checkbox" checked={!!(value & (1 << b))} onChange={(e) => onChange(e.target.checked ? value | (1 << b) : value & ~(1 << b))} />
          <span>{b}</span>
        </label>
      ))}
    </div>
  )
}

function Cv29Card({
  disabled,
  canRead,
  read,
  write,
}: {
  disabled: boolean
  canRead: boolean
  read: () => Promise<number>
  write: (v: number) => void
}) {
  const [value, setValue] = useState<number | null>(null)
  const v = value ?? 6 // NMRA default: 28/128 steps + analog
  return (
    <section className="card pad">
      <div className="row-wrap">
        <h2>Configuration (CV29)</h2>
        <div className="spacer" />
        <span className="mono muted">= {v}</span>
        <button className="btn" disabled={disabled || !canRead} onClick={() => read().then(setValue, () => {})}>
          Read
        </button>
        <button className="btn primary" disabled={disabled || value == null} onClick={() => write(v)}>
          Write
        </button>
      </div>
      {value == null && <p className="muted small">Read CV29 first{canRead ? '' : ' (not possible on the main; read it on the programming track)'}.</p>}
      <div className="toggles">
        {CV29_BITS.map((b) => (
          <label key={b.bit} className="toggle-row">
            <input
              type="checkbox"
              disabled={value == null}
              checked={!!(v & (1 << b.bit))}
              onChange={(e) => setValue(e.target.checked ? v | (1 << b.bit) : v & ~(1 << b.bit))}
            />
            <span>
              <strong>{b.label}</strong> <span className="muted small">bit {b.bit} · {b.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  )
}

function CvCard({
  disabled,
  canRead,
  read,
  write,
}: {
  disabled: boolean
  canRead: boolean
  read: (cv: string) => Promise<number>
  write: (cv: string, v: number) => void
}) {
  const [cv, setCv] = useState('')
  const [value, setValue] = useState('')
  const cvOk = /^\d+(\.\d+)*$/.test(cv) && Number(cv.split('.').pop()) >= 1
  const n = Number(value)
  const valueOk = value !== '' && Number.isInteger(n) && n >= 0 && n <= 255
  return (
    <section className="card pad">
      <h2>Any CV</h2>
      <div className="row-wrap">
        <input className="input" inputMode="numeric" aria-label="CV number" placeholder="CV" value={cv} onChange={(e) => setCv(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: 100 }} />
        <input
          className="input"
          inputMode="numeric"
          aria-label="CV value"
          placeholder="Value 0–255"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
          style={{ width: 130 }}
        />
        <button className="btn" disabled={disabled || !cvOk || !canRead} onClick={() => read(cv).then((v) => setValue(String(v)), () => {})}>
          Read
        </button>
        <button className="btn primary" disabled={disabled || !cvOk || !valueOk} onClick={() => write(cv, n)}>
          Write
        </button>
      </div>
      {valueOk && <Bits value={n} onChange={(v) => setValue(String(v))} />}
      <p className="muted small">Indexed CVs use JMRI's dotted form, e.g. 16.2.257.</p>
    </section>
  )
}
