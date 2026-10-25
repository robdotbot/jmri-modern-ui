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
export const BEAN_TYPES = ['turnout', 'sensor', 'light', 'route', 'block', 'memory'] as const
export type BeanType = (typeof BEAN_TYPES)[number]

export const displayName = (b: { name: string; userName?: string | null }) => b.userName || b.name
