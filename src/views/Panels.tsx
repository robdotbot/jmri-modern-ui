import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ACTIVE, CLOSED, HEAD, INACTIVE, OFF, ON, THROWN } from '../jmri/protocol.ts'
import { javaColor, nextSlipState, parsePanel, segmentPath, slipState, type LayoutModel, type PanelListItem, type PanelModel, type Positionable, type SlipState, type TextStyle } from '../jmri/panel.ts'
import { KEYS, useClient, useJmri, useStored, useToast } from '../state.tsx'
import { StoreConfig } from './StoreConfig.tsx'

const ROUTE_TYPE: Record<string, string> = { Layout: 'Layout Editor', Panel: 'Panel Editor', 'Control Panel': 'Control Panel', Switchboard: 'Switchboard' }

export function PanelsPage() {
  const client = useClient()
  const conn = useJmri((s) => s.conn)
  const [panels, setPanels] = useState<PanelListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useStored<string | null>(KEYS.panel, null)

  useEffect(() => {
    if (conn !== 'open') return
    fetch(client.url('/panel/?format=json'))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((list: { data: { name: string; userName: string; type: PanelListItem['type']; URL?: string; url?: string } }[]) =>
        setPanels(list.map(({ data }) => ({ name: data.name, userName: data.userName, type: data.type, url: data.URL ?? data.url ?? `/panel/${data.name}?format=xml` }))),
      )
      .catch((e) => setError(e.message))
  }, [client, conn])

  const selected = panels?.find((p) => p.name === current) ?? panels?.[0]

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-head">
        <h1>Panels</h1>
        {panels && panels.length > 0 && (
          <div className="segmented scroll-x" role="group" aria-label="Panel">
            {panels.map((p) => (
              <button key={p.name} aria-pressed={selected?.name === p.name} onClick={() => setCurrent(p.name)}>
                {p.userName}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <div className="banner danger">Couldn't list JMRI's panels: {error}</div>}
      {panels && panels.length === 0 && (
        <div className="card empty">
          <p style={{ fontWeight: 600, color: 'var(--text)' }}>No panels are open in JMRI</p>
          <p>
            Panels come from PanelPro: open your panel file there (or add it to Start Up) and it appears here. Panels
            can't be shown when JMRI runs without a screen.
          </p>
        </div>
      )}
      {selected && <PanelView key={selected.name} item={selected} />}
    </div>
  )
}

function PanelView({ item }: { item: PanelListItem }) {
  const client = useClient()
  const toast = useToast()
  const addon = useJmri((s) => s.addon)
  const [model, setModel] = useState<PanelModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<'fit' | number>('fit')
  const [fit, setFit] = useState(1)
  const [editing, setEditing] = useState(false)
  const [reload, setReload] = useState(0)
  const [selected, setSelected] = useState<Positionable | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // The servlet labels the XML as JSON; read it as text.
    const url = item.url.includes('format=') ? item.url : `${item.url}${item.url.includes('?') ? '&' : '?'}format=xml`
    fetch(client.url(url), { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((xml) => setModel(parsePanel(xml)))
      .catch((e) => setError(e.message))
  }, [client, item.url, reload])

  useLayoutEffect(() => {
    if (!model || !box.current) return
    const el = box.current
    const update = () => setFit(Math.min(2, el.clientWidth / model.width))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [model])

  if (error) return <div className="banner danger">Couldn't load {item.userName}: {error}</div>
  if (!model) return <div className="muted">Loading {item.userName}…</div>
  const scale = zoom === 'fit' ? fit : zoom
  // The servlet's panel name is the window title, which the list gives as userName.
  const panelEdit = async (edit: Record<string, unknown>) => {
    try {
      await client.panelEdit(item.userName, edit)
      return true
    } catch (e) {
      toast((e as Error).message)
      return false
    } finally {
      setReload((n) => n + 1)
    }
  }
  const target = (it: Positionable) => ({ tag: it.tag, x: it.x, y: it.y, ...('bean' in it ? { bean: it.bean } : {}) })

  return (
    <section className="card panel-card" aria-label={`Panel ${item.userName}`}>
      <div className="row-wrap panel-toolbar">
        <strong>{item.userName}</strong>
        <span className="muted small">{ROUTE_TYPE[item.type] ?? item.type}</span>
        {!model.controlling && !editing && <span className="pill">View only</span>}
        <span className="spacer" />
        {editing && <StoreConfig />}
        {addon && (
          <button
            className={`btn${editing ? ' primary' : ''}`}
            aria-pressed={editing}
            onClick={() => {
              setEditing(!editing)
              setSelected(null)
            }}
          >
            {editing ? 'Done editing' : 'Edit'}
          </button>
        )}
        <div className="segmented" role="group" aria-label="Zoom">
          <button aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>
            Fit
          </button>
          {[1, 1.5, 2].map((z) => (
            <button key={z} aria-pressed={zoom === z} onClick={() => setZoom(z)}>
              {z * 100}%
            </button>
          ))}
        </div>
      </div>
      {editing && (
        <EditBar
          selected={selected}
          layout={!!model.layout}
          onAdd={(kind, value) => {
            const at = box.current ? { x: Math.round(box.current.scrollLeft / scale) + 40, y: Math.round(box.current.scrollTop / scale) + 40 } : { x: 40, y: 40 }
            return panelEdit({ op: 'add', kind, ...(kind === 'label' ? { text: value } : { bean: value }), ...at })
          }}
          onDelete={() => selected && panelEdit({ op: 'delete', target: target(selected) }).then(() => setSelected(null))}
          onText={(text) => selected && panelEdit({ op: 'text', target: target(selected), text }).then(() => setSelected(null))}
        />
      )}
      <div className="panel-scroll" ref={box}>
        <div className="panel-stage" style={{ width: model.width * scale, height: model.height * scale }}>
          <div
            className={`panel-canvas${editing ? ' editing' : ''}`}
            data-testid="panel-canvas"
            style={{ width: model.width, height: model.height, transform: `scale(${scale})`, background: model.background ?? '#ffffff' }}
            onPointerDown={(e) => editing && e.target === e.currentTarget && setSelected(null)}
          >
            {model.layout && <LayoutTrack layout={model.layout} control={model.controlling && !editing} />}
            {model.items.map((it, i) =>
              editing ? (
                <Draggable
                  key={`${reload}-${i}`}
                  scale={scale}
                  selected={selected === it}
                  label={`${it.kind} ${'bean' in it ? it.bean : (it as { text?: string }).text ?? ''}`.trim()}
                  onSelect={() => setSelected(it)}
                  onDrop={(dx, dy) => panelEdit({ op: 'move', target: target(it), x: Math.round(it.x + dx), y: Math.round(it.y + dy) })}
                >
                  <Item it={{ ...it, ...('control' in it ? { control: false } : {}) } as Positionable} />
                </Draggable>
              ) : (
                <Item key={i} it={it} />
              ),
            )}
            {editing && model.layout && (
              <TrackHandles key={reload} layout={model.layout} scale={scale} onDrop={(ident, x, y) => panelEdit({ op: 'moveTrack', ident, x, y })} />
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------- editing ----------

/** Drag with the pointer, or select with a click. Offsets are in panel units. */
function useDrag(scale: number, onDrop: (dx: number, dy: number) => void, onClick?: () => void) {
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      start.current = { x: e.clientX, y: e.clientY, moved: false }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current
      if (!s) return
      const dx = (e.clientX - s.x) / scale
      const dy = (e.clientY - s.y) / scale
      if (!s.moved && Math.hypot(dx, dy) * scale < 4) return
      s.moved = true
      setOffset({ x: dx, y: dy })
    },
    onPointerUp: () => {
      const s = start.current
      start.current = null
      if (s?.moved && offset) onDrop(offset.x, offset.y)
      else {
        setOffset(null)
        onClick?.()
      }
    },
  }
  return { offset, handlers }
}

function Draggable({
  scale,
  selected,
  label,
  onSelect,
  onDrop,
  children,
}: {
  scale: number
  selected: boolean
  label: string
  onSelect: () => void
  onDrop: (dx: number, dy: number) => void
  children: React.ReactNode
}) {
  const { offset, handlers } = useDrag(scale, onDrop, onSelect)
  return (
    // A zero-size wrapper: the item positions itself; events bubble here and the offset moves it while dragging.
    <div
      className={`panel-drag${selected ? ' selected' : ''}`}
      role="button"
      aria-label={`Move ${label}`}
      aria-pressed={selected}
      style={{ transform: offset ? `translate(${offset.x}px, ${offset.y}px)` : undefined }}
      {...handlers}
    >
      {children}
    </div>
  )
}

/** Handles for Layout Editor track that can move: turnouts, slips, turntables, anchor points. */
function TrackHandles({ layout, scale, onDrop }: { layout: LayoutModel; scale: number; onDrop: (ident: string, x: number, y: number) => void }) {
  const handles = [
    ...layout.turnouts.map((t) => ({ ident: t.ident, at: t.center, what: `turnout ${t.ident}` })),
    ...layout.slips.map((t) => ({ ident: t.ident, at: t.center, what: `slip ${t.ident}` })),
    ...layout.turntables.map((t) => ({ ident: t.ident, at: t.center, what: `turntable ${t.ident}` })),
    ...layout.points.map((p) => ({ ident: p.ident, at: { x: p.x, y: p.y }, what: `anchor ${p.ident}` })),
  ]
  return (
    <svg className="panel-handles" width="100%" height="100%">
      {handles.map((h) => (
        <Handle key={h.ident} h={h} scale={scale} onDrop={onDrop} />
      ))}
    </svg>
  )
}

function Handle({ h, scale, onDrop }: { h: { ident: string; at: { x: number; y: number }; what: string }; scale: number; onDrop: (ident: string, x: number, y: number) => void }) {
  const { offset, handlers } = useDrag(scale, (dx, dy) => onDrop(h.ident, Math.round(h.at.x + dx), Math.round(h.at.y + dy)))
  return (
    <circle
      className="panel-handle"
      role="button"
      aria-label={`Move ${h.what}`}
      cx={h.at.x + (offset?.x ?? 0)}
      cy={h.at.y + (offset?.y ?? 0)}
      r={Math.max(5, 7 / scale)}
      {...handlers}
    />
  )
}

const ADD_KINDS: [string, string, string | null][] = [
  ['label', 'Text label', null],
  ['sensor', 'Sensor icon', 'sensor'],
  ['turnout', 'Turnout icon', 'turnout'],
  ['light', 'Light icon', 'light'],
  ['signalMast', 'Signal mast', 'signalMast'],
  ['memory', 'Memory value', 'memory'],
]

function EditBar({
  selected,
  layout,
  onAdd,
  onDelete,
  onText,
}: {
  selected: Positionable | null
  layout: boolean
  onAdd: (kind: string, value: string) => Promise<boolean>
  onDelete: () => void
  onText: (text: string) => void
}) {
  const beans = useJmri((s) => s.beans)
  const [kind, setKind] = useState('label')
  const [value, setValue] = useState('')
  const [text, setText] = useState<string | null>(null)
  const list = ADD_KINDS.find((k) => k[0] === kind)?.[2]
  const isLabel = selected?.kind === 'label' && !!selected.text
  return (
    <div className="row-wrap panel-editbar">
      <form
        className="row-wrap"
        onSubmit={async (e) => {
          e.preventDefault()
          if (value.trim() && (await onAdd(kind, value.trim()))) setValue('')
        }}
      >
        <select className="input" aria-label="Add" value={kind} onChange={(e) => setKind(e.target.value)}>
          {ADD_KINDS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <input
          className="input"
          aria-label={list ? 'Name' : 'Text'}
          placeholder={list ? `${kind} name` : 'Label text'}
          list={list ? `pe-${list}` : undefined}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn">Add</button>
        {list && (
          <datalist id={`pe-${list}`}>
            {Object.values(beans[list as keyof typeof beans] ?? {}).map((b) => {
              const bean = b as { name: string; userName?: string }
              return <option key={bean.name} value={bean.userName || bean.name} />
            })}
          </datalist>
        )}
      </form>
      <span className="spacer" />
      {selected ? (
        <div className="row-wrap">
          <span className="small">
            Selected: <strong>{selected.kind === 'label' ? (selected.text ?? 'image') : selected.bean}</strong>
          </span>
          {isLabel &&
            (text == null ? (
              <button className="btn ghost" onClick={() => setText(selected.text ?? '')}>
                Change text
              </button>
            ) : (
              <form
                className="row-wrap"
                onSubmit={(e) => {
                  e.preventDefault()
                  onText(text)
                  setText(null)
                }}
              >
                <input className="input" autoFocus aria-label="Label text" value={text} onChange={(e) => setText(e.target.value)} />
                <button className="btn primary">Save</button>
              </form>
            ))}
          <button className="btn ghost danger-text" onClick={onDelete}>
            Delete
          </button>
        </div>
      ) : (
        <span className="muted small">Drag items{layout ? ' and the round track handles' : ''} to move them; click one to select it.</span>
      )}
    </div>
  )
}

// ---------- layout editor track ----------

function LayoutTrack({ layout, control }: { layout: LayoutModel; control: boolean }) {
  const client = useClient()
  const layoutBlocks = useJmri((s) => s.beans.layoutBlock) as Record<string, { blockColor?: string }>
  const sensors = useJmri((s) => s.beans.sensor) as Record<string, { state?: number }>
  const turnouts = useJmri((s) => s.beans.turnout) as Record<string, { state?: number }>
  // JMRI doesn't push layout block colour changes, so derive occupancy from the block's sensor, which it does push.
  const color = (block: string | null) => {
    if (!block) return layout.colors.track
    const info = layout.blocks[block]
    if (info?.occupancySensor) {
      return sensors[info.occupancySensor]?.state === info.occupiedSense ? info.occupiedColor : info.trackColor
    }
    const pushed = layoutBlocks[block]?.blockColor
    return pushed ? javaColor(pushed) : (info?.trackColor ?? layout.colors.track)
  }
  const width = (mainline: boolean, block: string | null) =>
    block ? (mainline ? layout.trackWidth.mainBlock : layout.trackWidth.sideBlock) : mainline ? layout.trackWidth.main : layout.trackWidth.side

  return (
    <svg className="panel-track" width="100%" height="100%" aria-hidden="false">
      {layout.segments
        .filter((s) => !s.hidden)
        .map((s) => (
          <path
            key={s.ident}
            data-block={s.block ?? undefined}
            d={segmentPath(s)}
            fill="none"
            stroke={color(s.block)}
            strokeWidth={width(s.mainline, s.block)}
            strokeDasharray={s.dashed ? '6 4' : undefined}
            strokeLinecap="round"
          />
        ))}
      {layout.turnouts
        .filter((t) => !t.hidden)
        .map((t) => {
          const state = t.turnout ? turnouts[t.turnout]?.state : undefined
          const known = state === CLOSED || state === THROWN
          const continuing = state === t.continuing
          const w = layout.trackWidth.mainBlock
          const leg = (to: { x: number; y: number }, block: string | null, on: boolean) =>
            on || layout.drawUnselectedLeg ? (
              <line x1={t.center.x} y1={t.center.y} x2={to.x} y2={to.y} stroke={color(block)} strokeWidth={on ? w : 1} strokeLinecap="round" opacity={on ? 1 : 0.55} />
            ) : null
          const r = Math.max(6, layout.circleSize * 3)
          const toggle = () => {
            if (!t.turnout) return
            const next = state === CLOSED ? THROWN : CLOSED
            client.setBeanState('turnout', t.turnout, next)
            if (t.secondTurnout) client.setBeanState('turnout', t.secondTurnout, t.secondInverted ? (next === CLOSED ? THROWN : CLOSED) : next)
          }
          return (
            <g key={t.ident} data-turnout={t.turnout ?? undefined} data-state={state ?? 0}>
              <line x1={t.a.x} y1={t.a.y} x2={t.center.x} y2={t.center.y} stroke={color(t.blocks.a)} strokeWidth={w} strokeLinecap="round" />
              {leg(t.b, t.blocks.b, !known || continuing)}
              {leg(t.c, t.blocks.c, !known || !continuing)}
              {t.type.includes('XOVER') && leg(t.d, t.blocks.d, !known || continuing)}
              {layout.turnoutCircles && (
                <circle
                  cx={t.center.x}
                  cy={t.center.y}
                  r={layout.circleSize * 2.5}
                  fill="none"
                  stroke={state === THROWN ? layout.colors.circleThrown : layout.colors.circle}
                  strokeWidth={1}
                />
              )}
              {control && t.turnout && !t.disabled && (
                <circle
                  className="panel-hit"
                  role="button"
                  aria-label={`Turnout ${t.turnout}: ${state === CLOSED ? 'closed' : state === THROWN ? 'thrown' : 'unknown'}`}
                  tabIndex={0}
                  cx={t.center.x}
                  cy={t.center.y}
                  r={r}
                  onClick={toggle}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle())}
                />
              )}
            </g>
          )
        })}
      {layout.slips
        .filter((sl) => !sl.hidden)
        .map((sl) => {
          const a = sl.turnout ? turnouts[sl.turnout]?.state : undefined
          const b = sl.turnoutB ? turnouts[sl.turnoutB]?.state : undefined
          const current = slipState(sl, a, b)
          const w = layout.trackWidth.mainBlock
          const routes: [SlipState, string, string | null][] = [
            ['AC', `M${sl.a.x},${sl.a.y} L${sl.c.x},${sl.c.y}`, sl.blocks.a],
            ['BD', `M${sl.b.x},${sl.b.y} L${sl.d.x},${sl.d.y}`, sl.blocks.b],
            ['AD', `M${sl.a.x},${sl.a.y} Q${sl.center.x},${sl.center.y} ${sl.d.x},${sl.d.y}`, sl.blocks.a],
            ...(sl.double ? [['BC', `M${sl.b.x},${sl.b.y} Q${sl.center.x},${sl.center.y} ${sl.c.x},${sl.c.y}`, sl.blocks.b] as [SlipState, string, string | null]] : []),
          ]
          const set = (side: 'left' | 'right') => {
            const next = nextSlipState(sl, current, side)
            const [sa, sb] = sl.states[next] ?? []
            if (sl.turnout && sa) client.setBeanState('turnout', sl.turnout, sa)
            if (sl.turnoutB && sb) client.setBeanState('turnout', sl.turnoutB, sb)
          }
          const sideAt = (p: { x: number; y: number }, q: { x: number; y: number }) => ({
            x: sl.center.x + ((p.x + q.x) / 2 - sl.center.x) * 0.5,
            y: sl.center.y + ((p.y + q.y) / 2 - sl.center.y) * 0.5,
          })
          const r = Math.max(6, layout.circleSize * 3)
          return (
            <g key={sl.ident} data-slip={sl.ident} data-route={current ?? 'unknown'}>
              {routes.map(([k, d, block]) =>
                current === k || current == null || layout.drawUnselectedLeg ? (
                  <path key={k} d={d} fill="none" stroke={color(block)} strokeWidth={current === k ? w : 1} opacity={current === k ? 1 : 0.55} strokeLinecap="round" />
                ) : null,
              )}
              {layout.turnoutCircles &&
                [sideAt(sl.a, sl.b), sideAt(sl.c, sl.d)].map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={layout.circleSize * 2.5} fill="none" stroke={layout.colors.circle} strokeWidth={1} />
                ))}
              {control &&
                (sl.turnout || sl.turnoutB) &&
                !sl.disabled &&
                (['left', 'right'] as const).map((side) => {
                  const p = side === 'left' ? sideAt(sl.a, sl.b) : sideAt(sl.c, sl.d)
                  return (
                    <circle
                      key={side}
                      className="panel-hit"
                      role="button"
                      aria-label={`Slip ${sl.ident} ${side} side: ${current ? `${current[0]} to ${current[1]}` : 'unknown'}`}
                      tabIndex={0}
                      cx={p.x}
                      cy={p.y}
                      r={r}
                      onClick={() => set(side)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), set(side))}
                    />
                  )
                })}
            </g>
          )
        })}
      {layout.turntables.map((tt) => {
        // JMRI's position: the ray whose turnout is in that ray's state.
        const position = tt.turnoutControlled ? tt.rays.find((r) => r.turnout && turnouts[r.turnout]?.state === r.turnoutState) : undefined
        const pit = color(tt.block)
        const r = Math.max(6, layout.circleSize * 3)
        return (
          <g key={tt.ident} data-turntable={tt.ident} data-position={position?.index ?? -1}>
            <circle cx={tt.center.x} cy={tt.center.y} r={tt.radius} fill="none" stroke={layout.colors.track} strokeWidth={2} />
            <circle cx={tt.center.x} cy={tt.center.y} r={Math.max(tt.radius / 4, 4)} fill="none" stroke={layout.colors.track} strokeWidth={2} />
            {tt.rays.map((ray) => (
              <line key={ray.index} x1={ray.edge.x} y1={ray.edge.y} x2={ray.end.x} y2={ray.end.y} stroke={pit} strokeWidth={layout.trackWidth.sideBlock} strokeLinecap="round" />
            ))}
            {position && (
              // Asymmetric bridge, long end towards the selected ray, as JMRI draws it.
              <line
                className="turntable-bridge"
                x1={tt.center.x - (position.edge.x - tt.center.x) * 0.8}
                y1={tt.center.y - (position.edge.y - tt.center.y) * 0.8}
                x2={position.edge.x}
                y2={position.edge.y}
                stroke={pit}
                strokeWidth={layout.trackWidth.mainBlock}
                strokeLinecap="round"
              />
            )}
            {control &&
              tt.rays
                .filter((ray) => ray.turnout && !ray.disabled)
                .map((ray) => (
                  <circle
                    key={ray.index}
                    className="panel-hit"
                    role="button"
                    aria-label={`Turntable ${tt.ident} ray ${ray.index}${position === ray ? ' (selected)' : ''}`}
                    aria-pressed={position === ray}
                    tabIndex={0}
                    cx={ray.end.x}
                    cy={ray.end.y}
                    r={r}
                    onClick={() => client.setBeanState('turnout', ray.turnout!, ray.turnoutState)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), client.setBeanState('turnout', ray.turnout!, ray.turnoutState))}
                  />
                ))}
          </g>
        )
      })}
    </svg>
  )
}

// ---------- positionables ----------

function textCss(s: TextStyle): CSSProperties {
  return {
    fontSize: s.size,
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? 'italic' : undefined,
    color: s.color ?? '#000',
    background: s.background,
    width: s.width,
    height: s.height,
    lineHeight: s.height ? `${s.height}px` : undefined,
    textAlign: s.justify === 'centre' ? 'center' : s.justify,
    padding: s.background ? '0 4px' : undefined,
  }
}

function Img({ url, degrees = 0, scale = 1 }: { url: string; degrees?: number; scale?: number }) {
  const client = useClient()
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  return (
    <img
      src={client.url(url)}
      alt=""
      draggable={false}
      onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      style={{
        width: size ? size.w * scale : undefined,
        height: size ? size.h * scale : undefined,
        transform: degrees ? `rotate(${degrees}deg)` : undefined,
        transformOrigin: 'center',
        display: 'block',
      }}
    />
  )
}

const SENSOR_ICON: Record<number, string> = { [ACTIVE]: 'active', [INACTIVE]: 'inactive', 8: 'inconsistent' }
const TURNOUT_ICON: Record<number, string> = { [CLOSED]: 'closed', [THROWN]: 'thrown', 8: 'inconsistent' }
const LIGHT_ICON: Record<number, string> = { [ON]: 'on', [OFF]: 'off', 8: 'inconsistent' }
const HEAD_ICON: Record<number, string> = {
  [HEAD.DARK]: 'dark',
  [HEAD.RED]: 'red',
  [HEAD.YELLOW]: 'yellow',
  [HEAD.GREEN]: 'green',
  [HEAD.FLASHRED]: 'flashred',
  [HEAD.FLASHYELLOW]: 'flashyellow',
  [HEAD.FLASHGREEN]: 'flashgreen',
  [HEAD.LUNAR]: 'lunar',
  [HEAD.FLASHLUNAR]: 'flashlunar',
}

function Item({ it }: { it: Positionable }) {
  const client = useClient()
  const beans = useJmri((s) => s.beans)
  const pos: CSSProperties = { left: it.x, top: it.y, zIndex: it.level }

  switch (it.kind) {
    case 'label':
      return (
        <div className="panel-item" style={pos}>
          {it.icon ? <Img {...it.icon} /> : <div style={textCss(it.style)}>{it.text}</div>}
        </div>
      )
    case 'sensor':
    case 'turnout':
    case 'light': {
      const state = (beans[it.kind][it.bean] as { state?: number } | undefined)?.state ?? 0
      const name = (it.kind === 'sensor' ? SENSOR_ICON : it.kind === 'turnout' ? TURNOUT_ICON : LIGHT_ICON)[state] ?? 'unknown'
      const ic = it.icons[name] ?? it.icons.unknown
      const next =
        it.kind === 'sensor' ? (state === ACTIVE ? INACTIVE : ACTIVE) : it.kind === 'turnout' ? (state === CLOSED ? THROWN : CLOSED) : state === ON ? OFF : ON
      const label = `${it.kind} ${it.bean}: ${name}`
      const content = it.text != null ? (
        <div style={{ ...textCss(it.style), ...(state === ACTIVE && it.kind === 'sensor' ? { outline: '2px solid currentColor' } : {}) }}>{it.text}</div>
      ) : ic ? (
        <Img {...ic} />
      ) : null
      if (!it.control) return <div className="panel-item" style={pos} title={label}>{content}</div>
      return (
        <button
          className="panel-item panel-button"
          style={pos}
          aria-label={label}
          data-state={state}
          onClick={it.momentary ? undefined : () => client.setBeanState(it.kind, it.bean, next)}
          onPointerDown={it.momentary ? () => client.setBeanState(it.kind, it.bean, ACTIVE) : undefined}
          onPointerUp={it.momentary ? () => client.setBeanState(it.kind, it.bean, INACTIVE) : undefined}
        >
          {content}
        </button>
      )
    }
    case 'signalMast': {
      const m = beans.signalMast[it.bean] as { aspect?: string; held?: boolean; lit?: boolean } | undefined
      const key = m?.held && it.icons.Held ? 'Held' : m && !m.lit && it.icons.Dark ? 'Dark' : (m?.aspect ?? 'Unknown')
      const ic = it.icons[key] ?? it.icons.Unknown
      const cycle = Object.keys(it.icons).filter((a) => !['Held', 'Dark', 'Unlit', 'Unknown'].includes(a))
      const click = () => {
        if (!m) return
        if (it.clickmode === 2) return client.setSignalMast(it.bean, m.held ? 'Stop' : 'Held')
        const i = cycle.indexOf(m.aspect ?? '')
        client.setSignalMast(it.bean, cycle[(i + 1) % cycle.length])
      }
      const content = ic ? <Img url={ic.url} degrees={it.degrees} scale={it.scale} /> : null
      if (!it.control || cycle.length === 0) return <div className="panel-item" style={pos} title={`${it.bean}: ${key}`}>{content}</div>
      return (
        <button className="panel-item panel-button" style={pos} aria-label={`Signal ${it.bean}: ${key}`} data-aspect={key} onClick={click}>
          {content}
        </button>
      )
    }
    case 'signalHead': {
      const h = beans.signalHead[it.bean] as { appearance?: number; held?: boolean; lit?: boolean } | undefined
      const key = h?.held ? 'held' : h && !h.lit ? 'dark' : (HEAD_ICON[h?.appearance ?? 0] ?? 'dark')
      const ic = it.icons[key] ?? it.icons.dark
      const order = [HEAD.RED, HEAD.YELLOW, HEAD.GREEN]
      const click = () => {
        if (!h) return
        if (it.clickmode === 2) return client.setSignalHead(it.bean, h.held ? HEAD.RED : HEAD.HELD)
        const i = order.indexOf((h.appearance ?? HEAD.RED) as (typeof order)[number])
        client.setSignalHead(it.bean, order[(i + 1) % order.length])
      }
      const content = ic ? <Img {...ic} /> : null
      if (!it.control) return <div className="panel-item" style={pos}>{content}</div>
      return (
        <button className="panel-item panel-button" style={pos} aria-label={`Signal head ${it.bean}: ${key}`} onClick={click}>
          {content}
        </button>
      )
    }
    case 'memory': {
      const v = (beans.memory[it.bean] as { value?: unknown } | undefined)?.value
      const text = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v)
      const st = it.states.find((s) => s.value === text)
      return (
        <div className="panel-item" style={pos} title={it.bean}>
          {st ? <Img {...st.icon} /> : <div style={{ ...textCss(it.style), minWidth: 12 }}>{text}</div>}
        </div>
      )
    }
  }
}
