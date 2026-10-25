import { useEffect, useMemo, useState } from 'react'
import { IconSearch, IconX } from '../icons.tsx'
import { TRAIN_STATUS, type LocationData, type RollingStockData, type TrainData } from '../jmri/protocol.ts'
import { useClient, useJmri, useToast } from '../state.tsx'

type Tab = 'trains' | 'locations' | 'cars' | 'engines'

/** JMRI writes loads like "E<mpty>"; the brackets are markup, not text. */
const cleanLoad = (l?: string) => (l ?? '').replace(/[<>]/g, '')

function trainTone(code: number) {
  if (code === TRAIN_STATUS.BUILD_FAILED || code & 0x400) return 'danger'
  if (code === TRAIN_STATUS.EN_ROUTE) return 'warn'
  if (code === TRAIN_STATUS.BUILT || code === TRAIN_STATUS.PARTIAL_BUILT) return 'ok'
  return ''
}

export function OperationsPage() {
  const ops = useJmri((s) => s.ops)
  const [tab, setTab] = useState<Tab>('trains')
  const counts: Record<Tab, number> = {
    trains: Object.keys(ops.train).length,
    locations: Object.keys(ops.location).length,
    cars: Object.keys(ops.car).length,
    engines: Object.keys(ops.engine).length,
  }
  return (
    <div className="page">
      <div className="page-head">
        <h1>Operations</h1>
      </div>
      <div className="segmented" role="group" aria-label="Operations section" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {(['trains', 'locations', 'cars', 'engines'] as Tab[]).map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)} style={{ textTransform: 'capitalize' }}>
            {t} ({counts[t]})
          </button>
        ))}
      </div>
      {tab === 'trains' && <Trains />}
      {tab === 'locations' && <Locations />}
      {(tab === 'cars' || tab === 'engines') && <RollingStock type={tab === 'cars' ? 'car' : 'engine'} />}
    </div>
  )
}

// ---------- trains ----------

function Trains() {
  const trains = useJmri((s) => s.ops.train) as unknown as Record<string, TrainData>
  const [manifest, setManifest] = useState<TrainData | null>(null)
  const list = Object.values(trains).sort((a, b) => (a.departureTime || '').localeCompare(b.departureTime || '') || a.userName.localeCompare(b.userName))
  if (list.length === 0) return <div className="card empty">No trains defined in JMRI Operations.</div>
  return (
    <div className="logic-list">
      {list.map((t) => (
        <TrainCard key={t.name} t={t} onManifest={() => setManifest(t)} />
      ))}
      {manifest && <Manifest t={manifest} onClose={() => setManifest(null)} />}
    </div>
  )
}

function TrainCard({ t, onManifest }: { t: TrainData; onManifest: () => void }) {
  const client = useClient()
  const toast = useToast()
  const addon = useJmri((s) => s.addon)
  const [busy, setBusy] = useState<string | null>(null)
  const built = t.statusCode === TRAIN_STATUS.BUILT || t.statusCode === TRAIN_STATUS.PARTIAL_BUILT || t.statusCode === TRAIN_STATUS.EN_ROUTE
  const enRoute = t.statusCode === TRAIN_STATUS.EN_ROUTE
  const currentIdx = t.locations.findIndex((l) => l.name === t.locationId)

  const act = async (action: 'build' | 'reset' | 'move' | 'terminate') => {
    setBusy(action)
    try {
      if (addon) {
        const r = await client.trainAction(t.name, action)
        if (!r.ok) toast(action === 'reset' && enRoute ? `${t.userName}: terminate the train before resetting it.` : `${t.userName}: ${r.status}`)
      } else if (action === 'terminate') {
        await client.request({ type: 'train', method: 'post', data: { name: t.name, location: null } })
      } else if (action === 'move') {
        const next = t.locations[currentIdx + 1]
        if (next) await client.request({ type: 'train', method: 'post', data: { name: t.name, location: next.location.userName } })
      }
    } catch (e) {
      toast(`${t.userName}: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="card pad" aria-label={`Train ${t.userName}`}>
      <div className="logic-head">
        <span className="title">
          {t.userName} <span className="muted small">{t.description}</span>
        </span>
        {t.departureTime && <span className="pill mono">Departs {t.departureTime}</span>}
        <span className={`pill ${trainTone(t.statusCode)}`}>{t.status}</span>
      </div>
      <ol className="route" aria-label="Route">
        {t.locations.map((l, i) => (
          <li key={l.name} className={i === currentIdx && built ? 'here' : i < currentIdx && built ? 'past' : ''}>
            <span className="dot" />
            <span className="stop">{l.location.userName}</span>
            {l.expectedArrivalTime && l.expectedArrivalTime !== '-1' && <span className="muted small mono">{l.expectedArrivalTime}</span>}
          </li>
        ))}
      </ol>
      <div className="row-wrap">
        {!built && (
          <button className="btn primary" disabled={!!busy || !addon} title={addon ? undefined : 'Needs the JMRI add-on'} onClick={() => act('build')}>
            {busy === 'build' ? 'Building…' : 'Build'}
          </button>
        )}
        {built && (
          <>
            <button className="btn" onClick={onManifest}>
              Manifest
            </button>
            <button className="btn primary" disabled={!!busy || currentIdx >= t.locations.length - 1} onClick={() => act('move')}>
              {currentIdx >= 0 && t.locations[currentIdx + 1] ? `Move to ${t.locations[currentIdx + 1].location.userName}` : 'Move'}
            </button>
            <button className="btn" disabled={!!busy} onClick={() => act('terminate')}>
              Terminate
            </button>
          </>
        )}
        {(built || t.statusCode === TRAIN_STATUS.BUILD_FAILED) && !enRoute && (
          <button className="btn ghost" disabled={!!busy || !addon} onClick={() => act('reset')}>
            Reset
          </button>
        )}
        <span className="spacer" />
        <span className="muted small">
          {t.engines.length} engine{t.engines.length === 1 ? '' : 's'} · {t.cars.length} car{t.cars.length === 1 ? '' : 's'}
          {t.length ? ` · ${t.length} ft` : ''}
        </span>
      </div>
    </section>
  )
}

interface ManifestStop {
  name: string
  userName: string
  departureTime?: string
  comment?: string
  trainDirection?: string
  engines: { add: RollingStockData[]; remove: RollingStockData[] }
  cars: { add: RollingStockData[]; remove: RollingStockData[]; total: number; loads: number; empties: number }
}

function Manifest({ t, onClose }: { t: TrainData; onClose: () => void }) {
  const client = useClient()
  const [stops, setStops] = useState<ManifestStop[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    fetch(client.url(`/operations/manifest/${encodeURIComponent(t.name)}?format=json`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((m: { locations: ManifestStop[] }) => setStops(m.locations))
      .catch((e) => setError(e.message))
  }, [client, t.name])

  const rs = (c: RollingStockData, to: boolean) => (
    <li key={c.name}>
      <strong>
        {c.road} {c.number}
      </strong>{' '}
      <span className="muted">
        {c.carType}
        {c.load ? ` · ${cleanLoad(c.load)}` : ''}
        {to ? (c.destination?.track ? ` → ${c.destination.track.userName}` : '') : c.location?.track ? ` from ${c.location.track.userName}` : ''}
      </span>
    </li>
  )

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card dialog" role="dialog" aria-label={`Manifest ${t.userName}`} style={{ width: 'min(720px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="page-head">
          <h2 style={{ marginRight: 'auto' }}>Manifest · {t.userName}</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        {error && <div className="banner danger">Couldn't load the manifest ({error}). Is the train built?</div>}
        {!stops && !error && <div className="muted">Loading…</div>}
        {stops?.map((s) => (
          <div key={s.name} className="cond">
            <div className="logic-head">
              <span className="title">{s.userName}</span>
              {s.departureTime && <span className="pill mono">{s.departureTime}</span>}
              {s.trainDirection && <span className="muted small">heading {s.trainDirection}</span>}
            </div>
            {s.comment && <div className="muted small">{s.comment}</div>}
            {(s.engines.add.length > 0 || s.cars.add.length > 0) && (
              <>
                <div className="small">
                  <strong>Pick up</strong>
                </div>
                <ul>
                  {s.engines.add.map((c) => rs(c, true))}
                  {s.cars.add.map((c) => rs(c, true))}
                </ul>
              </>
            )}
            {(s.engines.remove.length > 0 || s.cars.remove.length > 0) && (
              <>
                <div className="small">
                  <strong>Set out</strong>
                </div>
                <ul>
                  {s.engines.remove.map((c) => rs(c, false))}
                  {s.cars.remove.map((c) => rs(c, false))}
                </ul>
              </>
            )}
            <div className="muted small">
              Departs with {s.cars.total} cars ({s.cars.loads} loads, {s.cars.empties} empties)
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- locations ----------

function Locations() {
  const locations = useJmri((s) => s.ops.location) as unknown as Record<string, LocationData>
  const cars = useJmri((s) => s.ops.car) as unknown as Record<string, RollingStockData>
  const [q, setQ] = useState('')
  const countAt = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of Object.values(cars)) {
      if (c.location?.name) m.set(c.location.name, (m.get(c.location.name) ?? 0) + 1)
      if (c.location?.track?.name) m.set(c.location.track.name, (m.get(c.location.track.name) ?? 0) + 1)
    }
    return m
  }, [cars])
  const list = Object.values(locations)
    .filter((l) => `${l.userName} ${l.comment}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.userName.localeCompare(b.userName))
  return (
    <>
      <div className="search" style={{ maxWidth: 360 }}>
        <IconSearch />
        <input className="input" placeholder="Search locations" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="roster-grid">
        {list.map((l) => (
          <section key={l.name} className="card pad">
            <div className="logic-head">
              <span className="title">{l.userName}</span>
              <span className="pill">{countAt.get(l.name) ?? 0} cars</span>
            </div>
            {l.comment && <div className="muted small">{l.comment}</div>}
            <table className="table">
              <tbody>
                {[...l.track]
                  .sort((a, b) => a.userName.localeCompare(b.userName))
                  .map((tr) => (
                    <tr key={tr.name}>
                      <td>{tr.userName}</td>
                      <td className="muted small">{tr.type}</td>
                      <td className="muted small mono">{tr.length} ft</td>
                      <td className="mono">{countAt.get(tr.name) ?? 0}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </>
  )
}

// ---------- cars & engines ----------

function RollingStock({ type }: { type: 'car' | 'engine' }) {
  const client = useClient()
  const stock = useJmri((s) => s.ops[type]) as unknown as Record<string, RollingStockData>
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<RollingStockData | null>(null)

  // Individual cars aren't subscribed (there can be thousands); refresh while this list is on screen.
  useEffect(() => {
    client.refreshOps(type)
    const id = setInterval(() => client.refreshOps(type), 10000)
    return () => clearInterval(id)
  }, [client, type])

  const list = Object.values(stock)
    .filter((c) =>
      `${c.road} ${c.number} ${c.carType} ${c.model ?? ''} ${c.location?.userName ?? ''} ${c.location?.track?.userName ?? ''} ${c.destination?.userName ?? ''} ${c.trainName ?? ''} ${cleanLoad(c.load)}`
        .toLowerCase()
        .includes(q.toLowerCase()),
    )
    .sort((a, b) => a.road.localeCompare(b.road) || a.number.localeCompare(b.number, undefined, { numeric: true }))
  const shown = list.slice(0, 300)

  return (
    <>
      <div className="row-wrap">
        <div className="search" style={{ maxWidth: 360 }}>
          <IconSearch />
          <input className="input" placeholder={`Search ${type}s: road, number, type, location…`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="muted small">
          {list.length} {type}s{list.length > shown.length ? `, showing first ${shown.length}` : ''}
        </span>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{type === 'car' ? 'Car' : 'Engine'}</th>
              <th>{type === 'car' ? 'Type / load' : 'Model'}</th>
              <th>Location</th>
              <th>Destination</th>
              <th>Train</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.name} style={c.outOfService ? { opacity: 0.55 } : undefined}>
                <td>
                  <strong>
                    {c.road} {c.number}
                  </strong>
                </td>
                <td className="small">
                  {type === 'car' ? (
                    <>
                      {c.carType}
                      {c.load ? <span className="muted"> · {cleanLoad(c.load)}</span> : null}
                    </>
                  ) : (
                    (c.model ?? c.carType)
                  )}
                </td>
                <td className="small">
                  {c.locationUnknown ? <span className="pill warn">Unknown</span> : c.location ? `${c.location.userName}${c.location.track ? ` · ${c.location.track.userName}` : ''}` : '—'}
                </td>
                <td className="small">{c.destination ? `${c.destination.userName}${c.destination.track ? ` · ${c.destination.track.userName}` : ''}` : '—'}</td>
                <td className="small">{c.trainName ?? '—'}</td>
                <td>
                  <button className="btn ghost" disabled={!!c.trainId} title={c.trainId ? 'Assigned to a train' : undefined} onClick={() => setEditing(c)}>
                    Move
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <div className="empty">No {type}s{q ? ' match your search' : ''}.</div>}
      </div>
      {editing && <SetLocation type={type} rs={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function SetLocation({ type, rs, onClose }: { type: 'car' | 'engine'; rs: RollingStockData; onClose: () => void }) {
  const client = useClient()
  const toast = useToast()
  const locations = useJmri((s) => s.ops.location) as unknown as Record<string, LocationData>
  const [loc, setLoc] = useState(rs.location?.name ?? '')
  const [track, setTrack] = useState(rs.location?.track?.name ?? '')
  const [busy, setBusy] = useState(false)
  const tracks = locations[loc]?.track ?? []
  return (
    <div className="overlay" onClick={onClose}>
      <form
        className="card dialog"
        role="dialog"
        aria-label={`Set location of ${rs.road} ${rs.number}`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            await client.setRollingStockLocation(type, rs, loc || null, track || undefined)
            onClose()
          } catch (err) {
            toast(`${rs.road} ${rs.number}: ${(err as Error).message}`)
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="page-head">
          <h2 style={{ marginRight: 'auto' }}>
            Move {rs.road} {rs.number}
          </h2>
          <button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <div className="field">
          <label htmlFor="loc">Location</label>
          <select
            id="loc"
            className="input"
            value={loc}
            onChange={(e) => {
              setLoc(e.target.value)
              setTrack('')
            }}
          >
            <option value="">(none)</option>
            {Object.values(locations)
              .sort((a, b) => a.userName.localeCompare(b.userName))
              .map((l) => (
                <option key={l.name} value={l.name}>
                  {l.userName}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="trk">Track</label>
          <select id="trk" className="input" value={track} onChange={(e) => setTrack(e.target.value)} disabled={!loc}>
            <option value="">(any)</option>
            {tracks.map((t) => (
              <option key={t.name} value={t.name}>
                {t.userName}
              </option>
            ))}
          </select>
        </div>
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
