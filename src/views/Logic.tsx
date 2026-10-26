import { useState } from 'react'
import { IconSearch } from '../icons.tsx'
import {
  displayName,
  HEAD,
  type ConditionalActionData,
  type ConditionalData,
  type ConditionalNGData,
  type ConditionalVariableData,
  type LogixData,
  type LogixNGData,
  type NGField,
  type NGNode,
  type NGSocket,
} from '../jmri/protocol.ts'
import { useClient, useJmri, useToast } from '../state.tsx'
import { AddonMissing } from './AddonMissing.tsx'
import { StoreConfig } from './StoreConfig.tsx'

/** JMRI's tree text repeats "::: Use default" on every node; it carries no information here. */
const cleanTree = (t: string) => t.replace(/ ::: Use default/g, '').replace(/\s+$/, '')

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return <button className="switch" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
}

/** Run an edit, reporting a refusal from JMRI. */
function useEdit() {
  const client = useClient()
  const toast = useToast()
  return async <T,>(type: 'logix' | 'logixng', name: string, edit: Record<string, unknown>): Promise<T | null> => {
    try {
      return await client.editLogic<T>(type, name, edit)
    } catch (e) {
      toast((e as Error).message)
      return null
    }
  }
}

export function LogicPage() {
  const addon = useJmri((s) => s.addon)
  const logix = useJmri((s) => s.logix)
  const logixng = useJmri((s) => s.logixng)
  const edit = useEdit()
  const [kind, setKind] = useState<'logixng' | 'logix'>('logixng')
  const [q, setQ] = useState('')
  const [newName, setNewName] = useState<string | null>(null)

  if (addon === null) return <AddonMissing feature="Logix and LogixNG" />

  const matches = (x: { name: string; userName: string | null; comment: string | null }) =>
    `${x.name} ${x.userName ?? ''} ${x.comment ?? ''}`.toLowerCase().includes(q.toLowerCase())
  const ng = Object.values(logixng).filter(matches).sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { numeric: true }))
  const lx = Object.values(logix).filter(matches).sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { numeric: true }))
  const label = kind === 'logixng' ? 'LogixNG' : 'Logix'

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <h1>Logic</h1>
        <div className="search">
          <IconSearch />
          <input className="input" placeholder="Search logic" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <StoreConfig />
      </div>
      <div className="row-wrap">
        <div className="segmented" role="group" aria-label="Logic type">
          <button aria-pressed={kind === 'logixng'} onClick={() => setKind('logixng')}>
            LogixNG ({Object.keys(logixng).length})
          </button>
          <button aria-pressed={kind === 'logix'} onClick={() => setKind('logix')}>
            Logix ({Object.keys(logix).length})
          </button>
        </div>
        <span className="spacer" />
        {newName == null ? (
          <button className="btn primary" onClick={() => setNewName('')}>
            New {label}
          </button>
        ) : (
          <form
            className="row-wrap"
            onSubmit={async (e) => {
              e.preventDefault()
              if (await edit(kind, '', { op: 'create', userName: newName })) setNewName(null)
            }}
          >
            <input className="input" autoFocus aria-label={`New ${label} name`} placeholder={`${label} name`} value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="btn primary" disabled={!newName.trim()}>
              Create
            </button>
            <button type="button" className="btn ghost" onClick={() => setNewName(null)}>
              Cancel
            </button>
          </form>
        )}
      </div>
      <BeanLists />
      <div className="logic-list">
        {kind === 'logixng' ? ng.map((l) => <LogixNGCard key={l.name} l={l} />) : lx.map((l) => <LogixCard key={l.name} l={l} />)}
        {(kind === 'logixng' ? ng : lx).length === 0 && <div className="card empty">{q ? 'Nothing matches your search.' : `No ${label} defined in JMRI.`}</div>}
      </div>
    </div>
  )
}

/** Datalists of JMRI's beans by type, for the name fields below (id "dl-<type>"). */
function BeanLists() {
  const beans = useJmri((s) => s.beans)
  const logix = useJmri((s) => s.logix)
  const lists: Record<string, { name: string; userName?: string | null }[]> = {
    ...Object.fromEntries(Object.entries(beans).map(([t, m]) => [t, Object.values(m) as { name: string; userName?: string | null }[]])),
    logix: Object.values(logix),
    conditional: Object.values(logix).flatMap((l) => l.conditionals),
  }
  return (
    <>
      {Object.entries(lists).map(([t, items]) => (
        <datalist key={t} id={`dl-${t}`}>
          {items.map((b) => (
            <option key={b.name} value={b.userName || b.name}>
              {b.userName ? b.name : undefined}
            </option>
          ))}
        </datalist>
      ))}
    </>
  )
}

/** Heading row with rename and delete, shared by Logix and LogixNG cards. */
function ItemTools({ type, item, extra }: { type: 'logix' | 'logixng'; item: { name: string; userName: string | null }; extra?: React.ReactNode }) {
  const edit = useEdit()
  const [renaming, setRenaming] = useState<string | null>(null)
  return (
    <div className="row-wrap logic-tools">
      {renaming == null ? (
        <button className="btn ghost" onClick={() => setRenaming(item.userName ?? '')}>
          Rename
        </button>
      ) : (
        <form
          className="row-wrap"
          onSubmit={async (e) => {
            e.preventDefault()
            if (await edit(type, item.name, { op: 'rename', userName: renaming })) setRenaming(null)
          }}
        >
          <input className="input" autoFocus aria-label="New name" value={renaming} onChange={(e) => setRenaming(e.target.value)} />
          <button className="btn primary">Save</button>
          <button type="button" className="btn ghost" onClick={() => setRenaming(null)}>
            Cancel
          </button>
        </form>
      )}
      {extra}
      <span className="spacer" />
      <button
        className="btn ghost danger-text"
        onClick={() => confirm(`Delete ${displayName(item)}? This can't be undone here.`) && edit(type, item.name, { op: 'delete' })}
      >
        Delete
      </button>
    </div>
  )
}

// ================= LogixNG =================

const NG_TYPES: Record<'action' | 'expression', Record<string, string>> = {
  action: {
    IfThenElse: 'If … then … else',
    DigitalMany: 'Many (do several things)',
    ActionTurnout: 'Set turnout',
    ActionSensor: 'Set sensor',
    ActionLight: 'Set light',
    ActionMemory: 'Set memory',
    ActionSignalMast: 'Set signal mast',
    ExecuteDelayed: 'Do after a delay',
  },
  expression: {
    ExpressionSensor: 'Sensor',
    ExpressionTurnout: 'Turnout',
    ExpressionLight: 'Light',
    ExpressionSignalMast: 'Signal mast',
    And: 'And',
    Or: 'Or',
    Not: 'Not',
    True: 'Always true',
    False: 'Always false',
  },
}

const FIELD_LABEL: Record<string, string> = { state: 'State', _Is_IsNot: 'Is / is not', QueryType: 'Check', OperationType: 'Do', MemoryOperation: 'Set to', OtherConstantValue: 'Value', Unit: 'Unit' }
const fieldLabel = (f: NGField) => (f.kind === 'bean' ? (f.beanType ?? 'Item') : (FIELD_LABEL[f.key] ?? f.key.replace(/([a-z])([A-Z])/g, '$1 $2')))
const beanList = (beanType?: string) => {
  const t = (beanType ?? '').replace(/\s/g, '')
  return `dl-${t.charAt(0).toLowerCase()}${t.slice(1)}`
}

function LogixNGCard({ l }: { l: LogixNGData }) {
  const client = useClient()
  const edit = useEdit()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  return (
    <section className="card pad" aria-label={`LogixNG ${displayName(l)}`}>
      <div className="logic-head">
        <span className="title">
          {displayName(l)} {l.userName && <span className="muted mono small">{l.name}</span>}
        </span>
        {l.enabled && !l.active && <span className="pill warn">Not running</span>}
        <span className="muted small">
          {l.conditionalNGs.length} ConditionalNG{l.conditionalNGs.length === 1 ? '' : 's'}
        </span>
        <Switch on={l.enabled} label={`Enable ${displayName(l)}`} onChange={(v) => client.setLogixNG(l.name, { enabled: v })} />
        <button className="btn ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'} logic
        </button>
      </div>
      {l.comment && <p className="muted small">{l.comment}</p>}
      {open && (
        <>
          <ItemTools
            type="logixng"
            item={l}
            extra={
              adding == null ? (
                <button className="btn ghost" onClick={() => setAdding('')}>
                  Add ConditionalNG
                </button>
              ) : (
                <form
                  className="row-wrap"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    if (await edit('logixng', l.name, { op: 'addConditionalNG', userName: adding })) setAdding(null)
                  }}
                >
                  <input className="input" autoFocus aria-label="ConditionalNG name" placeholder="ConditionalNG name" value={adding} onChange={(e) => setAdding(e.target.value)} />
                  <button className="btn primary">Add</button>
                  <button type="button" className="btn ghost" onClick={() => setAdding(null)}>
                    Cancel
                  </button>
                </form>
              )
            }
          />
          {l.conditionalNGs.map((c) => (
            <ConditionalNGView key={c.name} l={l} c={c} />
          ))}
        </>
      )}
    </section>
  )
}

function ConditionalNGView({ l, c }: { l: LogixNGData; c: ConditionalNGData }) {
  const client = useClient()
  const edit = useEdit()
  const [text, setText] = useState(false)
  const change = (e: Record<string, unknown>) => edit('logixng', l.name, { conditionalNG: c.name, ...e })
  return (
    <div className="cond" aria-label={`ConditionalNG ${displayName(c)}`} role="group">
      <div className="logic-head">
        <span className="title small">
          {displayName(c)} {c.userName && <span className="muted mono">{c.name}</span>}
        </span>
        <button className="btn ghost" onClick={() => setText(!text)}>
          {text ? 'Edit view' : 'Text view'}
        </button>
        <button className="btn" disabled={!l.enabled || !c.enabled} onClick={() => client.setLogixNG(c.name, { execute: true })}>
          Run now
        </button>
        <Switch on={c.enabled} label={`Enable ${displayName(c)}`} onChange={(v) => client.setLogixNG(c.name, { enabled: v })} />
        <button
          className="btn ghost danger-text"
          aria-label={`Delete ${displayName(c)}`}
          onClick={() => confirm(`Delete ConditionalNG ${displayName(c)}?`) && change({ op: 'deleteConditionalNG' })}
        >
          Delete
        </button>
      </div>
      {text || !c.root ? <pre className="tree">{cleanTree(c.tree)}</pre> : <SocketView s={c.root} path={[]} change={change} />}
    </div>
  )
}

type Change = (e: Record<string, unknown>) => Promise<unknown>

function SocketView({ s, path, change }: { s: NGSocket; path: number[]; change: Change }) {
  const types = s.kind === 'other' ? null : NG_TYPES[s.kind]
  return (
    <div className="ng-socket" data-socket={s.name}>
      <span className={`ng-socket-name ${s.kind}`} title={s.kind === 'expression' ? 'Expression (a condition)' : s.kind === 'action' ? 'Action' : undefined}>
        {s.kind === 'expression' ? '?' : '!'} {s.name}
      </span>
      {s.child ? (
        <NodeView n={s.child} path={path} change={change} />
      ) : types ? (
        <select
          className="input ng-add"
          aria-label={`Add to ${s.name}`}
          value=""
          onChange={(e) => e.target.value && change({ op: 'add', path, type: e.target.value, config: {} })}
        >
          <option value="">+ Add {s.kind}…</option>
          {Object.entries(types).map(([t, label]) => (
            <option key={t} value={t}>
              {label}
            </option>
          ))}
        </select>
      ) : (
        <span className="muted small">empty (edit in PanelPro)</span>
      )}
    </div>
  )
}

function NodeView({ n, path, change }: { n: NGNode; path: number[]; change: Change }) {
  return (
    <div className={`ng-node${n.enabled ? '' : ' disabled'}`}>
      <div className="ng-node-head">
        <span className="ng-desc">{n.long || n.short}</span>
        <span className="muted small mono">{n.type}</span>
        <button className="btn ghost small-btn" onClick={() => change({ op: 'setEnabled', path, enabled: !n.enabled })}>
          {n.enabled ? 'Disable' : 'Enable'}
        </button>
        <button className="btn ghost small-btn danger-text" aria-label={`Remove ${n.short}`} onClick={() => change({ op: 'remove', path })}>
          Remove
        </button>
      </div>
      {n.fields.length > 0 && (
        <div className="row-wrap ng-fields">
          {n.fields.map((f) => (
            <FieldEditor key={f.key} f={f} onSet={(value) => change({ op: 'edit', path, config: { [f.key]: value } })} />
          ))}
        </div>
      )}
      {n.sockets.length > 0 && (
        <div className="ng-children">
          {n.sockets.map((s, i) => (
            <SocketView key={i} s={s} path={[...path, i]} change={change} />
          ))}
        </div>
      )}
    </div>
  )
}

function FieldEditor({ f, onSet }: { f: NGField; onSet: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const label = fieldLabel(f)
  if (f.kind === 'enum') {
    return (
      <label className="ng-field">
        <span className="muted small">{label}</span>
        <select className="input" aria-label={label} value={String(f.value ?? '')} onChange={(e) => onSet(e.target.value)}>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    )
  }
  const commit = () => {
    if (draft != null && draft !== String(f.value ?? '')) onSet(draft)
    setDraft(null)
  }
  return (
    <label className="ng-field">
      <span className="muted small">{label}</span>
      <input
        className="input"
        aria-label={label}
        list={f.kind === 'bean' ? beanList(f.beanType) : undefined}
        inputMode={f.kind === 'int' ? 'numeric' : undefined}
        placeholder={f.kind === 'bean' ? `${f.beanType} name` : undefined}
        value={draft ?? String(f.value ?? '')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commit())}
      />
    </label>
  )
}

// ================= Logix =================

const STATE_PILL: Record<string, string> = { true: 'ok', false: '', unknown: 'warn' }

function LogixCard({ l }: { l: LogixData }) {
  const client = useClient()
  const edit = useEdit()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <section className="card pad" aria-label={`Logix ${displayName(l)}`}>
      <div className="logic-head">
        <span className="title">
          {displayName(l)} {l.userName && <span className="muted mono small">{l.name}</span>}
        </span>
        <span className="muted small">
          {l.conditionals.length} conditional{l.conditionals.length === 1 ? '' : 's'}
        </span>
        <Switch on={l.enabled} label={`Enable ${displayName(l)}`} onChange={(v) => client.setLogixEnabled(l.name, v)} />
        <button className="btn ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'} logic
        </button>
      </div>
      {l.comment && <p className="muted small">{l.comment}</p>}
      {open && (
        <>
          <ItemTools
            type="logix"
            item={l}
            extra={
              <button
                className="btn ghost"
                onClick={async () => {
                  const r = await edit<LogixData>('logix', l.name, { op: 'addConditional', userName: '' })
                  const added = r?.conditionals[r.conditionals.length - 1]
                  if (added) setEditing(added.name)
                }}
              >
                Add conditional
              </button>
            }
          />
          {l.conditionals.map((c) =>
            editing === c.name ? (
              <ConditionalEditor key={c.name} l={l} c={c} onDone={() => setEditing(null)} />
            ) : (
              <ConditionalView key={c.name} l={l} c={c} onEdit={() => setEditing(c.name)} />
            ),
          )}
        </>
      )}
    </section>
  )
}

function ConditionalView({ l, c, onEdit }: { l: LogixData; c: ConditionalData; onEdit: () => void }) {
  const edit = useEdit()
  return (
    <div className="cond" role="group" aria-label={`Conditional ${displayName(c)}`}>
      <div className="logic-head">
        <span className="title small">{displayName(c)}</span>
        <span className={`pill ${STATE_PILL[c.state] ?? ''}`}>{c.state}</span>
        <button className="btn ghost" onClick={onEdit}>
          Edit
        </button>
        <button
          className="btn ghost danger-text"
          aria-label={`Delete conditional ${displayName(c)}`}
          onClick={() => confirm(`Delete conditional ${displayName(c)}?`) && edit('logix', l.name, { op: 'deleteConditional', conditional: c.name })}
        >
          Delete
        </button>
      </div>
      <div className="small">
        <strong>If</strong> <span className="mono">{c.antecedent || '(no conditions)'}</span>
      </div>
      <ul>
        {c.variables.map((v, i) => (
          <li key={i}>
            <span className="mono muted">R{i + 1}</span> {v.description}
          </li>
        ))}
      </ul>
      <div className="small">
        <strong>Then</strong>
      </div>
      <ul>
        {c.actions.map((a, i) => (
          <li key={i}>{a.description}</li>
        ))}
      </ul>
    </div>
  )
}

// What the editor offers; other types already in a conditional are kept and shown as JMRI describes them.
interface VarType {
  label: string
  item: string | null
  data?: 'value' | 'aspect' | 'clock'
}
const VAR_TYPES: Record<string, VarType> = {
  SENSOR_ACTIVE: { label: 'Sensor is active', item: 'sensor' },
  SENSOR_INACTIVE: { label: 'Sensor is inactive', item: 'sensor' },
  TURNOUT_THROWN: { label: 'Turnout is thrown', item: 'turnout' },
  TURNOUT_CLOSED: { label: 'Turnout is closed', item: 'turnout' },
  LIGHT_ON: { label: 'Light is on', item: 'light' },
  LIGHT_OFF: { label: 'Light is off', item: 'light' },
  MEMORY_EQUALS: { label: 'Memory equals', item: 'memory', data: 'value' },
  SIGNAL_MAST_ASPECT_EQUALS: { label: 'Signal mast shows', item: 'signalMast', data: 'aspect' },
  SIGNAL_MAST_LIT: { label: 'Signal mast is lit', item: 'signalMast' },
  SIGNAL_MAST_HELD: { label: 'Signal mast is held', item: 'signalMast' },
  SIGNAL_HEAD_RED: { label: 'Signal head is red', item: 'signalHead' },
  SIGNAL_HEAD_YELLOW: { label: 'Signal head is yellow', item: 'signalHead' },
  SIGNAL_HEAD_GREEN: { label: 'Signal head is green', item: 'signalHead' },
  SIGNAL_HEAD_DARK: { label: 'Signal head is dark', item: 'signalHead' },
  SIGNAL_HEAD_HELD: { label: 'Signal head is held', item: 'signalHead' },
  CONDITIONAL_TRUE: { label: 'Conditional is true', item: 'conditional' },
  CONDITIONAL_FALSE: { label: 'Conditional is false', item: 'conditional' },
  FAST_CLOCK_RANGE: { label: 'Fast clock is between', item: null, data: 'clock' },
}

interface ActionType {
  label: string
  item: string | null
  states?: [number, string][]
  text?: string
}
const ON_OFF_TOGGLE = (on: string, off: string): [number, string][] => [
  [2, on],
  [4, off],
  [8, 'Toggle'],
]
const ACTION_TYPES: Record<string, ActionType> = {
  SET_TURNOUT: { label: 'Set turnout', item: 'turnout', states: ON_OFF_TOGGLE('Closed', 'Thrown') },
  SET_SENSOR: { label: 'Set sensor', item: 'sensor', states: ON_OFF_TOGGLE('Active', 'Inactive') },
  DELAYED_SENSOR: { label: 'Set sensor after a delay', item: 'sensor', states: ON_OFF_TOGGLE('Active', 'Inactive'), text: 'Seconds' },
  SET_LIGHT: { label: 'Set light', item: 'light', states: ON_OFF_TOGGLE('On', 'Off') },
  SET_MEMORY: { label: 'Set memory', item: 'memory', text: 'Value' },
  SET_SIGNALMAST_ASPECT: { label: 'Set signal mast aspect', item: 'signalMast', text: 'Aspect' },
  SET_SIGNALMAST_HELD: { label: 'Hold signal mast', item: 'signalMast' },
  CLEAR_SIGNALMAST_HELD: { label: 'Release signal mast', item: 'signalMast' },
  SET_SIGNALMAST_DARK: { label: 'Set signal mast dark', item: 'signalMast' },
  SET_SIGNALMAST_LIT: { label: 'Set signal mast lit', item: 'signalMast' },
  SET_SIGNAL_APPEARANCE: {
    label: 'Set signal head',
    item: 'signalHead',
    states: [
      [HEAD.RED, 'Red'],
      [HEAD.YELLOW, 'Yellow'],
      [HEAD.GREEN, 'Green'],
      [HEAD.FLASHRED, 'Flashing red'],
      [HEAD.FLASHYELLOW, 'Flashing yellow'],
      [HEAD.FLASHGREEN, 'Flashing green'],
      [HEAD.DARK, 'Dark'],
    ],
  },
  SET_SIGNAL_HELD: { label: 'Hold signal head', item: 'signalHead' },
  CLEAR_SIGNAL_HELD: { label: 'Release signal head', item: 'signalHead' },
  TRIGGER_ROUTE: { label: 'Set route', item: 'route' },
  ENABLE_LOGIX: { label: 'Enable Logix', item: 'logix' },
  DISABLE_LOGIX: { label: 'Disable Logix', item: 'logix' },
  START_FAST_CLOCK: { label: 'Start fast clock', item: null },
  STOP_FAST_CLOCK: { label: 'Stop fast clock', item: null },
}
const OPTIONS: [number, string][] = [
  [1, 'When it becomes true'],
  [2, 'When it becomes false'],
  [3, 'When it changes'],
]

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const minutes = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function ConditionalEditor({ l, c, onDone }: { l: LogixData; c: ConditionalData; onDone: () => void }) {
  const edit = useEdit()
  const [userName, setUserName] = useState(c.userName ?? '')
  const [logicType, setLogicType] = useState(c.logicType || 'ALL_AND')
  const [antecedent, setAntecedent] = useState(c.antecedent)
  const [trigger, setTrigger] = useState(c.triggerOnChange)
  const [vars, setVars] = useState<ConditionalVariableData[]>(c.variables)
  const [actions, setActions] = useState<ConditionalActionData[]>(c.actions)
  const setVar = (i: number, p: Partial<ConditionalVariableData>) => setVars(vars.map((v, j) => (j === i ? { ...v, ...p, description: undefined } : v)))
  const setAction = (i: number, p: Partial<ConditionalActionData>) => setActions(actions.map((a, j) => (j === i ? { ...a, ...p, description: undefined } : a)))

  const save = async () => {
    const r = await edit('logix', l.name, { op: 'updateConditional', conditional: c.name, userName, logicType, antecedent, triggerOnChange: trigger, variables: vars, actions })
    if (r) onDone()
  }

  return (
    <div className="cond cond-edit" role="group" aria-label={`Edit conditional ${displayName(c)}`}>
      <div className="row-wrap">
        <label className="field-inline">
          <span className="muted small">Name</span>
          <input className="input" aria-label="Conditional name" value={userName} onChange={(e) => setUserName(e.target.value)} placeholder={c.name} />
        </label>
        <label className="field-inline">
          <span className="muted small">Combine conditions with</span>
          <select className="input" aria-label="Logic type" value={logicType} onChange={(e) => setLogicType(e.target.value)}>
            <option value="ALL_AND">AND (all must hold)</option>
            <option value="ALL_OR">OR (any may hold)</option>
            <option value="MIXED">An expression</option>
          </select>
        </label>
        {logicType === 'MIXED' && (
          <label className="field-inline">
            <span className="muted small">Expression</span>
            <input className="input mono" aria-label="Antecedent" placeholder="R1 and (R2 or not R3)" value={antecedent} onChange={(e) => setAntecedent(e.target.value)} />
          </label>
        )}
      </div>

      <div className="small">
        <strong>If</strong>
      </div>
      {vars.map((v, i) => {
        const t = VAR_TYPES[v.type]
        return (
          <div key={i} className="row-wrap edit-row" role="group" aria-label={`Condition R${i + 1}`}>
            <span className="mono muted">R{i + 1}</span>
            {t ? (
              <>
                <label className="toggle-row" title="Negate">
                  <input type="checkbox" aria-label="Not" checked={v.not} onChange={(e) => setVar(i, { not: e.target.checked })} />
                  <span className="small">not</span>
                </label>
                <select className="input" aria-label="Condition type" value={v.type} onChange={(e) => setVar(i, { type: e.target.value })}>
                  {Object.entries(VAR_TYPES).map(([k, x]) => (
                    <option key={k} value={k}>
                      {x.label}
                    </option>
                  ))}
                </select>
                {t.item && <input className="input" aria-label="Name" list={`dl-${t.item}`} placeholder={`${t.item} name`} value={v.name} onChange={(e) => setVar(i, { name: e.target.value })} />}
                {t.data === 'value' && <input className="input" aria-label="Value" placeholder="value" value={v.dataString ?? ''} onChange={(e) => setVar(i, { dataString: e.target.value, num1: 3 })} />}
                {t.data === 'aspect' && <input className="input" aria-label="Aspect" placeholder="aspect" value={v.dataString ?? ''} onChange={(e) => setVar(i, { dataString: e.target.value })} />}
                {t.data === 'clock' && (
                  <>
                    <input className="input" type="time" aria-label="From" value={hhmm(v.num1)} onChange={(e) => setVar(i, { num1: minutes(e.target.value) })} />
                    <span className="small">to</span>
                    <input className="input" type="time" aria-label="To" value={hhmm(v.num2)} onChange={(e) => setVar(i, { num2: minutes(e.target.value) })} />
                  </>
                )}
                <label className="toggle-row" title="Changes of this condition trigger the actions">
                  <input type="checkbox" aria-label="Triggers" checked={v.trigger} onChange={(e) => setVar(i, { trigger: e.target.checked })} />
                  <span className="small">triggers</span>
                </label>
              </>
            ) : (
              <span className="small">{v.description} <span className="muted">(edit in PanelPro)</span></span>
            )}
            <button className="btn ghost" aria-label={`Remove R${i + 1}`} onClick={() => setVars(vars.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        )
      })}
      <div>
        <button
          className="btn ghost"
          onClick={() => setVars([...vars, { not: false, operator: vars.length ? 'AND' : 'NONE', type: 'SENSOR_ACTIVE', name: '', dataString: null, num1: 0, num2: 0, trigger: true }])}
        >
          Add condition
        </button>
      </div>

      <div className="small">
        <strong>Then</strong>
      </div>
      {actions.map((a, i) => {
        const t = ACTION_TYPES[a.type]
        return (
          <div key={i} className="row-wrap edit-row" role="group" aria-label={`Action ${i + 1}`}>
            {t ? (
              <>
                <select className="input" aria-label="When" value={a.option} onChange={(e) => setAction(i, { option: Number(e.target.value) })}>
                  {OPTIONS.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  aria-label="Action type"
                  value={a.type}
                  onChange={(e) => setAction(i, { type: e.target.value, actionData: ACTION_TYPES[e.target.value].states?.[0][0] ?? 0 })}
                >
                  {Object.entries(ACTION_TYPES).map(([k, x]) => (
                    <option key={k} value={k}>
                      {x.label}
                    </option>
                  ))}
                </select>
                {t.item && <input className="input" aria-label="Name" list={`dl-${t.item}`} placeholder={`${t.item} name`} value={a.deviceName} onChange={(e) => setAction(i, { deviceName: e.target.value })} />}
                {t.states && (
                  <select className="input" aria-label="To" value={a.actionData} onChange={(e) => setAction(i, { actionData: Number(e.target.value) })}>
                    {t.states.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
                {t.text && <input className="input" aria-label={t.text} placeholder={t.text.toLowerCase()} value={a.actionString ?? ''} onChange={(e) => setAction(i, { actionString: e.target.value })} />}
              </>
            ) : (
              <span className="small">{a.description} <span className="muted">(edit in PanelPro)</span></span>
            )}
            <button className="btn ghost" aria-label={`Remove action ${i + 1}`} onClick={() => setActions(actions.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        )
      })}
      <div>
        <button className="btn ghost" onClick={() => setActions([...actions, { option: 1, type: 'SET_TURNOUT', deviceName: '', actionData: 4, actionString: '' }])}>
          Add action
        </button>
      </div>

      <label className="toggle-row">
        <input type="checkbox" checked={trigger} onChange={(e) => setTrigger(e.target.checked)} />
        <span className="small">Only act when the result changes (JMRI's "trigger on change")</span>
      </label>
      <div className="row-end">
        <button className="btn" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary" onClick={save}>
          Save conditional
        </button>
      </div>
    </div>
  )
}
