import { useEffect, useState, type ComponentType, type SVGProps } from 'react'
import {
  IconBlock,
  IconChip,
  IconConsist,
  IconLight,
  IconLogic,
  IconMemory,
  IconMoon,
  IconMore,
  IconPanel,
  IconPower,
  IconRoster,
  IconRoute,
  IconSensor,
  IconSettings,
  IconSignal,
  IconSun,
  IconThrottle,
  IconTrain,
  IconTurnout,
} from './icons.tsx'
import { OFF, ON, type BeanType } from './jmri/protocol.ts'
import { useClient, useJmri, useRoute, useTheme, useToast } from './state.tsx'
import { ConsistsPage } from './views/Consists.tsx'
import { DevicesPage } from './views/Devices.tsx'
import { FastClock } from './views/FastClock.tsx'
import { LogicPage } from './views/Logic.tsx'
import { MemoriesPage } from './views/Memories.tsx'
import { OperationsPage } from './views/Operations.tsx'
import { PanelsPage } from './views/Panels.tsx'
import { ProgrammingPage } from './views/Programming.tsx'
import { RosterPage } from './views/Roster.tsx'
import { SettingsPage } from './views/Settings.tsx'
import { SignalsPage } from './views/Signals.tsx'
import { ThrottlesPage } from './views/Throttles.tsx'

type Count = BeanType | 'roster' | 'throttles' | 'consists' | 'trains' | 'logic'

type NavItem = {
  route: string
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  count?: Count
  /** Shown in the phone bottom bar; everything else is under "More". */
  primary?: boolean
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Operate',
    items: [
      { route: 'throttles', label: 'Throttles', icon: IconThrottle, count: 'throttles', primary: true },
      { route: 'roster', label: 'Roster', icon: IconRoster, count: 'roster', primary: true },
      { route: 'consists', label: 'Consists', icon: IconConsist, count: 'consists' },
      { route: 'panels', label: 'Panels', icon: IconPanel, primary: true },
    ],
  },
  {
    section: 'Layout',
    items: [
      { route: 'turnouts', label: 'Turnouts', icon: IconTurnout, count: 'turnout', primary: true },
      { route: 'routes', label: 'Routes', icon: IconRoute, count: 'route' },
      { route: 'signals', label: 'Signals', icon: IconSignal, count: 'signalMast' },
      { route: 'sensors', label: 'Sensors', icon: IconSensor, count: 'sensor' },
      { route: 'lights', label: 'Lights', icon: IconLight, count: 'light' },
      { route: 'blocks', label: 'Blocks', icon: IconBlock, count: 'block' },
      { route: 'memories', label: 'Memories', icon: IconMemory, count: 'memory' },
    ],
  },
  {
    section: 'Railroad',
    items: [{ route: 'operations', label: 'Operations', icon: IconTrain, count: 'trains' }],
  },
  {
    section: 'Tools',
    items: [
      { route: 'programming', label: 'Programming', icon: IconChip },
      { route: 'logic', label: 'Logic', icon: IconLogic, count: 'logic' },
      { route: 'settings', label: 'Settings', icon: IconSettings },
    ],
  },
]

const ALL_NAV = NAV.flatMap((s) => s.items)

export default function App() {
  const [route, go] = useRoute()
  const [, setTheme, dark] = useTheme()
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

  const [more, setMore] = useState(false)

  const count = (k: Count | undefined) => {
    if (!k) return undefined
    if (k === 'roster') return Object.keys(snap.roster).length
    if (k === 'throttles') return Object.keys(snap.throttles).length
    if (k === 'consists') return Object.keys(snap.consists).length
    if (k === 'trains') return Object.keys(snap.ops.train).length
    if (k === 'logic') return snap.addon ? Object.keys(snap.logixng).length + Object.keys(snap.logix).length : undefined
    if (k === 'signalMast') return Object.keys(snap.beans.signalMast).length + Object.keys(snap.beans.signalHead).length
    return Object.keys(snap.beans[k]).length
  }

  const link = (n: NavItem, onClick?: () => void) => (
    <button
      key={n.route}
      className={`navlink${n.primary ? '' : ' secondary'}`}
      aria-current={route === n.route ? 'page' : undefined}
      onClick={() => {
        go(n.route)
        onClick?.()
      }}
    >
      <n.icon />
      <span>{n.label}</span>
      {n.count && <span className="count">{count(n.count)}</span>}
    </button>
  )
  const moreActive = !ALL_NAV.find((n) => n.route === route)?.primary

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
        {NAV.map((s) => (
          <div key={s.section} className="nav-group">
            <div className="nav-section">{s.section}</div>
            {s.items.map((n) => link(n))}
          </div>
        ))}
        <button className="navlink more-link" aria-current={moreActive ? 'page' : undefined} aria-expanded={more} onClick={() => setMore(true)}>
          <IconMore />
          <span>More</span>
        </button>
      </nav>
      {more && (
        <div className="overlay sheet-overlay" onClick={() => setMore(false)}>
          <nav className="card sheet" aria-label="All sections" onClick={(e) => e.stopPropagation()}>
            {ALL_NAV.map((n) => link(n, () => setMore(false)))}
          </nav>
        </div>
      )}
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
    case 'signals':
      return <SignalsPage />
    case 'consists':
      return <ConsistsPage onDrive={() => go('throttles')} />
    case 'panels':
      return <PanelsPage />
    case 'operations':
      return <OperationsPage />
    case 'programming':
      return <ProgrammingPage />
    case 'logic':
      return <LogicPage />
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
