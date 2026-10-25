import { useState } from 'react'
import { IconSearch } from '../icons.tsx'
import { displayName, type LogixData, type LogixNGData } from '../jmri/protocol.ts'
import { useClient, useJmri } from '../state.tsx'
import { AddonMissing } from './AddonMissing.tsx'

/** JMRI's tree text repeats "::: Use default" on every node; it carries no information here. */
const cleanTree = (t: string) => t.replace(/ ::: Use default/g, '').replace(/\s+$/, '')

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return <button className="switch" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
}

export function LogicPage() {
  const addon = useJmri((s) => s.addon)
  const logix = useJmri((s) => s.logix)
  const logixng = useJmri((s) => s.logixng)
  const [kind, setKind] = useState<'logixng' | 'logix'>('logixng')
  const [q, setQ] = useState('')

  if (addon === null) return <AddonMissing feature="Logix and LogixNG" />

  const matches = (x: { name: string; userName: string | null; comment: string | null }) =>
    `${x.name} ${x.userName ?? ''} ${x.comment ?? ''}`.toLowerCase().includes(q.toLowerCase())
  const ng = Object.values(logixng).filter(matches).sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { numeric: true }))
  const lx = Object.values(logix).filter(matches).sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { numeric: true }))

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <h1>Logic</h1>
        <div className="search">
          <IconSearch />
          <input className="input" placeholder="Search logic" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="segmented" role="group" aria-label="Logic type" style={{ alignSelf: 'flex-start' }}>
        <button aria-pressed={kind === 'logixng'} onClick={() => setKind('logixng')}>
          LogixNG ({Object.keys(logixng).length})
        </button>
        <button aria-pressed={kind === 'logix'} onClick={() => setKind('logix')}>
          Logix ({Object.keys(logix).length})
        </button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Turn logic on or off and see what it does. To change the logic itself, use PanelPro's LogixNG or Logix tables.
      </p>
      <div className="logic-list">
        {kind === 'logixng'
          ? ng.map((l) => <LogixNGCard key={l.name} l={l} />)
          : lx.map((l) => <LogixCard key={l.name} l={l} />)}
        {(kind === 'logixng' ? ng : lx).length === 0 && (
          <div className="card empty">{q ? 'Nothing matches your search.' : `No ${kind === 'logixng' ? 'LogixNG' : 'Logix'} defined in JMRI.`}</div>
        )}
      </div>
    </div>
  )
}

function LogixNGCard({ l }: { l: LogixNGData }) {
  const client = useClient()
  const [open, setOpen] = useState(false)
  return (
    <section className="card pad">
      <div className="logic-head">
        <span className="title">
          {displayName(l)} {l.userName && <span className="muted mono small">{l.name}</span>}
        </span>
        {l.enabled && !l.active && <span className="pill warn">Not running</span>}
        <span className="muted small">{l.conditionalNGs.length} ConditionalNG{l.conditionalNGs.length === 1 ? '' : 's'}</span>
        <Switch on={l.enabled} label={`Enable ${displayName(l)}`} onChange={(v) => client.setLogixNG(l.name, { enabled: v })} />
        <button className="btn ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'} logic
        </button>
      </div>
      {l.comment && <p className="muted small">{l.comment}</p>}
      {open &&
        l.conditionalNGs.map((c) => (
          <div key={c.name} className="cond">
            <div className="logic-head">
              <span className="title small">
                {displayName(c)} {c.userName && <span className="muted mono">{c.name}</span>}
              </span>
              <button className="btn" disabled={!l.enabled || !c.enabled} onClick={() => client.setLogixNG(c.name, { execute: true })}>
                Run now
              </button>
              <Switch on={c.enabled} label={`Enable ${displayName(c)}`} onChange={(v) => client.setLogixNG(c.name, { enabled: v })} />
            </div>
            <pre className="tree">{cleanTree(c.tree)}</pre>
          </div>
        ))}
    </section>
  )
}

const STATE_PILL: Record<string, string> = { true: 'ok', false: '', unknown: 'warn' }

function LogixCard({ l }: { l: LogixData }) {
  const client = useClient()
  const [open, setOpen] = useState(false)
  return (
    <section className="card pad">
      <div className="logic-head">
        <span className="title">
          {displayName(l)} {l.userName && <span className="muted mono small">{l.name}</span>}
        </span>
        <span className="muted small">{l.conditionals.length} conditional{l.conditionals.length === 1 ? '' : 's'}</span>
        <Switch on={l.enabled} label={`Enable ${displayName(l)}`} onChange={(v) => client.setLogixEnabled(l.name, v)} />
        <button className="btn ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'} logic
        </button>
      </div>
      {l.comment && <p className="muted small">{l.comment}</p>}
      {open &&
        l.conditionals.map((c) => (
          <div key={c.name} className="cond">
            <div className="logic-head">
              <span className="title small">{displayName(c)}</span>
              <span className={`pill ${STATE_PILL[c.state] ?? ''}`}>{c.state}</span>
            </div>
            <div className="small">
              <strong>If</strong> <span className="mono">{c.antecedent}</span>
            </div>
            <ul>
              {c.variables.map((v, i) => (
                <li key={i}>
                  <span className="mono muted">R{i + 1}</span> {v}
                </li>
              ))}
            </ul>
            <div className="small">
              <strong>Then</strong>
            </div>
            <ul>
              {c.actions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        ))}
    </section>
  )
}
