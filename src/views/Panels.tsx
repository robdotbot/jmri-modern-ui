import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ACTIVE, CLOSED, HEAD, INACTIVE, OFF, ON, THROWN } from '../jmri/protocol.ts'
import { javaColor, parsePanel, segmentPath, type LayoutModel, type PanelListItem, type PanelModel, type Positionable, type TextStyle } from '../jmri/panel.ts'
import { KEYS, useClient, useJmri, useStored } from '../state.tsx'

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
  const [model, setModel] = useState<PanelModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<'fit' | number>('fit')
  const [fit, setFit] = useState(1)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // The servlet labels the XML as JSON; read it as text.
    const url = item.url.includes('format=') ? item.url : `${item.url}${item.url.includes('?') ? '&' : '?'}format=xml`
    fetch(client.url(url))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((xml) => setModel(parsePanel(xml)))
      .catch((e) => setError(e.message))
  }, [client, item.url])

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

  return (
    <section className="card panel-card" aria-label={`Panel ${item.userName}`}>
      <div className="row-wrap panel-toolbar">
        <strong>{item.userName}</strong>
        <span className="muted small">{ROUTE_TYPE[item.type] ?? item.type}</span>
        {!model.controlling && <span className="pill">View only</span>}
        <span className="spacer" />
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
      <div className="panel-scroll" ref={box}>
        <div className="panel-stage" style={{ width: model.width * scale, height: model.height * scale }}>
          <div
            className="panel-canvas"
            data-testid="panel-canvas"
            style={{ width: model.width, height: model.height, transform: `scale(${scale})`, background: model.background ?? '#ffffff' }}
          >
            {model.layout && <LayoutTrack layout={model.layout} control={model.controlling} />}
            {model.items.map((it, i) => (
              <Item key={i} it={it} />
            ))}
          </div>
        </div>
      </div>
    </section>
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
