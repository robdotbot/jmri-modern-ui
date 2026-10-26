import {
  BEAN_TYPES,
  OPS_TYPES,
  consistKey,
  type BeanType,
  type ConsistData,
  type ConsistEngine,
  type OpsType,
  type Hello,
  type LogixData,
  type LogixNGData,
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
  /** `unresponsive` is set when JMRI stops confirming this throttle's commands (see watchThrottle). */
  throttles: Record<string, ThrottleStatus & { acquired: boolean; unresponsive?: boolean; requestedAt?: number }>
  lastError: (JmriError & { at: number }) | null
  /** Version of the JMRI Modern UI add-on, null if JMRI doesn't have it, undefined until known. */
  addon: string | null | undefined
  logix: Record<string, LogixData>
  logixng: Record<string, LogixNGData>
  /** Operations objects by type, keyed by id. */
  ops: Record<OpsType, Record<string, Record<string, unknown>>>
  /** Keyed by consistKey(). */
  consists: Record<string, ConsistData>
  /** Logic or panels were changed from here and JMRI hasn't stored its configuration since. */
  unstored: boolean
}

const emptyBeans = () =>
  Object.fromEntries(BEAN_TYPES.map((t) => [t, {}])) as Snapshot['beans']

export interface ProgramOp {
  op: 'read' | 'write'
  cv: string
  value?: number
  mode?: string
  address?: number
  isLongAddress?: boolean
  /** Program through the facades this decoder definition declares (indexed CVs), as DecoderPro does. */
  decoderFile?: string
}

export interface ProgramResult {
  op: 'read' | 'write'
  cv: string
  value: number
  status: number
  ok: boolean
  message: string
  mode: string | null
}

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
  /** Last values JMRI confirmed for each throttle, and commands still waiting for that confirmation. */
  private confirmed = new Map<string, Record<string, unknown>>()
  private expecting = new Map<string, Map<string, number>>()
  private expectTimer: number | undefined
  /** Requests awaiting a reply with their id. */
  private pending = new Map<number, { resolve: (m: Message) => void; reject: (e: Error) => void }>()
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
      addon: undefined,
      logix: {},
      logixng: {},
      ops: Object.fromEntries(OPS_TYPES.map((t) => [t, {}])) as Snapshot['ops'],
      consists: {},
      unstored: false,
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
      for (const p of this.pending.values()) p.reject(new Error('Connection to JMRI lost'))
      this.pending.clear()
      this.expecting.clear() // unconfirmed commands are lost with the socket, not ignored by JMRI
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
    for (const t of OPS_TYPES) this.send({ type: t, method: 'list' })
    this.send({ type: 'consist', method: 'list' })
    for (const req of this.wanted.values()) this.send({ type: 'throttle', data: req })
    // Optional server add-on (programmer, Logix, LogixNG); JMRI answers 400/404 without it.
    this.request({ type: 'modernUiAddon' })
      .then((m) => {
        this.set({ addon: String((m.data as { version?: string })?.version ?? '?') })
        this.send({ type: 'logix', method: 'list' })
        this.send({ type: 'logixng', method: 'list' })
      })
      .catch(() => this.set({ addon: null }))
  }

  // ---------- inbound ----------

  private receive(msg: Message | Message[]) {
    if (!Array.isArray(msg) && msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      if (msg.type === 'error') {
        const e = msg.data as JmriError
        return p.reject(Object.assign(new Error(e?.message ?? 'JMRI error'), { code: e?.code }))
      }
      p.resolve(msg)
    }
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
      case 'error': {
        const e = data as unknown as JmriError
        // JMRI looks up a loco's own consist when it leaves one and reports a harmless 404 if there is none.
        if (e.code === 404 && /consist .*\((L|S)\)/i.test(e.message ?? '')) return
        return this.set({ lastError: { ...e, at: Date.now() } })
      }
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
      case 'consist':
        return this.set({ consists: { ...this.snap.consists, [consistKey(data as unknown as ConsistData)]: data as unknown as ConsistData } })
      case 'logix':
      case 'logixng': {
        const all = { ...this.snap[msg.type] } as Record<string, unknown>
        if (data.deleted) delete all[String(data.name)]
        else all[String(data.name)] = data
        return this.set({ [msg.type]: all })
      }
      default:
        if ((BEAN_TYPES as readonly string[]).includes(msg.type)) this.putBeans(msg.type as BeanType, [data], true)
        else if ((OPS_TYPES as readonly string[]).includes(msg.type)) this.putOps(msg.type as OpsType, [data], true)
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
    } else if ((OPS_TYPES as readonly string[]).includes(type)) {
      this.putOps(type as OpsType, datas, false)
    } else if (type === 'consist') {
      this.set({ consists: Object.fromEntries(datas.map((d) => [consistKey(d as unknown as ConsistData), d as unknown as ConsistData])) })
    } else if (type === 'logix' || type === 'logixng') {
      this.set({ [type]: Object.fromEntries(datas.map((d) => [String(d.name), d])) })
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

  private putOps(type: OpsType, datas: Record<string, unknown>[], single: boolean) {
    const current = single ? { ...this.snap.ops[type] } : {}
    for (const d of datas) {
      const name = String(d.name)
      current[name] = d
      // Trains and locations are few and change often: watch each. Cars and engines can number in the
      // thousands, so they rely on list pushes plus refreshOps() while their page is open.
      const key = `${type}:${name}`
      if ((type === 'train' || type === 'location') && !this.watched.has(key)) {
        this.watched.add(key)
        this.send({ type, data: { name } })
      }
    }
    this.set({ ops: { ...this.snap.ops, [type]: current } })
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
      this.confirmed.set(name, { ...this.confirmed.get(name), ...fields })
      const waiting = this.expecting.get(name)
      if (waiting) for (const k of Object.keys(fields)) waiting.delete(k === 'speed' ? 'speed' : k)
      // Any push proves JMRI is talking to this throttle again.
      throttles[name] = { ...(throttles[name] ?? { name }), ...fields, acquired: true, unresponsive: false }
    }
    this.set({ throttles })
  }

  /**
   * JMRI pushes every applied change back. If a command that changes something gets no confirmation,
   * the throttle has stopped working server-side (a JMRI bug can leave a shared throttle dead after another
   * client vanishes), and the operator needs to know, because its STOP won't work either.
   */
  private watchThrottle(name: string, fields: Record<string, unknown>) {
    const t = this.snap.throttles[name]
    if (!t?.acquired) return
    const known = this.confirmed.get(name) ?? {}
    const steps = t.speedSteps || 126
    const waiting = this.expecting.get(name) ?? new Map<string, number>()
    const due = Date.now() + 2500
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'eStop') {
        if (typeof known.speed !== 'number' || known.speed >= 0) waiting.set('speed', due)
      } else if (k === 'speed') {
        if (typeof known.speed !== 'number' || Math.abs(known.speed - Number(v)) > 1.5 / steps) waiting.set('speed', due)
      } else if (k === 'forward' || /^F\d+$/.test(k)) {
        if (known[k] !== v) waiting.set(k, due)
      }
    }
    if (waiting.size === 0) return
    this.expecting.set(name, waiting)
    this.expectTimer ??= window.setInterval(() => this.checkExpectations(), 500)
  }

  private checkExpectations() {
    const now = Date.now()
    let changed = false
    const throttles = { ...this.snap.throttles }
    for (const [name, waiting] of this.expecting) {
      if (!throttles[name]) {
        this.expecting.delete(name)
        continue
      }
      if ([...waiting.values()].some((due) => due < now)) {
        waiting.clear()
        if (!throttles[name].unresponsive) {
          throttles[name] = { ...throttles[name], unresponsive: true }
          changed = true
        }
      }
      if (waiting.size === 0) this.expecting.delete(name)
    }
    if (this.expecting.size === 0) {
      clearInterval(this.expectTimer)
      this.expectTimer = undefined
    }
    if (changed) this.set({ throttles })
  }

  // ---------- commands ----------

  /** Send a message and resolve with the reply carrying the same id (rejects on an error reply or timeout). */
  request<T = unknown>(msg: Message, timeoutMs = 30000): Promise<Message<T>> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return reject(new Error('Not connected to JMRI'))
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('JMRI did not answer in time'))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (m) => (clearTimeout(timer), resolve(m as Message<T>)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      })
      this.send({ ...msg, id })
    })
  }

  /** Read or write one CV. Omit `address` for the programming track; give it to program on the main. */
  async program(op: ProgramOp): Promise<ProgramResult> {
    const m = await this.request<ProgramResult>({ type: 'programmer', method: 'post', data: { ...op } }, 60000)
    return m.data!
  }

  // ---- signals ----

  /** Masts take an aspect name (or "Held"); heads take an appearance number (HEAD.*). */
  setSignalMast(name: string, aspect: string) {
    this.post('signalMast', { name, state: aspect })
  }

  setSignalHead(name: string, appearance: number) {
    this.post('signalHead', { name, state: appearance })
  }

  /** JMRI only honours lit/held when sent as strings. */
  setSignalFlags(type: 'signalMast' | 'signalHead', name: string, flags: { lit?: boolean; held?: boolean }) {
    const data: Record<string, unknown> = { name }
    if (flags.lit != null) data.lit = String(flags.lit)
    if (flags.held != null) data.held = String(flags.held)
    this.post(type, data)
  }

  // ---- operations ----

  refreshOps(type: OpsType) {
    this.send({ type, method: 'list' })
  }

  /** build | reset | move (one stop) | terminate — needs the add-on except terminate. */
  async trainAction(id: string, action: 'build' | 'reset' | 'move' | 'terminate') {
    const m = await this.request<{ ok: boolean; status: string; built: boolean; location: string }>(
      { type: 'trainAction', method: 'post', data: { name: id, action } },
      60000,
    )
    this.send({ type: 'train', data: { name: id } })
    this.refreshOps('car')
    this.refreshOps('engine')
    return m.data!
  }

  /** Set a car's or engine's location (and track). JMRI blanks weightTons unless it is resent. */
  async setRollingStockLocation(type: 'car' | 'engine', rs: { name: string; weightTons: string }, location: string | null, track?: string) {
    await this.request({
      type,
      method: 'post',
      data: {
        name: rs.name,
        weightTons: rs.weightTons,
        location: location ? { name: location, ...(track ? { track: { name: track } } : {}) } : null,
      },
    })
    this.refreshOps(type)
  }

  // ---- consists ----
  //
  // Consist changes go over REST, not the WebSocket. Any WebSocket message about a consist makes JMRI attach a
  // listener for that address, and when the consist is later deleted that listener re-creates it empty. REST calls
  // attach nothing and return once JMRI has applied the change (which includes writing CV19 on each loco, so they
  // can take a few seconds); the consist list is then re-read.

  private async consistRest(method: 'PUT' | 'POST' | 'DELETE', c: { address: number; isLongAddress: boolean }, data: Record<string, unknown> = {}) {
    const path = method === 'PUT' ? 'json/consist' : `json/consist/${encodeURIComponent(consistKey(c))}`
    const r = await fetch(new URL(path, this.base), {
      method,
      headers: { 'Content-Type': 'application/json' }, // JMRI 5.6 also needs a body on DELETE, or it fails with a 500
      body: JSON.stringify({ address: c.address, isLongAddress: c.isLongAddress, ...data }),
    })
    const reply = await r.json().catch(() => null)
    if (!r.ok || reply?.type === 'error') {
      throw new Error(reply?.data?.message ?? `JMRI refused the consist change (HTTP ${r.status})`)
    }
    this.send({ type: 'consist', method: 'list' })
  }

  createConsist(address: number, isLongAddress: boolean, name: string, engines: ConsistEngine[]) {
    return this.consistRest('PUT', { address, isLongAddress }, { name, engines })
  }

  /** `engines` is the full membership; JMRI adds, removes and repositions to match. */
  setConsist(c: { address: number; isLongAddress: boolean }, fields: { name?: string; engines?: ConsistEngine[] }) {
    return this.consistRest('POST', c, fields)
  }

  /** JMRI applies direction only when a loco joins, so flip it by removing and re-adding. */
  async setConsistDirection(c: ConsistData, address: number, forward: boolean) {
    const others = c.engines.filter((e) => e.address !== address)
    const me = c.engines.find((e) => e.address === address)
    if (!me) return
    await this.setConsist(c, { engines: others })
    await this.setConsist(c, { engines: c.engines.map((e) => (e.address === address ? { ...e, forward } : e)) })
  }

  async deleteConsist(c: { address: number; isLongAddress: boolean }) {
    await this.consistRest('DELETE', c)
    const consists = { ...this.snap.consists }
    delete consists[consistKey(c)]
    this.set({ consists })
  }

  /** A Logix or LogixNG edit (see the add-on's Logic.java); resolves with the changed item. */
  async editLogic<T>(type: 'logix' | 'logixng', name: string, edit: Record<string, unknown>): Promise<T> {
    const m = await this.request<T>({ type, method: 'post', data: { name, ...edit } })
    this.set({ unstored: true })
    return m.data!
  }

  /** Files JMRI loaded its configuration from, which it can store back to. */
  async storeTargets(): Promise<{ file: string; name: string; exists: boolean }[]> {
    return (await this.request<{ files: { file: string; name: string; exists: boolean }[] }>({ type: 'storeConfig' })).data!.files
  }

  /** PanelPro's Store: write all tables and panels to `file`. */
  async storeConfig(file: string) {
    await this.request({ type: 'storeConfig', method: 'post', data: { file } }, 60000)
    this.set({ unstored: false })
  }

  /** Change an open panel (add-on PanelEditing): move/delete/text/add an item, or move Layout Editor track. */
  async panelEdit(panel: string, edit: Record<string, unknown>) {
    await this.request({ type: 'panelEdit', method: 'post', data: { name: panel, ...edit } })
    this.set({ unstored: true })
  }

  setLogixEnabled(name: string, enabled: boolean) {
    this.post('logix', { name, enabled })
  }

  /** `name` may be a LogixNG or a ConditionalNG. */
  setLogixNG(name: string, fields: { enabled?: boolean; execute?: boolean }) {
    this.post('logixng', { name, ...fields })
  }


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
        [req.name]: { name: req.name, address: req.address, rosterEntry: req.rosterEntry, acquired: false, requestedAt: Date.now() },
      },
    })
    this.send({ type: 'throttle', data: req })
  }

  throttle(name: string, fields: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.watchThrottle(name, fields)
    // Optimistic local update; the server pushes changes back as they're applied.
    const t = this.snap.throttles[name]
    if (t && !('eStop' in fields) && !('release' in fields)) {
      this.set({ throttles: { ...this.snap.throttles, [name]: { ...t, ...fields } } })
    }
    this.send({ type: 'throttle', data: { name, ...fields } })
  }

  /** Drop a throttle that JMRI stopped serving and ask for the same loco again under a new name. */
  reacquireThrottle(name: string) {
    const req = this.wanted.get(name)
    this.releaseThrottle(name)
    if (req) this.acquireThrottle({ ...req, name: `${name.replace(/~\d+$/, '')}~${Date.now() % 100000}` })
  }

  releaseThrottle(name: string) {
    this.confirmed.delete(name)
    this.expecting.delete(name)
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
