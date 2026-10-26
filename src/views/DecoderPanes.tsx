import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ProgramOp, ProgramResult } from '../jmri/client.ts'
import {
  allCvs,
  cvsForRaw,
  defaultStore,
  fnMapCell,
  paneHas,
  paneItems,
  parseDecoder,
  qualified,
  rawFromShown,
  rawValue,
  variableIndex,
  type CvState,
  type CvStore,
  type DecoderDef,
  type PaneNode,
  type VarDef,
} from '../jmri/decoderDef.ts'
import { loadDecoderIndex, type DecoderMatch } from '../jmri/decoders.ts'
import { useClient, useJmri, useToast } from '../state.tsx'

type Op = (o: Omit<ProgramOp, 'mode' | 'address' | 'isLongAddress'>) => Promise<ProgramResult>

interface RosterCvs {
  name: string
  decoderFamily: string
  decoderModel: string
  file: string | null
  values: Record<string, { value: number; state: string }>
}

interface Loaded {
  def: DecoderDef
  store: CvStore
  /** Roster entry the values were loaded from and can be saved to. */
  roster: string | null
}

/** JMRI's AbstractValue.ValueState names, for the roster file. */
const ROSTER_STATE: Record<CvState, string> = { default: 'FromDefault', file: 'FromFile', read: 'Read', edited: 'Edited', stored: 'Stored' }
const FROM_ROSTER: Record<string, CvState> = { Read: 'read', Stored: 'stored', Edited: 'edited', FromDefault: 'default', FromFile: 'file' }

let programmerXml: Promise<string> | null = null

export function DecoderPanes({ op, run, busy, canRead }: { op: Op; run: (label: string, fn: () => Promise<void>) => Promise<void>; busy: boolean; canRead: boolean }) {
  const client = useClient()
  const toast = useToast()
  const roster = useJmri((s) => s.roster)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [pick, setPick] = useState<'roster' | 'decoder'>('roster')

  const load = async (file: string, model: string, family: string, rosterName: string | null, values?: RosterCvs['values']) => {
    setLoading(`Loading ${model}…`)
    try {
      programmerXml ??= client
        .request<{ xml: string }>({ type: 'decoderDefinition', data: { programmer: '' } })
        .then((m) => m.data!.xml)
        .catch((e) => {
          programmerXml = null
          throw e
        })
      const [decoder, prog] = await Promise.all([client.request<{ xml: string }>({ type: 'decoderDefinition', data: { file } }), programmerXml])
      const { def } = parseDecoder(file, decoder.data!.xml, model, prog, family)
      const store = defaultStore(def)
      for (const [cv, v] of Object.entries(values ?? {})) store[cv] = { value: v.value, state: FROM_ROSTER[v.state] ?? 'file' }
      setLoaded({ def, store, roster: rosterName })
    } catch (e) {
      toast(`Couldn't load the decoder definition: ${(e as Error).message}`)
    } finally {
      setLoading(null)
    }
  }

  const chooseRoster = async (name: string) => {
    setLoading(`Loading ${name}…`)
    try {
      const r = (await client.request<RosterCvs>({ type: 'rosterCvs', data: { name } })).data!
      if (!r.file) {
        setLoading(null)
        toast(`${name} has no decoder type in the roster. Pick its decoder below; saving stores it in the roster.`)
        setPick('decoder')
        setLoaded(null)
        setPendingRoster(name)
        return
      }
      await load(r.file, r.decoderModel, r.decoderFamily, name, r.values)
    } catch (e) {
      setLoading(null)
      toast(`${name}: ${(e as Error).message}`)
    }
  }
  const [pendingRoster, setPendingRoster] = useState<string | null>(null)

  return (
    <>
      <section className="card pad">
        <div className="row-wrap">
          <h2>Decoder</h2>
          <div className="segmented" role="group" aria-label="Choose by">
            <button aria-pressed={pick === 'roster'} onClick={() => setPick('roster')}>
              Roster loco
            </button>
            <button aria-pressed={pick === 'decoder'} onClick={() => setPick('decoder')}>
              Decoder type
            </button>
          </div>
          {loading && <span className="pill warn">{loading}</span>}
        </div>
        {pick === 'roster' ? (
          <div className="row-wrap">
            <select className="input" aria-label="Roster loco" value={loaded?.roster ?? ''} onChange={(e) => e.target.value && chooseRoster(e.target.value)} style={{ maxWidth: 360 }}>
              <option value="">Choose a loco…</option>
              {Object.values(roster)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                  </option>
                ))}
            </select>
            <span className="muted small">Uses the decoder type and CV values DecoderPro stored for the loco.</span>
          </div>
        ) : (
          <DecoderPicker
            op={op}
            canRead={canRead}
            busy={busy}
            run={run}
            onPick={(m) => load(m.file, m.model, m.family, pendingRoster)}
            note={pendingRoster ? `Will be saved to ${pendingRoster}.` : undefined}
          />
        )}
        {loaded && (
          <p className="small" style={{ margin: 0 }}>
            <strong>{loaded.def.model}</strong> <span className="muted">· {loaded.def.family} · {loaded.def.mfg} · {loaded.def.variables.length} settings</span>
            {loaded.roster && <span className="muted"> · roster: {loaded.roster}</span>}
          </p>
        )}
      </section>
      {loaded && (
        <Sheets
          key={loaded.def.file + loaded.def.model + (loaded.roster ?? '')}
          loaded={loaded}
          op={op}
          run={run}
          busy={busy}
          canRead={canRead}
          onSaved={(name) => setLoaded((l) => (l ? { ...l, roster: name } : l))}
        />
      )}
    </>
  )
}

function DecoderPicker({
  op,
  canRead,
  busy,
  run,
  onPick,
  note,
}: {
  op: Op
  canRead: boolean
  busy: boolean
  run: (label: string, fn: () => Promise<void>) => Promise<void>
  onPick: (m: DecoderMatch) => void
  note?: string
}) {
  const client = useClient()
  const [all, setAll] = useState<Map<string, DecoderMatch[]> | null>(null)
  const [mfg, setMfg] = useState('')
  const [detected, setDetected] = useState<DecoderMatch[] | null>(null)
  useEffect(() => {
    loadDecoderIndex(client.url('/xml/decoderIndex.xml')).then((i) => setAll(i.all()), () => setAll(new Map()))
  }, [client])
  const models = detected ?? (mfg ? (all?.get(mfg) ?? []) : [])
  const key = (m: DecoderMatch) => `${m.file}|${m.model}`
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row-wrap">
        <select className="input" aria-label="Manufacturer" value={mfg} onChange={(e) => (setMfg(e.target.value), setDetected(null))} style={{ maxWidth: 260 }}>
          <option value="">Manufacturer…</option>
          {[...(all?.keys() ?? [])].sort().map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Decoder model"
          value=""
          disabled={models.length === 0}
          onChange={(e) => {
            const m = models.find((x) => key(x) === e.target.value)
            if (m) onPick(m)
          }}
          style={{ maxWidth: 360 }}
        >
          <option value="">{detected ? `${detected.length} matching models…` : 'Model…'}</option>
          {models.map((m) => (
            <option key={key(m)} value={key(m)}>
              {m.model} · {m.family}
            </option>
          ))}
        </select>
        <button
          className="btn"
          disabled={busy || !canRead}
          title={canRead ? 'Read CV8 and CV7 to narrow the list' : 'Needs the programming track'}
          onClick={() =>
            run('Identifying decoder', async () => {
              const mfgId = (await op({ op: 'read', cv: '8' })).value
              const version = (await op({ op: 'read', cv: '7' })).value
              const index = await loadDecoderIndex(client.url('/xml/decoderIndex.xml'))
              setMfg(index.manufacturer(mfgId) ?? '')
              setDetected(index.identify(mfgId, version))
            })
          }
        >
          Detect
        </button>
      </div>
      {note && <span className="muted small">{note}</span>}
    </div>
  )
}

// ---------- sheets ----------

interface Ctx {
  def: DecoderDef
  vars: Map<string, VarDef>
  store: CvStore
  edit: (v: VarDef, raw: number) => void
  /** Several variable changes applied in order, so ones sharing a CV combine. */
  editMany: (changes: [VarDef, number][]) => void
  editCv: (cv: string, value: number) => void
  readCvs: (cvs: string[]) => void
  writeCvs: (cvs: string[]) => void
  busy: boolean
  canRead: boolean
}

const varState = (v: VarDef, store: CvStore): CvState | null => {
  const states = v.cvs.map((p) => store[p.cv]?.state)
  for (const s of ['edited', 'default', 'file', 'stored', 'read'] as const) if (states.includes(s)) return s
  return null
}

/** CVs behind a variable, including the ones a composite sets through other variables. */
function cvsOf(v: VarDef, vars: Map<string, VarDef>): string[] {
  if (v.kind === 'composite') return v.composite.flatMap((c) => c.settings.flatMap((s) => (vars.get(s.ref) ? cvsOf(vars.get(s.ref)!, vars) : [])))
  return v.cvs.map((p) => p.cv)
}

function Sheets({
  loaded,
  op,
  run,
  busy,
  canRead,
  onSaved,
}: {
  loaded: Loaded
  op: Op
  run: (label: string, fn: () => Promise<void>) => Promise<void>
  busy: boolean
  canRead: boolean
  onSaved: (rosterName: string) => void
}) {
  const client = useClient()
  const toast = useToast()
  const { def } = loaded
  const [store, setStore] = useState<CvStore>(loaded.store)
  const vars = useMemo(() => variableIndex(def.variables), [def])
  const fnVars = useMemo(() => def.variables.filter((v) => fnMapCell(v.item)), [def])

  // Programmer panes the decoder has nothing for are left out, as in DecoderPro.
  const panes = useMemo(
    () =>
      def.panes.filter(
        (p) => !p.fromProgrammer || paneItems(p.root).some((i) => vars.has(i)) || paneHas(p.root, 'cvtable') || (paneHas(p.root, 'fnmapping') && fnVars.length > 0),
      ),
    [def, vars, fnVars],
  )
  const [paneIdx, setPaneIdx] = useState(0)
  const pane = panes[Math.min(paneIdx, panes.length - 1)]

  const update = (values: Record<string, number>, state: CvState) =>
    setStore((s) => {
      const next = { ...s }
      for (const [cv, value] of Object.entries(values)) next[cv] = { value, state }
      return next
    })

  const editMany = (changes: [VarDef, number][]) => {
    // Apply in order on a working copy, so changes sharing a CV combine.
    let work = store
    const changed: Record<string, number> = {}
    for (const [v, raw] of changes) {
      const c = cvsForRaw(v, raw, work)
      Object.assign(changed, c)
      work = { ...work, ...Object.fromEntries(Object.entries(c).map(([k, value]) => [k, { value, state: 'edited' as const }])) }
    }
    update(changed, 'edited')
  }

  const edit = (v: VarDef, raw: number) => {
    if (v.kind !== 'composite') return editMany([[v, raw]])
    const choice = v.composite[raw]
    if (choice) editMany(choice.settings.flatMap((s) => (vars.get(s.ref) ? [[vars.get(s.ref)!, s.value] as [VarDef, number]] : [])))
  }

  const readCvs = (cvs: string[]) =>
    run(`Reading ${cvs.length} CV${cvs.length === 1 ? '' : 's'}`, async () => {
      for (const cv of cvs) {
        const r = await op({ op: 'read', cv, decoderFile: def.file })
        update({ [cv]: r.value }, 'read')
      }
    })

  const writeCvs = (cvs: string[]) =>
    run(`Writing ${cvs.length} CV${cvs.length === 1 ? '' : 's'}`, async () => {
      for (const cv of cvs) {
        const value = store[cv]?.value ?? 0
        await op({ op: 'write', cv, value, decoderFile: def.file })
        update({ [cv]: value }, 'stored')
      }
    })

  /** CVs a pane shows, for reading and writing it. */
  const paneCvs = (node: PaneNode, readable: boolean) => {
    const items = paneItems(node)
    const list = new Set<string>()
    const add = (v: VarDef) => {
      if (readable && v.writeOnly) return
      if (!readable && (v.readOnly || v.infoOnly)) return
      cvsOf(v, vars).forEach((c) => list.add(c))
    }
    for (const i of items) {
      const v = vars.get(i)
      if (v && qualified(v.qualifiers, vars, store)) add(v)
    }
    if (paneHas(node, 'fnmapping')) fnVars.forEach(add)
    if (paneHas(node, 'dccaddress')) ['Short Address', 'Long Address', 'Address Format'].forEach((i) => vars.get(i) && add(vars.get(i)!))
    if (paneHas(node, 'cvtable')) def.variables.forEach(add)
    return [...list].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }

  const edited = (cvs: string[]) => cvs.filter((c) => store[c]?.state === 'edited')
  const allEdited = Object.keys(store).filter((c) => store[c].state === 'edited')

  const save = async () => {
    const name = loaded.roster
    if (!name) return
    try {
      await client.request({
        type: 'rosterCvs',
        method: 'post',
        data: {
          name,
          values: Object.fromEntries(Object.entries(store).map(([cv, e]) => [cv, { value: e.value, state: ROSTER_STATE[e.state] }])),
          decoderFamily: def.family,
          decoderModel: def.model,
        },
      })
      toast(`Saved to roster entry ${name}`)
      onSaved(name)
    } catch (e) {
      toast(`Couldn't save to the roster: ${(e as Error).message}`)
    }
  }

  const ctx: Ctx = { def, vars, store, edit, editMany, editCv: (cv, value) => update({ [cv]: value }, 'edited'), readCvs, writeCvs, busy, canRead }
  const readable = pane ? paneCvs(pane.root, true) : []
  const writable = pane ? paneCvs(pane.root, false) : []

  return (
    <section className="card pad dp" aria-label="Decoder settings">
      <div className="segmented scroll-x" role="tablist" aria-label="Panes">
        {panes.map((p, i) => (
          <button key={p.name + i} role="tab" aria-selected={p === pane} aria-pressed={p === pane} onClick={() => setPaneIdx(i)}>
            {p.name}
          </button>
        ))}
      </div>
      <div className="row-wrap dp-actions">
        <button className="btn" disabled={busy || !canRead || readable.length === 0} onClick={() => readCvs(readable)}>
          Read pane
        </button>
        <button className="btn primary" disabled={busy || edited(writable).length === 0} onClick={() => writeCvs(edited(writable))}>
          Write changes{edited(writable).length ? ` (${edited(writable).length})` : ''}
        </button>
        <button className="btn" disabled={busy || writable.length === 0} onClick={() => writeCvs(writable)}>
          Write pane
        </button>
        <span className="spacer" />
        <button className="btn ghost" disabled={busy || allEdited.length === 0} onClick={() => writeCvs(allEdited)}>
          Write all changes{allEdited.length ? ` (${allEdited.length})` : ''}
        </button>
        {loaded.roster && (
          <button className="btn ghost" disabled={busy} onClick={save}>
            Save to roster
          </button>
        )}
      </div>
      {!canRead && <p className="muted small">Reading isn't possible here; values shown are the roster's or the decoder's defaults.</p>}
      {pane && (
        <div className="dp-pane" role="tabpanel" aria-label={pane.name}>
          <Node node={pane.root} ctx={ctx} />
        </div>
      )}
    </section>
  )
}

function Node({ node, ctx }: { node: PaneNode; ctx: Ctx }): ReactNode {
  if ('qualifiers' in node && !qualified(node.qualifiers, ctx.vars, ctx.store)) return null
  switch (node.t) {
    case 'box':
      return (
        <div className={node.dir === 'row' ? 'dp-row' : 'dp-col'}>
          {node.children.map((c, i) => (
            <Node key={i} node={c} ctx={ctx} />
          ))}
        </div>
      )
    case 'group':
      return (
        <>
          {node.children.map((c, i) => (
            <Node key={i} node={c} ctx={ctx} />
          ))}
        </>
      )
    case 'grid':
      return (
        <div className="dp-grid">
          {node.items.map((it, i) => (
            <div key={i} className="dp-griditem" style={{ gridColumn: `${it.x + 1} / span ${it.w}`, gridRow: `${it.y + 1} / span ${it.h}` }}>
              {it.children.map((c, j) => (
                <Node key={j} node={c} ctx={ctx} />
              ))}
            </div>
          ))}
        </div>
      )
    case 'label':
      return node.text ? <div className="dp-heading">{node.text}</div> : null
    case 'separator':
      return <hr className="dp-sep" />
    case 'display': {
      const v = ctx.vars.get(node.item)
      if (!v || !qualified(v.qualifiers, ctx.vars, ctx.store)) return null
      return <Setting v={v} label={node.label} format={node.format} layout={node.layout} tooltip={node.tooltip} ctx={ctx} />
    }
    case 'dccaddress':
      return <DccAddress ctx={ctx} />
    case 'fnmapping':
      return <FnMap ctx={ctx} />
    case 'cvtable':
      return <CvTable ctx={ctx} />
  }
}

const STATE_LABEL: Record<CvState, string> = { default: 'Default', file: 'From roster', read: 'Read', edited: 'Changed, not written', stored: 'Written' }

function Setting({ v, label, format, layout, tooltip, ctx }: { v: VarDef; label?: string; format?: string; layout?: string; tooltip?: string; ctx: Ctx }) {
  const state = varState(v, ctx.store)
  const name = label ?? v.label
  const disabled = v.readOnly || v.infoOnly
  const stacked = v.kind === 'speedTable' || layout === 'above' || layout === 'below'
  return (
    <label
      className={`dp-setting ${state ?? ''}${stacked ? ' wide' : ''}${layout === 'below' ? ' below' : ''}${name ? '' : ' unnamed'}`}
      title={tooltip ?? v.tooltip}
    >
      {name && (
        <span className="dp-name">
          {name}
          <span className="dp-cv mono">{v.cvs.length ? `CV${v.cvs.length > 1 ? 's' : ''} ${v.cvs.map((p) => p.cv).slice(0, 3).join(', ')}${v.cvs.length > 3 ? '…' : ''}` : ''}</span>
        </span>
      )}
      <Control v={v} name={name || v.label} format={format} ctx={ctx} disabled={disabled} />
      {state && <span className={`dp-state ${state}`} title={STATE_LABEL[state]} aria-label={STATE_LABEL[state]} />}
    </label>
  )
}

function Control({ v, name, format, ctx, disabled }: { v: VarDef; name: string; format?: string; ctx: Ctx; disabled: boolean }) {
  const raw = rawValue(v, ctx.store, ctx.vars)
  switch (v.kind) {
    case 'enum':
    case 'splitEnum': {
      const two = v.choices.length === 2
      if (two && format && /checkbox|radiobutton/.test(format)) {
        return (
          <input
            type="checkbox"
            aria-label={name}
            disabled={disabled}
            checked={raw === v.choices[1].value}
            onChange={(e) => ctx.edit(v, e.target.checked ? v.choices[1].value : v.choices[0].value)}
          />
        )
      }
      const known = v.choices.some((c) => c.value === raw)
      return (
        <select className="input" aria-label={name} disabled={disabled} value={raw ?? ''} onChange={(e) => ctx.edit(v, Number(e.target.value))}>
          {!known && <option value={raw ?? ''}>(value {raw})</option>}
          {v.choices.map((c, i) => (
            <option key={i} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      )
    }
    case 'composite':
      return (
        <select className="input" aria-label={name} disabled={disabled} value={raw ?? -1} onChange={(e) => ctx.edit(v, Number(e.target.value))}>
          {(raw == null || raw < 0) && <option value={-1}>(custom)</option>}
          {v.composite.map((c, i) => (
            <option key={i} value={i}>
              {c.label}
            </option>
          ))}
        </select>
      )
    case 'speedTable':
      return <SpeedTable v={v} ctx={ctx} disabled={disabled} />
    case 'unsupported':
      return <span className="muted small">Edit as CV {v.cvs.map((p) => p.cv).join(', ')}</span>
    default:
      return <NumberField v={v} name={name} raw={raw ?? 0} ctx={ctx} disabled={disabled} slider={!!format && /slider/.test(format)} />
  }
}

/** DccAddressPanel: the address the decoder answers to; setting it picks short or long and sets CV29 to match. */
function DccAddress({ ctx }: { ctx: Ctx }) {
  const short = ctx.vars.get('Short Address')
  const long = ctx.vars.get('Long Address')
  const format = ctx.vars.get('Address Format')
  const [draft, setDraft] = useState<string | null>(null)
  if (!short) return null
  const isLong = !!long && !!format && rawValue(format, ctx.store) === 1
  const active = rawValue(isLong ? long : short, ctx.store) ?? 0
  const commit = () => {
    if (draft == null) return
    const n = Number(draft)
    setDraft(null)
    if (!Number.isInteger(n) || n < 1 || n > (long ? 10239 : 127)) return
    if (n <= 127 || !long) ctx.editMany([[short, n], ...(format ? [[format, 0] as [VarDef, number]] : [])])
    else ctx.editMany([[long, n], ...(format ? [[format, 1] as [VarDef, number]] : [])])
  }
  return (
    <label className={`dp-setting ${[short, long, format].some((v) => v && varState(v, ctx.store) === 'edited') ? 'edited' : ''}`}>
      <span className="dp-name">
        <strong>Active address</strong>
        <span className="dp-cv">{isLong ? 'long, CVs 17/18 and CV29' : 'short, CV1 and CV29'}</span>
      </span>
      <span className="dp-num">
        <input
          className="input mono"
          aria-label="Active address"
          inputMode="numeric"
          value={draft ?? String(active)}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      </span>
      <span />
    </label>
  )
}

function NumberField({ v, name, raw, ctx, disabled, slider }: { v: VarDef; name: string; raw: number; ctx: Ctx; disabled: boolean; slider: boolean }) {
  const hex = v.kind === 'hex' || v.kind === 'splitHex'
  const shown = raw * v.factor + v.offset
  const text = hex ? shown.toString(16).toUpperCase() : String(shown)
  const [draft, setDraft] = useState<string | null>(null)
  const lo = v.kind === 'dec' || v.kind === 'shortAddress' || v.kind === 'longAddress' ? v.min : 0
  const hi = v.max
  const commit = () => {
    if (draft == null) return
    const n = hex ? parseInt(draft, 16) : Number(draft)
    setDraft(null)
    if (!Number.isFinite(n) || n < lo || n > hi) return
    ctx.edit(v, rawFromShown(v, n))
  }
  if (slider && !hex) {
    // Panes pair a slider with a separate value field, so the slider stands alone here.
    return (
      <span className="dp-num">
        <input type="range" min={lo} max={hi} value={shown} disabled={disabled} aria-label={`${name} slider`} onChange={(e) => ctx.edit(v, rawFromShown(v, Number(e.target.value)))} />
        <span className="mono small muted">{shown}</span>
      </span>
    )
  }
  return (
    <span className="dp-num">
      <input
        className="input mono"
        aria-label={name}
        inputMode={hex ? 'text' : 'numeric'}
        disabled={disabled}
        value={draft ?? text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        title={`${lo}–${hi}${hex ? ' (hex)' : ''}`}
      />
    </span>
  )
}

function SpeedTable({ v, ctx, disabled }: { v: VarDef; ctx: Ctx; disabled: boolean }) {
  const values = v.cvs.map((p) => ctx.store[p.cv]?.value ?? 0)
  const w = 280
  const h = 90
  const pts = values.map((y, i) => `${(i / (values.length - 1)) * w},${h - (y / 255) * h}`).join(' ')
  return (
    <div className="dp-speed">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={2} />
      </svg>
      <div className="dp-speed-cells">
        {v.cvs.map((p, i) => (
          <input
            key={p.cv}
            className="input mono"
            aria-label={`Speed step ${i + 1} (CV${p.cv})`}
            disabled={disabled}
            value={values[i]}
            inputMode="numeric"
            onChange={(e) => {
              const n = Number(e.target.value.replace(/\D/g, ''))
              if (n >= 0 && n <= 255) ctx.editCv(p.cv, n)
            }}
          />
        ))}
      </div>
    </div>
  )
}

function FnMap({ ctx }: { ctx: Ctx }) {
  const cells = ctx.def.variables.flatMap((v) => {
    const c = fnMapCell(v.item)
    return c && qualified(v.qualifiers, ctx.vars, ctx.store) ? [{ ...c, v }] : []
  })
  if (cells.length === 0) return <p className="muted small">This decoder has no function map.</p>
  const fns = [...new Set(cells.map((c) => c.fn))]
  const outputs = [...new Set(cells.map((c) => c.output))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const outLabel = (o: string) => ctx.def.outputs.find((x) => x.name === o)?.label ?? o
  return (
    <div className="table-wrap">
      <table className="table dp-fnmap">
        <thead>
          <tr>
            <th>Function</th>
            {outputs.map((o) => (
              <th key={o} title={`Output ${o}`}>
                {outLabel(o).split('|')[0]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fns.map((fn) => (
            <tr key={fn}>
              <th>{fn}</th>
              {outputs.map((o) => {
                const cell = cells.find((c) => c.fn === fn && c.output === o)
                if (!cell) return <td key={o} />
                const raw = rawValue(cell.v, ctx.store, ctx.vars) ?? 0
                const on = cell.v.choices.length ? raw === (cell.v.choices[1]?.value ?? 1) : raw !== 0
                return (
                  <td key={o} className={varState(cell.v, ctx.store) === 'edited' ? 'edited' : undefined}>
                    <input
                      type="checkbox"
                      aria-label={`${fn} controls output ${outLabel(o)}`}
                      checked={on}
                      disabled={cell.v.readOnly}
                      onChange={(e) => ctx.edit(cell.v, e.target.checked ? (cell.v.choices[1]?.value ?? 1) : (cell.v.choices[0]?.value ?? 0))}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CvTable({ ctx }: { ctx: Ctx }) {
  const cvs = allCvs(ctx.def)
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>CV</th>
            <th>Value</th>
            <th>State</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {cvs.map((cv) => {
            const e = ctx.store[cv]
            return (
              <tr key={cv}>
                <td className="mono">{cv}</td>
                <td>
                  <input
                    className="input mono"
                    style={{ width: 80 }}
                    aria-label={`CV${cv} value`}
                    inputMode="numeric"
                    value={e?.value ?? 0}
                    onChange={(ev) => {
                      const n = Number(ev.target.value.replace(/\D/g, ''))
                      if (n >= 0 && n <= 255) ctx.editCv(cv, n)
                    }}
                  />
                </td>
                <td className="small muted">{e ? STATE_LABEL[e.state] : ''}</td>
                <td>
                  <button className="btn ghost" disabled={ctx.busy || !ctx.canRead} onClick={() => ctx.readCvs([cv])}>
                    Read
                  </button>
                  <button className="btn ghost" disabled={ctx.busy} onClick={() => ctx.writeCvs([cv])}>
                    Write
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
