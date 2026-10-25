import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

function Svg(props: P) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  )
}

export const IconThrottle = (p: P) => (
  <Svg {...p}>
    <path d="M12 14l4-4" />
    <path d="M3.34 19a10 10 0 1 1 17.32 0" />
  </Svg>
)

export const IconRoster = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="15" height="10" rx="2" />
    <path d="M18 8h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2" />
    <circle cx="7" cy="18" r="2" />
    <circle cx="14" cy="18" r="2" />
    <path d="M6 9h4" />
  </Svg>
)

export const IconTurnout = (p: P) => (
  <Svg {...p}>
    <path d="M4 20V4" />
    <path d="M4 14c0-4 4-6 10-8" />
    <path d="M14 3l4 2-2 4" />
  </Svg>
)

export const IconSensor = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4" />
  </Svg>
)

export const IconLight = (p: P) => (
  <Svg {...p}>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" />
  </Svg>
)

export const IconRoute = (p: P) => (
  <Svg {...p}>
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="5" r="2" />
    <path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" />
  </Svg>
)

export const IconMemory = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M8 9h8M8 13h8M8 17h5" />
  </Svg>
)

export const IconBlock = (p: P) => (
  <Svg {...p}>
    <path d="M3 12h18" />
    <path d="M7 8v8M17 8v8" />
  </Svg>
)

export const IconSignal = (p: P) => (
  <Svg {...p}>
    <rect x="8" y="2" width="8" height="14" rx="4" />
    <circle cx="12" cy="6" r="1.4" />
    <circle cx="12" cy="11" r="1.4" />
    <path d="M12 16v6M8 22h8" />
  </Svg>
)

export const IconSettings = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
)

export const IconPower = (p: P) => (
  <Svg {...p}>
    <path d="M12 2v10" />
    <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
  </Svg>
)

export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Svg>
)

export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconX = (p: P) => (
  <Svg {...p}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Svg>
)

export const IconLeft = (p: P) => (
  <Svg {...p}>
    <path d="M15 18l-6-6 6-6" />
  </Svg>
)

export const IconRight = (p: P) => (
  <Svg {...p}>
    <path d="M9 18l6-6-6-6" />
  </Svg>
)

export const IconStop = (p: P) => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </Svg>
)

export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
)

export const IconMoon = (p: P) => (
  <Svg {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Svg>
)

export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
)

/** Turnout drawn with the route it is set for: straight leg when closed, diverging leg when thrown. */
export const TurnoutGlyph = ({ state, ...p }: P & { state: number }) => {
  const closed = state === 2
  const thrown = state === 4
  return (
    <Svg {...p}>
      <path d="M12 22V12" />
      <path d="M12 12V2" opacity={thrown ? 0.25 : 1} strokeWidth={closed ? 2.6 : 2} />
      <path d="M12 12c0-4 3-6 8-9" opacity={closed ? 0.25 : 1} strokeWidth={thrown ? 2.6 : 2} />
    </Svg>
  )
}
