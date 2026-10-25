// Parses the panel XML JMRI's /panel servlet produces (web/servlet/panel) into a renderable model.
// Covers Layout Editor track (points, turnouts, segments, blocks) and the common positionable icons.

export interface PanelListItem {
  name: string
  userName: string
  type: 'Panel' | 'Control Panel' | 'Layout' | 'Switchboard'
  url: string
}

export interface IconState {
  url: string
  degrees: number
  scale: number
}

export type Positionable =
  | { kind: 'label'; x: number; y: number; level: number; text?: string; icon?: IconState; style: TextStyle }
  | {
      kind: 'sensor' | 'turnout' | 'light'
      x: number
      y: number
      level: number
      bean: string
      icons: Record<string, IconState>
      text?: string
      style: TextStyle
      momentary: boolean
      control: boolean
    }
  | { kind: 'signalMast'; x: number; y: number; level: number; bean: string; icons: Record<string, IconState>; degrees: number; scale: number; clickmode: number; control: boolean }
  | { kind: 'signalHead'; x: number; y: number; level: number; bean: string; icons: Record<string, IconState>; clickmode: number; control: boolean }
  | { kind: 'memory'; x: number; y: number; level: number; bean: string; style: TextStyle; states: { value: string; icon: IconState }[] }

export interface TextStyle {
  size: number
  bold: boolean
  italic: boolean
  color?: string
  background?: string
  width?: number
  height?: number
  justify: 'left' | 'centre' | 'right'
}

export interface Point {
  x: number
  y: number
}

export interface LayoutTurnout {
  ident: string
  type: string
  center: Point
  a: Point
  b: Point
  c: Point
  d: Point
  turnout: string | null
  secondTurnout: string | null
  secondInverted: boolean
  continuing: number
  blocks: { a: string | null; b: string | null; c: string | null; d: string | null }
  disabled: boolean
  hidden: boolean
}

export interface TrackSegment {
  ident: string
  from: Point
  to: Point
  block: string | null
  mainline: boolean
  dashed: boolean
  hidden: boolean
  arc?: { angle: number; flip: boolean; circle: boolean }
  bezier?: Point[]
}

export interface LayoutBlockInfo {
  name: string
  occupancySensor: string | null
  /** Sensor state that means occupied (ACTIVE=2 normally). */
  occupiedSense: number
  trackColor: string
  occupiedColor: string
}

export interface LayoutModel {
  /** Keyed by layout block system name, as referenced by segments and turnouts. */
  blocks: Record<string, LayoutBlockInfo>
  trackWidth: { main: number; side: number; mainBlock: number; sideBlock: number }
  colors: { background: string; track: string; occupied: string; text: string; circle: string; circleThrown: string }
  turnoutCircles: boolean
  circleSize: number
  drawUnselectedLeg: boolean
  points: Point[]
  turnouts: LayoutTurnout[]
  segments: TrackSegment[]
}

export interface PanelModel {
  name: string
  width: number
  height: number
  controlling: boolean
  background?: string
  items: Positionable[]
  layout?: LayoutModel
}

/** Java AWT colour names JMRI writes (ColorUtil.colorToColorName). */
const JAVA_COLORS: Record<string, string> = {
  black: '#000000',
  darkgray: '#404040',
  gray: '#808080',
  lightgray: '#c0c0c0',
  white: '#ffffff',
  red: '#ff0000',
  pink: '#ffafaf',
  orange: '#ffc800',
  yellow: '#ffff00',
  green: '#00ff00',
  magenta: '#ff00ff',
  cyan: '#00ffff',
  blue: '#0000ff',
  track: '#404040',
}

export function javaColor(c: string | null | undefined, fallback = '#404040'): string {
  if (!c) return fallback
  if (c.startsWith('#')) return c
  return JAVA_COLORS[c.toLowerCase()] ?? fallback
}

const num = (el: Element, a: string, d = 0) => {
  const v = el.getAttribute(a)
  const n = v == null ? NaN : Number(v)
  return Number.isNaN(n) ? d : n
}
const yes = (el: Element, a: string) => ['yes', 'true'].includes((el.getAttribute(a) ?? '').toLowerCase())

/** Colour from red/green/blue attributes; JMRI names the background ones redBack/greenBack/blueBack. */
function rgb(el: Element, suffix = '') {
  const r = el.getAttribute(`red${suffix}`)
  if (r == null) return undefined
  return `rgb(${r}, ${el.getAttribute(`green${suffix}`) ?? 0}, ${el.getAttribute(`blue${suffix}`) ?? 0})`
}

function textStyle(el: Element): TextStyle {
  const style = num(el, 'style')
  return {
    size: num(el, 'size', 12),
    bold: (style & 1) === 1,
    italic: (style & 2) === 2,
    color: rgb(el),
    background: yes(el, 'hasBackground') ? rgb(el, 'Back') : undefined,
    width: num(el, 'fixedWidth') || undefined,
    height: num(el, 'fixedHeight') || undefined,
    justify: ((el.getAttribute('justification') ?? 'left') as TextStyle['justify']),
  }
}

function icon(el: Element | null): IconState | undefined {
  const url = el?.getAttribute('url')
  if (!el || !url) return undefined
  const rotation = Number(el.querySelector(':scope > rotation')?.textContent ?? 0)
  return { url, degrees: num(el, 'degrees') - rotation * 90, scale: num(el, 'scale', 1) }
}

function icons(el: Element, names: string[]): Record<string, IconState> {
  const out: Record<string, IconState> = {}
  for (const n of names) {
    const i = icon(el.querySelector(`:scope > ${n}`) ?? el.querySelector(`:scope > icons > ${n}`))
    if (i) out[n] = i
  }
  return out
}

export function parsePanel(xml: string): PanelModel {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const root = doc.documentElement
  if (root.nodeName !== 'panel') throw new Error('Not a JMRI panel document')
  const controlling = yes(root, 'controlling')
  const bg = root.querySelector(':scope > backgroundColor')
  const model: PanelModel = {
    name: root.getAttribute('name') ?? '',
    width: num(root, 'panelwidth') || num(root, 'width', 800),
    height: num(root, 'panelheight') || num(root, 'height', 600),
    controlling,
    background: bg ? (rgb(bg) ?? undefined) : root.getAttribute('backgroundcolor') ? javaColor(root.getAttribute('backgroundcolor')) : undefined,
    items: [],
  }

  const isLayout = root.getAttribute('paneltype') === 'LayoutPanel'
  const pointByKey = new Map<string, Point>()
  const turnouts: LayoutTurnout[] = []
  const rawSegments: Element[] = []
  const blocks: Record<string, LayoutBlockInfo> = {}

  for (const el of root.children) {
    const base = { x: num(el, 'x'), y: num(el, 'y'), level: num(el, 'level', 1) }
    const control = controlling && !yes(el, 'forcecontroloff')
    if (yes(el, 'hidden')) continue
    switch (el.nodeName) {
      case 'positionablelabel': {
        const i = icon(el.querySelector(':scope > icon'))
        const text = el.getAttribute('text') ?? undefined
        if (i || text) model.items.push({ kind: 'label', ...base, text: i ? undefined : text, icon: i, style: textStyle(el) })
        break
      }
      case 'sensoricon':
        model.items.push({
          kind: 'sensor',
          ...base,
          bean: el.getAttribute('id') ?? el.getAttribute('sensor') ?? '',
          icons: icons(el, ['active', 'inactive', 'unknown', 'inconsistent']),
          text: el.getAttribute('icon') === 'no' ? (el.getAttribute('text') ?? el.getAttribute('sensor') ?? '') : undefined,
          style: textStyle(el),
          momentary: yes(el, 'momentary'),
          control,
        })
        break
      case 'turnouticon':
        model.items.push({
          kind: 'turnout',
          ...base,
          bean: el.getAttribute('id') ?? el.getAttribute('turnout') ?? '',
          icons: icons(el, ['closed', 'thrown', 'unknown', 'inconsistent']),
          style: textStyle(el),
          momentary: yes(el, 'momentary'),
          control,
        })
        break
      case 'LightIcon':
      case 'lighticon':
        model.items.push({
          kind: 'light',
          ...base,
          bean: el.getAttribute('id') ?? el.getAttribute('light') ?? '',
          icons: icons(el, ['on', 'off', 'unknown', 'inconsistent']),
          style: textStyle(el),
          momentary: false,
          control,
        })
        break
      case 'signalmasticon': {
        const ic: Record<string, IconState> = {}
        for (const a of el.querySelectorAll(':scope > icons > *')) {
          const url = a.getAttribute('url')
          if (url) ic[a.getAttribute('aspect') ?? a.nodeName] = { url, degrees: 0, scale: 1 }
        }
        model.items.push({
          kind: 'signalMast',
          ...base,
          bean: el.getAttribute('id') ?? el.getAttribute('signalmast') ?? '',
          icons: ic,
          degrees: num(el, 'degrees'),
          scale: num(el, 'scale', 1),
          clickmode: num(el, 'clickmode'),
          control,
        })
        break
      }
      case 'signalheadicon':
        model.items.push({
          kind: 'signalHead',
          ...base,
          bean: el.getAttribute('id') ?? el.getAttribute('signalhead') ?? '',
          icons: icons(el, ['held', 'dark', 'red', 'yellow', 'green', 'flashred', 'flashyellow', 'flashgreen', 'lunar', 'flashlunar']),
          clickmode: num(el, 'clickmode'),
          control,
        })
        break
      case 'memoryicon':
        model.items.push({
          kind: 'memory',
          ...base,
          bean: el.getAttribute('id') ?? el.getAttribute('memory') ?? '',
          style: textStyle(el),
          states: [...el.querySelectorAll(':scope > memorystate')].flatMap((s) => {
            const i = icon(s)
            return i ? [{ value: s.getAttribute('value') ?? '', icon: i }] : []
          }),
        })
        break
      case 'positionablepoint': {
        const p = { x: num(el, 'x'), y: num(el, 'y') }
        pointByKey.set(`${el.getAttribute('ident')}.POS_POINT`, p)
        break
      }
      case 'layoutturnout': {
        const center = { x: num(el, 'xcen'), y: num(el, 'ycen') }
        const pt = (k: string): Point | null => (el.getAttribute(`x${k}`) != null ? { x: num(el, `x${k}`), y: num(el, `y${k}`) } : null)
        const b = pt('b') ?? center
        const c = pt('c') ?? center
        const type = el.getAttribute('type') ?? 'RH_TURNOUT'
        const mirror = (p: Point) => ({ x: 2 * center.x - p.x, y: 2 * center.y - p.y })
        // Older files only store B and C; derive the rest the way JMRI's web panel does.
        const xover = type.includes('XOVER')
        const a = pt('a') ?? (xover ? mirror(c) : mirror(b))
        const d = pt('d') ?? mirror(b)
        const ident = el.getAttribute('ident') ?? ''
        const t: LayoutTurnout = {
          ident,
          type,
          center,
          a,
          b,
          c,
          d,
          turnout: el.getAttribute('turnoutname'),
          secondTurnout: el.getAttribute('secondturnoutname'),
          secondInverted: yes(el, 'secondturnoutinverted'),
          continuing: num(el, 'continuing', 2),
          blocks: {
            a: el.getAttribute('blockname'),
            b: el.getAttribute('blockbname') ?? el.getAttribute('blockname'),
            c: el.getAttribute('blockcname') ?? el.getAttribute('blockname'),
            d: el.getAttribute('blockdname') ?? el.getAttribute('blockname'),
          },
          disabled: yes(el, 'disabled'),
          hidden: yes(el, 'hidden'),
        }
        turnouts.push(t)
        for (const k of ['A', 'B', 'C', 'D'] as const) pointByKey.set(`${ident}.TURNOUT_${k}`, t[k.toLowerCase() as 'a'])
        break
      }
      case 'levelxing': {
        const ident = el.getAttribute('ident') ?? ''
        for (const k of ['a', 'b', 'c', 'd']) {
          if (el.getAttribute(`x${k}`) != null) pointByKey.set(`${ident}.LEVEL_XING_${k.toUpperCase()}`, { x: num(el, `x${k}`), y: num(el, `y${k}`) })
        }
        break
      }
      case 'tracksegment':
        rawSegments.push(el)
        break
      case 'layoutblock': {
        const name = el.getAttribute('systemName') ?? ''
        blocks[name] = {
          name,
          occupancySensor: el.getAttribute('occupancysensor') || null,
          occupiedSense: num(el, 'occupiedsense', 2),
          trackColor: javaColor(el.getAttribute('trackcolor'), javaColor(root.getAttribute('defaulttrackcolor'))),
          occupiedColor: javaColor(el.getAttribute('occupiedcolor'), javaColor(root.getAttribute('defaultoccupiedtrackcolor'), '#ff0000')),
        }
        break
      }
    }
  }

  if (isLayout) {
    const segments: TrackSegment[] = []
    for (const el of rawSegments) {
      const from = pointByKey.get(`${el.getAttribute('connect1name')}.${el.getAttribute('type1')}`)
      const to = pointByKey.get(`${el.getAttribute('connect2name')}.${el.getAttribute('type2')}`)
      if (!from || !to) continue // e.g. slips/turntables we don't draw
      const seg: TrackSegment = {
        ident: el.getAttribute('ident') ?? '',
        from,
        to,
        block: el.getAttribute('blockname'),
        mainline: yes(el, 'mainline'),
        dashed: yes(el, 'dashed'),
        hidden: yes(el, 'hidden'),
      }
      if (yes(el, 'arc')) seg.arc = { angle: num(el, 'angle', 90), flip: yes(el, 'flip'), circle: yes(el, 'circle') }
      if (yes(el, 'bezier')) {
        seg.bezier = [...el.querySelectorAll('controlpoints > controlpoint')]
          .sort((p, q) => num(p, 'index') - num(q, 'index'))
          .map((p) => ({ x: num(p, 'x'), y: num(p, 'y') }))
      }
      segments.push(seg)
    }
    model.layout = {
      blocks,
      trackWidth: {
        main: num(root, 'mainlinetrackwidth', 2),
        side: num(root, 'sidelinetrackwidth', 1),
        mainBlock: num(root, 'mainlineblockwidth', 4),
        sideBlock: num(root, 'sidelineblockwidth', 2),
      },
      colors: {
        background: javaColor(root.getAttribute('backgroundcolor'), '#c0c0c0'),
        track: javaColor(root.getAttribute('defaulttrackcolor'), '#404040'),
        occupied: javaColor(root.getAttribute('defaultoccupiedtrackcolor'), '#ff0000'),
        text: javaColor(root.getAttribute('defaulttextcolor'), '#000000'),
        circle: javaColor(root.getAttribute('turnoutcirclecolor'), '#000000'),
        circleThrown: javaColor(root.getAttribute('turnoutcirclethrowncolor'), '#000000'),
      },
      turnoutCircles: yes(root, 'turnoutcircles'),
      circleSize: num(root, 'turnoutcirclesize', 2),
      drawUnselectedLeg: yes(root, 'turnoutdrawunselectedleg'),
      points: [...pointByKey.entries()].filter(([k]) => k.endsWith('.POS_POINT')).map(([, p]) => p),
      turnouts,
      segments,
    }
  }
  model.items.sort((a, b) => a.level - b.level)
  return model
}

/** SVG path for a segment: straight, circular arc (JMRI's angle/flip) or bezier through its control points. */
export function segmentPath(s: TrackSegment): string {
  const { from: p, to: q } = s
  if (s.bezier && s.bezier.length > 0) {
    const pts = [p, ...s.bezier, q]
    if (pts.length === 3) return `M${p.x},${p.y} Q${pts[1].x},${pts[1].y} ${q.x},${q.y}`
    if (pts.length === 4) return `M${p.x},${p.y} C${pts[1].x},${pts[1].y} ${pts[2].x},${pts[2].y} ${q.x},${q.y}`
    // Higher-order bezier: sample with de Casteljau.
    const at = (t: number): Point => {
      let ps = pts
      while (ps.length > 1) ps = ps.slice(1).map((pt, i) => ({ x: ps[i].x + (pt.x - ps[i].x) * t, y: ps[i].y + (pt.y - ps[i].y) * t }))
      return ps[0]
    }
    const samples = Array.from({ length: 33 }, (_, i) => at(i / 32))
    return 'M' + samples.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' L')
  }
  if (s.arc) {
    const chord = Math.hypot(q.x - p.x, q.y - p.y)
    const angle = (Math.min(Math.max(s.arc.angle, 1), 359) * Math.PI) / 180
    const r = chord / (2 * Math.sin(angle / 2))
    return `M${p.x},${p.y} A${r},${r} 0 ${angle > Math.PI ? 1 : 0} ${s.arc.flip ? 0 : 1} ${q.x},${q.y}`
  }
  return `M${p.x},${p.y} L${q.x},${q.y}`
}
