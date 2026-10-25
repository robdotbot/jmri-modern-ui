import { useState } from 'react'
import { IconRoster, IconSearch, IconThrottle, IconX } from '../icons.tsx'
import type { RosterEntry } from '../jmri/protocol.ts'
import { useClient, useJmri } from '../state.tsx'
import { useAcquire } from './Throttles.tsx'

export function RosterPage({ onDrive }: { onDrive: () => void }) {
  const roster = useJmri((s) => s.roster)
  const groups = useJmri((s) => s.rosterGroups)
  const throttles = useJmri((s) => s.throttles)
  const acquire = useAcquire()
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<string | null>(null)
  const [detail, setDetail] = useState<RosterEntry | null>(null)

  const held = new Set(Object.values(throttles).map((t) => t.rosterEntry))
  const entries = Object.values(roster)
    .filter((r) => !group || r.rosterGroups?.includes(group))
    .filter((r) =>
      `${r.name} ${r.road} ${r.number} ${r.address} ${r.mfg} ${r.model} ${r.owner}`.toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  // The first group returned is JMRI's localized "All Entries".
  const realGroups = groups.slice(1)

  const drive = (r: RosterEntry) => {
    if (!held.has(r.name)) acquire({ rosterEntry: r.name })
    onDrive()
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Roster</h1>
        <div className="search">
          <IconSearch />
          <input className="input" placeholder="Search name, road, number, address…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {realGroups.length > 0 && (
        <div className="segmented" role="group" aria-label="Roster group" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
          <button aria-pressed={group == null} onClick={() => setGroup(null)}>
            {groups[0]?.name ?? 'All'} ({groups[0]?.length ?? entries.length})
          </button>
          {realGroups.map((g) => (
            <button key={g.name} aria-pressed={group === g.name} onClick={() => setGroup(g.name)}>
              {g.name} ({g.length})
            </button>
          ))}
        </div>
      )}
      {entries.length === 0 ? (
        <div className="card empty">
          {Object.keys(roster).length === 0
            ? 'The JMRI roster is empty. Add locomotives in DecoderPro.'
            : 'Nothing matches your search.'}
        </div>
      ) : (
        <div className="roster-grid">
          {entries.map((r) => (
            <LocoCard key={r.name} r={r} held={held.has(r.name)} onDrive={() => drive(r)} onInfo={() => setDetail(r)} />
          ))}
        </div>
      )}
      {detail && <LocoDetail r={detail} onClose={() => setDetail(null)} onDrive={() => drive(detail)} />}
    </div>
  )
}

function LocoImage({ r, height }: { r: RosterEntry; height: number }) {
  const client = useClient()
  const [failed, setFailed] = useState(false)
  const src = r.image ?? r.icon
  return (
    <div className="art">
      {src && !failed ? (
        <img
          src={`${client.url(src)}?maxHeight=${height * 2}`}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <IconRoster />
      )}
    </div>
  )
}

function LocoCard({
  r,
  held,
  onDrive,
  onInfo,
}: {
  r: RosterEntry
  held: boolean
  onDrive: () => void
  onInfo: () => void
}) {
  const labelled = r.functionKeys.filter((f) => f.label).length
  return (
    <article className="card loco">
      <LocoImage r={r} height={120} />
      <div className="body">
        <div className="name">{r.name}</div>
        <div className="row">
          <span className="pill mono">#{r.address}{r.isLongAddress ? ' L' : ' S'}</span>
          {r.road && <span className="pill">{r.road}{r.number ? ` ${r.number}` : ''}</span>}
          {held && <span className="pill ok">On throttle</span>}
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {[r.mfg, r.model].filter(Boolean).join(' ') || '—'}
          {labelled ? ` · ${labelled} functions` : ''}
        </div>
        <div className="actions">
          <button className="btn" onClick={onInfo}>
            Details
          </button>
          <button className="btn primary" onClick={onDrive}>
            <IconThrottle /> {held ? 'Open' : 'Drive'}
          </button>
        </div>
      </div>
    </article>
  )
}

function LocoDetail({ r, onClose, onDrive }: { r: RosterEntry; onClose: () => void; onDrive: () => void }) {
  const rows: [string, string | undefined][] = [
    ['DCC address', `${r.address} (${r.isLongAddress ? 'long' : 'short'})`],
    ['Road', [r.road, r.number].filter(Boolean).join(' ')],
    ['Manufacturer', r.mfg],
    ['Model', r.model],
    ['Owner', r.owner],
    ['Decoder', [r.decoderFamily, r.decoderModel].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' — ')],
    ['Max speed', r.maxSpeedPct ? `${r.maxSpeedPct}%` : undefined],
    ['Groups', r.rosterGroups?.join(', ')],
    ['Comment', r.comment],
  ]
  const fns = r.functionKeys.filter((f) => f.label)
  return (
    <div className="overlay" onClick={onClose}>
      <div className="card dialog" role="dialog" aria-label={r.name} onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 100%)', padding: 0 }}>
        <div style={{ borderRadius: 'var(--radius) var(--radius) 0 0', overflow: 'hidden' }} className="loco">
          <LocoImage r={r} height={180} />
        </div>
        <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="page-head">
            <h2 style={{ marginRight: 'auto' }}>{r.name}</h2>
            <button className="btn icon ghost" onClick={onClose} aria-label="Close">
              <IconX />
            </button>
          </div>
          <table className="table">
            <tbody>
              {rows
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <tr key={k}>
                    <th style={{ width: 140 }}>{k}</th>
                    <td>{v}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {fns.length > 0 && (
            <div className="fn-grid">
              {fns.map((f) => (
                <div key={f.name} className={`fn${f.lockable ? '' : ' momentary'}`}>
                  <span className="k">{f.name}</span>
                  <span className="l">{f.label}</span>
                </div>
              ))}
            </div>
          )}
          <div className="row-end">
            <button className="btn primary" onClick={onDrive}>
              <IconThrottle /> Drive
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
