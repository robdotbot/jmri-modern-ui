// JMRI JSON protocol v5 (java/src/jmri/server/json). State values come from JSON.java.

export const UNKNOWN = 0
export const ON = 2
export const OFF = 4
export const ACTIVE = 2
export const INACTIVE = 4
export const CLOSED = 2
export const THROWN = 4
export const INCONSISTENT = 8

export interface Message<T = unknown> {
  type: string
  data?: T
  method?: 'get' | 'post' | 'put' | 'delete' | 'list'
  id?: number
  list?: string
}

export interface Bean {
  name: string
  userName: string | null
  comment: string | null
  state?: number
}

export interface Turnout extends Bean {
  inverted: boolean
  state: number
  feedbackMode: number
}

export interface Sensor extends Bean {
  inverted: boolean
  state: number
}

export interface Light extends Bean {
  state: number
}

export interface Route extends Bean {
  state: number
}

export interface Block extends Bean {
  state: number
  value: unknown
  sensor: string | null
  length?: number
}

export interface Memory extends Bean {
  value: unknown
}

export interface Power {
  name: string
  state: number
  default: boolean
  prefix?: string
}

export interface FunctionKey {
  name: string // "F0".."Fn"
  label: string | null
  lockable: boolean
  icon: string | null
  selectedIcon: string | null
}

export interface RosterEntry {
  name: string
  address: string
  isLongAddress: boolean
  road: string
  number: string
  mfg: string
  model: string
  decoderModel: string
  decoderFamily: string
  comment: string
  maxSpeedPct: number
  image: string | null
  icon: string | null
  owner: string
  functionKeys: FunctionKey[]
  rosterGroups?: string[]
}

export interface RosterGroup {
  name: string
  length: number
}

export interface TimeData {
  time: string
  rate: number
  state: number
}

export interface Hello {
  JMRI: string
  json: string
  version: string
  heartbeat: number
  railroad: string
  node: string
  activeProfile: string
}

export interface SystemConnection {
  name: string
  prefix: string
  mfg: string | null
  description: string | null
}

/** Status pushed for a held throttle. Function keys appear as F0..Fn booleans. */
export interface ThrottleStatus {
  name: string
  address?: number
  speed?: number
  forward?: boolean
  speedSteps?: number
  clients?: number
  rosterEntry?: string
  prefix?: string
  [fn: `F${number}`]: boolean | undefined
}

/** Bean types the UI lists and watches. */
export const BEAN_TYPES = [
  'turnout',
  'sensor',
  'light',
  'route',
  'block',
  'memory',
  'signalMast',
  'signalHead',
  'layoutBlock',
] as const
export type BeanType = (typeof BEAN_TYPES)[number]

export interface SignalMastData extends Omit<Bean, 'state'> {
  aspect: string
  lit: boolean
  held: boolean
  state: string
}

export interface SignalHeadData extends Bean {
  appearance: number
  appearanceName: string
  lit: boolean
  held: boolean
  state: number
}

/** Signal head appearances (JSON.java / SignalHead.java). */
export const HEAD = {
  DARK: 0x00,
  RED: 0x01,
  FLASHRED: 0x02,
  YELLOW: 0x04,
  FLASHYELLOW: 0x08,
  GREEN: 0x10,
  FLASHGREEN: 0x20,
  LUNAR: 0x40,
  FLASHLUNAR: 0x80,
  HELD: 0x100,
} as const

export interface LayoutBlockData extends Bean {
  state: number
  blockColor: string
  trackColor: string
  occupiedColor: string
  extraColor: string
  useExtraColor: boolean
  occupancySensor: string | null
  block: string | null
}

// ---- operations (java/src/jmri/server/json/operations) ----

export const OPS_TYPES = ['train', 'location', 'car', 'engine'] as const
export type OpsType = (typeof OPS_TYPES)[number]

export interface OpsPlace {
  name: string
  userName: string
  route?: string | null
  track?: { name: string; userName: string } | null
}

export interface RouteStop {
  name: string
  userName: string
  trainDirection: string
  comment: string
  sequenceId: number
  expectedArrivalTime: string
  expectedDepartureTime: string
  location: { name: string; userName: string }
}

export interface TrainData {
  name: string
  userName: string
  iconName: string
  departureTime: string
  description: string
  comment: string
  route: string
  routeId: string
  locations: RouteStop[]
  engines: RollingStockData[]
  cars: RollingStockData[]
  trainDepartsName: string
  trainTerminatesName: string
  location: string
  locationId: string
  status: string
  statusCode: number
  length: number
  weight: number
  leadEngine: string | null
  caboose: string | null
}

/** Train.statusCode values (operations/trains/Train.java). */
export const TRAIN_STATUS = {
  RESET: 0,
  BUILDING: 0x01,
  BUILD_FAILED: 0x02,
  BUILT: 0x10,
  PARTIAL_BUILT: 0x14,
  EN_ROUTE: 0x18,
  TERMINATED: 0x80,
} as const

export interface TrackData {
  name: string
  userName: string
  comment: string
  length: number
  type: string
  carType: string[]
}

export interface LocationData {
  name: string
  userName: string
  length: number
  comment: string
  carType: string[]
  track: TrackData[]
}

/** One stop of a built train's manifest (/operations/manifest/<train id>?format=json). */
export interface ManifestStop {
  name: string
  userName: string
  departureTime?: string
  comment?: string
  trainDirection?: string
  engines: { add: RollingStockData[]; remove: RollingStockData[] }
  cars: { add: RollingStockData[]; remove: RollingStockData[]; total: number; loads: number; empties: number }
}

export interface RollingStockData {
  name: string
  number: string
  road: string
  carType: string
  length: number
  color: string
  owner: string
  built: string
  comment: string
  outOfService: boolean
  locationUnknown: boolean
  location: OpsPlace | null
  destination: OpsPlace | null
  trainId: string | null
  trainName: string | null
  weightTons: string
  // cars
  load?: string
  kernel?: string | null
  hazardous?: boolean
  caboose?: boolean
  passenger?: boolean
  fred?: boolean
  status?: string
  // engines
  model?: string
  hp?: string
  consist?: string | null
}

export interface ConsistEngine {
  address: number
  isLongAddress: boolean
  forward: boolean
  position: number
}

export interface ConsistData {
  address: number
  isLongAddress: boolean
  type: number
  engines: ConsistEngine[]
  name: string
  sizeLimit: number
}

export const consistKey = (c: { address: number; isLongAddress: boolean }) =>
  `${c.address}(${c.isLongAddress ? 'L' : 'S'})`

export const displayName = (b: { name: string; userName?: string | null }) => b.userName || b.name

// ---- types served by the JMRI Modern UI add-on (addon/) ----

export interface ConditionalData {
  name: string
  userName: string | null
  comment: string | null
  state: 'true' | 'false' | 'unknown'
  logicType: string
  antecedent: string
  triggerOnChange: boolean
  variables: string[]
  actions: string[]
}

export interface LogixData {
  name: string
  userName: string | null
  comment: string | null
  enabled: boolean
  conditionals: ConditionalData[]
}

export interface ConditionalNGData {
  name: string
  userName: string | null
  comment: string | null
  enabled: boolean
  /** JMRI's own text rendering of the action/expression tree. */
  tree: string
}

export interface LogixNGData {
  name: string
  userName: string | null
  comment: string | null
  enabled: boolean
  active: boolean
  conditionalNGs: ConditionalNGData[]
}
