import { useState } from 'react'
import { IconPlus, IconThrottle, IconX } from '../icons.tsx'
import { consistKey, type ConsistData, type ConsistEngine, type RosterEntry } from '../jmri/protocol.ts'
import { useClient, useJmri, useToast } from '../state.tsx'
import { useAcquire } from './Throttles.tsx'

const LEAD = 0
const TRAIL = 255

/** Roster entry for a consist member, if any, so we can show names instead of bare addresses. */
function useRosterByAddress() {
  const roster = useJmri((s) => s.roster)
  return (address: number): RosterEntry | undefined => Object.values(roster).find((r) => Number(r.address) === address)
}

export function ConsistsPage({ onDrive }: { onDrive: () => void }) {
  const consists = useJmri((s) => s.consists)
  const [creating, setCreating] = useState(false)
  const list = Object.values(consists).sort((a, b) => a.address - b.address)

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <h1>Consists</h1>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <IconPlus /> New consist
        </button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Locos in a consist answer to the consist address. JMRI programs each member's CV19 on the main (an advanced
        consist), so the locos must be on powered track.
      </p>
      {list.length === 0 ? (
        <div className="card empty">No consists yet.</div>
      ) : (
        <div className="logic-list">
          {list.map((c) => (
            <ConsistCard key={consistKey(c)} c={c} onDrive={onDrive} />
          ))}
        </div>
      )}
      {creating && <CreateConsist onClose={() => setCreating(false)} />}
    </div>
  )
}

function ConsistCard({ c, onDrive }: { c: ConsistData; onDrive: () => void }) {
  const client = useClient()
  const toast = useToast()
  const acquire = useAcquire()
  const byAddress = useRosterByAddress()
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast(`${label}: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const engines = [...c.engines].sort((a, b) => a.position - b.position)
  const remove = (address: number) =>
    act('Remove loco', () => client.setConsist(c, { engines: c.engines.filter((e) => e.address !== address) }))

  return (
    <section className="card pad" aria-label={`Consist ${c.name || c.address}`}>
      <div className="logic-head">
        <span className="title">
          {c.name || `Consist ${c.address}`} <span className="pill mono">#{c.address}</span>
        </span>
        {busy && <span className="pill warn" title="JMRI writes CV19 on each loco, which takes a moment">Updating…</span>}
        <button
          className="btn primary"
          disabled={engines.length === 0}
          onClick={() => {
            acquire({ address: c.address, isLongAddress: c.isLongAddress })
            onDrive()
          }}
        >
          <IconThrottle /> Drive
        </button>
        <button
          className="btn ghost"
          disabled={busy}
          onClick={() => confirm(`Delete consist ${c.name || c.address}? Members return to their own addresses.`) && act('Delete consist', () => client.deleteConsist(c))}
        >
          Delete
        </button>
      </div>
      <div className="consist-train">
        {engines.map((e, i) => {
          const r = byAddress(e.address)
          return (
            <div key={e.address} className="consist-loco">
              <div className="consist-loco-head">
                <strong>{r?.name ?? `#${e.address}`}</strong>
                <span className="muted small">
                  {i === 0 ? 'Lead' : i === engines.length - 1 ? 'Trail' : 'Mid'} · #{e.address}
                </span>
              </div>
              <div className="segmented" role="group" aria-label={`Direction of ${r?.name ?? e.address}`}>
                <button aria-pressed={e.forward} disabled={busy} onClick={() => !e.forward && act('Direction', () => client.setConsistDirection(c, e.address, true))}>
                  Forward
                </button>
                <button aria-pressed={!e.forward} disabled={busy} onClick={() => e.forward && act('Direction', () => client.setConsistDirection(c, e.address, false))}>
                  Reversed
                </button>
              </div>
              <button className="btn icon ghost" disabled={busy} aria-label={`Remove ${r?.name ?? e.address}`} onClick={() => remove(e.address)}>
                <IconX />
              </button>
            </div>
          )
        })}
        <button className="btn" disabled={busy} onClick={() => setAdding(true)}>
          <IconPlus /> Add loco
        </button>
      </div>
      {adding && (
        <PickLoco
          exclude={c.engines.map((e) => e.address)}
          onClose={() => setAdding(false)}
          onPick={(address, isLongAddress, forward) =>
            act('Add loco', () =>
              client.setConsist(c, {
                engines: [
                  ...c.engines.map((e, i) => ({ ...e, position: i === 0 ? LEAD : e.position === TRAIL ? i : e.position })),
                  { address, isLongAddress, forward, position: TRAIL },
                ],
              }),
            )
          }
        />
      )}
    </section>
  )
}

function PickLoco({
  exclude,
  onClose,
  onPick,
}: {
  exclude: number[]
  onClose: () => void
  onPick: (address: number, isLong: boolean, forward: boolean) => void
}) {
  const roster = useJmri((s) => s.roster)
  const [addr, setAddr] = useState('')
  const [forward, setForward] = useState(true)
  const n = Number(addr)
  const valid = Number.isInteger(n) && n > 0 && n <= 10239 && !exclude.includes(n)
  const entries = Object.values(roster)
    .filter((r) => !exclude.includes(Number(r.address)))
    .sort((a, b) => a.name.localeCompare(b.name))
  const pick = (address: number, isLong: boolean) => {
    onPick(address, isLong, forward)
    onClose()
  }
  return (
    <div
      className="overlay"
      onClick={(e) => {
        e.stopPropagation() // may sit on top of the New consist dialog
        onClose()
      }}
    >
      <div className="card dialog" role="dialog" aria-label="Add loco to consist" onClick={(e) => e.stopPropagation()}>
        <div className="page-head">
          <h2 style={{ marginRight: 'auto' }}>Add loco</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <div className="segmented" role="group" aria-label="Facing" style={{ alignSelf: 'flex-start' }}>
          <button aria-pressed={forward} onClick={() => setForward(true)}>
            Facing forward
          </button>
          <button aria-pressed={!forward} onClick={() => setForward(false)}>
            Facing backward
          </button>
        </div>
        <div className="pick-list">
          {entries.map((r) => (
            <button key={r.name} onClick={() => pick(Number(r.address), r.isLongAddress)}>
              <span>
                <strong>{r.name}</strong>
              </span>
              <span className="pill mono">{r.address}</span>
            </button>
          ))}
        </div>
        <form
          className="row-wrap"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) pick(n, n > 127)
          }}
        >
          <input className="input" inputMode="numeric" aria-label="Loco address" placeholder="Or an address" value={addr} onChange={(e) => setAddr(e.target.value.replace(/\D/g, ''))} />
          <button className="btn primary" disabled={!valid}>
            Add
          </button>
        </form>
      </div>
    </div>
  )
}

function CreateConsist({ onClose }: { onClose: () => void }) {
  const client = useClient()
  const toast = useToast()
  const consists = useJmri((s) => s.consists)
  const [addr, setAddr] = useState('')
  const [name, setName] = useState('')
  const [members, setMembers] = useState<ConsistEngine[]>([])
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const byAddress = useRosterByAddress()
  const n = Number(addr)
  const taken = !!consists[consistKey({ address: n, isLongAddress: false })]
  const valid = Number.isInteger(n) && n >= 1 && n <= 127 && !taken

  return (
    <div className="overlay" onClick={onClose}>
      <form
        className="card dialog"
        role="dialog"
        aria-label="New consist"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault()
          if (!valid) return
          setBusy(true)
          try {
            await client.createConsist(n, false, name.trim(), members.map((m, i) => ({ ...m, position: i === 0 ? LEAD : i === members.length - 1 ? TRAIL : i })))
            onClose()
          } catch (err) {
            toast(`Create consist: ${(err as Error).message}`)
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="page-head">
          <h2 style={{ marginRight: 'auto' }}>New consist</h2>
          <button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <div className="field">
          <label htmlFor="caddr">Consist address (1–127)</label>
          <input id="caddr" className="input" inputMode="numeric" value={addr} onChange={(e) => setAddr(e.target.value.replace(/\D/g, ''))} autoFocus />
          {taken && <span className="small" style={{ color: 'var(--danger)' }}>A consist already uses this address.</span>}
        </div>
        <div className="field">
          <label htmlFor="cname">Name (optional)</label>
          <input id="cname" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Daylight double-header" />
        </div>
        <div className="field">
          <label>Locos</label>
          {members.map((m) => (
            <div key={m.address} className="row-wrap">
              <span style={{ flex: 1 }}>
                {byAddress(m.address)?.name ?? `#${m.address}`} <span className="muted small">{m.forward ? 'forward' : 'reversed'}</span>
              </span>
              <button type="button" className="btn icon ghost" aria-label="Remove" onClick={() => setMembers(members.filter((x) => x.address !== m.address))}>
                <IconX />
              </button>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setPicking(true)} style={{ alignSelf: 'flex-start' }}>
            <IconPlus /> Add loco
          </button>
        </div>
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid || busy}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
      {picking && (
        <PickLoco
          exclude={members.map((m) => m.address)}
          onClose={() => setPicking(false)}
          onPick={(address, isLongAddress, forward) => setMembers([...members, { address, isLongAddress, forward, position: TRAIL }])}
        />
      )}
    </div>
  )
}
