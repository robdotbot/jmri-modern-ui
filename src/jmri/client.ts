import {
  BEAN_TYPES,
  type BeanType,
  type Hello,
  type Message,
  type Power,
  type RosterEntry,
  type RosterGroup,
  type SystemConnection,
  type ThrottleStatus,
  type TimeData,
} from './protocol.ts'

export type ConnState = 'connecting' | 'open' | 'closed'

export interface JmriError {
  code: number
  message: string
}

/** Everything the UI renders. Replaced (never mutated) on each change so React can compare by reference. */
export interface Snapshot {
  conn: ConnState
  hello: Hello | null
  beans: Record<BeanType, Record<string, Record<string, unknown>>>
  power: Record<string, Power> // keyed by name
  roster: Record<string, RosterEntry>
  rosterGroups: RosterGroup[]
  connections: SystemConnection[]
  time: TimeData | null
  /** Local Date.now() when `time` arrived, for interpolating between fast-minute pushes. */
  timeAt: number
  throttles: Record<string, ThrottleStatus & { acquired: boolean }>
  lastError: (JmriError & { at: number }) | null
}

const emptyBeans = () =>
  Object.fromEntries(BEAN_TYPES.map((t) => [t, {}])) as Snapshot['beans']

export interface ThrottleRequest {
  name: string
  address?: number
  isLongAddress?: boolean
  rosterEntry?: string
  prefix?: string
}

/** Resolve the JMRI base URL: an explicit setting, else the page's own origin (served by JMRI or the dev proxy). */
export function resolveBase(setting: string | null): URL {
  if (setting) {
    const s = /^https?:\/\//.test(setting) ? setting : `http://${setting}`
    return new URL(s.endsWith('/') ? s : s + '/')
  }
  return new URL('/', location.href)
}

export class JmriClient {
  private ws: WebSocket | null = null
  private listeners = new Set<() => void>()
  private snap: Snapshot
  private pingTimer: number | undefined
  private retryTimer: number | undefined
  private retryDelay = 500
  private stopped = false
  private nextId = 1
  /** Throttles the UI wants held; re-acquired after a reconnect. */
  private wanted = new Map<string, ThrottleRequest>()
  /** Beans we have sent a `get` for on the current socket (a `get` is what subscribes). */
  private watched = new Set<string>()
  readonly base: URL

  constructor(base: URL) {
    this.base = base
    this.snap = {
      conn: 'connecting',
      hello: null,
      beans: emptyBeans(),
      power: {},
      roster: {},
      rosterGroups: [],
      connections: [],
      time: null,
      timeAt: 0,
      throttles: {},
      lastError: null,
    }
  }

  // ---------- store ----------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = () => this.snap

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  /** Absolute URL for a server-relative path such as a roster image. */
  url(path: string) {
    return new URL(path.replace(/^\//, ''), this.base).toString()
  }

  // ---------- socket lifecycle ----------

  start() {
    this.stopped = false
    this.open()
  }

  stop() {
    this.stopped = true
    clearTimeout(this.retryTimer)
    clearInterval(this.pingTimer)
    this.ws?.close()
  }

  private open() {
    const wsUrl = new URL('json/', this.base)
    wsUrl.protocol = this.base.protocol === 'https:' ? 'wss:' : 'ws:'
    this.set({ conn: 'connecting' })
    const ws = new WebSocket(wsUrl)
    this.ws = ws
    ws.onmessage = (e) => {
      try {
        this.receive(JSON.parse(e.data))
      } catch (err) {
        console.warn('Unparseable JMRI message', e.data, err)
      }
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      clearInterval(this.pingTimer)
      this.watched.clear()
      // Server releases our throttles when the socket drops; mark them pending until re-acquired.
      const throttles = Object.fromEntries(
        Object.entries(this.snap.throttles).map(([k, t]) => [k, { ...t, acquired: false }]),
      )
      this.set({ conn: 'closed', throttles })
      if (!this.stopped) {
        this.retryTimer = window.setTimeout(() => this.open(), this.retryDelay)
        this.retryDelay = Math.min(this.retryDelay * 2, 10000)
      }
    }
    // The server sends hello on connect; we bootstrap from there (see onHello).
  }

  private send(msg: Message) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  private onHello(hello: Hello) {
    this.retryDelay = 500
    this.set({ conn: 'open', hello })
    clearInterval(this.pingTimer)
    // Server idles out at heartbeatInterval*1.1; hello.heartbeat is interval*0.9.
    this.pingTimer = window.setInterval(() => this.send({ type: 'ping' }), Math.max(1000, hello.heartbeat || 13500))
    // Note: never send `hello` back — it resets the connection's services and drops throttles.
    for (const t of BEAN_TYPES) this.send({ type: t, method: 'list' })
    this.send({ type: 'power', method: 'list' })
    this.send({ type: 'roster', method: 'list' })
    this.send({ type: 'rosterGroups', method: 'list' })
    this.send({ type: 'systemConnection', method: 'list' })
    this.send({ type: 'time' })
    for (const req of this.wanted.values()) this.send({ type: 'throttle', data: req })
  }

  // ---------- inbound ----------

  private receive(msg: Message | Message[]) {
    if (Array.isArray(msg)) return this.receiveList(msg)
    if (msg.type === 'list' && Array.isArray(msg.data)) return this.receiveList(msg.data as Message[])
    const data = (msg.data ?? {}) as Record<string, unknown>
    switch (msg.type) {
      case 'hello':
        return this.onHello(data as unknown as Hello)
      case 'pong':
        return
      case 'goodbye':
        return this.ws?.close()
      case 'error':
        return this.set({ lastError: { ...(data as unknown as JmriError), at: Date.now() } })
      case 'power':
        return this.set({ power: { ...this.snap.power, [String(data.name)]: data as unknown as Power } })
      case 'time':
        return this.set({ time: data as unknown as TimeData, timeAt: Date.now() })
      case 'rosterEntry':
        return this.putRoster([data as unknown as RosterEntry])
      case 'roster':
        return this.rosterDelta(data)
      case 'rosterGroup':
        return this.send({ type: 'rosterGroups', method: 'list' })
      case 'throttle':
        return this.throttleUpdate(data as unknown as ThrottleStatus & { release?: unknown })
      default:
        if ((BEAN_TYPES as readonly string[]).includes(msg.type)) this.putBeans(msg.type as BeanType, [data], true)
    }
  }

  /** Lists arrive for our own `list` requests and, unprompted, whenever a manager's contents change. */
  private receiveList(items: Message[]) {
    if (items.length === 0) return
    const type = items[0].type
    const datas = items.map((m) => (m.data ?? {}) as Record<string, unknown>)
    if ((BEAN_TYPES as readonly string[]).includes(type)) {
      this.putBeans(type as BeanType, datas, false)
    } else if (type === 'power') {
      this.set({ power: Object.fromEntries(datas.map((d) => [String(d.name), d as unknown as Power])) })
    } else if (type === 'rosterEntry') {
      this.set({ roster: {} })
      this.putRoster(datas as unknown as RosterEntry[])
    } else if (type === 'rosterGroup') {
      this.set({ rosterGroups: datas as unknown as RosterGroup[] })
    } else if (type === 'systemConnection') {
      this.set({ connections: datas as unknown as SystemConnection[] })
    }
  }

  private putBeans(type: BeanType, datas: Record<string, unknown>[], single: boolean) {
    const current = single ? { ...this.snap.beans[type] } : {}
    for (const d of datas) {
      const name = String(d.name)
      current[name] = d
      // A list doesn't subscribe; a get on each bean does.
      const key = `${type}:${name}`
      if (!this.watched.has(key)) {
        this.watched.add(key)
        this.send({ type, data: { name } })
      }
    }
    this.set({ beans: { ...this.snap.beans, [type]: current } })
  }

  private putRoster(entries: RosterEntry[]) {
    const roster = { ...this.snap.roster }
    for (const e of entries) roster[e.name] = e
    this.set({ roster })
  }

  private rosterDelta(data: Record<string, unknown>) {
    const roster = { ...this.snap.roster }
    const rem = data.remove as { data?: RosterEntry } | RosterEntry | undefined
    const add = data.add as { data?: RosterEntry } | RosterEntry | undefined
    const unwrap = (x: { data?: RosterEntry } | RosterEntry) => ('data' in x && x.data ? x.data : (x as RosterEntry))
    if (rem) delete roster[unwrap(rem).name]
    if (add) roster[unwrap(add).name] = unwrap(add)
    this.set({ roster })
  }

  private throttleUpdate(data: ThrottleStatus & { release?: unknown; throttle?: string }) {
    const name = data.name ?? data.throttle
    if (!name) return
    const throttles = { ...this.snap.throttles }
    if ('release' in data) {
      delete throttles[name]
    } else {
      const { throttle: _alias, ...fields } = data
      void _alias
      throttles[name] = { ...(throttles[name] ?? { name }), ...fields, acquired: true }
    }
    this.set({ throttles })
  }

  // ---------- commands ----------

  private post(type: string, data: Record<string, unknown>) {
    this.send({ type, method: 'post', data, id: this.nextId++ })
  }

  setBeanState(type: BeanType, name: string, state: number) {
    this.post(type, { name, state })
  }

  setMemory(name: string, value: string | null) {
    this.post('memory', { name, value })
  }

  setPower(state: number, prefix?: string) {
    this.post('power', prefix ? { state, prefix } : { state })
  }

  setClock(fields: Partial<TimeData>) {
    this.send({ type: 'time', method: 'post', data: fields })
  }

  createBean(type: BeanType, name: string, userName?: string) {
    this.send({ type, method: 'put', data: { name, ...(userName ? { userName } : {}) }, id: this.nextId++ })
  }

  acquireThrottle(req: ThrottleRequest) {
    this.wanted.set(req.name, req)
    this.set({
      throttles: {
        ...this.snap.throttles,
        [req.name]: { name: req.name, address: req.address, rosterEntry: req.rosterEntry, acquired: false },
      },
    })
    this.send({ type: 'throttle', data: req })
  }

  throttle(name: string, fields: Record<string, unknown>) {
    // Optimistic local update; the server pushes changes back as they're applied.
    const t = this.snap.throttles[name]
    if (t && !('eStop' in fields) && !('release' in fields)) {
      this.set({ throttles: { ...this.snap.throttles, [name]: { ...t, ...fields } } })
    }
    this.send({ type: 'throttle', data: { name, ...fields } })
  }

  releaseThrottle(name: string) {
    this.wanted.delete(name)
    this.send({ type: 'throttle', data: { name, release: null } })
    const throttles = { ...this.snap.throttles }
    delete throttles[name]
    this.set({ throttles })
  }

  /** Emergency-stop every throttle this client holds. */
  stopAll() {
    for (const name of Object.keys(this.snap.throttles)) this.send({ type: 'throttle', data: { name, eStop: null } })
  }

  heldThrottles() {
    return [...this.wanted.values()]
  }
}
