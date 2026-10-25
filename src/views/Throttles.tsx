import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { IconLeft, IconPlus, IconRight, IconRoster, IconSearch, IconX } from '../icons.tsx'
import type { ThrottleRequest } from '../jmri/client.ts'
import { OFF, type FunctionKey, type RosterEntry, type ThrottleStatus } from '../jmri/protocol.ts'
import { KEYS, save, useClient, useJmri, useStored } from '../state.tsx'

type SpeedUnit = 'pct' | 'steps'

export function ThrottlesPage({ onBrowseRoster }: { onBrowseRoster: () => void }) {
  const throttles = useJmri((s) => s.throttles)
  const [adding, setAdding] = useState(false)
  const list = Object.values(throttles)

  return (
    <div className="page">
      <div className="page-head">
        <h1>Throttles</h1>
        <button className="btn" onClick={onBrowseRoster}>
          <IconRoster /> Roster
        </button>
        <button className="btn primary" onClick={() => setAdding(true)}>
          <IconPlus /> Add throttle
        </button>
      </div>
      {list.length === 0 ? (
        <div className="card empty">
          <p style={{ fontSize: 17, fontWeight: 600, color: 'var(--text)' }}>No locomotives on throttles</p>
          <p>Pick a loco from the roster or enter a DCC address.</p>
          <button className="btn primary" onClick={() => setAdding(true)}>
            <IconPlus /> Add throttle
          </button>
        </div>
      ) : (
        <div className="throttles">
          {list.map((t) => (
            <ThrottleCard key={t.name} t={t} />
          ))}
        </div>
      )}
      {adding && <AcquireDialog onClose={() => setAdding(false)} />}
    </div>
  )
}

/** Acquire a throttle and remember it so a reload re-acquires it. */
export function useAcquire() {
  const client = useClient()
  return (req: Omit<ThrottleRequest, 'name'>) => {
    const name = `t-${req.rosterEntry ?? req.address}-${Date.now().toString(36)}`
    client.acquireThrottle({ name, ...req })
    save(KEYS.throttles, client.heldThrottles())
  }
}

function AcquireDialog({ onClose }: { onClose: () => void }) {
  const roster = useJmri((s) => s.roster)
  const held = useJmri((s) => s.throttles)
  const acquire = useAcquire()
  const [q, setQ] = useState('')
  const [addr, setAddr] = useState('')
  const [long, setLong] = useState<boolean | null>(null)

  const heldRoster = new Set(Object.values(held).map((t) => t.rosterEntry))
  const matches = Object.values(roster)
    .filter((r) => !heldRoster.has(r.name))
    .filter((r) => `${r.name} ${r.road} ${r.number} ${r.address} ${r.model}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))

  const n = Number(addr)
  const validAddr = addr !== '' && Number.isInteger(n) && n > 0 && n <= 10239
  const isLong = long ?? n > 127

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card dialog" role="dialog" aria-label="Add throttle" onClick={(e) => e.stopPropagation()}>
        <div className="page-head">
          <h2 style={{ marginRight: 'auto' }}>Add throttle</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <div className="search" style={{ maxWidth: 'none' }}>
          <IconSearch />
          <input
            className="input"
            autoFocus
            placeholder="Search roster"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="pick-list">
          {matches.map((r) => (
            <button
              key={r.name}
              onClick={() => {
                acquire({ rosterEntry: r.name })
                onClose()
              }}
            >
              <span>
                <strong>{r.name}</strong>
                <br />
                <span className="muted" style={{ fontSize: 13 }}>
                  {[r.road, r.number, r.model].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="pill mono">{r.address}</span>
            </button>
          ))}
          {matches.length === 0 && <div className="muted" style={{ padding: 12 }}>No matching roster entries.</div>}
        </div>
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault()
            if (!validAddr) return
            acquire({ address: n, isLongAddress: isLong })
            onClose()
          }}
        >
          <label htmlFor="addr">Or a DCC address</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="addr"
              className="input"
              inputMode="numeric"
              placeholder="e.g. 3 or 4449"
              value={addr}
              onChange={(e) => setAddr(e.target.value.replace(/\D/g, ''))}
              style={{ flex: 1 }}
            />
            <div className="segmented" role="group" aria-label="Address type">
              <button type="button" aria-pressed={!isLong} disabled={n > 127} onClick={() => setLong(false)}>
                Short
              </button>
              <button type="button" aria-pressed={isLong} onClick={() => setLong(true)}>
                Long
              </button>
            </div>
            <button className="btn primary" disabled={!validAddr}>
              Acquire
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Coalesces rapid slider movement into at most one speed command per interval (always sends the final value). */
function useRateLimited(fn: (v: number) => void, ms = 80) {
  const last = useRef(0)
  const pending = useRef<number | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })
  useEffect(() => () => clearTimeout(timer.current), [])
  return (v: number) => {
    const now = Date.now()
    pending.current = v
    const flush = () => {
      if (pending.current == null) return
      last.current = Date.now()
      fnRef.current(pending.current)
      pending.current = null
    }
    if (now - last.current >= ms) flush()
    else {
      clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, ms - (now - last.current))
    }
  }
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

function ThrottleCard({ t }: { t: ThrottleStatus & { acquired: boolean; unresponsive?: boolean; requestedAt?: number } }) {
  const client = useClient()
  const roster = useJmri((s) => s.roster)
  const entry: RosterEntry | undefined = t.rosterEntry ? roster[t.rosterEntry] : undefined
  const [unit, setUnit] = useStored<SpeedUnit>(KEYS.speedUnit, 'pct')
  const now = useNow(!t.acquired)
  const steps = t.speedSteps || 126
  const speed = Math.max(0, t.speed ?? 0) // -1 means e-stopped
  const estopped = (t.speed ?? 0) < 0
  const forward = t.forward ?? true

  const sendSpeed = useRateLimited((v) => client.throttle(t.name, { speed: v }))
  const setSpeed = (v: number) => {
    const snapped = Math.round(Math.min(1, Math.max(0, v)) * steps) / steps
    sendSpeed(snapped)
  }

  // The set of function keys only changes on acquire; key the memo on it rather than on every speed push.
  const fnNames = Object.keys(t)
    .filter((k) => /^F\d+$/.test(k))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .join(',')
  const fnKeys: FunctionKey[] = useMemo(() => {
    const labelled = entry?.functionKeys ?? []
    const names = fnNames ? fnNames.split(',') : Array.from({ length: 29 }, (_, i) => `F${i}`)
    return names.map(
      (n) =>
        labelled.find((f) => f.name === n) ?? { name: n, label: null, lockable: true, icon: null, selectedIcon: null },
    )
  }, [fnNames, entry])

  // Show labelled functions first; unlabelled ones are behind "More".
  const [showAll, setShowAll] = useState(false)
  const labelled = fnKeys.filter((f) => f.label)
  const visible = showAll || labelled.length === 0 ? fnKeys : labelled

  const title = entry?.name ?? `Address ${t.address ?? '…'}`
  const subtitle = entry
    ? [entry.road, entry.number, entry.model].filter(Boolean).join(' · ') + ` · #${entry.address}`
    : t.address
      ? `DCC ${t.address}`
      : ''

  const display =
    unit === 'pct' ? Math.round(speed * 100) : Math.round(speed * steps)

  return (
    <section className="card throttle" aria-label={`Throttle ${title}`}>
      <div className="throttle-head">
        {entry?.icon ? (
          <img
            src={client.url(entry.icon) + '?maxHeight=40'}
            alt=""
            style={{ height: 40, maxWidth: 90, objectFit: 'contain' }}
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
        ) : null}
        <div className="who">
          <div className="name">{title}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            {subtitle}
          </div>
        </div>
        {!t.acquired ? (
          <span className="pill warn">Acquiring…</span>
        ) : t.clients && t.clients > 1 ? (
          <span className="pill" title="Other throttles also control this loco">
            Shared ×{t.clients}
          </span>
        ) : null}
        <button
          className="btn icon ghost"
          aria-label={`Release ${title}`}
          title="Release"
          onClick={() => {
            client.releaseThrottle(t.name)
            save(KEYS.throttles, client.heldThrottles())
          }}
        >
          <IconX />
        </button>
      </div>

      {!t.acquired && t.requestedAt && now - t.requestedAt > 6000 && (
        <div className="banner" role="status">
          JMRI hasn't handed over this loco yet. If it stays like this, JMRI may be stuck on it: turn track power off
          if the loco is moving, and restart JMRI.
        </div>
      )}

      {t.unresponsive && (
        <div className="banner danger" role="alert" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <span>
            JMRI stopped confirming this throttle's commands, so it may not be controlling the loco, and its Stop may not
            work either. This can happen when another device sharing this loco drops off the network.
          </span>
          <div className="row-wrap">
            <button className="btn danger" onClick={() => client.setPower(OFF)}>
              Turn track power off
            </button>
            <button
              className="btn"
              onClick={() => {
                client.reacquireThrottle(t.name)
                save(KEYS.throttles, client.heldThrottles())
              }}
            >
              Get a fresh throttle
            </button>
          </div>
        </div>
      )}

      <div className="speed-wrap">
        <div className="dial">
          <div className="value" style={estopped ? { color: 'var(--danger)' } : undefined}>
            {estopped ? 'E' : display}
          </div>
          <div className="segmented" role="group" aria-label="Speed unit">
            <button aria-pressed={unit === 'pct'} onClick={() => setUnit('pct')}>
              %
            </button>
            <button aria-pressed={unit === 'steps'} onClick={() => setUnit('steps')}>
              Step/{steps}
            </button>
          </div>
          <div className="dir" role="group" aria-label="Direction">
            <button aria-pressed={!forward} onClick={() => client.throttle(t.name, { forward: false })}>
              <IconLeft /> Rev
            </button>
            <button aria-pressed={forward} onClick={() => client.throttle(t.name, { forward: true })}>
              Fwd <IconRight />
            </button>
          </div>
        </div>
        <SpeedSlider value={speed} steps={steps} onChange={setSpeed} disabled={!t.acquired} label={title} />
      </div>

      <div className="speed-steps">
        {[0.25, 0.5, 0.75, 1].map((v) => (
          <button key={v} className="btn" disabled={!t.acquired} onClick={() => setSpeed(v)}>
            {v * 100}%
          </button>
        ))}
      </div>

      <div className="throttle-foot">
        <button className="btn" disabled={!t.acquired} onClick={() => client.throttle(t.name, { speed: 0 })}>
          Stop
        </button>
        <button className="btn danger" onClick={() => client.throttle(t.name, { eStop: null })}>
          E-Stop
        </button>
      </div>

      <div className="fn-grid">
        {visible.map((f) => (
          <FnButton
            key={f.name}
            fn={f}
            on={!!t[f.name as `F${number}`]}
            disabled={!t.acquired}
            set={(v) => client.throttle(t.name, { [f.name]: v })}
          />
        ))}
      </div>
      {labelled.length > 0 && labelled.length < fnKeys.length && (
        <button className="btn ghost" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show labelled functions only' : `All functions (${fnKeys.length})`}
        </button>
      )}
    </section>
  )
}

function FnButton({
  fn,
  on,
  set,
  disabled,
}: {
  fn: FunctionKey
  on: boolean
  set: (v: boolean) => void
  disabled: boolean
}) {
  // Non-lockable (momentary) functions like horns are on only while held.
  const momentary = !fn.lockable
  const held = useRef(false)
  const down = (e: PointerEvent) => {
    if (!momentary || disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    held.current = true
    set(true)
  }
  const up = () => {
    if (momentary && held.current) {
      held.current = false
      set(false)
    }
  }
  return (
    <button
      className={`fn${momentary ? ' momentary' : ''}`}
      aria-pressed={on}
      disabled={disabled}
      title={momentary ? `${fn.label ?? fn.name} (hold)` : fn.label ?? fn.name}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => momentary && e.preventDefault()}
      onClick={() => !momentary && set(!on)}
      onKeyDown={(e) => {
        if (momentary && (e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault()
          set(true)
        }
      }}
      onKeyUp={(e) => {
        if (momentary && (e.key === ' ' || e.key === 'Enter')) set(false)
      }}
    >
      <span className="k">{fn.name}</span>
      <span className="l">{fn.label ?? '—'}</span>
    </button>
  )
}

function SpeedSlider({
  value,
  steps,
  onChange,
  disabled,
  label,
}: {
  value: number
  steps: number
  onChange: (v: number) => void
  disabled: boolean
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  // While dragging, show the finger position immediately rather than waiting for the server echo.
  const [drag, setDrag] = useState<number | null>(null)
  const shown = drag ?? value

  const fromPointer = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (r.bottom - e.clientY) / r.height))
  }
  const onKey = (e: KeyboardEvent) => {
    const step = 1 / steps
    const map: Record<string, number> = {
      ArrowUp: value + step,
      ArrowRight: value + step,
      ArrowDown: value - step,
      ArrowLeft: value - step,
      PageUp: value + 0.1,
      PageDown: value - 0.1,
      Home: 0,
      End: 1,
    }
    if (e.key in map) {
      e.preventDefault()
      onChange(map[e.key])
    }
  }

  return (
    <div
      ref={ref}
      className="slider"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={`Speed, ${label}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)}
      aria-disabled={disabled}
      style={disabled ? { opacity: 0.5 } : undefined}
      onKeyDown={disabled ? undefined : onKey}
      onPointerDown={(e) => {
        if (disabled) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const v = fromPointer(e)
        setDrag(v)
        onChange(v)
      }}
      onPointerMove={(e) => {
        if (drag == null) return
        const v = fromPointer(e)
        setDrag(v)
        onChange(v)
      }}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
    >
      <div className="fill" style={{ height: `${shown * 100}%` }} />
      <div className="thumb" style={{ bottom: `calc(${shown} * (100% - 22px) + 4px)` }} />
    </div>
  )
}
