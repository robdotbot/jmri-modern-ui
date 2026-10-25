import { useEffect, type ComponentType, type SVGProps } from 'react'
import {
  IconBlock,
  IconLight,
  IconMemory,
  IconMoon,
  IconPower,
  IconRoster,
  IconRoute,
  IconSensor,
  IconSettings,
  IconSun,
  IconThrottle,
  IconTurnout,
} from './icons.tsx'
import { OFF, ON, type BeanType } from './jmri/protocol.ts'
import { useClient, useJmri, useRoute, useTheme, useToast } from './state.tsx'
import { DevicesPage } from './views/Devices.tsx'
import { MemoriesPage } from './views/Memories.tsx'
import { RosterPage } from './views/Roster.tsx'
import { SettingsPage } from './views/Settings.tsx'
import { ThrottlesPage } from './views/Throttles.tsx'
import { FastClock } from './views/FastClock.tsx'

type NavItem = {
  route: string
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  count?: BeanType | 'roster' | 'throttles'
  secondary?: boolean
}

const NAV: NavItem[] = [
  { route: 'throttles', label: 'Throttles', icon: IconThrottle, count: 'throttles' },
  { route: 'roster', label: 'Roster', icon: IconRoster, count: 'roster' },
  { route: 'turnouts', label: 'Turnouts', icon: IconTurnout, count: 'turnout' },
  { route: 'routes', label: 'Routes', icon: IconRoute, count: 'route' },
  { route: 'sensors', label: 'Sensors', icon: IconSensor, count: 'sensor', secondary: true },
  { route: 'lights', label: 'Lights', icon: IconLight, count: 'light', secondary: true },
  { route: 'blocks', label: 'Blocks', icon: IconBlock, count: 'block', secondary: true },
  { route: 'memories', label: 'Memories', icon: IconMemory, count: 'memory', secondary: true },
  { route: 'settings', label: 'Settings', icon: IconSettings },
]

export default function App() {
  const [route, go] = useRoute()
  const [theme, setTheme] = useTheme()
  const client = useClient()
  const toast = useToast()
  const conn = useJmri((s) => s.conn)
  const hello = useJmri((s) => s.hello)
  const lastError = useJmri((s) => s.lastError)
  const snap = useJmri((s) => s)

  useEffect(() => {
    if (lastError) toast(`JMRI: ${lastError.message} (${lastError.code})`)
  }, [lastError, toast])

  useEffect(() => {
    document.title = hello?.railroad ? `${hello.railroad} · JMRI` : 'JMRI'
  }, [hello?.railroad])

  const count = (k: NavItem['count']) => {
    if (!k) return undefined
    if (k === 'roster') return Object.keys(snap.roster).length
    if (k === 'throttles') return Object.keys(snap.throttles).length
    return Object.keys(snap.beans[k]).length
  }

  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <img src="./favicon.svg" alt="" />
          <span className="full">{hello?.railroad || 'JMRI'}</span>
        </div>
        <ConnPill conn={conn} />
        <div className="spacer" />
        <span className="hide-narrow">
          <FastClock />
        </span>
        <PowerButton />
        <button className="estop" onClick={() => client.stopAll()} title="Emergency stop all my throttles">
          STOP
        </button>
        <button
          className="btn icon ghost hide-narrow"
          aria-label="Toggle theme"
          onClick={() => setTheme(dark ? 'light' : 'dark')}
        >
          {dark ? <IconSun /> : <IconMoon />}
        </button>
      </header>
      <nav className="sidenav" aria-label="Sections">
        {NAV.map((n) => (
          <button
            key={n.route}
            className={`navlink${n.secondary ? ' secondary' : ''}`}
            aria-current={route === n.route ? 'page' : undefined}
            onClick={() => go(n.route)}
          >
            <n.icon />
            <span>{n.label}</span>
            {n.count && <span className="count">{count(n.count)}</span>}
          </button>
        ))}
      </nav>
      <main className="main">
        {conn !== 'open' && (
          <div className="page" style={{ marginBottom: 16 }}>
            <div className={`banner${conn === 'closed' ? ' danger' : ''}`}>
              {conn === 'closed'
                ? `Can't reach JMRI at ${client.base.host}. Retrying… Check that the JMRI web server is running, or change the server in Settings.`
                : `Connecting to JMRI at ${client.base.host}…`}
            </div>
          </div>
        )}
        <Page route={route} go={go} />
      </main>
    </div>
  )
}

function Page({ route, go }: { route: string; go: (r: string) => void }) {
  switch (route) {
    case 'roster':
      return <RosterPage onDrive={() => go('throttles')} />
    case 'turnouts':
      return <DevicesPage type="turnout" title="Turnouts" />
    case 'routes':
      return <DevicesPage type="route" title="Routes" />
    case 'sensors':
      return <DevicesPage type="sensor" title="Sensors" />
    case 'lights':
      return <DevicesPage type="light" title="Lights" />
    case 'blocks':
      return <DevicesPage type="block" title="Blocks" />
    case 'memories':
      return <MemoriesPage />
    case 'settings':
      return <SettingsPage />
    default:
      return <ThrottlesPage onBrowseRoster={() => go('roster')} />
  }
}

function ConnPill({ conn }: { conn: string }) {
  const tone = conn === 'open' ? 'ok' : conn === 'connecting' ? 'warn' : 'danger'
  const label = conn === 'open' ? 'Connected' : conn === 'connecting' ? 'Connecting' : 'Offline'
  return (
    <span className={`pill ${tone}`}>
      <span className="dot" />
      {label}
    </span>
  )
}

function PowerButton() {
  const client = useClient()
  const power = useJmri((s) => s.power)
  const managers = Object.values(power)
  const main = managers.find((p) => p.default) ?? managers[0]
  if (!main) return null
  const on = main.state === ON
  const label = on ? 'Track on' : main.state === OFF ? 'Track off' : 'Track ?'
  return (
    <button
      className={`power ${on ? 'on' : main.state === OFF ? 'off' : ''}`}
      onClick={() => client.setPower(on ? OFF : ON, main.prefix)}
      title={`${main.name}: click to turn ${on ? 'off' : 'on'}`}
      aria-label={`${label}. Turn ${on ? 'off' : 'on'}`}
    >
      <IconPower />
      <span className="label">{label}</span>
    </button>
  )
}
