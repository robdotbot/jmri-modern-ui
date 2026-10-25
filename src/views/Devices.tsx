import { useState, type ReactNode } from 'react'
import { IconBlock, IconLight, IconPlus, IconRoute, IconSearch, IconSensor, IconX, TurnoutGlyph } from '../icons.tsx'
import {
  ACTIVE,
  CLOSED,
  INACTIVE,
  INCONSISTENT,
  OFF,
  ON,
  THROWN,
  displayName,
  type BeanType,
} from '../jmri/protocol.ts'
import { KEYS, useClient, useJmri, useStored } from '../state.tsx'

type Tone = 'ok' | 'warn' | 'danger' | 'accent' | undefined

interface Look {
  label: string
  tone: Tone
}

/** JMRI creates these for its own bookkeeping (fast clock etc.); hidden unless "Show system objects" is on. */
export const isSystemBean = (name: string) => /^I[SM](CLOCK|CURRENTTIME|RATEFACTOR)/.test(name)

const TYPES: Record<
  Exclude<BeanType, 'memory'>,
  {
    icon: (state: number) => ReactNode
    look: (state: number) => Look
    /** Next state to post when the card is tapped, or null if read-only. */
    next: (state: number) => number | null
    hint: string
    creatable: boolean
    prefix: string
  }
> = {
  turnout: {
    icon: (state) => <TurnoutGlyph state={state} />,
    look: (s) =>
      s === CLOSED
        ? { label: 'Closed', tone: 'ok' }
        : s === THROWN
          ? { label: 'Thrown', tone: 'warn' }
          : s === INCONSISTENT
            ? { label: 'Moving / inconsistent', tone: 'danger' }
            : { label: 'Unknown', tone: undefined },
    next: (s) => (s === CLOSED ? THROWN : CLOSED),
    hint: 'Tap to throw or close',
    creatable: true,
    prefix: 'IT',
  },
  route: {
    icon: () => <IconRoute />,
    look: (s) => (s === ACTIVE ? { label: 'Set', tone: 'accent' } : { label: 'Not set', tone: undefined }),
    next: () => ACTIVE,
    hint: 'Tap to set the route',
    creatable: false,
    prefix: 'IO',
  },
  sensor: {
    icon: () => <IconSensor />,
    look: (s) =>
      s === ACTIVE
        ? { label: 'Active', tone: 'warn' }
        : s === INACTIVE
          ? { label: 'Inactive', tone: undefined }
          : { label: s === INCONSISTENT ? 'Inconsistent' : 'Unknown', tone: 'danger' },
    next: (s) => (s === ACTIVE ? INACTIVE : ACTIVE),
    hint: 'Tap to toggle (internal/simulated sensors)',
    creatable: true,
    prefix: 'IS',
  },
  light: {
    icon: () => <IconLight />,
    look: (s) =>
      s === ON ? { label: 'On', tone: 'warn' } : s === OFF ? { label: 'Off', tone: undefined } : { label: 'Unknown', tone: undefined },
    next: (s) => (s === ON ? OFF : ON),
    hint: 'Tap to switch',
    creatable: true,
    prefix: 'IL',
  },
  block: {
    icon: () => <IconBlock />,
    look: (s) =>
      s === 2 ? { label: 'Occupied', tone: 'danger' } : s === 4 ? { label: 'Clear', tone: 'ok' } : { label: 'Unknown', tone: undefined },
    next: () => null,
    hint: '',
    creatable: false,
    prefix: 'IB',
  },
}

export function DevicesPage({ type, title }: { type: Exclude<BeanType, 'memory'>; title: string }) {
  const client = useClient()
  const beans = useJmri((s) => s.beans[type])
  const [q, setQ] = useState('')
  const [showSystem, setShowSystem] = useStored(KEYS.showSystem, false)
  const [creating, setCreating] = useState(false)
  const cfg = TYPES[type]

  const all = Object.values(beans) as { name: string; userName: string | null; state: number; value?: unknown; comment?: string | null }[]
  const hidden = all.filter((b) => isSystemBean(b.name)).length
  const items = all
    .filter((b) => showSystem || !isSystemBean(b.name))
    .filter((b) => `${b.name} ${b.userName ?? ''} ${b.comment ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { numeric: true }))

  return (
    <div className="page">
      <div className="page-head">
        <h1>{title}</h1>
        <div className="search">
          <IconSearch />
          <input className="input" placeholder={`Search ${title.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {hidden > 0 && (
          <button className="btn ghost" onClick={() => setShowSystem(!showSystem)}>
            {showSystem ? 'Hide' : 'Show'} system ({hidden})
          </button>
        )}
        {cfg.creatable && (
          <button className="btn" onClick={() => setCreating(true)}>
            <IconPlus /> New
          </button>
        )}
      </div>
      {cfg.hint && items.length > 0 && <div className="muted" style={{ marginTop: -8 }}>{cfg.hint}</div>}
      {items.length === 0 ? (
        <div className="card empty">
          {all.length === 0 ? `No ${title.toLowerCase()} defined in JMRI yet.` : 'Nothing matches your search.'}
        </div>
      ) : (
        <div className="device-grid">
          {items.map((b) => {
            const look = cfg.look(b.state)
            const next = cfg.next(b.state)
            const value = type === 'block' && b.value != null ? describeValue(b.value) : null
            const inner = (
              <>
                <span className="glyph">{cfg.icon(b.state)}</span>
                <span className="meta">
                  <span className="title" style={{ display: 'block' }}>
                    {displayName(b)}
                  </span>
                  <span className="sub">
                    {look.label}
                    {value ? ` · ${value}` : ''}
                    {b.userName ? <span className="mono"> · {b.name}</span> : null}
                  </span>
                </span>
              </>
            )
            return next == null ? (
              <div key={b.name} className="device" data-tone={look.tone}>
                {inner}
              </div>
            ) : (
              <button
                key={b.name}
                className="device"
                data-tone={look.tone}
                aria-label={`${displayName(b)}: ${look.label}`}
                onClick={() => client.setBeanState(type, b.name, next)}
              >
                {inner}
              </button>
            )
          })}
        </div>
      )}
      {creating && (
        <CreateDialog
          title={`New ${type}`}
          prefix={cfg.prefix}
          onClose={() => setCreating(false)}
          onCreate={(name, user) => client.createBean(type, name, user)}
        />
      )}
    </div>
  )
}

export function describeValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v && 'data' in v) {
    const d = (v as { data: { name?: string; userName?: string } }).data
    return d.userName || d.name || ''
  }
  return JSON.stringify(v)
}

export function CreateDialog({
  title,
  prefix,
  onClose,
  onCreate,
}: {
  title: string
  prefix: string
  onClose: () => void
  onCreate: (systemName: string, userName: string) => void
}) {
  const [sys, setSys] = useState(prefix)
  const [user, setUser] = useState('')
  const valid = sys.length > prefix.length
  return (
    <div className="overlay" onClick={onClose}>
      <form
        className="card dialog"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onCreate(sys.trim(), user.trim())
          onClose()
        }}
      >
        <div className="page-head">
          <h2 style={{ marginRight: 'auto', textTransform: 'capitalize' }}>{title}</h2>
          <button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <div className="field">
          <label htmlFor="sys">System name</label>
          <input id="sys" className="input mono" value={sys} onChange={(e) => setSys(e.target.value.toUpperCase())} autoFocus />
          <span className="muted" style={{ fontSize: 12 }}>
            Prefix selects the connection, e.g. {prefix}12 for internal or D{prefix.slice(1)}12 for DCC++.
          </span>
        </div>
        <div className="field">
          <label htmlFor="user">User name (optional)</label>
          <input id="user" className="input" value={user} onChange={(e) => setUser(e.target.value)} />
        </div>
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid}>
            Create
          </button>
        </div>
      </form>
    </div>
  )
}
