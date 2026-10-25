import { useEffect, useMemo, useState } from 'react'
import { TRAIN_STATUS, type LocationData, type ManifestStop, type RollingStockData, type TrainData } from '../jmri/protocol.ts'
import { KEYS, useClient, useJmri, useStored } from '../state.tsx'

// Switch lists, worked out the way JMRI's TrainSwitchLists does: for one location, every train whose route
// stops there, in time order, with the cars it picks up and sets out. Built trains' work comes from their
// manifests (/operations/manifest), so it matches JMRI's own paperwork; trains not yet built are listed as
// expected.

/** JMRI writes loads like "E<mpty>"; the brackets are markup, not text. */
const cleanLoad = (l?: string) => (l ?? '').replace(/[<>]/g, '')

const isBuilt = (t: TrainData) => t.statusCode === TRAIN_STATUS.BUILT || t.statusCode === TRAIN_STATUS.PARTIAL_BUILT || t.statusCode === TRAIN_STATUS.EN_ROUTE

interface Visit {
  train: TrainData
  /** Route stop id, e.g. "4r3". */
  stop: string
  arrival: string
  direction: string
  /** Where the train is relative to this stop. */
  progress: 'notBuilt' | 'due' | 'here' | 'departed'
  work: ManifestStop | null
}

/** Manifests of the given built trains, refetched whenever one's status changes (built, moved, terminated). */
function useManifests(trains: TrainData[]) {
  const client = useClient()
  const [manifests, setManifests] = useState<Record<string, ManifestStop[]>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const key = trains.map((t) => `${t.name}:${t.statusCode}:${t.locationId}:${t.status}`).join('|')
  useEffect(() => {
    let live = true
    for (const id of key ? key.split('|').map((k) => k.slice(0, k.indexOf(':'))) : []) {
      fetch(client.url(`/operations/manifest/${encodeURIComponent(id)}?format=json`))
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((m: { locations: ManifestStop[] }) => live && setManifests((all) => ({ ...all, [id]: m.locations })))
        .catch((e) => live && setErrors((all) => ({ ...all, [id]: e.message })))
    }
    return () => {
      live = false
    }
  }, [client, key])
  return { manifests, errors }
}

export function SwitchLists() {
  const locations = useJmri((s) => s.ops.location) as unknown as Record<string, LocationData>
  const trains = useJmri((s) => s.ops.train) as unknown as Record<string, TrainData>
  const cars = useJmri((s) => s.ops.car) as unknown as Record<string, RollingStockData>
  const client = useClient()
  const [current, setCurrent] = useStored<string>(KEYS.switchList, '')
  const [onlyWork, setOnlyWork] = useState(true)

  // Cars on hand come from the car list, which isn't subscribed per car.
  useEffect(() => {
    client.refreshOps('car')
    const id = setInterval(() => client.refreshOps('car'), 10000)
    return () => clearInterval(id)
  }, [client])

  const built = useMemo(() => Object.values(trains).filter(isBuilt), [trains])
  const { manifests, errors } = useManifests(built)

  const visitsByLocation = useMemo(() => {
    const out = new Map<string, Visit[]>()
    for (const t of Object.values(trains)) {
      const here = t.locations.findIndex((l) => l.name === t.locationId)
      t.locations.forEach((stop, i) => {
        const work = manifests[t.name]?.find((m) => m.name === stop.name) ?? null
        const progress: Visit['progress'] = !isBuilt(t) ? 'notBuilt' : here < 0 || i > here ? 'due' : i === here ? 'here' : 'departed'
        const list = out.get(stop.location.name) ?? []
        list.push({
          train: t,
          stop: stop.name,
          arrival: stop.expectedArrivalTime && stop.expectedArrivalTime !== '-1' ? stop.expectedArrivalTime : '',
          direction: stop.trainDirection ?? '',
          progress,
          work,
        })
        out.set(stop.location.name, list)
      })
    }
    for (const list of out.values()) list.sort((a, b) => a.arrival.localeCompare(b.arrival) || a.train.userName.localeCompare(b.train.userName))
    return out
  }, [trains, manifests])

  const workCount = (id: string) =>
    (visitsByLocation.get(id) ?? []).reduce((n, v) => n + (v.work && v.progress !== 'departed' ? v.work.cars.add.length + v.work.cars.remove.length : 0), 0)

  const list = Object.values(locations).sort((a, b) => a.userName.localeCompare(b.userName))
  const shown = list.filter((l) => !onlyWork || workCount(l.name) > 0 || l.name === current)
  const selected = locations[current] ?? shown[0] ?? list[0]

  if (list.length === 0) return <div className="card empty">No locations defined in JMRI Operations.</div>

  return (
    <>
      <div className="row-wrap no-print">
        <select className="input" aria-label="Location" value={selected?.name ?? ''} onChange={(e) => setCurrent(e.target.value)} style={{ maxWidth: 320 }}>
          {shown.map((l) => {
            const n = workCount(l.name)
            return (
              <option key={l.name} value={l.name}>
                {l.userName}
                {n ? ` (${n} car moves)` : ''}
              </option>
            )
          })}
        </select>
        <label className="toggle-row" style={{ gap: 6 }}>
          <input type="checkbox" checked={onlyWork} onChange={(e) => setOnlyWork(e.target.checked)} />
          <span className="small">Only locations with work</span>
        </label>
        <span className="spacer" />
        <button className="btn" onClick={() => window.print()}>
          Print
        </button>
      </div>
      {selected && <SwitchList location={selected} visits={visitsByLocation.get(selected.name) ?? []} cars={cars} errors={errors} />}
    </>
  )
}

const PROGRESS: Record<Visit['progress'], [string, string]> = {
  notBuilt: ['Not built', ''],
  due: ['Expected', 'warn'],
  here: ['Here now', 'ok'],
  departed: ['Departed', ''],
}

function SwitchList({
  location,
  visits,
  cars,
  errors,
}: {
  location: LocationData
  visits: Visit[]
  cars: Record<string, RollingStockData>
  errors: Record<string, string>
}) {
  const [printedAt] = useState(() => new Date().toLocaleString())
  const working = visits.filter((v) => v.progress !== 'notBuilt')
  const scheduled = visits.filter((v) => v.progress === 'notBuilt' && v.train.statusCode !== TRAIN_STATUS.TERMINATED)
  const trackName = (id?: string) => location.track.find((t) => t.name === id)?.userName ?? id ?? ''
  const byTrack = new Map<string, RollingStockData[]>()
  for (const c of Object.values(cars)) {
    if (c.location?.name !== location.name) continue
    const k = c.location.track?.name ?? ''
    byTrack.set(k, [...(byTrack.get(k) ?? []), c])
  }
  const onHand = [...byTrack.entries()].sort(([a], [b]) => trackName(a).localeCompare(trackName(b)))

  return (
    <article className="card pad switch-list" aria-label={`Switch list for ${location.userName}`}>
      <div className="logic-head">
        <h2 className="title" style={{ margin: 0 }}>
          Switch list · {location.userName}
        </h2>
        <span className="muted small">{printedAt}</span>
      </div>
      {location.comment && <p className="muted small">{location.comment}</p>}

      {visits.length === 0 && <p className="muted">No train's route stops here.</p>}
      {visits.length > 0 && working.length === 0 && <p className="muted">No built train stops here.</p>}
      {working.map((v) => {
        const [label, tone] = PROGRESS[v.progress]
        const w = v.work
        const pickups = w ? [...w.engines.add, ...w.cars.add] : []
        const setouts = w ? [...w.engines.remove, ...w.cars.remove] : []
        return (
          <section key={v.train.name + v.stop} className={`cond${v.progress === 'departed' ? ' done' : ''}`} aria-label={`Train ${v.train.userName} at ${location.userName}`}>
            <div className="logic-head">
              <span className="title">
                {v.train.userName} <span className="muted small">{v.train.description}</span>
              </span>
              {v.arrival && <span className="pill mono">{v.arrival}</span>}
              {v.direction && <span className="muted small">heading {v.direction}</span>}
              <span className={`pill ${tone}`}>{label}</span>
            </div>
            {!w ? (
              <p className="muted small">{errors[v.train.name] ? `Couldn't load the manifest (${errors[v.train.name]}).` : 'Loading…'}</p>
            ) : pickups.length === 0 && setouts.length === 0 ? (
              <p className="muted small">No work here.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th />
                    <th>Car</th>
                    <th>Type / load</th>
                    <th>Track</th>
                    <th>To</th>
                  </tr>
                </thead>
                <tbody>
                  {pickups.map((c) => (
                    <tr key={'p' + c.name}>
                      <td>
                        <span className="pill">Pick up</span>
                      </td>
                      <td>
                        <strong>
                          {c.road} {c.number}
                        </strong>
                      </td>
                      <td className="small">
                        {c.carType}
                        {c.load ? <span className="muted"> · {cleanLoad(c.load)}</span> : null}
                      </td>
                      <td className="small">{c.location?.track?.userName ?? '—'}</td>
                      <td className="small">
                        {c.destination ? `${c.destination.userName}${c.destination.track ? ` · ${c.destination.track.userName}` : ''}` : '—'}
                      </td>
                    </tr>
                  ))}
                  {setouts.map((c) => (
                    <tr key={'s' + c.name}>
                      <td>
                        <span className="pill ok">Set out</span>
                      </td>
                      <td>
                        <strong>
                          {c.road} {c.number}
                        </strong>
                      </td>
                      <td className="small">
                        {c.carType}
                        {c.load ? <span className="muted"> · {cleanLoad(c.load)}</span> : null}
                      </td>
                      <td className="small">{c.destination?.track?.userName ?? '—'}</td>
                      <td className="small muted">here</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )
      })}

      {scheduled.length > 0 && (
        <section className="cond" aria-label="Also scheduled">
          <div className="logic-head">
            <span className="title">Also scheduled</span>
            <span className="muted small">not built yet; their work is known once built</span>
          </div>
          <table className="table">
            <tbody>
              {scheduled.map((v) => (
                <tr key={v.train.name + v.stop}>
                  <td className="mono" style={{ width: 70 }}>
                    {v.arrival || '—'}
                  </td>
                  <td>
                    <strong>{v.train.userName}</strong> <span className="muted small">{v.train.description}</span>
                  </td>
                  <td className="small muted">{v.direction && `heading ${v.direction}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="cond" aria-label="Cars on hand">
        <div className="logic-head">
          <span className="title">Cars on hand</span>
          <span className="muted small">{onHand.reduce((n, [, cs]) => n + cs.length, 0)} cars</span>
        </div>
        {onHand.length === 0 ? (
          <p className="muted small">None.</p>
        ) : (
          <table className="table">
            <tbody>
              {onHand.map(([track, cs]) => (
                <tr key={track}>
                  <th style={{ whiteSpace: 'nowrap' }}>{trackName(track) || '(no track)'}</th>
                  <td className="small">
                    {cs
                      .sort((a, b) => a.road.localeCompare(b.road) || a.number.localeCompare(b.number, undefined, { numeric: true }))
                      .map((c, i) => (
                        <span key={c.name}>
                          {i > 0 && ', '}
                          {c.road} {c.number}
                          {c.trainName ? <span className="muted"> ({c.trainName})</span> : null}
                        </span>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </article>
  )
}
