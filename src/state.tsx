import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import type { JmriClient, Snapshot } from './jmri/client.ts'

export const ClientContext = createContext<JmriClient | null>(null)

export function useClient(): JmriClient {
  const c = useContext(ClientContext)
  if (!c) throw new Error('JmriClient missing')
  return c
}

export function useJmri<T>(select: (s: Snapshot) => T): T {
  const c = useClient()
  return select(useSyncExternalStore(c.subscribe, c.getSnapshot))
}

// localStorage can throw (private mode, blocked storage); every access is guarded.
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export function useStored<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => load(key, fallback))
  const set = useCallback(
    (nv: T) => {
      setV(nv)
      save(key, nv)
    },
    [key],
  )
  return [v, set]
}

export const KEYS = {
  server: 'jmri.server',
  theme: 'jmri.theme',
  throttles: 'jmri.throttles',
  speedUnit: 'jmri.speedUnit',
  showSystem: 'jmri.showSystem',
  panel: 'jmri.panel',
} as const

export type Theme = 'system' | 'light' | 'dark'

const darkQuery = matchMedia('(prefers-color-scheme: dark)')
const subscribeDark = (cb: () => void) => {
  darkQuery.addEventListener('change', cb)
  return () => darkQuery.removeEventListener('change', cb)
}

/** Stored theme preference, its setter, and whether dark is in effect right now (follows the OS on 'system'). */
export function useTheme(): [Theme, (t: Theme) => void, boolean] {
  const [theme, setTheme] = useStored<Theme>(KEYS.theme, 'system')
  const systemDark = useSyncExternalStore(subscribeDark, () => darkQuery.matches)
  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    // Browser chrome (mobile address bar, installed PWA title bar) follows the in-app choice, not just the OS.
    const color = dark ? '#0d1117' : '#f6f8fa'
    for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = color
  }, [dark])
  return [theme, setTheme, dark]
}

/** Simple hash router: #/throttles, #/roster, ... */
export function useRoute(): [string, (r: string) => void] {
  const read = () => location.hash.replace(/^#\/?/, '').split('?')[0] || 'throttles'
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const on = () => setRoute(read())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return [route, (r: string) => (location.hash = `#/${r}`)]
}

type Toast = { id: number; text: string }
const ToastContext = createContext<(text: string) => void>(() => {})
export const useToast = () => useContext(ToastContext)

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
